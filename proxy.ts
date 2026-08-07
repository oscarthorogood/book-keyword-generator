import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_CONFIG } from "@/lib/config";

/**
 * Gate every route behind a Supabase session, and refresh that session on the
 * way through so it doesn't expire mid-visit.
 *
 * `middleware.ts` was renamed to `proxy.ts` in Next 16; the function must be
 * named `proxy`. Note the Next docs' warning that a matcher change can
 * silently drop coverage — so the API routes that do real work verify the
 * session themselves as well, rather than trusting this alone.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (AUTH_CONFIG.PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Fail closed: an unconfigured deployment must not serve the app openly.
    return new NextResponse("Authentication is not configured.", { status: 500 });
  }

  // Cookies set during session refresh have to land on BOTH the request (so
  // downstream handlers see the fresh session) and the response (so the
  // browser stores it).
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates against Supabase — unlike getSession(), which only
  // decodes whatever cookie the browser sent and is therefore spoofable.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
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
