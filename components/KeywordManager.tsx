"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Loader2,
  Plus,
  Search,
  ShieldMinus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import RecommendationsPanel from "./RecommendationsPanel";

type MatchType = "broad" | "phrase" | "exact";
type KeywordStatus = "active" | "paused" | "negative" | "archived" | "rejected";

interface Keyword {
  id: string;
  text: string;
  match_type: MatchType;
  category: string | null;
  status: KeywordStatus;
  bid: number | null;
  source: string | null;
  created_at: string;
  /** Why the filter pipeline rejected or paused this keyword (lib/keywordFilters.ts). */
  rejection_reason?: string | null;
  /** Which filter decided — uiPollution, offTopicEntity, anchorRelevance, … */
  rejected_by_filter?: string | null;
  /** Broad (1) – Very specific (5), from lib/keywordSpecificity.ts. Null for rows generated before sql/09 or for negatives. */
  specificity?: number | null;
}

interface CompetitorAsinRow {
  id: string;
  competitor_asin: string;
  source: string | null;
  status: KeywordStatus;
  bid: number | null;
  rejection_reason: string | null;
  rejected_by_filter: string | null;
  /** Broad (1) – Very specific (5) "closest match to book" rating, from lib/asinSpecificity.ts. */
  specificity?: number | null;
  created_at: string;
}

/** Row type badge (batch 12 item 3): the book detail page's target bank is
 * one table across both keywords and competitor ASINs. */
type BankKind = "keyword" | "asin";

interface BankRow {
  id: string;
  kind: BankKind;
  text: string;
  match_type: MatchType | null;
  status: KeywordStatus;
  bid: number | null;
  source: string | null;
  rejection_reason: string | null;
  rejected_by_filter: string | null;
  specificity: number | null;
  campaigns: string[];
}

async function fetchCompetitors(bookId: string): Promise<CompetitorAsinRow[]> {
  const res = await fetch(`/api/books/${bookId}/competitors`);
  const body = await res.json().catch(() => ({}));
  return res.ok ? (body.competitors ?? []) : [];
}

async function fetchTargetMemberships(
  bookId: string
): Promise<{ keywordCampaigns: Record<string, string[]>; competitorCampaigns: Record<string, string[]> }> {
  const res = await fetch(`/api/books/${bookId}/target-memberships`);
  const body = await res.json().catch(() => ({}));
  return res.ok ? { keywordCampaigns: body.keywordCampaigns ?? {}, competitorCampaigns: body.competitorCampaigns ?? {} } : { keywordCampaigns: {}, competitorCampaigns: {} };
}

const SPECIFICITY_LABELS: Record<number, string> = {
  1: "Broad",
  2: "Somewhat broad",
  3: "Medium",
  4: "Somewhat specific",
  5: "Very specific",
};

interface GenerateSummary {
  insertedCount: number;
  alreadyPresentCount: number;
  generatedCount: number;
  contributingSources: string[];
  byMatchType: Record<string, number>;
  aiRanked: boolean;
  pausedCount?: number;
  rejectedCount?: number;
  negativeCount?: number;
  filterSummary?: {
    byVerdict: Record<string, number>;
    byFilter: Record<string, number>;
    /** Positive-verdict codes for passed keywords — COMP_TITLE_MATCH, CORE_GENRE_MATCH, … */
    byPassCode?: Record<string, number>;
  };
  /** True when the database predates sql/08 and only the active keywords could be stored. */
  needsFilterMigration?: boolean;
}

interface KeywordManagerProps {
  bookId: string;
  metadataCapturedAt?: string;
  metadataReady: boolean;
  genreTerms: string[];
  onKeywordsChanged?: () => void;
}

const STATUSES: KeywordStatus[] = ["active", "paused", "negative", "archived", "rejected"];
const PAGE_SIZE = 100;

/** Status → badge recipe (§4.6). Every one of these is a token pairing. */
const statusBadge: Record<KeywordStatus, string> = {
  active: "badge-success",
  paused: "badge-warning",
  negative: "badge-error",
  archived: "badge-gray",
  rejected: "badge-gray",
};

const STATUS_LABELS: Record<KeywordStatus, string> = {
  active: "Active",
  paused: "Paused",
  negative: "Negative",
  archived: "Archived",
  rejected: "Rejected",
};

/** Filter names are camelCase in the pipeline; show them as words. */
function labelForFilter(filter: string | null | undefined): string {
  if (!filter) return "";
  return filter.replace(/([A-Z])/g, " $1").toLowerCase();
}

/** Positive-verdict codes (lib/keywordFilters.ts) are SCREAMING_SNAKE_CASE; show them as words. */
function labelForPassCode(code: string): string {
  return code.replace(/_/g, " ").toLowerCase();
}

/** Fetches without touching state, so effects never set state synchronously. */
async function fetchKeywords(bookId: string): Promise<Keyword[]> {
  const res = await fetch(`/api/books/${bookId}/keywords`);
  const body = await res.json().catch(() => ({}));
  return res.ok ? (body.keywords ?? []) : [];
}

function labelForSource(source: string | null): string {
  if (!source) return "—";
  return source.replace(/-/g, " ");
}

