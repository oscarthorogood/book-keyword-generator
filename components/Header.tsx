"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

/**
 * `isAdmin` is resolved once in the root layout on the server and passed down,
 * so the Access link needs no client-side fetch. It only controls whether the
 * link is *shown* — /admin and its API do their own authorization.
 */
export function Header({ isAdmin = false }: { isAdmin?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // "/" renders its own full sidebar nav (including sign out), and /login has
  // no session yet — the global header would duplicate or overlap both.
  if (pathname === "/login" || pathname === "/") {
    return null;
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      const response = await fetch("/api/logout", {
        method: "POST",
      });

      if (response.ok) {
        router.push("/login");
      }
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }

  const onAdmin = pathname === "/admin";

  return (
    <header className="border-b bg-white" style={{ borderColor: "var(--line)" }}>
      <div
        className="mx-auto flex w-full items-center justify-between gap-4 px-8 py-4"
        style={{ maxWidth: "var(--container-max)" }}
      >
        <Link href="/" className="flex items-center gap-3 no-underline">
          <span className="logo-mark" aria-hidden="true">
            AB
          </span>
          <span className="text-md font-semibold" style={{ color: "var(--text-primary)" }}>
            Amazon Book Ads Builder
          </span>
        </Link>
        <nav className="flex items-center gap-3" aria-label="Account">
          {isAdmin && (
            <Link
              href={onAdmin ? "/" : "/admin"}
              className="btn btn-secondary btn-sm no-underline"
              aria-current={onAdmin ? "page" : undefined}
            >
              {onAdmin ? "Builder" : "Access"}
            </Link>
          )}
          <button onClick={handleLogout} disabled={isLoggingOut} className="btn btn-secondary btn-sm">
            {isLoggingOut ? "Signing out…" : "Sign out"}
          </button>
        </nav>
      </div>
    </header>
  );
}
