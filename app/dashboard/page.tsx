import Link from "next/link";
import { Plus } from "lucide-react";
import AppShell from "@/components/AppShell";
import AttentionWidget from "@/components/dashboard/AttentionWidget";
import RecentBooksWidget from "@/components/dashboard/RecentBooksWidget";
import TargetingFunnelWidget from "@/components/dashboard/TargetingFunnelWidget";
import TargetingAccuracyWidget from "@/components/dashboard/TargetingAccuracyWidget";

/**
 * At-a-glance overview of books, campaigns and targeting performance
 * (Ads Builder redesign handoff). The funnel + accuracy donut are the
 * dashboard's headline widgets now — the old KPI tile row and spend-over-
 * time chart aren't part of this layout; "Needs attention" and "Recent
 * books" cover the same ground the KPI row did, and per-campaign spend
 * detail lives on the Campaign detail page.
 */
export default function DashboardPage() {
  return (
    <AppShell active="dashboard">
      <div className="page-body grid-split">
        <div className="flex flex-col gap-6">
          <TargetingFunnelWidget variant="hero" />

          <div className="grid-split-tight">
            <AttentionWidget />

            <Link href="/books/add" className="action-card action-card-gradient">
              <p className="text-lg font-semibold">Add a new book</p>
              <p className="text-sm" style={{ color: "var(--line-strong)" }}>
                Paste an Amazon product link to capture a new listing and start building its campaigns.
              </p>
              <span
                className="mt-auto inline-flex items-center justify-between gap-2 rounded-md px-3.5 py-2.5 text-sm font-semibold"
                style={{ background: "#ffffff", color: "var(--text-primary)" }}
              >
                Add new book
                <Plus size={16} />
              </span>
            </Link>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <RecentBooksWidget />
          <TargetingAccuracyWidget variant="lg" />
        </div>
      </div>
    </AppShell>
  );
}
