"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

export function Header() {
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

  return (
    <header className="border-b" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center justify-between px-3 py-4 md:px-6 md:py-5">
        <div className="flex items-center gap-2">
          <div className="logo-mark text-sm">PB</div>
          <span className="text-sm font-medium">Amazon Book Ads Builder</span>
        </div>
        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="btn-pill-outline text-xs px-3 py-1.5"
        >
          {isLoggingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </header>
  );
}
