"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronLeft, ChevronRight, Database, KeyRound, LayoutDashboard, ListChecks, LogOut, Megaphone, Shield, Swords } from "lucide-react";

export type ShellSection = "dashboard" | "books" | "keywords" | "competitors" | "campaigns" | "presets" | "sources" | "access";

interface AppShellProps {
  active: ShellSection;
  children: ReactNode;
}

const NAV_ITEMS: Array<{ section: Exclude<ShellSection, "access">; label: string; href: string; Icon: typeof BookOpen }> = [
  { section: "dashboard", label: "Dashboard", href: "/dashboard", Icon: LayoutDashboard },
  { section: "books", label: "Books", href: "/books", Icon: BookOpen },
  { section: "keywords", label: "Keywords", href: "/keywords", Icon: KeyRound },
  { section: "competitors", label: "Competitors", href: "/competitors", Icon: Swords },
  { section: "campaigns", label: "Campaigns", href: "/campaigns", Icon: Megaphone },
  { section: "presets", label: "Presets", href: "/presets", Icon: ListChecks },
  { section: "sources", label: "Sources", href: "/sources", Icon: Database },
];

/**
 * The app chrome: fixed 280px sidebar + fluid content (§3.2/§4.4).
 *
 * Every section is its own route now (Enhancements spec §2) — the sidebar
 * is plain `Link`s, and every page owns its own data fetching rather than
 * swapping views inside a single-page builder's local state.
 */
export default function AppShell({ active, children }: AppShellProps) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
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

  const itemClass = (section: ShellSection) =>
    `nav-item ${active === section ? "nav-item-active" : ""} ${sidebarOpen ? "" : "justify-center px-0"}`;

  const iconColor = (section: ShellSection) =>
    active === section ? "var(--icon-active)" : "var(--icon-default)";

  return (
    <div className="app-shell flex min-h-screen">
      <aside
        className="fixed left-0 top-0 z-40 flex h-screen flex-col border-r bg-white transition-[width] duration-150"
        style={{
          width: sidebarOpen ? "var(--sidebar-width)" : "var(--sidebar-width-collapsed)",
          borderColor: "var(--line)",
        }}
      >
        <div
          className={`flex items-center gap-3 ${
            sidebarOpen ? "justify-between px-4 pt-6" : "justify-center px-3 pt-6"
          }`}
        >
          {sidebarOpen && (
            <div className="flex min-w-0 items-center gap-3">
              <span className="logo-mark" aria-hidden="true">
                AB
              </span>
              <span className="truncate text-md font-semibold" style={{ color: "var(--text-primary)" }}>
                Ads Builder
              </span>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="btn btn-secondary btn-icon btn-sm"
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-6" aria-label="Main">
          {NAV_ITEMS.map(({ section, label, href, Icon }) => (
            <Link
              key={section}
              href={href}
              className={itemClass(section)}
              aria-current={active === section ? "page" : undefined}
              title={sidebarOpen ? undefined : label}
            >
              <Icon size={20} className="shrink-0" style={{ color: iconColor(section) }} />
              {sidebarOpen && <span>{label}</span>}
            </Link>
          ))}
        </nav>

        {/* Bottom-pinned account area (§4.4). */}
        <div className="space-y-1 border-t px-4 py-4" style={{ borderColor: "var(--line)" }}>
          {isAdmin && (
            <Link
              href="/admin"
              className={itemClass("access")}
              aria-current={active === "access" ? "page" : undefined}
              title={sidebarOpen ? undefined : "Access"}
            >
              <Shield size={20} className="shrink-0" style={{ color: iconColor("access") }} />
              {sidebarOpen && <span>Access</span>}
            </Link>
          )}
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className={`nav-item ${sidebarOpen ? "" : "justify-center px-0"}`}
            title={sidebarOpen ? undefined : "Sign out"}
          >
            <LogOut size={20} className="shrink-0" style={{ color: "var(--icon-default)" }} />
            {sidebarOpen && <span>{isLoggingOut ? "Signing out…" : "Sign out"}</span>}
          </button>
        </div>
      </aside>

      <div
        className="min-w-0 flex-1 transition-[margin] duration-150"
        style={{ marginLeft: sidebarOpen ? "var(--sidebar-width)" : "var(--sidebar-width-collapsed)" }}
      >
        {children}
      </div>
    </div>
  );
}
