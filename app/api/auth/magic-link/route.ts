import { NextRequest, NextResponse } from "next/server";
import {
  createPendingRequest,
  findAccessRequest,
  isPlausibleEmail,
  markNotified,
  normalizeEmail,
  shouldRenotify,
  signDecisionToken,
} from "@/lib/accessRequests";
import { sendApprovalRequestEmail, sendEmail } from "@/lib/email";
import { createMagicLink, siteUrl } from "@/lib/magicLink";

/**
 * Sign-in entry point.
 *
 * Approved address  -> email a magic link.
 * Unknown address   -> record it as pending, email the admin approve/deny links.
 * Pending or denied -> do nothing visible.
 *
 * The response deliberately does not distinguish approved / pending / denied:
 * telling an anonymous caller which addresses are on the allowlist would turn
 * this endpoint into an account-enumeration oracle. Only "brand new address"
 * is surfaced, since that tells the requester their request was filed and
 * reveals nothing about anyone else.
 */

const SENT = "If that address has access, a sign-in link is on its way.";
const FILED =
  "Thanks — your request has been sent for approval. You'll get an email once it's reviewed.";

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
    const existing = await findAccessRequest(email);

    if (existing?.status === "approved") {
      const link = await createMagicLink(email, origin, next);
      const ok = await sendEmail({
        to: email,
        subject: "Your sign-in link — Amazon Book Ads Builder",
        html: signInEmailHtml(link),
      });
      if (!ok) {
        return NextResponse.json(
          { error: "Could not send the sign-in email. Try again shortly." },
          { status: 502 }
        );
      }
      return NextResponse.json({ status: "sent", message: SENT });
    }

    // Pending or denied: stay silent, but re-ping the admin about a pending
    // request if it's been a while (their first email may have been missed).
    if (existing) {
      if (shouldRenotify(existing) && existing.decision_token) {
        await notifyAdmin(email, existing.decision_token, origin);
      }
      return NextResponse.json({
        status: existing.status === "pending" ? "pending" : "sent",
        message: existing.status === "pending" ? FILED : SENT,
      });
    }

    const created = await createPendingRequest(email);
    if (created.decision_token) {
      await notifyAdmin(email, created.decision_token, origin);
    }
    return NextResponse.json({ status: "pending", message: FILED });
  } catch (err) {
    console.error("Magic-link request failed:", err);
    return NextResponse.json(
      { error: "Something went wrong. Try again shortly." },
      { status: 500 }
    );
  }
}

async function notifyAdmin(
  email: string,
  nonce: string,
  origin: string
): Promise<void> {
  const [approveToken, denyToken] = await Promise.all([
    signDecisionToken({ email, action: "approved", nonce }),
    signDecisionToken({ email, action: "denied", nonce }),
  ]);

  const sent = await sendApprovalRequestEmail({
    requesterEmail: email,
    approveUrl: `${origin}/api/auth/approve?token=${encodeURIComponent(approveToken)}`,
    denyUrl: `${origin}/api/auth/approve?token=${encodeURIComponent(denyToken)}`,
  });

  if (sent) {
    await markNotified(email);
  }
}

function signInEmailHtml(link: string): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:520px">
      <h2 style="font-size:18px;margin:0 0 12px">Sign in</h2>
      <p style="margin:0 0 24px">Use the link below to sign in to Amazon Book Ads Builder.</p>
      <p style="margin:0 0 24px">
        <a href="${link}" style="display:inline-block;padding:10px 22px;border-radius:999px;background:#1a1a1a;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px">Sign in</a>
      </p>
      <p style="margin:0;color:#666;font-size:13px">
        This link works once and expires shortly. If you didn't request it, ignore this email.
      </p>
    </div>
  `;
}
