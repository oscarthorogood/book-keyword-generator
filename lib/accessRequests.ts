import { supabaseAdmin } from "./supabaseAdmin";

/**
 * Sign-in is open to anyone with a plausible email — there's no approval
 * gate. This table now doubles as a usage log: every sign-in request bumps
 * `sign_in_count` and `last_signed_in_at`, which is what the admin console
 * reads to show who's actually using the app. An admin can still block a
 * specific address by setting its status to 'denied'.
 *
 * SERVER ONLY — every function here uses the service-role client.
 */

const TABLE = "access_requests";

export type AccessStatus = "pending" | "approved" | "denied";

export interface AccessRequest {
  email: string;
  status: AccessStatus;
  requested_at: string;
  sign_in_count: number;
  last_signed_in_at: string | null;
}

/**
 * Lowercase and trim. Every lookup and insert goes through this so
 * "User@Example.com" and "user@example.com" are the same account, matching
 * the `email = lower(email)` constraint on the table.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Deliberately permissive — real validation is "can it receive the link". */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export async function findAccessRequest(
  email: string
): Promise<AccessRequest | null> {
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .select("*")
    .eq("email", normalizeEmail(email))
    .maybeSingle();

  if (error) {
    throw new Error(`Access request lookup failed: ${error.message}`);
  }
  return (data as AccessRequest) ?? null;
}

/**
 * Record a sign-in request: first time seeing this address, insert it as
 * approved; otherwise bump its usage counters. A row already marked 'denied'
 * is left untouched — the caller checks the returned status and skips
 * sending a link when blocked.
 */
export async function recordSignInAttempt(email: string): Promise<AccessRequest> {
  const normalized = normalizeEmail(email);
  const existing = await findAccessRequest(normalized);
  const now = new Date().toISOString();

  if (!existing) {
    const { data, error } = await supabaseAdmin()
      .from(TABLE)
      .insert({
        email: normalized,
        status: "approved",
        sign_in_count: 1,
        last_signed_in_at: now,
      })
      .select("*")
      .single();

    if (error) {
      throw new Error(`Could not record sign-in: ${error.message}`);
    }
    return data as AccessRequest;
  }

  if (existing.status === "denied") {
    return existing;
  }

  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .update({
      last_signed_in_at: now,
      sign_in_count: existing.sign_in_count + 1,
    })
    .eq("email", normalized)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Could not record sign-in: ${error.message}`);
  }
  return data as AccessRequest;
}

/** Every known address, most recently active first. Admin view. */
export async function listAccessRequests(): Promise<AccessRequest[]> {
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .select("*")
    .order("last_signed_in_at", { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(`Could not list access requests: ${error.message}`);
  }
  return (data as AccessRequest[]) ?? [];
}

/**
 * Block or unblock an address. This is the admin-console path, where
 * authorization is the caller's session rather than a signed link.
 */
export async function setAccessStatus(
  email: string,
  status: Exclude<AccessStatus, "pending">
): Promise<AccessRequest | null> {
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .update({ status })
    .eq("email", normalizeEmail(email))
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not update access: ${error.message}`);
  }
  return (data as AccessRequest) ?? null;
}

/**
 * Delete the Supabase auth user for an address, if one exists.
 *
 * This is what makes revocation take effect *now*. Marking the row 'denied'
 * only stops new magic links being issued — an already-signed-in browser keeps
 * working until its token expires, because proxy.ts validates the session
 * against Supabase, not against this table. Removing the auth user invalidates
 * those sessions immediately.
 *
 * Best-effort: a failure here is logged, not thrown, so the status change
 * still lands.
 */
export async function destroyAuthUser(email: string): Promise<void> {
  const target = normalizeEmail(email);
  try {
    const admin = supabaseAdmin();
    // listUsers is paginated and has no email filter, so page until found.
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) throw new Error(error.message);
      if (!data.users.length) return;

      const match = data.users.find((u) => u.email?.toLowerCase() === target);
      if (match) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(match.id);
        if (deleteError) throw new Error(deleteError.message);
        return;
      }
      if (data.users.length < 200) return;
    }
  } catch (err) {
    console.error(
      `Could not remove auth user for ${target}:`,
      err instanceof Error ? err.message : err
    );
  }
}
