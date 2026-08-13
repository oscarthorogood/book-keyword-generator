import { redirect } from "next/navigation";

// Sources moved into the Databases tab switcher (Enhancements spec §2).
export default function Sources() {
  redirect("/databases?tab=sources");
}
