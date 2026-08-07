import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";

/**
 * Landing point for the emailed magic link.
 *
 * Exchanges the one-time `token_hash` for a session; verifyOtp writes the
 * session cookies through the SSR client. On failure the user goes back to
 * /login with a message rather than seeing a raw error.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = (params.get("type") ?? "magiclink") as EmailOtpType;

  // Only ever redirect to a path on this origin — an attacker-supplied
  // absolute URL here would turn the sign-in link into an open redirect.
  const rawNext = params.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (!tokenHash) {
    return NextResponse.redirect(new URL("/login?error=invalid_link", req.url));
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    console.error("Magic link verification failed:", error.message);
    return NextResponse.redirect(new URL("/login?error=expired_link", req.url));
  }

  return NextResponse.redirect(new URL(next, req.url));
}
