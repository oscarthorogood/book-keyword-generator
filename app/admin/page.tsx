import { notFound } from "next/navigation";
import { AccessManager } from "@/components/AccessManager";
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
    <main className="flex-1 bg-white">
      <div className="mx-auto w-full" style={{ maxWidth: "var(--container-max)" }}>
        <header className="page-header">
          <h1 className="page-title">Access</h1>
          <p className="page-subtitle mt-1 max-w-2xl">
            Who can sign in. Revoking ends any active session immediately and blocks new sign-in links;
            reinstating emails a fresh one.
          </p>
        </header>

        <div className="page-body">
          <AccessManager
            adminEmail={normalizeEmail(email)}
            initialRequests={await listAccessRequests()}
          />
        </div>
      </div>
    </main>
  );
}
