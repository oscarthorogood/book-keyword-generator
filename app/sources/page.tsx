import AppShell from "@/components/AppShell";
import SourcesPage from "@/components/SourcesPage";

/**
 * Source health for the generation pipeline.
 *
 * Deliberately not in the sidebar: the five databases are Books, Campaigns,
 * Results, Presets and Keywords/ASINs, and this is a diagnostic, not a
 * database. Kept as a working route so it's there when a source starts
 * failing and someone needs to see which one.
 */
export default function Sources() {
  return (
    <AppShell active="sources">
      <SourcesPage />
    </AppShell>
  );
}
