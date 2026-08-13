import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Request-scoped Supabase client for Server Components and Route Handlers.
 *
 * Uses the publishable (anon) key and reads/writes the session cookies, so it
 * acts as the signed-in user. This is the client to use for anything
 * user-facing; `supabaseAdmin()` is for privileged work only.
 */
export async function supabaseServer(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Session refresh is handled in proxy.ts, so this is safe to skip.
          }
        },
      },
    }
  );
}

export interface CurrentUser {
  id: string;
  email: string;
}

/**
 * The signed-in user, or null.
 *
 * Uses getUser(), which revalidates against Supabase — getSession() only
 * decodes the cookie the browser sent, which a caller can forge.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  return { id: user.id, email: user.email };
}

/** Email of the signed-in user, or null. */
export async function currentUserEmail(): Promise<string | null> {
  return (await currentUser())?.email ?? null;
}

/**
 * Retry a Supabase query once if PostgREST rejects the JWT with "JWT issued
 * at future" — its own clock check, distinct from (and stricter than) the
 * one GoTrue already passed to authenticate the request via `currentUser()`.
 * A token minted a moment ago can still have an `iat` that's technically
 * ahead of a database server whose clock trails by even a second or two;
 * waiting a beat and re-running clears it without surfacing a raw
 * clock-skew error to the user.
 */
export async function withClockSkewRetry<T>(
  run: () => PromiseLike<{ data: T; error: { message: string } | null }>
): Promise<{ data: T; error: { message: string } | null }> {
  const first = await run();
  if (first.error?.message.toLowerCase().includes("issued at future")) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return run();
  }
  return first;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}
