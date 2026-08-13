import AppShell from "@/components/AppShell";
import ResultsDatabasePage from "@/components/ResultsDatabasePage";

export default function Results() {
  return (
    <AppShell active="results">
      <ResultsDatabasePage />
    </AppShell>
  );
}
