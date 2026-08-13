import { redirect } from "next/navigation";

// Competitor ASINs are part of the combined Keywords/ASINs database now.
export default function CompetitorsPage() {
  redirect("/targets");
}
