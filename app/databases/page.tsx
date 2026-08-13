"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import AllKeywordsPage from "@/components/AllKeywordsPage";
import CompetitorsOverviewPage from "@/components/CompetitorsOverviewPage";
import SourcesPage from "@/components/SourcesPage";

type DatabaseTab = "keywords" | "competitors" | "sources";

const TABS: Array<{ tab: DatabaseTab; label: string }> = [
  { tab: "keywords", label: "Keywords" },
  { tab: "competitors", label: "Competitors" },
  { tab: "sources", label: "Sources" },
];

function isDatabaseTab(value: string | null): value is DatabaseTab {
  return value === "keywords" || value === "competitors" || value === "sources";
}

/**
 * Databases tab switcher (Enhancements spec §2): what used to be three
 * separate top-level routes (/keywords, /competitors, /sources) are now
 * sub-views of a single page, selected via `?tab=`. The old routes redirect
 * here (see app/keywords/page.tsx etc.) so bookmarks and existing links
 * keep working. Each sub-view is the same self-contained component the old
 * route rendered — mounted as-is, not rewritten.
 */
function DatabasesTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [fallbackTab, setFallbackTab] = useState<DatabaseTab>("keywords");
  const activeTab = isDatabaseTab(tabParam) ? tabParam : fallbackTab;

  function selectTab(tab: DatabaseTab) {
    setFallbackTab(tab);
    router.replace(`/databases?tab=${tab}`, { scroll: false });
  }

  // Each sub-view (AllKeywordsPage etc.) renders its own full page-header
  // and title, so the switcher here is just a thin tab bar sitting above it —
  // not a second "Databases" header competing with it.
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <div className="border-b px-6 pt-4" style={{ borderColor: "var(--line)" }}>
        <div className="tabs" role="tablist" aria-label="Database">
          {TABS.map(({ tab, label }) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => selectTab(tab)}
              className={`tab ${activeTab === tab ? "tab-active" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1">
        {activeTab === "keywords" && <AllKeywordsPage />}
        {activeTab === "competitors" && <CompetitorsOverviewPage />}
        {activeTab === "sources" && <SourcesPage />}
      </div>
    </div>
  );
}

export default function DatabasesPage() {
  return (
    <AppShell active="databases">
      <Suspense fallback={null}>
        <DatabasesTabs />
      </Suspense>
    </AppShell>
  );
}
