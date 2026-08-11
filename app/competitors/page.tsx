import AppShell from "@/components/AppShell";
import CompetitorsOverviewPage from "@/components/CompetitorsOverviewPage";

export default function CompetitorsPage() {
  return (
    <AppShell active="competitors">
      <CompetitorsOverviewPage />
    </AppShell>
  );
}
