"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, LogOut, Search, Shield } from "lucide-react";

export type ShellSection =
  | "dashboard"
  | "books"
  | "campaigns"
  | "results"
  | "presets"
  | "targets"
  | "sources"
  | "access";

interface AppShellProps {
  active: ShellSection;
  children: ReactNode;
}

interface NavLink {
  section: ShellSection;
  label: string;
  href: string;
}

/** The five primary sections, always shown in this order (§ handoff README). */
const NAV_LINKS: NavLink[] = [
  { section: "dashboard", label: "Dashboard", href: "/dashboard" },
  { section: "books", label: "Books", href: "/books" },
  { section: "campaigns", label: "Campaigns", href: "/campaigns" },
  { section: "targets", label: "Keywords/ASINs", href: "/targets" },
  { section: "presets", label: "Presets", href: "/presets" },
];

/**
 * The app chrome: a top nav bar + fluid content, replacing the old fixed
 * 280px sidebar (Ads Builder redesign handoff). Every section is still its
 * own route — this is plain `Link`s, and every page owns its own data
 * fetching.
 *
 * The sidebar's live "recent books" rail has no equivalent here; the
 * Dashboard's "Recent books" widget covers that job instead.
 */
export default function AppShell({ active, children }: AppShellProps) {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    fetch("/api/admin/access")
      .then((res) => setIsAdmin(res.ok))
      .catch(() => setIsAdmin(false));
  }, []);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      const res = await fetch("/api/logout", { method: "POST" });
      if (res.ok) router.push("/login");
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="app-shell min-h-screen">
      <div className="top-nav">
        <div className="top-nav-left">
          <Link href="/dashboard" className="top-nav-brand">
            <span className="top-nav-logo-mark" aria-hidden="true">
              AB
            </span>
            <span className="text-md font-semibold" style={{ color: "var(--text-primary)" }}>
              Ads Builder
            </span>
          </Link>

          <nav className="top-nav-links" aria-label="Main">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.section}
                href={link.href}
                className={`top-nav-link ${active === link.section ? "top-nav-link-active" : ""}`}
                aria-current={active === link.section ? "page" : undefined}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="top-nav-right">
          {isAdmin && (
            <Link
              href="/admin"
              className={`top-nav-link ${active === "access" ? "top-nav-link-active" : ""}`}
              aria-current={active === "access" ? "page" : undefined}
            >
              <Shield size={16} />
              Access
            </Link>
          )}

          <div className="top-nav-search hidden sm:block">
            <Search size={16} className="input-icon" aria-hidden="true" />
            <label className="sr-only" htmlFor="top-nav-search">
              Search books, campaigns
            </label>
            <input id="top-nav-search" type="search" placeholder="Search books, campaigns…" />
          </div>

          <button type="button" className="top-nav-icon-btn" aria-label="Notifications" title="Notifications">
            <Bell size={18} />
          </button>

          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="top-nav-icon-btn"
            aria-label={isLoggingOut ? "Signing out…" : "Sign out"}
            title="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
