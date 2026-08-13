/**
 * Transactional email via the Resend REST API.
 *
 * Called directly over fetch rather than through the SDK — one endpoint, one
 * POST, no dependency worth adding for it. Every sign-in link and reinstated-
 * access notification goes through here, minted server-side via Supabase's
 * admin API but delivered as our own Resend template (see lib/magicLink.ts).
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY &&
      process.env.EMAIL_FROM &&
      process.env.ADMIN_EMAIL
  );
}

export function adminEmail(): string | undefined {
  return process.env.ADMIN_EMAIL;
}

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file content, per Resend's attachments format. */
  content: string;
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

/**
 * Send one email. Returns true on success; logs and returns false on failure
 * rather than throwing, so a mail outage degrades the sign-in flow instead of
 * turning it into a 500.
 */
export async function sendEmail({
  to,
  subject,
  html,
  replyTo,
  attachments,
}: SendArgs): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.error("Email not configured: set RESEND_API_KEY, EMAIL_FROM, ADMIN_EMAIL.");
    return false;
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`Resend rejected the email (${res.status}): ${detail}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      "Sending email failed:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/** Escape anything interpolated into an HTML email body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const WRAPPER =
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:520px';

const BUTTON =
  "display:inline-block;padding:10px 22px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px";

/** Sign-in link, sent on every fresh magic-link request. */
export async function sendSignInEmail(args: {
  to: string;
  magicLink: string;
}): Promise<boolean> {
  return sendEmail({
    to: args.to,
    subject: "Your sign-in link — Amazon Book Ads Builder",
    html: `
      <div style="${WRAPPER}">
        <h2 style="font-size:18px;margin:0 0 12px">Sign in</h2>
        <p style="margin:0 0 24px">Use the link below to sign in to Amazon Book Ads Builder.</p>
        <p style="margin:0 0 24px">
          <a href="${args.magicLink}" style="${BUTTON};background:#1a1a1a;color:#ffffff">Sign in</a>
        </p>
        <p style="margin:0;color:#666;font-size:13px">
          This link works once and expires shortly. If you didn't request it, ignore this email.
        </p>
      </div>
    `,
  });
}

/**
 * Sent to whoever created or updated a campaign — a log of what changed,
 * plus the bulksheet/review files that went with it.
 */
export async function sendCampaignActivityEmail(args: {
  to: string;
  bookTitle: string;
  action: "created" | "updated";
  changeLines: string[];
  attachments: EmailAttachment[];
}): Promise<boolean> {
  const rows = args.changeLines
    .map((line) => `<li style="margin:0 0 6px">${escapeHtml(line)}</li>`)
    .join("");

  return sendEmail({
    to: args.to,
    subject: `Campaigns ${args.action} — ${args.bookTitle}`,
    html: `
      <div style="${WRAPPER}">
        <h2 style="font-size:18px;margin:0 0 12px">Campaigns ${args.action}: ${escapeHtml(args.bookTitle)}</h2>
        <p style="margin:0 0 12px">Here's what changed:</p>
        <ul style="margin:0 0 20px;padding-left:20px">${rows}</ul>
        <p style="margin:0;color:#666;font-size:13px">
          The bulksheet and review files for this run are attached.
        </p>
      </div>
    `,
    attachments: args.attachments,
  });
}

/** Sent when an admin reinstates a previously blocked address. */
export async function sendReinstatedEmail(args: {
  to: string;
  magicLink: string;
}): Promise<boolean> {
  return sendEmail({
    to: args.to,
    subject: "Your access was reinstated — Amazon Book Ads Builder",
    html: `
      <div style="${WRAPPER}">
        <h2 style="font-size:18px;margin:0 0 12px">You're back in</h2>
        <p style="margin:0 0 20px">
          Your access was reinstated. Use the link below to sign in.
        </p>
        <p style="margin:0 0 24px">
          <a href="${args.magicLink}" style="${BUTTON};background:#1a1a1a;color:#ffffff">Sign in</a>
        </p>
        <p style="margin:0;color:#666;font-size:13px">
          This link signs you in once and expires shortly. After that, just enter
          your email on the sign-in page for a fresh one.
        </p>
      </div>
    `,
  });
}

