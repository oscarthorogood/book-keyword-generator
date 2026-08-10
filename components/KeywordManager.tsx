"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Sparkles, X } from "lucide-react";

type MatchType = "broad" | "phrase" | "exact";
type KeywordStatus = "active" | "paused" | "negative" | "archived";

interface Keyword {
  id: string;
  text: string;
  match_type: MatchType;
  category: string | null;
  status: KeywordStatus;
  bid: number | null;
  source: string | null;
  created_at: string;
}

const statusStyles: Record<KeywordStatus, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  paused: "bg-yellow-50 text-yellow-700 border-yellow-200",
  negative: "bg-red-50 text-red-700 border-red-200",
  archived: "bg-gray-50 text-gray-500 border-gray-200",
};

export default function KeywordManager({ bookId }: { bookId: string }) {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState("");
  const [newMatchType, setNewMatchType] = useState<MatchType>("phrase");
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<"all" | KeywordStatus>("all");
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [keyTropes, setKeyTropes] = useState("");

  async function loadKeywords() {
    setLoading(true);
    try {
      const res = await fetch(`/api/books/${bookId}/keywords`);
      const body = await res.json().catch(() => ({}));
      setKeywords(res.ok ? body.keywords ?? [] : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadKeywords();
  }, [bookId]);

  async function addKeyword() {
    const text = newText.trim();
    if (!text) return;
    setAdding(true);
    try {
      // Support comma/newline separated bulk paste
      const entries = text
        .split(/[\n,]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => ({ text: t, matchType: newMatchType }));

      const res = await fetch(`/api/books/${bookId}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          entries.length > 1 ? { keywords: entries } : entries[0]
        ),
      });
      if (res.ok) {
        setNewText("");
        await loadKeywords();
      }
    } finally {
      setAdding(false);
    }
  }

  async function updateKeyword(id: string, updates: Partial<Keyword>) {
    setKeywords((prev) =>
      prev.map((k) => (k.id === id ? { ...k, ...updates } : k))
    );
    await fetch(`/api/keywords/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  }

  async function deleteKeyword(id: string) {
    setKeywords((prev) => prev.filter((k) => k.id !== id));
    await fetch(`/api/keywords/${id}`, { method: "DELETE" });
  }

  async function generateKeywords() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/keywords/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyTropes: keyTropes
            .split(/[\n,]/)
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGenerateError(body.error || "Failed to generate keywords.");
        return;
      }
      setShowGenerateForm(false);
      setKeyTropes("");
      await loadKeywords();
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Failed to generate keywords.");
    } finally {
      setGenerating(false);
    }
  }

  const visible = keywords.filter((k) => filter === "all" || k.status === filter);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Keywords</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGenerateForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Sparkles size={14} />
            Generate new keywords
          </button>
        </div>
      </div>

      {/* Generate keywords form */}
      {showGenerateForm && (
        <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-900">Generate new keywords</p>
            <button onClick={() => setShowGenerateForm(false)} className="text-gray-400 hover:text-gray-700">
              <X size={16} />
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Re-scrapes the product page and runs it through the keyword taxonomy
            (genre, tropes, autocomplete, buyer intent) to add new candidates.
          </p>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Key tropes / themes (optional, one per line)
          </label>
          <textarea
            value={keyTropes}
            onChange={(e) => setKeyTropes(e.target.value)}
            rows={2}
            placeholder="e.g. grumpy billionaire, enemies to lovers"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 resize-none focus:outline-none focus:ring-2 focus:ring-gray-300"
          />
          {generateError && <p className="text-xs text-red-600 mb-3">{generateError}</p>}
          <button
            onClick={generateKeywords}
            disabled={generating}
            className="btn-pill-dark px-4 py-2 text-sm disabled:opacity-50"
          >
            {generating ? "Analysing..." : "Analyse & generate"}
          </button>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 mb-4">
        {(["all", "active", "paused", "negative", "archived"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
              filter === s
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
            {s !== "all" && ` (${keywords.filter((k) => k.status === s).length})`}
          </button>
        ))}
      </div>

      {/* Add keyword form */}
      <div className="flex items-start gap-2 mb-4">
        <textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Add a keyword (or paste a list, one per line / comma-separated)"
          rows={1}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300"
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
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
        >
          <option value="broad">Broad</option>
          <option value="phrase">Phrase</option>
          <option value="exact">Exact</option>
        </select>
        <button
          onClick={addKeyword}
          disabled={adding || !newText.trim()}
          className="btn-pill-dark px-4 py-2 text-sm disabled:opacity-50"
        >
          <Plus size={16} className="inline mr-1" />
          Add
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500 text-sm">Loading keywords...</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-gray-600 text-sm">
            {keywords.length === 0
              ? "No keywords yet. Add your first keyword above."
              : "No keywords match this filter."}
          </p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Keyword</th>
                <th className="text-left px-4 py-2 font-medium">Match Type</th>
                <th className="text-left px-4 py-2 font-medium">Category</th>
                <th className="text-left px-4 py-2 font-medium">Bid</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((k) => (
                <tr key={k.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-900">{k.text}</td>
                  <td className="px-4 py-2">
                    <select
                      value={k.match_type}
                      onChange={(e) =>
                        updateKeyword(k.id, { match_type: e.target.value as MatchType })
                      }
                      className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
                    >
                      <option value="broad">Broad</option>
                      <option value="phrase">Phrase</option>
                      <option value="exact">Exact</option>
                    </select>
                  </td>
                  <td className="px-4 py-2 text-gray-500">{k.category || "—"}</td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={k.bid ?? ""}
                      onChange={(e) =>
                        updateKeyword(k.id, {
                          bid: e.target.value === "" ? null : parseFloat(e.target.value),
                        })
                      }
                      placeholder="—"
                      className="w-20 border border-gray-200 rounded px-2 py-1 text-xs"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={k.status}
                      onChange={(e) =>
                        updateKeyword(k.id, { status: e.target.value as KeywordStatus })
                      }
                      className={`border rounded px-2 py-1 text-xs font-medium ${statusStyles[k.status]}`}
                    >
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="negative">Negative</option>
                      <option value="archived">Archived</option>
                    </select>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => deleteKeyword(k.id)}
                      title="Delete keyword"
                      className="text-gray-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
