import { NextRequest } from "next/server";
import { applyDecision, verifyDecisionToken } from "@/lib/accessRequests";
import { sendApprovedEmail } from "@/lib/email";
import { createMagicLink, siteUrl } from "@/lib/magicLink";

/**
 * One-click approve/deny target for the links in the admin's email.
 *
 * Authorization is the signed token itself — there is no session here, since
 * the whole point is to act straight from a phone's mail app. Three things
 * make that safe enough:
 *
 *   - the token is HMAC-signed with AUTH_SECRET, so it can't be forged;
 *   - it carries a nonce that must still match the row, and the update is
 *     conditional on status = 'pending', so each link works exactly once;
 *   - it expires after 14 days.
 *
 * Responds with a small HTML page rather than JSON because a human is looking
 * at it in a browser.
 */

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return page("Missing link", "This approval link is incomplete.", false);
  }

  const claims = await verifyDecisionToken(token);
  if (!claims) {
    return page(
      "Link not valid",
      "This approval link is invalid or has expired. If the request is still outstanding, ask them to try signing in again and a fresh email will be sent.",
      false
    );
  }

  try {
    const updated = await applyDecision(claims.email, claims.nonce, claims.action);

    if (!updated) {
      // Already decided, or the nonce no longer matches.
      return page(
        "Already handled",
        `Nothing to do — ${claims.email} has already been approved or denied.`,
        false
      );
    }

    if (claims.action === "denied") {
      return page(
        "Access denied",
        `${claims.email} will not be able to sign in. They were not notified.`,
        true
      );
    }

    // Approved: send them a working link immediately.
    try {
      const link = await createMagicLink(claims.email, siteUrl(req.url));
      const sent = await sendApprovedEmail({ to: claims.email, magicLink: link });
      return page(
        "Access approved",
        sent
          ? `${claims.email} has been approved and emailed a sign-in link.`
          : `${claims.email} has been approved, but the notification email failed to send. They can sign in by entering their email on the login page.`,
        true
      );
    } catch (err) {
      console.error("Approved, but magic link failed:", err);
      return page(
        "Access approved",
        `${claims.email} has been approved, but the sign-in email could not be sent. They can request a link themselves from the login page.`,
        true
      );
    }
  } catch (err) {
    console.error("Decision failed:", err);
    return page(
      "Something went wrong",
      "The decision could not be saved. Try the link again in a moment.",
      false
    );
  }
}

/** Minimal standalone HTML — this renders outside the app shell. */
function page(title: string, detail: string, ok: boolean): Response {
  const accent = ok ? "#0f7b3f" : "#8a6d1f";
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;padding:24px">
    <main style="max-width:420px;background:#ffffff;border:1px solid #ececec;border-radius:14px;padding:28px">
      <h1 style="margin:0 0 10px;font-size:19px;color:${accent}">${escapeHtml(title)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#3a3a3a">${escapeHtml(detail)}</p>
    </main>
  </body>
</html>`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Never let a proxy or the browser cache a one-shot decision page.
      "Cache-Control": "no-store",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
