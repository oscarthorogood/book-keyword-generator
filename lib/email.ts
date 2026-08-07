/**
 * Transactional email via the Resend REST API.
 *
 * Called directly over fetch rather than through the SDK — one endpoint, one
 * POST, no dependency worth adding for it.
 *
 * Note this is *only* for the approval workflow's own mail. Magic-link emails
 * are sent by Supabase Auth, which should be pointed at the same Resend
 * account via custom SMTP (see README) so both come from the same domain and
 * neither is subject to Supabase's built-in rate limit.
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

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
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

/** Approve/deny request sent to the admin when a new address tries to sign in. */
export async function sendApprovalRequestEmail(args: {
  requesterEmail: string;
  approveUrl: string;
  denyUrl: string;
}): Promise<boolean> {
  const to = adminEmail();
  if (!to) return false;

  const requester = escapeHtml(args.requesterEmail);
  return sendEmail({
    to,
    subject: `Access request: ${args.requesterEmail}`,
    replyTo: args.requesterEmail,
    html: `
      <div style="${WRAPPER}">
        <h2 style="font-size:18px;margin:0 0 12px">New access request</h2>
        <p style="margin:0 0 20px">
          <strong>${requester}</strong> tried to sign in to Amazon Book Ads Builder
          and is not on the allowlist yet.
        </p>
        <p style="margin:0 0 24px">
          <a href="${args.approveUrl}" style="${BUTTON};background:#0f7b3f;color:#ffffff">Approve</a>
          &nbsp;&nbsp;
          <a href="${args.denyUrl}" style="${BUTTON};background:#f1f1f1;color:#1a1a1a">Deny</a>
        </p>
        <p style="margin:0;color:#666;font-size:13px">
          Approving emails them a login link straight away. These links work once
          and expire in 14 days. If you ignore this, nothing happens — they stay
          locked out.
        </p>
      </div>
    `,
  });
}

/** Confirmation to the requester once approved, carrying their magic link. */
export async function sendApprovedEmail(args: {
  to: string;
  magicLink: string;
}): Promise<boolean> {
  return sendEmail({
    to: args.to,
    subject: "You've been approved — Amazon Book Ads Builder",
    html: `
      <div style="${WRAPPER}">
        <h2 style="font-size:18px;margin:0 0 12px">You're in</h2>
        <p style="margin:0 0 20px">
          Your access request was approved. Use the link below to sign in.
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

/** Send generated bulksheet file as email attachment. */
export async function sendBulksheetEmail(args: {
  to: string;
  campaignName: string;
  fileBuffer: Buffer;
}): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.error("Email not configured: set RESEND_API_KEY, EMAIL_FROM, ADMIN_EMAIL.");
    return false;
  }

  try {
    const base64File = args.fileBuffer.toString("base64");
    const filename = `${args.campaignName}.xlsx`;
    const campaignEscaped = escapeHtml(args.campaignName);

    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [args.to],
        subject: `Bulksheet ready: ${args.campaignName}`,
        html: `
          <div style="${WRAPPER}">
            <h2 style="font-size:18px;margin:0 0 12px">Your bulksheet is ready</h2>
            <p style="margin:0 0 20px">
              <strong>${campaignEscaped}</strong> is attached and ready to upload to Amazon Ads.
            </p>
            <p style="margin:0 0 24px">
              <a href="https://advertising.amazon.com" style="${BUTTON};background:#0f7b3f;color:#ffffff">Go to Amazon Ads</a>
            </p>
            <p style="margin:0;color:#666;font-size:13px">
              You can also access your bulksheet archive in the Amazon Book Ads Builder anytime
              to download it again or generate new campaigns.
            </p>
          </div>
        `,
        attachments: [
          {
            filename,
            content: base64File,
            content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`Resend rejected the bulksheet email (${res.status}): ${detail}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      "Sending bulksheet email failed:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