export default function KeywordManager({
  bookId,
  metadataCapturedAt,
  metadataReady,
  genreTerms,
  onKeywordsChanged,
}: KeywordManagerProps) {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorAsinRow[]>([]);
  const [memberships, setMemberships] = useState<{ keywordCampaigns: Record<string, string[]>; competitorCampaigns: Record<string, string[]> }>({
    keywordCampaigns: {},
    competitorCampaigns: {},
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [newMatchType, setNewMatchType] = useState<MatchType>("phrase");
  const [adding, setAdding] = useState(false);

  const [newAsinText, setNewAsinText] = useState("");
  const [addingAsin, setAddingAsin] = useState(false);
  const [recalculatingBids, setRecalculatingBids] = useState(false);

  // "ready" is a UI-only pseudo-status: status === "active" but not yet a
  // member of any campaign. Only rows genuinely in a campaign show as
  // "Active" — active-but-uncampaigned rows get their own tab instead of
  // being indistinguishable from campaigned ones.
  const [statusFilter, setStatusFilter] = useState<"all" | KeywordStatus | "ready">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | BankKind>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | string>("all");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [filterFilter, setFilterFilter] = useState<"all" | string>("all");
  const [specificityFilter, setSpecificityFilter] = useState<"all" | number>("all");
  const [specificitySort, setSpecificitySort] = useState<"none" | "asc" | "desc">("none");
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [promoteNotice, setPromoteNotice] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [summary, setSummary] = useState<GenerateSummary | null>(null);
  const [keyTropes, setKeyTropes] = useState("");
  // Amazon's own guidance is 25-50 keywords per ad group, so 50 — the top of
  // that range — is the recommended default. Applies per ad group (tropes,
  // comp names), each still bounded by the book-library hard ceiling server-side.
  const [resultCap, setResultCap] = useState(50);

  useEffect(() => {
    let active = true;
    Promise.all([fetchKeywords(bookId), fetchCompetitors(bookId), fetchTargetMemberships(bookId)])
      .then(([kw, comp, memb]) => {
        if (!active) return;
        setKeywords(kw);
        setCompetitors(comp);
        setMemberships(memb);
        setLoadError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : "Could not load the keyword/ASIN bank.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bookId]);

  async function reload() {
    const [kw, comp, memb] = await Promise.all([fetchKeywords(bookId), fetchCompetitors(bookId), fetchTargetMemberships(bookId)]);
    setKeywords(kw);
    setCompetitors(comp);
    setMemberships(memb);
    setSelected(new Set());
    onKeywordsChanged?.();
  }

  /** Restores an archived keyword or ASIN — gated server-side on the
   * recommendation engine no longer suggesting it be archived (item 6). */
  async function restoreArchived(row: BankRow) {
    setPromotingId(row.id);
    setRestoreError(null);
    try {
      const endpoint = row.kind === "keyword" ? `/api/keywords/${row.id}/restore` : `/api/competitors/${row.id}/restore`;
      const res = await fetch(endpoint, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRestoreError(body.error || "Could not restore this row.");
        return;
      }
      await reload();
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : "Could not restore this row.");
    } finally {
      setPromotingId(null);
    }
  }

  async function addKeyword() {
    const text = newText.trim();
    if (!text) return;
    setAdding(true);
    try {
      // Supports pasting a list, one per line or comma separated.
      const entries = text
        .split(/[\n,]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => ({ text: t, matchType: newMatchType }));

      const res = await fetch(`/api/books/${bookId}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entries.length > 1 ? { keywords: entries } : entries[0]),
      });
      if (res.ok) {
        setNewText("");
        await reload();
      }
    } finally {
      setAdding(false);
    }
  }

  async function addAsin() {
    const text = newAsinText.trim();
    if (!text) return;
    setAddingAsin(true);
    try {
      const values = text
        .split(/[\n,]/)
        .map((t) => t.trim())
        .filter(Boolean);
      for (const value of values) {
        await fetch(`/api/books/${bookId}/competitors`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ competitor_asin: value, source: "manual" }),
        });
      }
      setNewAsinText("");
      await reload();
    } finally {
      setAddingAsin(false);
    }
  }

  /** Re-scores computeCompetitorBid() from each selected ASIN's already-stored metadata. */
  async function recalculateBids(ids?: string[]) {
    setRecalculatingBids(true);
    try {
      await fetch(`/api/books/${bookId}/competitors/recalculate-bids`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { ids } : {}),
      });
      if (ids) setSelected(new Set());
      await reload();
    } finally {
      setRecalculatingBids(false);
    }
  }

  /**
   * Optimistic edit of one keyword. The row uses snake_case columns while the
   * PATCH endpoint takes camelCase, so the local patch and the request body
   * are built separately rather than sending a union of both spellings.
   */
  async function updateKeyword(id: string, updates: Partial<Keyword>) {
    setKeywords((prev) => prev.map((k) => (k.id === id ? { ...k, ...updates } : k)));

    const payload: Record<string, unknown> = {};
    if (updates.match_type !== undefined) payload.matchType = updates.match_type;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.bid !== undefined) payload.bid = updates.bid;
    if (updates.text !== undefined) payload.text = updates.text;

    await fetch(`/api/keywords/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    onKeywordsChanged?.();
  }

  async function deleteKeyword(id: string) {
    setKeywords((prev) => prev.filter((k) => k.id !== id));
    await fetch(`/api/keywords/${id}`, { method: "DELETE" });
    onKeywordsChanged?.();
  }

  /**
   * Promotes a per-book rejection to the global negative-keyword library
   * (§15) — a rejection is the best-evidenced negative available (see
   * lib/negativeKeywords.ts), so it doesn't have to be rediscovered on
   * every other book. Global scope by default; the book stays the source
   * of truth for the reason.
   */
  async function promoteToNegativeLibrary(keyword: Keyword) {
    setPromotingId(keyword.id);
    try {
      const res = await fetch("/api/negative-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.text,
          matchType: keyword.match_type === "exact" ? "exact" : "phrase",
          scope: "global",
          reason: keyword.rejection_reason || `Rejected on this book (${labelForFilter(keyword.rejected_by_filter).trim()})`,
          source: "promoted-from-rejection",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setPromoteNotice(
          body.collisions?.length > 0
            ? `Added to the negative library — heads up, it matches an active keyword: ${body.collisions.join(", ")}.`
            : `Added "${keyword.text}" to the negative library.`
        );
      } else {
        setPromoteNotice(body.error || "Could not add to the negative library.");
      }
    } finally {
      setPromotingId(null);
    }
  }

  /**
   * Restores a false-positive rejection: activates it here and adds it to
   * the filter allowlist (§16, scoped) so no future generate run — on this
   * book or any other — rejects that exact text again.
   */
  async function restoreAndAllowlist(keyword: Keyword) {
    setPromotingId(keyword.id);
    try {
      const res = await fetch("/api/filter-allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: keyword.text, filter: keyword.rejected_by_filter }),
      });
      if (res.ok) {
        await updateKeyword(keyword.id, { status: "active" });
        setPromoteNotice(`Restored "${keyword.text}" and added it to the filter allowlist.`);
      } else {
        const body = await res.json().catch(() => ({}));
        setPromoteNotice(body.error || "Could not restore this keyword.");
      }
    } finally {
      setPromotingId(null);
    }
  }

  async function bulkUpdate(status: KeywordStatus) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const keywordIds = ids.filter((id) => rowById(id)?.kind === "keyword");
    const asinIds = ids.filter((id) => rowById(id)?.kind === "asin");
    setKeywords((prev) => prev.map((k) => (selected.has(k.id) ? { ...k, status } : k)));
    setCompetitors((prev) => prev.map((a) => (selected.has(a.id) ? { ...a, status } : a)));
    setSelected(new Set());
    await Promise.all([
      keywordIds.length > 0
        ? fetch(`/api/books/${bookId}/keywords`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: keywordIds, status }),
          })
        : Promise.resolve(),
      asinIds.length > 0
        ? fetch(`/api/books/${bookId}/competitors`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: asinIds, status }),
          })
        : Promise.resolve(),
    ]);
    onKeywordsChanged?.();
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const keywordIds = ids.filter((id) => rowById(id)?.kind === "keyword");
    const asinIds = ids.filter((id) => rowById(id)?.kind === "asin");
    setKeywords((prev) => prev.filter((k) => !selected.has(k.id)));
    setCompetitors((prev) => prev.filter((a) => !selected.has(a.id)));
    setSelected(new Set());
    await Promise.all([
      keywordIds.length > 0
        ? fetch(`/api/books/${bookId}/keywords`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: keywordIds }),
          })
        : Promise.resolve(),
      asinIds.length > 0
        ? fetch(`/api/books/${bookId}/competitors`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: asinIds }),
          })
        : Promise.resolve(),
    ]);
    onKeywordsChanged?.();
  }

  async function generateKeywords() {
    setGenerating(true);
    setGenerateError(null);
    setSummary(null);
    try {
      const res = await fetch(`/api/books/${bookId}/keywords/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyTropes: keyTropes
            .split(/[\n,]/)
            .map((t) => t.trim())
            .filter(Boolean),
          resultCap,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGenerateError(body.error || "Could not generate keywords.");
        return;
      }
      setSummary(body as GenerateSummary);
      setShowGenerateForm(false);
      setKeyTropes("");
      await reload();
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Could not generate keywords.");
    } finally {
      setGenerating(false);
    }
  }

  /**
   * Every filter change runs through here. Selection is scoped to what's on
   * screen: selecting rows on one tab and then switching tabs would otherwise
   * leave a bulk action armed against rows the user can no longer see — and
   * "Delete" would take them all.
   */
  function changeFilters(apply: () => void) {
    apply();
    setVisibleCount(PAGE_SIZE);
    setSelected(new Set());
  }

  /** Combined ASIN + keyword bank (batch 12 item 3): one table, each row
   * tagged with its type and the campaign(s) it's currently active in. */
  const bank: BankRow[] = useMemo(() => {
    const keywordRows: BankRow[] = keywords.map((k) => ({
      id: k.id,
      kind: "keyword",
      text: k.text,
      match_type: k.match_type,
      status: k.status,
      bid: k.bid,
      source: k.source,
      rejection_reason: k.rejection_reason ?? null,
      rejected_by_filter: k.rejected_by_filter ?? null,
      specificity: k.specificity ?? null,
      campaigns: memberships.keywordCampaigns[k.id] ?? [],
    }));
    const asinRows: BankRow[] = competitors.map((a) => ({
      id: a.id,
      kind: "asin",
      text: a.competitor_asin,
      match_type: null,
      status: a.status,
      bid: a.bid,
      source: a.source,
      rejection_reason: a.rejection_reason,
      rejected_by_filter: a.rejected_by_filter,
      specificity: a.specificity ?? null,
      campaigns: memberships.competitorCampaigns[a.id] ?? [],
    }));
    return [...keywordRows, ...asinRows];
  }, [keywords, competitors, memberships]);

  const sources = useMemo(
    () => Array.from(new Set(bank.map((r) => r.source).filter((s): s is string => !!s))).sort(),
    [bank]
  );

  // Rejections are research exhaust, not part of the working list — they get
  // their own tab rather than padding every count in the UI.
  const keptCount = useMemo(() => bank.filter((r) => r.status !== "rejected").length, [bank]);
  const rejectedCount = bank.length - keptCount;

  const rejectingFilters = useMemo(
    () => Array.from(new Set(bank.map((r) => r.rejected_by_filter).filter((f): f is string => !!f))).sort(),
    [bank]
  );

  const inCampaign = (r: BankRow) => r.campaigns.length > 0;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matched = bank.filter((r) => {
      // A generate run produces more rejections than keepers, so the default
      // view is the list you'd actually work with; rejected has its own tab.
      if (statusFilter === "all" && r.status === "rejected") return false;
      if (statusFilter === "active" && !(r.status === "active" && inCampaign(r))) return false;
      if (statusFilter === "ready" && !(r.status === "active" && !inCampaign(r))) return false;
      if (statusFilter !== "all" && statusFilter !== "active" && statusFilter !== "ready" && r.status !== statusFilter) return false;
      if (typeFilter !== "all" && r.kind !== typeFilter) return false;
      if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
      if (filterFilter !== "all" && r.rejected_by_filter !== filterFilter) return false;
      if (specificityFilter !== "all" && r.specificity !== specificityFilter) return false;
      if (term && !r.text.toLowerCase().includes(term)) return false;
      return true;
    });
    if (specificitySort === "none") return matched;
    const sorted = [...matched].sort((a, b) => (a.specificity ?? 0) - (b.specificity ?? 0));
    return specificitySort === "desc" ? sorted.reverse() : sorted;
  }, [bank, statusFilter, typeFilter, sourceFilter, filterFilter, specificityFilter, specificitySort, search]);

  // Item 5: within a specific status tab, split the visible rows into ASIN
  // and Keyword sub-lists rather than one mixed list. "All" and "Rejected"
  // keep the single combined table (there's no status grouping to split).
  const splitByType = statusFilter !== "all";
  const asinVisible = useMemo(() => visible.filter((r) => r.kind === "asin"), [visible]);
  const keywordVisible = useMemo(() => visible.filter((r) => r.kind === "keyword"), [visible]);

  // Active tab: grouped by campaign rather than a flat list — a row in
  // multiple campaigns appears under each. Ungrouped/"All" and other tabs
  // keep the flat combined table.
  const campaignGroups = useMemo(() => {
    if (statusFilter !== "active") return [];
    const byName = new Map<string, BankRow[]>();
    for (const row of visible) {
      for (const name of row.campaigns) {
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name)!.push(row);
      }
    }
    return Array.from(byName.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [statusFilter, visible]);

  const page = visible.slice(0, visibleCount);

  function rowById(id: string): BankRow | undefined {
    return bank.find((r) => r.id === id);
  }

  async function updateRow(row: BankRow, updates: { status?: KeywordStatus; bid?: number | null; match_type?: MatchType }) {
    if (row.kind === "keyword") {
      await updateKeyword(row.id, updates);
    } else {
      setCompetitors((prev) => prev.map((a) => (a.id === row.id ? { ...a, ...updates } : a)));
      await fetch(`/api/competitors/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates.status !== undefined ? { status: updates.status } : { bid: updates.bid }),
      });
    }
  }

  async function deleteRow(row: BankRow) {
    if (row.kind === "keyword") {
      await deleteKeyword(row.id);
    } else {
      setCompetitors((prev) => prev.filter((a) => a.id !== row.id));
      await fetch(`/api/competitors/${row.id}`, { method: "DELETE" });
    }
  }

  return (
    <section className="card">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="card-title">Keyword manager</p>
          <p className="meta-line mt-1">
            {keptCount} keyword{keptCount === 1 ? "" : "s"} for this book
            {rejectedCount > 0 && ` · ${rejectedCount} rejected by the relevance filters`}
            {metadataCapturedAt ? " · generated from the metadata captured when the book was added" : ""}
          </p>
        </div>
      </div>

      <RecommendationsPanel bookId={bookId} />

      {/* Generation is driven from the page-level action bar (BookActionBar); this stays as
          an opt-in for the advanced options (key tropes, result cap) that bar's one-click
          "Generate keywords/ASINs" doesn't expose. */}
      <div className="mb-6">
        <button
          onClick={() => setShowGenerateForm((open) => !open)}
          className="btn-link"
          aria-expanded={showGenerateForm}
        >
          <Sparkles size={16} />
          Advanced generate options (key tropes, result cap)
        </button>
      </div>

      {promoteNotice && (
        <div className="alert mb-6" aria-live="polite">
          <ShieldMinus size={20} className="mt-0.5 shrink-0" style={{ color: "var(--icon-default)" }} />
          <p>{promoteNotice}</p>
        </div>
      )}

      {restoreError && (
        <div className="alert alert-error mb-6" role="alert">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <p className="flex-1">{restoreError}</p>
          <button className="btn btn-tertiary btn-icon btn-sm" onClick={() => setRestoreError(null)} aria-label="Dismiss error">
            <X size={16} />
          </button>
        </div>
      )}

      {loadError && (
        <div className="alert alert-error mb-6" role="alert">
          <AlertTriangle size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="alert-title">Couldn&apos;t load the keyword/ASIN bank</p>
            <p className="mt-1">{loadError}</p>
          </div>
        </div>
      )}

      {showGenerateForm && (
        <div className="card card-compact mb-6" style={{ background: "var(--bg-subtle)" }}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Generate from this book&apos;s metadata
              </p>
              <p className="meta-line mt-1 max-w-2xl">
                Runs the stored ASIN scrape — categories, comparable titles, reviews, Q&amp;A, author
                catalogue, Goodreads/Open Library/Google Books — through every keyword source, plus live
                autocomplete and SerpApi sweeps. Everything is then gated by this book&apos;s relevance
                filters before anything is activated.
              </p>
              {genreTerms.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {genreTerms.slice(0, 6).map((term) => (
                    <span key={term} className="chip-tag">
                      {term}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowGenerateForm(false)}
              className="btn btn-tertiary btn-icon btn-sm"
              aria-label="Close generate panel"
            >
              <X size={20} />
            </button>
          </div>

          {!metadataReady && (
            <div className="alert alert-warning mb-4">
              <AlertTriangle size={20} className="mt-0.5 shrink-0" />
              <p>
                This book&apos;s metadata is incomplete. Re-fetch it above before generating, or the keywords
                won&apos;t reflect the book.
              </p>
            </div>
          )}

          <label className="field-label" htmlFor="key-tropes">
            Key tropes or themes <span style={{ color: "var(--text-tertiary)" }}>(optional)</span>
          </label>
          <textarea
            id="key-tropes"
            value={keyTropes}
            onChange={(e) => setKeyTropes(e.target.value)}
            rows={2}
            placeholder="e.g. enemies to lovers, small town, locked room mystery"
            className="input resize-none"
            aria-describedby="key-tropes-hint"
          />
          <span className="field-hint" id="key-tropes-hint">
            One per line or comma separated. These are the highest-trust signal in the run — they seed the
            trope categories and anchor relevance.
          </span>

          <label className="field-label mt-4" htmlFor="keyword-result-cap">
            Result cap
          </label>
          <select
            id="keyword-result-cap"
            value={resultCap}
            onChange={(e) => setResultCap(Number(e.target.value))}
            className="input w-auto"
          >
            <option value={25}>25 keywords</option>
            <option value={50}>50 keywords (recommended)</option>
            <option value={100}>100 keywords</option>
            <option value={150}>150 keywords</option>
            <option value={300}>300 keywords (no cap)</option>
          </select>
          <span className="field-hint">
            Applies per ad group (tropes, comp names). Amazon recommends 25-50 keywords per ad group for
            focused targeting.
          </span>

          {generateError && (
            <div className="alert alert-error mt-4" role="alert">
              <AlertCircle size={20} className="mt-0.5 shrink-0" />
              <p>{generateError}</p>
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <button onClick={generateKeywords} disabled={generating || !metadataReady} className="btn btn-primary">
              {generating ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
              {generating ? "Generating…" : "Generate keywords"}
            </button>
          </div>
        </div>
      )}

      {summary && (
        <div className="alert alert-success mb-6" aria-live="polite">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="alert-title">
              Added {summary.insertedCount} new keyword{summary.insertedCount === 1 ? "" : "s"}
              {summary.alreadyPresentCount > 0 && ` · ${summary.alreadyPresentCount} already in the list`}
            </p>
            <p className="mt-1">
              {summary.contributingSources.length} sources contributed
              {summary.byMatchType &&
                ` · ${Object.entries(summary.byMatchType)
                  .map(([type, count]) => `${count} ${type}`)
                  .join(", ")}`}
              {summary.aiRanked && " · AI relevance pass applied"}
            </p>
            {summary.needsFilterMigration && (
              <p className="mt-1" style={{ color: "var(--color-error-700)" }}>
                Rejected and paused keywords could not be stored — apply{" "}
                <code className="font-mono">sql/08-keyword-filter-status.sql</code> to this database to keep
                them.
              </p>
            )}
            {summary.filterSummary && (
              <p className="mt-1">
                Relevance filters: {summary.filterSummary.byVerdict.pass ?? 0} kept ·{" "}
                {summary.filterSummary.byVerdict.pause ?? 0} paused ·{" "}
                {summary.filterSummary.byVerdict.reject ?? 0} rejected
                {summary.negativeCount ? ` · ${summary.negativeCount} negatives added` : ""}
                {Object.keys(summary.filterSummary.byFilter).length > 0 &&
                  ` — ${Object.entries(summary.filterSummary.byFilter)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 4)
                    .map(([filter, count]) => `${count} ${labelForFilter(filter).trim()}`)
                    .join(", ")}`}
              </p>
            )}
            {summary.filterSummary?.byPassCode && Object.keys(summary.filterSummary.byPassCode).length > 0 && (
              <p className="mt-1">
                Why kept:{" "}
                {Object.entries(summary.filterSummary.byPassCode)
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, count]) => `${count} ${labelForPassCode(code)}`)
                  .join(", ")}
              </p>
            )}
            <p className="mt-1">{summary.contributingSources.map(labelForSource).join(", ")}</p>
          </div>
        </div>
      )}

      {/* Add keyword */}
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <textarea
          id="manual-keyword-input"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Add a keyword, or paste a list (one per line / comma separated)"
          rows={1}
          className="input min-w-[240px] flex-1 resize-none"
          aria-label="New keyword"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              addKeyword();
            }
          }}
        />
        <select
          value={newMatchType}
          onChange={(e) => setNewMatchType(e.target.value as MatchType)}
          className="input w-auto"
          aria-label="Match type for new keyword"
        >
          <option value="broad">Broad</option>
          <option value="phrase">Phrase</option>
          <option value="exact">Exact</option>
        </select>
        <button onClick={addKeyword} disabled={adding || !newText.trim()} className="btn btn-secondary">
          <Plus size={20} />
          Add
        </button>
      </div>

      {/* Add competitor ASIN */}
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <textarea
          value={newAsinText}
          onChange={(e) => setNewAsinText(e.target.value)}
          placeholder="Add a competitor ASIN, or paste a list (one per line / comma separated)"
          rows={1}
          className="input min-w-[240px] flex-1 resize-none"
          aria-label="New competitor ASIN"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              addAsin();
            }
          }}
        />
        <button onClick={addAsin} disabled={addingAsin || !newAsinText.trim()} className="btn btn-secondary">
          <Plus size={20} />
          Add ASIN
        </button>
      </div>

      {/* Status tabs — the primary cut through the list (§4.4). Ordered so
          Active/Ready (the working set) sit together, then the rest of the
          lifecycle, with All last as the escape hatch. Spread to fill the
          row rather than clustering to one side. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="tabs tabs-spread" role="tablist" aria-label="Filter by status">
          <button
            role="tab"
            aria-selected={statusFilter === "active"}
            onClick={() => changeFilters(() => setStatusFilter("active"))}
            className={`tab ${statusFilter === "active" ? "tab-active" : ""}`}
          >
            Active ({bank.filter((r) => r.status === "active" && inCampaign(r)).length})
          </button>
          <button
            role="tab"
            aria-selected={statusFilter === "ready"}
            onClick={() => changeFilters(() => setStatusFilter("ready"))}
            className={`tab ${statusFilter === "ready" ? "tab-active" : ""}`}
            title="Passed the relevance filters but not yet part of any campaign"
          >
            Ready ({bank.filter((r) => r.status === "active" && !inCampaign(r)).length})
          </button>
          {(["archived", "paused", "negative", "rejected"] as KeywordStatus[]).map((status) => (
            <button
              key={status}
              role="tab"
              aria-selected={statusFilter === status}
              onClick={() => changeFilters(() => setStatusFilter(status))}
              className={`tab ${statusFilter === status ? "tab-active" : ""}`}
            >
              {STATUS_LABELS[status]} ({keywords.filter((k) => k.status === status).length})
            </button>
          ))}
          <button
            role="tab"
            aria-selected={statusFilter === "all"}
            onClick={() => changeFilters(() => setStatusFilter("all"))}
            className={`tab ${statusFilter === "all" ? "tab-active" : ""}`}
          >
            All ({keptCount})
          </button>
        </div>
      </div>

      {/* Search + secondary filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={20} className="input-icon" aria-hidden="true" />
          <label className="sr-only" htmlFor="keyword-search">
            Search keywords
          </label>
          <input
            id="keyword-search"
            type="search"
            value={search}
            onChange={(e) => changeFilters(() => setSearch(e.target.value))}
            placeholder="Search keywords"
            className="input input-with-icon"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => changeFilters(() => setTypeFilter(e.target.value as "all" | BankKind))}
          className="input w-auto"
          aria-label="Filter by type"
        >
          <option value="all">ASINs &amp; keywords</option>
          <option value="keyword">Keywords only</option>
          <option value="asin">ASINs only</option>
        </select>

        <select
          value={sourceFilter}
          onChange={(e) => changeFilters(() => setSourceFilter(e.target.value))}
          className="input w-auto"
          aria-label="Filter by source"
        >
          <option value="all">All sources</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {labelForSource(source)}
            </option>
          ))}
        </select>

        {rejectingFilters.length > 0 && (
          <select
            value={filterFilter}
            onChange={(e) => changeFilters(() => setFilterFilter(e.target.value))}
            className="input w-auto"
            aria-label="Filter by rejecting filter"
          >
            <option value="all">Any filter verdict</option>
            {rejectingFilters.map((filter) => (
              <option key={filter} value={filter}>
                {labelForFilter(filter).trim()} ({keywords.filter((k) => k.rejected_by_filter === filter).length})
              </option>
            ))}
          </select>
        )}

        <select
          value={specificityFilter}
          onChange={(e) =>
            changeFilters(() => setSpecificityFilter(e.target.value === "all" ? "all" : Number(e.target.value)))
          }
          className="input w-auto"
          aria-label="Filter by specificity"
        >
          <option value="all">Any specificity</option>
          {[1, 2, 3, 4, 5].map((level) => (
            <option key={level} value={level}>
              {SPECIFICITY_LABELS[level]}
            </option>
          ))}
        </select>
      </div>

      {selected.size > 0 && (
        <div
          className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border p-3"
          style={{ background: "var(--bg-subtle)", borderColor: "var(--line)" }}
        >
          <span className="mr-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {selected.size} selected
          </span>
          {STATUSES.filter((status) => status !== "rejected").map((status) => (
            <button key={status} onClick={() => bulkUpdate(status)} className="btn btn-secondary btn-sm">
              Mark {STATUS_LABELS[status].toLowerCase()}
            </button>
          ))}
          {Array.from(selected).some((id) => rowById(id)?.kind === "asin") && (
            <button
              onClick={() => recalculateBids(Array.from(selected).filter((id) => rowById(id)?.kind === "asin"))}
              disabled={recalculatingBids}
              className="btn btn-secondary btn-sm"
              title="Re-score the selected ASINs' bids from their stored price/BSR/competitor-count signals"
            >
              <Calculator size={16} />
              {recalculatingBids ? "Recalculating…" : "Recalculate bids"}
            </button>
          )}
          <button onClick={bulkDelete} className="btn btn-destructive btn-sm">
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      )}

      {loading ? (
        <div className="table-wrap" aria-busy="true" aria-label="Loading keyword/ASIN bank">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-4 border-b p-4" style={{ borderColor: "var(--line)" }}>
              <div className="skeleton h-4 w-4 shrink-0" />
              <div className="skeleton h-4 flex-1" />
              <div className="skeleton h-4 w-20 shrink-0" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <span className="icon-tile icon-tile-lg icon-tile-dark">
            <Sparkles size={24} />
          </span>
          <div className="space-y-1">
            <p className="empty-state-title">{bank.length === 0 ? "No keywords or ASINs yet" : "Nothing matches these filters"}</p>
            <p className="empty-state-body">
              {bank.length === 0
                ? "Generate keywords from this book's metadata, or add your own above."
                : "Try a different status tab, or clear the search."}
            </p>
          </div>
          {bank.length === 0 ? (
            <button onClick={() => setShowGenerateForm(true)} className="btn btn-primary">
              <Sparkles size={20} />
              Generate keywords
            </button>
          ) : (
            <button
              onClick={() =>
                changeFilters(() => {
                  setSearch("");
                  setStatusFilter("all");
                  setTypeFilter("all");
                  setSourceFilter("all");
                  setFilterFilter("all");
                })
              }
              className="btn btn-secondary"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : statusFilter === "active" ? (
        <div className="space-y-6">
          {campaignGroups.map(([name, rows]) => (
            <div key={name}>
              <p className="meta-line text-xs mb-2">
                {name} ({rows.length})
              </p>
              {renderBankTable(rows)}
            </div>
          ))}
        </div>
      ) : (
        <>
          {splitByType ? (
            <div className="space-y-6">
              <div>
                <p className="meta-line text-xs mb-2">ASINs ({asinVisible.length})</p>
                {asinVisible.length > 0 ? renderBankTable(asinVisible) : <p className="meta-line text-xs">None</p>}
              </div>
              <div>
                <p className="meta-line text-xs mb-2">Keywords ({keywordVisible.length})</p>
                {keywordVisible.length > 0 ? renderBankTable(keywordVisible) : <p className="meta-line text-xs">None</p>}
              </div>
            </div>
          ) : (
            renderBankTable(page)
          )}

          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Showing {splitByType ? visible.length : page.length} of {visible.length}
            </p>
            {!splitByType && page.length < visible.length && (
              <button onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="btn btn-secondary">
                Show more
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );

  /** Renders one combined ASIN+keyword table for the given rows (batch 12
   * items 3 & 5). Declared inside the component so it closes over state. */
  function renderBankTable(rows: BankRow[]) {
    const pageAllSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
    return (
      <div className="table-wrap overflow-x-auto">
        <table className="table table-dense">
          <thead>
            <tr>
              <th scope="col" className="w-8">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={pageAllSelected}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (pageAllSelected) rows.forEach((r) => next.delete(r.id));
                      else rows.forEach((r) => next.add(r.id));
                      return next;
                    })
                  }
                  aria-label="Select all shown rows"
                />
              </th>
              <th scope="col">Type</th>
              <th scope="col">Keyword / ASIN</th>
              <th scope="col">Match</th>
              <th scope="col" className="hidden lg:table-cell">
                Source
              </th>
              <th scope="col" className="hidden xl:table-cell">
                Filter verdict
              </th>
              <th scope="col" className="hidden md:table-cell">
                <button
                  type="button"
                  onClick={() =>
                    setSpecificitySort((prev) => (prev === "none" ? "asc" : prev === "asc" ? "desc" : "none"))
                  }
                  className="flex items-center gap-1"
                  aria-label="Sort by specificity"
                  title="Broad → Specific"
                >
                  Specificity
                  {specificitySort !== "none" && <span aria-hidden="true">{specificitySort === "asc" ? "↑" : "↓"}</span>}
                </button>
              </th>
              <th scope="col">Bid</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={selected.has(row.id)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(row.id);
                        else next.delete(row.id);
                        return next;
                      })
                    }
                    aria-label={`Select ${row.text}`}
                  />
                </td>
                <td>
                  <span className="badge badge-gray">{row.kind === "keyword" ? "Keyword" : "ASIN"}</span>
                </td>
                <td>
                  <p className="cell-primary">{row.text}</p>
                </td>
                <td>
                  {row.kind === "keyword" ? (
                    <select
                      value={row.match_type ?? "phrase"}
                      onChange={(e) => updateRow(row, { match_type: e.target.value as MatchType })}
                      className="input input-sm w-auto"
                      aria-label={`Match type for ${row.text}`}
                    >
                      <option value="broad">Broad</option>
                      <option value="phrase">Phrase</option>
                      <option value="exact">Exact</option>
                    </select>
                  ) : (
                    <span style={{ color: "var(--text-placeholder)" }}>—</span>
                  )}
                </td>
                <td className="hidden lg:table-cell">{labelForSource(row.source)}</td>
                <td className="hidden xl:table-cell">
                  {row.rejected_by_filter ? (
                    <span title={row.rejection_reason ?? undefined}>
                      <span className="cell-primary">{labelForFilter(row.rejected_by_filter).trim()}</span>
                      {row.rejection_reason && <span className="meta-line block text-xs">{row.rejection_reason}</span>}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-placeholder)" }}>—</span>
                  )}
                </td>
                <td className="hidden md:table-cell">
                  {row.specificity ? (
                    <span
                      className="inline-flex items-center gap-0.5"
                      title={SPECIFICITY_LABELS[row.specificity]}
                      aria-label={`Specificity: ${SPECIFICITY_LABELS[row.specificity]}`}
                    >
                      {[1, 2, 3, 4, 5].map((step) => (
                        <span
                          key={step}
                          aria-hidden="true"
                          style={{
                            display: "inline-block",
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: step <= row.specificity! ? "var(--icon-active, currentColor)" : "var(--border-default, #d1d5db)",
                          }}
                        />
                      ))}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-placeholder)" }}>—</span>
                  )}
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.bid ?? ""}
                    onChange={(e) => updateRow(row, { bid: e.target.value === "" ? null : parseFloat(e.target.value) })}
                    placeholder="—"
                    className="input input-sm w-20"
                    aria-label={`Bid for ${row.text}`}
                  />
                </td>
                <td>
                  <select
                    value={row.status}
                    onChange={(e) => updateRow(row, { status: e.target.value as KeywordStatus })}
                    className={`badge ${statusBadge[row.status]} cursor-pointer appearance-none pr-3`}
                    aria-label={`Status for ${row.text}`}
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="text-right">
                  <div className="flex justify-end gap-1">
                    {row.status === "rejected" && row.kind === "keyword" && (
                      <>
                        <button
                          onClick={() => {
                            const kw = keywords.find((k) => k.id === row.id);
                            if (kw) restoreAndAllowlist(kw);
                          }}
                          disabled={promotingId === row.id}
                          className="btn btn-tertiary btn-icon btn-sm"
                          aria-label={`Restore ${row.text} and add it to the filter allowlist`}
                          title="False positive? Restore & allowlist"
                        >
                          <CheckCircle2 size={16} style={{ color: "var(--icon-default)" }} />
                        </button>
                        <button
                          onClick={() => {
                            const kw = keywords.find((k) => k.id === row.id);
                            if (kw) promoteToNegativeLibrary(kw);
                          }}
                          disabled={promotingId === row.id}
                          className="btn btn-tertiary btn-icon btn-sm"
                          aria-label={`Promote ${row.text} to the negative-keyword library`}
                          title="Promote to negative library"
                        >
                          <ShieldMinus size={16} style={{ color: "var(--icon-default)" }} />
                        </button>
                      </>
                    )}
                    {row.status === "rejected" && row.kind === "asin" && (
                      <button
                        onClick={() => updateRow(row, { status: "active" })}
                        className="btn btn-tertiary btn-icon btn-sm"
                        aria-label={`Restore ${row.text}`}
                        title="False positive? Restore"
                      >
                        <CheckCircle2 size={16} style={{ color: "var(--icon-default)" }} />
                      </button>
                    )}
                    {row.status === "archived" && (
                      <button
                        onClick={() => restoreArchived(row)}
                        disabled={promotingId === row.id}
                        className="btn btn-tertiary btn-icon btn-sm"
                        aria-label={`Restore ${row.text} to active`}
                        title="Restore to active — only allowed while the recommendation engine no longer suggests archiving it"
                      >
                        <CheckCircle2 size={16} style={{ color: "var(--icon-default)" }} />
                      </button>
                    )}
                    <button
                      onClick={() => deleteRow(row)}
                      className="btn btn-tertiary btn-icon btn-sm"
                      aria-label={`Delete ${row.text}`}
                      title="Delete"
                    >
                      <Trash2 size={16} style={{ color: "var(--icon-default)" }} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
}
