import { redirect } from "next/navigation";

// Keywords moved into the Databases tab switcher (Enhancements spec §2).
export default function KeywordsPage() {
  redirect("/databases?tab=keywords");
}
