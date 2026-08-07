import { normalizeEmail } from "./accessRequests";
import { currentUserEmail } from "./supabaseServer";

/**
 * Admin is whoever ADMIN_EMAIL points at — the same person who receives the
 * approve/deny emails. Deliberately a single address rather than a role
 * column: there is exactly one operator, and a role table nobody maintains is
 * worse than no role table.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  const admin = process.env.ADMIN_EMAIL;
  if (!admin || !email) return false;
  return normalizeEmail(email) === normalizeEmail(admin);
}

/** True when the signed-in user is the admin. */
export async function isCurrentUserAdmin(): Promise<boolean> {
  return isAdminEmail(await currentUserEmail());
}
