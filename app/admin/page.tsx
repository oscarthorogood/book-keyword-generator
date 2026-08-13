import { notFound } from "next/navigation";
import { AccessManager } from "@/components/AccessManager";
import AppShell from "@/components/AppShell";
import { listAccessRequests, normalizeEmail } from "@/lib/accessRequests";
import { isAdminEmail } from "@/lib/admin";
import { currentUserEmail } from "@/lib/supabaseServer";

/**
 * Access console. proxy.ts already guarantees a session here; this page adds
 * the admin check on top.
 *
 * Renders 404 rather than 403 for non-admins so the page's existence isn't
 * advertised to ordinary users.
 */
export default async function AdminPage() {
  const email = await currentUserEmail();
  if (!email || !isAdminEmail(email)) {
    notFound();
  }

  return (
    <AppShell active="access">
      <div className="flex min-h-screen flex-col bg-white">
        <header className="page-header">
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle mt-1 max-w-2xl">
            Everyone who has signed in, and how often. Blocking ends any active session immediately
            and stops new sign-in links; unblocking emails a fresh one.
          </p>
        </header>

        <div className="page-body flex-1">
          <AccessManager
            adminEmail={normalizeEmail(email)}
            initialRequests={await listAccessRequests()}
          />
        </div>
      </div>
    </AppShell>
  );
}
