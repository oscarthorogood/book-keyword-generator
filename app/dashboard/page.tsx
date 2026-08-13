import AppShell from "@/components/AppShell";
import OverviewStatsWidget from "@/components/dashboard/OverviewStatsWidget";
import AttentionWidget from "@/components/dashboard/AttentionWidget";
import CampaignSummaryWidget from "@/components/dashboard/CampaignSummaryWidget";
import RecentBooksWidget from "@/components/dashboard/RecentBooksWidget";

/**
 * Books, campaigns and results across the whole library.
 *
 * The keyword-flavoured widgets (Keyword stats, Top keywords by genre) are
 * gone: keywords are an implementation detail of campaign generation now,
 * not something the user manages, so a dashboard panel ranking them was
 * reporting on machinery rather than on work.
 */
export default function DashboardPage() {
  return (
    <AppShell active="dashboard">
      <div className="flex min-h-screen flex-col bg-white">
        <header className="page-header">
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle mt-1">An overview of every book and campaign you&apos;re running.</p>
        </header>

        <div className="page-body flex-1 space-y-5">
          <OverviewStatsWidget />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <CampaignSummaryWidget />
            <AttentionWidget />
          </div>

          <RecentBooksWidget />
        </div>
      </div>
    </AppShell>
  );
}
