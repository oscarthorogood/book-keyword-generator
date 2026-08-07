import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

export function proxy(req: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;

  // If no password is configured, fail closed rather than leaving the app open.
  if (!appPassword) {
    return new NextResponse("APP_PASSWORD is not configured.", { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = atob(authHeader.slice("Basic ".length));
    const separatorIndex = decoded.indexOf(":");
    const password = separatorIndex === -1 ? decoded : decoded.slice(separatorIndex + 1);
    if (timingSafeEqual(password, appPassword)) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Amazon Ads Assistant"' },
  });
}
