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

  // Don't show header on login page
  if (pathname === "/login") {
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
    <header className="border-b" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center justify-between px-3 py-4 md:px-6 md:py-5">
        <Link href="/" className="flex items-center gap-2" style={{ textDecoration: "none" }}>
          <div className="logo-mark text-sm">PB</div>
          <span className="text-sm font-medium">Amazon Book Ads Builder</span>
        </Link>
        <nav className="flex items-center gap-2">
          {isAdmin && (
            <Link
              href={onAdmin ? "/" : "/admin"}
              className="btn-pill-outline text-xs px-3 py-1.5"
              style={{ textDecoration: "none" }}
              aria-current={onAdmin ? "page" : undefined}
            >
              {onAdmin ? "Builder" : "Access"}
            </Link>
          )}
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="btn-pill-outline text-xs px-3 py-1.5"
          >
            {isLoggingOut ? "Signing out…" : "Sign out"}
          </button>
        </nav>
      </div>
    </header>
  );
}
