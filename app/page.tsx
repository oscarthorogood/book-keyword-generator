import { redirect } from "next/navigation";

/** "/" is the dashboard's address; every section is its own route (Enhancements spec §2). */
export default function Home() {
  redirect("/dashboard");
}
