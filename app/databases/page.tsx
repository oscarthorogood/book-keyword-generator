import { redirect } from "next/navigation";

// The Databases tab switcher is gone: each database is its own route now
// (/books, /campaigns, /results, /presets, /targets), listed in the sidebar.
// Kept so existing links and bookmarks still land somewhere sensible.
export default function DatabasesPage() {
  redirect("/books");
}
