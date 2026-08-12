"use client";

import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import CampaignDetailPage from "@/components/CampaignDetailPage";

export default function CampaignPage() {
  const params = useParams<{ id: string }>();

  return (
    <AppShell active="campaigns">
      <CampaignDetailPage campaignId={params.id} />
    </AppShell>
  );
}
