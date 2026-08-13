import { NextRequest, NextResponse } from "next/server";
import {
  isPlausibleEmail,
  normalizeEmail,
  recordSignInAttempt,
} from "@/lib/accessRequests";
import { sendSignInEmail } from "@/lib/email";
import { createMagicLink, siteUrl } from "@/lib/magicLink";

/**
 * Sign-in entry point.
 *
 * Sign-up is open: any plausible address gets a magic link, no admin
 * approval required. The only exception is an address an admin has
 * explicitly blocked (see /admin), which stays silent — the response
 * deliberately doesn't distinguish "blocked" from "sent" so this endpoint
 * can't be used to enumerate blocked addresses.
 */

const SENT = "If that address has access, a sign-in link is on its way.";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const raw =
    body && typeof body === "object" && "email" in body
      ? (body as { email?: unknown }).email
      : undefined;

  if (typeof raw !== "string" || !isPlausibleEmail(normalizeEmail(raw))) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 }
    );
  }

  const email = normalizeEmail(raw);
  const origin = siteUrl(req.url);

  // Where to land after sign-in. Same-origin paths only — never echo back an
  // absolute URL, or the emailed link becomes an open redirect.
  const rawNext =
    body && typeof body === "object" && "next" in body
      ? (body as { next?: unknown }).next
      : undefined;
  const next =
    typeof rawNext === "string" && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/";

  try {
    const record = await recordSignInAttempt(email);

    if (record.status === "denied") {
      return NextResponse.json({ status: "sent", message: SENT });
    }

    const link = await createMagicLink(email, origin, next);
    const ok = await sendSignInEmail({ to: email, magicLink: link });
    if (!ok) {
      return NextResponse.json(
        { error: "Could not send the sign-in email. Try again shortly." },
        { status: 502 }
      );
    }
    return NextResponse.json({ status: "sent", message: SENT });
  } catch (err) {
    console.error("Magic-link request failed:", err);
    return NextResponse.json(
      { error: "Something went wrong. Try again shortly." },
      { status: 500 }
    );
  }
}
