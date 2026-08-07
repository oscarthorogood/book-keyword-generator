import { supabaseAdmin } from "./supabaseAdmin";

/**
 * Magic-link generation.
 *
 * Links are minted server-side with the admin API and delivered through our
 * own Resend templates rather than Supabase's built-in mailer. That keeps the
 * approval email and the login email looking identical, and sidesteps the
 * strict rate limit on Supabase's default SMTP.
 *
 * The emailed URL points at /auth/confirm with a `token_hash`, which that
 * route exchanges for a session via verifyOtp.
 */

/**
 * Absolute origin for links in emails. NEXT_PUBLIC_SITE_URL wins when set
 * (correct for production); otherwise fall back to the origin of the request
 * that triggered the email, which is right for local dev and previews.
 */
export function siteUrl(requestUrl: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  return new URL(requestUrl).origin;
}

/**
 * Ensure an auth user exists for this address.
 *
 * Approval is our gate, so the address is treated as confirmed on creation —
 * the magic link itself proves control of the inbox. An address that already
 * exists is left untouched.
 */
async function ensureUser(email: string): Promise<void> {
  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (!error) return;

  // Already registered is the expected path for returning users.
  const message = error.message.toLowerCase();
  if (message.includes("already") || message.includes("exists")) return;

  throw new Error(`Could not create auth user: ${error.message}`);
}

/**
 * Mint a single-use sign-in URL for an approved address.
 *
 * Throws if Supabase rejects the request; callers decide whether that's fatal.
 */
export async function createMagicLink(
  email: string,
  origin: string,
  next = "/"
): Promise<string> {
  await ensureUser(email);

  const { data, error } = await supabaseAdmin().auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (error || !data?.properties?.hashed_token) {
    throw new Error(
      `Could not generate magic link: ${error?.message ?? "no token returned"}`
    );
  }

  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token_hash", data.properties.hashed_token);
  url.searchParams.set("type", "magiclink");
  url.searchParams.set("next", next);
  return url.toString();
}
