import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "your-secret-key-change-this-in-production");

const publicPaths = ["/login", "/api/login", "/api/logout"];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Allow public paths without authentication
  if (publicPaths.includes(pathname)) {
    return NextResponse.next();
  }

  // Check for auth token
  const token = request.cookies.get("auth_token")?.value;

  if (!token) {
    // Redirect to login if not authenticated
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Verify token
  try {
    await jwtVerify(token, SECRET);
    return NextResponse.next();
  } catch {
    // Invalid or expired token, redirect to login
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
