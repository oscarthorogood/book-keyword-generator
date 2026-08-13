import { redirect } from "next/navigation";

// Competitors moved into the Databases tab switcher (Enhancements spec §2).
export default function CompetitorsPage() {
  redirect("/databases?tab=competitors");
}
