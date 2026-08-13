import { redirect } from "next/navigation";

// Keywords and ASINs are one database now — see app/targets/page.tsx.
export default function KeywordsPage() {
  redirect("/targets");
}
