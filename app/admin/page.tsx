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
    <main className="flex-1 flex justify-center px-3 py-6 md:px-6 md:py-10">
      <div className="w-full max-w-3xl shell p-4 md:p-8">
        <div className="mb-6">
          <p className="brand-title text-base md:text-lg">Access</p>
          <p className="eyebrow">Who can sign in</p>
        </div>

        <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
          Revoking ends any active session immediately and blocks new sign-in
          links. Reinstating emails a fresh link.
        </p>

        <AccessManager
          adminEmail={normalizeEmail(email)}
          initialRequests={await listAccessRequests()}
        />
      </div>
    </main>
  );
}
