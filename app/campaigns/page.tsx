import AppShell from "@/components/AppShell";
import CampaignsOverviewPage from "@/components/CampaignsOverviewPage";

export default function CampaignsPage() {
  return (
    <AppShell active="campaigns">
      <CampaignsOverviewPage />
    </AppShell>
  );
}
