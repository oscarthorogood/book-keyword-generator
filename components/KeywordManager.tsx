"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

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

  const visible = keywords.filter((k) => filter === "all" || k.status === filter);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Keywords</h2>
        <div className="flex items-center gap-2">
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
