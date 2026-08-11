"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { GenreKeywordGroup } from "@/lib/dashboardStats";

/** Dashboard "Top keywords by genre" widget (Enhancements spec §2). Own fetch, fails soft. */
export default function TopKeywordsByGenreWidget() {
  const [groups, setGroups] = useState<GenreKeywordGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard/genre-keywords")
      .then((res) => res.json().catch(() => ({})).then((body) => ({ res, body })))
      .then(({ res, body }) => {
        if (!active) return;
        if (!res.ok) setError(body.error || "Couldn't load top keywords.");
        else setGroups(body.groups);
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "Couldn't load top keywords."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="card p-5">
      <h2 className="text-md font-semibold" style={{ color: "var(--text-primary)" }}>
        Top keywords by genre
      </h2>
      {loading ? (
        <div className="skeleton mt-3 h-24 w-full" />
      ) : error ? (
        <div className="alert alert-error mt-3" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      ) : !groups || groups.length === 0 ? (
        <p className="meta-line mt-3">No active keywords yet.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {groups.slice(0, 6).map((group) => (
            <div key={group.genre}>
              <p className="mb-1 text-sm font-medium capitalize">{group.genre}</p>
              <div className="flex flex-wrap gap-1">
                {group.keywords.map((k) => (
                  <Link key={`${k.bookId}-${k.text}`} href={`/books/${k.bookId}`} className="chip-tag" title={k.bookTitle}>
                    {k.text}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
