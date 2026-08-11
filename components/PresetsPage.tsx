"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Plus, Trash2 } from "lucide-react";

type MatchType = "broad" | "phrase" | "exact";
type Tier = "a" | "b";

interface PresetKeywordRow {
  id: string;
  genre_id: string;
  keyword: string;
  match_type: MatchType;
  tier: Tier;
  author_references?: string[] | null;
}

interface PresetGenreRow {
  id: string;
  name: string;
  parent_id: string | null;
  keywords: PresetKeywordRow[];
}

async function fetchGenres(): Promise<{ genres: PresetGenreRow[]; error: string | null; needsMigration?: boolean }> {
  try {
    const res = await fetch("/api/presets/genres");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { genres: [], error: body.error || "Could not load presets." };
    return { genres: body.genres ?? [], error: null, needsMigration: body.needsMigration };
  } catch (err) {
    return { genres: [], error: err instanceof Error ? err.message : "Could not load presets." };
  }
}

/** Preset keyword library management (Enhancements spec §3): genre tree + keyword lists. */
export default function PresetsPage() {
  const [genres, setGenres] = useState<PresetGenreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  const [selectedGenreId, setSelectedGenreId] = useState<string | null>(null);
  const [newGenreName, setNewGenreName] = useState("");
  const [newGenreParentId, setNewGenreParentId] = useState<string>("");
  const [creatingGenre, setCreatingGenre] = useState(false);

  const [newKeyword, setNewKeyword] = useState("");
  const [newKeywordMatchType, setNewKeywordMatchType] = useState<MatchType>("phrase");
  const [newKeywordTier, setNewKeywordTier] = useState<Tier>("a");
  const [addingKeyword, setAddingKeyword] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const [reloadToken, setReloadToken] = useState(0);
  const load = () => setReloadToken((n) => n + 1);

  useEffect(() => {
    let active = true;
    fetchGenres().then(({ genres: loaded, error, needsMigration: migration }) => {
      if (!active) return;
      setGenres(loaded);
      setLoadError(error);
      setNeedsMigration(!!migration);
      setLoading(false);
      setSelectedGenreId((current) => current ?? loaded[0]?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const topLevel = useMemo(() => genres.filter((g) => !g.parent_id), [genres]);
  const childrenOf = (parentId: string) => genres.filter((g) => g.parent_id === parentId);
  const selectedGenre = genres.find((g) => g.id === selectedGenreId) ?? null;

  async function importStarterLibrary() {
    setImporting(true);
    setImportMessage(null);
    try {
      const res = await fetch("/api/presets/import-starter-library", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportMessage(body.error || "Could not import the starter library.");
        return;
      }
      setImportMessage(
        body.keywordsAdded > 0
          ? `Added ${body.keywordsAdded} new preset keyword${body.keywordsAdded === 1 ? "" : "s"} across ${body.genresTotal ?? ""} genres.`
          : "Starter library is already fully imported — nothing new to add."
      );
      load();
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : "Could not import the starter library.");
    } finally {
      setImporting(false);
    }
  }

  async function createGenre() {
    const name = newGenreName.trim();
    if (!name) return;
    setCreatingGenre(true);
    try {
      const res = await fetch("/api/presets/genres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId: newGenreParentId || null }),
      });
      if (res.ok) {
        setNewGenreName("");
        setNewGenreParentId("");
        load();
      }
    } finally {
      setCreatingGenre(false);
    }
  }

  async function deleteGenre(id: string) {
    if (!confirm("Delete this genre and its preset keywords? Books that already applied them keep their keywords.")) return;
    await fetch(`/api/presets/genres/${id}`, { method: "DELETE" });
    if (selectedGenreId === id) setSelectedGenreId(null);
    load();
  }

  async function addKeyword() {
    const keyword = newKeyword.trim();
    if (!keyword || !selectedGenreId) return;
    setAddingKeyword(true);
    try {
      const res = await fetch("/api/presets/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genreId: selectedGenreId, keyword, matchType: newKeywordMatchType, tier: newKeywordTier }),
      });
      if (res.ok) {
        setNewKeyword("");
        load();
      }
    } finally {
      setAddingKeyword(false);
    }
  }

  async function deleteKeyword(id: string) {
    await fetch(`/api/presets/keywords/${id}`, { method: "DELETE" });
    load();
  }

  async function updateKeywordTier(id: string, tier: Tier) {
    await fetch(`/api/presets/keywords/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    });
    load();
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Preset Keywords by Genre</h1>
          <p className="page-subtitle mt-1">
            A managed keyword library, applied to matching books with one click from the book page.
          </p>
        </div>
        <button onClick={importStarterLibrary} disabled={importing} className="btn btn-secondary">
          <Download size={20} />
          {importing ? "Importing…" : "Import starter library"}
        </button>
      </header>

      {importMessage && (
        <div className="page-body pb-0">
          <div className="alert alert-success" aria-live="polite">
            <p>{importMessage}</p>
          </div>
        </div>
      )}

      <div className="page-body flex-1">
        {loadError ? (
          <div className="alert alert-error" role="alert">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <p>{loadError}</p>
          </div>
        ) : needsMigration ? (
          <div className="alert alert-error" role="alert">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <p>Run sql/10-preset-keywords.sql against the database to enable this page.</p>
          </div>
        ) : loading ? (
          <div className="skeleton h-64 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
            <div>
              <div className="card p-4">
                <p className="mb-3 text-sm font-medium">Genres</p>
                <ul className="space-y-1">
                  {topLevel.map((genre) => (
                    <li key={genre.id}>
                      <button
                        onClick={() => setSelectedGenreId(genre.id)}
                        className={`nav-item w-full text-left ${selectedGenreId === genre.id ? "nav-item-active" : ""}`}
                      >
                        {genre.name}
                        <span className="meta-line ml-1 text-xs">({genre.keywords.length})</span>
                      </button>
                      {childrenOf(genre.id).length > 0 && (
                        <ul className="ml-3 space-y-1 border-l pl-2" style={{ borderColor: "var(--line)" }}>
                          {childrenOf(genre.id).map((sub) => (
                            <li key={sub.id}>
                              <button
                                onClick={() => setSelectedGenreId(sub.id)}
                                className={`nav-item w-full text-left ${selectedGenreId === sub.id ? "nav-item-active" : ""}`}
                              >
                                {sub.name}
                                <span className="meta-line ml-1 text-xs">({sub.keywords.length})</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                  {topLevel.length === 0 && <p className="meta-line">No genres yet — add one below.</p>}
                </ul>
              </div>

              <div className="card mt-4 p-4">
                <p className="mb-3 text-sm font-medium">Add genre</p>
                <input
                  value={newGenreName}
                  onChange={(e) => setNewGenreName(e.target.value)}
                  placeholder="Genre name"
                  className="input mb-2 w-full"
                />
                <select
                  value={newGenreParentId}
                  onChange={(e) => setNewGenreParentId(e.target.value)}
                  className="input mb-2 w-full"
                  aria-label="Parent genre (optional)"
                >
                  <option value="">Top-level genre</option>
                  {topLevel.map((g) => (
                    <option key={g.id} value={g.id}>
                      Sub-genre of {g.name}
                    </option>
                  ))}
                </select>
                <button onClick={createGenre} disabled={creatingGenre || !newGenreName.trim()} className="btn btn-secondary w-full">
                  <Plus size={16} />
                  Add genre
                </button>
              </div>
            </div>

            <div>
              {!selectedGenre ? (
                <div className="empty-state">
                  <p>Select or create a genre to manage its preset keywords.</p>
                </div>
              ) : (
                <div className="card p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="card-title">{selectedGenre.name}</p>
                    <button onClick={() => deleteGenre(selectedGenre.id)} className="btn btn-tertiary btn-sm">
                      <Trash2 size={16} />
                      Delete genre
                    </button>
                  </div>

                  <div className="mb-4 flex flex-wrap items-end gap-2">
                    <div className="flex-1">
                      <label className="mb-1 block text-xs" style={{ color: "var(--text-secondary)" }}>
                        Keyword
                      </label>
                      <input
                        value={newKeyword}
                        onChange={(e) => setNewKeyword(e.target.value)}
                        placeholder="e.g. cozy mystery series"
                        className="input w-full"
                        onKeyDown={(e) => e.key === "Enter" && addKeyword()}
                      />
                    </div>
                    <select
                      value={newKeywordMatchType}
                      onChange={(e) => setNewKeywordMatchType(e.target.value as MatchType)}
                      className="input w-auto"
                      aria-label="Match type"
                    >
                      <option value="broad">Broad</option>
                      <option value="phrase">Phrase</option>
                      <option value="exact">Exact</option>
                    </select>
                    <select
                      value={newKeywordTier}
                      onChange={(e) => setNewKeywordTier(e.target.value as Tier)}
                      className="input w-auto"
                      aria-label="Tier"
                      title="Tier A applies automatically; Tier B is applied paused for review"
                    >
                      <option value="a">Tier A (auto-apply)</option>
                      <option value="b">Tier B (review first)</option>
                    </select>
                    <button onClick={addKeyword} disabled={addingKeyword || !newKeyword.trim()} className="btn btn-primary">
                      <Plus size={16} />
                      Add
                    </button>
                  </div>

                  <div className="table-wrap overflow-x-auto">
                    <table className="table table-dense">
                      <thead>
                        <tr>
                          <th scope="col">Keyword</th>
                          <th scope="col">Match</th>
                          <th scope="col">Tier</th>
                          <th scope="col">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedGenre.keywords.map((kw) => (
                          <tr key={kw.id}>
                            <td>
                              <p className="cell-primary">{kw.keyword}</p>
                              {kw.author_references && kw.author_references.length > 0 && (
                                <p className="meta-line text-xs">Researched against: {kw.author_references.join(", ")}</p>
                              )}
                            </td>
                            <td className="capitalize">{kw.match_type}</td>
                            <td>
                              <select
                                value={kw.tier}
                                onChange={(e) => updateKeywordTier(kw.id, e.target.value as Tier)}
                                className="input input-sm w-auto"
                                aria-label={`Tier for ${kw.keyword}`}
                              >
                                <option value="a">A</option>
                                <option value="b">B</option>
                              </select>
                            </td>
                            <td className="text-right">
                              <button
                                onClick={() => deleteKeyword(kw.id)}
                                className="btn btn-tertiary btn-icon btn-sm"
                                aria-label={`Delete ${kw.keyword}`}
                              >
                                <Trash2 size={16} style={{ color: "var(--icon-default)" }} />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {selectedGenre.keywords.length === 0 && (
                          <tr>
                            <td colSpan={4} className="meta-line">
                              No preset keywords yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
