import { jwtVerify, SignJWT } from "jose";
import { AUTH_CONFIG } from "./config";
import { supabaseAdmin } from "./supabaseAdmin";

/**
 * Allowlist gating magic-link sign-in.
 *
 * An address is only ever sent a login link once it has status 'approved'.
 * A first-time address is recorded as 'pending' and the admin is emailed a
 * pair of signed approve/deny links.
 *
 * SERVER ONLY — every function here uses the service-role client.
 */

const TABLE = "access_requests";

export type AccessStatus = "pending" | "approved" | "denied";

export interface AccessRequest {
  email: string;
  status: AccessStatus;
  decision_token: string | null;
  requested_at: string;
  notified_at: string | null;
  decided_at: string | null;
}

/** Don't re-email the admin more than once per hour for the same address. */
const RENOTIFY_AFTER_MS = 60 * 60 * 1000;

/** Approve/deny links stop working after this long. */
const DECISION_TOKEN_TTL = "14d";

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
 * Record a first-time address as pending. Returns the stored row, including
 * the nonce that the approve/deny links are signed against.
 */
export async function createPendingRequest(
  email: string
): Promise<AccessRequest> {
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .insert({ email: normalizeEmail(email), status: "pending" })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Could not record access request: ${error.message}`);
  }
  return data as AccessRequest;
}

/** True when enough time has passed to email the admin about this row again. */
export function shouldRenotify(request: AccessRequest): boolean {
  if (request.status !== "pending") return false;
  if (!request.notified_at) return true;
  return Date.now() - new Date(request.notified_at).getTime() > RENOTIFY_AFTER_MS;
}

export async function markNotified(email: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from(TABLE)
    .update({ notified_at: new Date().toISOString() })
    .eq("email", normalizeEmail(email));
  if (error) {
    // Non-fatal: the admin email already went out, this only affects throttling.
    console.error("Could not update notified_at:", error.message);
  }
}

/**
 * Apply a decision, but only to a row that is still pending and still holds
 * the nonce the link was signed against. The conditional update is what makes
 * the link single-use: a second click matches zero rows.
 */
export async function applyDecision(
  email: string,
  nonce: string,
  status: Exclude<AccessStatus, "pending">
): Promise<AccessRequest | null> {
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .update({
      status,
      decided_at: new Date().toISOString(),
      decision_token: null,
    })
    .eq("email", normalizeEmail(email))
    .eq("decision_token", nonce)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not apply decision: ${error.message}`);
  }
  return (data as AccessRequest) ?? null;
}

/** Every request, newest first. Admin view. */
export async function listAccessRequests(): Promise<AccessRequest[]> {
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .select("*")
    .order("requested_at", { ascending: false });

  if (error) {
    throw new Error(`Could not list access requests: ${error.message}`);
  }
  return (data as AccessRequest[]) ?? [];
}

/**
 * Set a status directly, bypassing the nonce check the email links use. This
 * is the admin-console path, where authorization is the caller's session.
 *
 * Unlike `applyDecision` this works on an already-decided row, which is what
 * makes revoking (approved -> denied) and reinstating possible.
 */
export async function setAccessStatus(
  email: string,
  status: Exclude<AccessStatus, "pending">
): Promise<AccessRequest | null> {
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .update({
      status,
      decided_at: new Date().toISOString(),
      // Burn any outstanding email link so it can't undo this later.
      decision_token: null,
    })
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

interface DecisionClaims {
  email: string;
  action: Exclude<AccessStatus, "pending">;
  nonce: string;
}

/**
 * Sign an approve/deny link payload. Signed with AUTH_SECRET so a guessed URL
 * can't grant access, and bound to the row's nonce so it can only be used once.
 */
export async function signDecisionToken(
  claims: DecisionClaims
): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(DECISION_TOKEN_TTL)
    .sign(AUTH_CONFIG.SECRET_KEY);
}

export async function verifyDecisionToken(
  token: string
): Promise<DecisionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, AUTH_CONFIG.SECRET_KEY);
    const { email, action, nonce } = payload as Partial<DecisionClaims>;
    if (
      typeof email !== "string" ||
      typeof nonce !== "string" ||
      (action !== "approved" && action !== "denied")
    ) {
      return null;
    }
    return { email, action, nonce };
  } catch {
    return null;
  }
}
