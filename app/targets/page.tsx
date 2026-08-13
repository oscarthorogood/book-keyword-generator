import AppShell from "@/components/AppShell";
import TargetsDatabasePage from "@/components/TargetsDatabasePage";

// The single Keywords/ASINs database — what used to be /keywords and
// /competitors as separate pages (both now redirect here).
export default function Targets() {
  return (
    <AppShell active="targets">
      <TargetsDatabasePage />
    </AppShell>
  );
}
