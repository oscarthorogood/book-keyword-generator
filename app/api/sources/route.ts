import { SOURCE_REGISTRY } from "@/lib/sourceRegistry";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export interface SourceUsageRow {
  id: string;
  label: string;
  description: string;
  usedFor: ("keywords" | "competitors")[];
  /** Pipelines this source feeds without owning the rows — see SourceDefinition.seedsFor. */
  seedsFor?: ("keywords" | "competitors")[];
  configEnvVar?: string;
  configured: boolean;
  keywordCount: number;
  competitorCount: number;
  lastUsedAt: string | null;
}

function countAndLatestBy(
  rows: Array<{ source: string | null; created_at: string }>
): Map<string, { count: number; lastUsedAt: string | null }> {
  const byId = new Map<string, { count: number; lastUsedAt: string | null }>();
  for (const row of rows) {
    const id = row.source ?? "unknown";
    const entry = byId.get(id) ?? { count: 0, lastUsedAt: null };
    entry.count += 1;
    if (!entry.lastUsedAt || row.created_at > entry.lastUsedAt) entry.lastUsedAt = row.created_at;
    byId.set(id, entry);
  }
  return byId;
}

/**
 * GET /api/sources
 *
 * Powers the Sources sidebar page: every data source the two generation
 * pipelines can draw on (lib/sourceRegistry.ts), whether it's configured
 * (an env var it needs is set — checked here, server-side only, so the key
 * itself never reaches the client), and how much it's actually contributed
 * per source — counted the same way the dashboard's keyword-stats widget
 * does (grouping the already-persisted `source` column on `keywords` and
 * `competitor_asins`), so no separate usage-tracking table is needed.
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const [{ data: keywordRows, error: keywordError }, { data: competitorRows, error: competitorError }] =
      await Promise.all([
        supabase.from("keywords").select("source, created_at").eq("user_id", user.id),
        supabase.from("competitor_asins").select("source, created_at").eq("user_id", user.id),
      ]);

    if (keywordError) return Response.json({ error: keywordError.message }, { status: 400 });
    if (competitorError) return Response.json({ error: competitorError.message }, { status: 400 });

    const keywordUsage = countAndLatestBy(keywordRows ?? []);
    const competitorUsage = countAndLatestBy(competitorRows ?? []);

    const sources: SourceUsageRow[] = SOURCE_REGISTRY.map((def) => {
      const kw = keywordUsage.get(def.id);
      const comp = competitorUsage.get(def.id);
      const lastUsedAt = [kw?.lastUsedAt, comp?.lastUsedAt].filter((d): d is string => !!d).sort().pop() ?? null;
      return {
        id: def.id,
        label: def.label,
        description: def.description,
        usedFor: def.usedFor,
        seedsFor: def.seedsFor,
        configEnvVar: def.configEnvVar,
        configured: def.configEnvVar ? !!process.env[def.configEnvVar] : true,
        keywordCount: kw?.count ?? 0,
        competitorCount: comp?.count ?? 0,
        lastUsedAt,
      };
    });

    // Any source tag actually present in the data but missing from the
    // registry (a stale/renamed source) still shows up, rather than
    // silently vanishing from the totals.
    const knownIds = new Set(SOURCE_REGISTRY.map((d) => d.id));
    for (const [id, entry] of keywordUsage) {
      if (knownIds.has(id)) continue;
      sources.push({
        id,
        label: id,
        description: "Not in the source registry — check lib/sourceRegistry.ts.",
        usedFor: ["keywords"],
        configured: true,
        keywordCount: entry.count,
        competitorCount: competitorUsage.get(id)?.count ?? 0,
        lastUsedAt: entry.lastUsedAt,
      });
      knownIds.add(id);
    }
    for (const [id, entry] of competitorUsage) {
      if (knownIds.has(id)) continue;
      sources.push({
        id,
        label: id,
        description: "Not in the source registry — check lib/sourceRegistry.ts.",
        usedFor: ["competitors"],
        configured: true,
        keywordCount: 0,
        competitorCount: entry.count,
        lastUsedAt: entry.lastUsedAt,
      });
      knownIds.add(id);
    }

    return Response.json({ success: true, sources });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
