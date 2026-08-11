import AppShell from "@/components/AppShell";
import KeywordStatsWidget from "@/components/dashboard/KeywordStatsWidget";
import RecentBooksWidget from "@/components/dashboard/RecentBooksWidget";
import TopKeywordsByGenreWidget from "@/components/dashboard/TopKeywordsByGenreWidget";

export default function DashboardPage() {
  return (
    <AppShell active="dashboard">
      <div className="flex min-h-screen flex-col bg-white">
        <header className="page-header">
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle mt-1">An overview across every book you&apos;re running keywords for.</p>
        </header>

        <div className="page-body flex-1">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <RecentBooksWidget />
            <TopKeywordsByGenreWidget />
            <KeywordStatsWidget />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
