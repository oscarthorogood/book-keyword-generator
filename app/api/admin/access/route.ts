import { NextRequest, NextResponse } from "next/server";
import {
  destroyAuthUser,
  isPlausibleEmail,
  listAccessRequests,
  normalizeEmail,
  setAccessStatus,
} from "@/lib/accessRequests";
import { isAdminEmail, isCurrentUserAdmin } from "@/lib/admin";
import { sendReinstatedEmail } from "@/lib/email";
import { createMagicLink, siteUrl } from "@/lib/magicLink";

/**
 * Admin console API: list users and their usage, and block / unblock an
 * address. Sign-up itself is open — there's nothing left to approve.
 *
 * Authorization here is the caller's session matching ADMIN_EMAIL.
 */

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  try {
    return NextResponse.json({ requests: await listAccessRequests() });
  } catch (err) {
    console.error("Listing access requests failed:", err);
    return NextResponse.json({ error: "Could not load requests." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { email: rawEmail, status } = (body ?? {}) as {
    email?: unknown;
    status?: unknown;
  };

  if (typeof rawEmail !== "string" || !isPlausibleEmail(normalizeEmail(rawEmail))) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }
  if (status !== "approved" && status !== "denied") {
    return NextResponse.json(
      { error: "Status must be 'approved' or 'denied'." },
      { status: 400 }
    );
  }

  const email = normalizeEmail(rawEmail);

  // Guard against locking yourself out of the console you're standing in.
  // ADMIN_EMAIL is the only identity that reaches this handler, so matching
  // against it is the same as matching the caller's own address.
  if (status === "denied" && isAdminEmail(email)) {
    return NextResponse.json(
      { error: "You can't block your own access." },
      { status: 400 }
    );
  }

  try {
    const updated = await setAccessStatus(email, status);
    if (!updated) {
      return NextResponse.json({ error: "No such user." }, { status: 404 });
    }

    if (status === "denied") {
      // Status alone only blocks new links; drop the auth user so any live
      // session dies on its next request.
      await destroyAuthUser(email);
      return NextResponse.json({ request: updated, emailed: false });
    }

    // Unblocked from the console: send them a fresh link so they're not
    // stuck waiting on their own next sign-in attempt.
    let emailed = false;
    try {
      const link = await createMagicLink(email, siteUrl(req.url));
      emailed = await sendReinstatedEmail({ to: email, magicLink: link });
    } catch (err) {
      console.error("Unblocked, but magic link failed:", err);
    }
    return NextResponse.json({ request: updated, emailed });
  } catch (err) {
    console.error("Updating access failed:", err);
    return NextResponse.json({ error: "Could not update access." }, { status: 500 });
  }
}
