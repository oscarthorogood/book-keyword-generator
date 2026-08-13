"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronLeft, ChevronRight, Database, LayoutDashboard, ListChecks, LogOut, Megaphone, Shield } from "lucide-react";

export type ShellSection = "dashboard" | "books" | "databases" | "campaigns" | "presets" | "access";

interface AppShellProps {
  active: ShellSection;
  children: ReactNode;
}

interface SidebarBook {
  id: string;
  title: string;
  author: string;
}

/** Sidebar shows only the most-recent books — it's a fixed 280px rail, not the full list (see /books "All"). */
const SIDEBAR_BOOK_LIMIT = 8;

const NAV_ITEMS_TOP: Array<{ section: Extract<ShellSection, "dashboard">; label: string; href: string; Icon: typeof BookOpen }> = [
  { section: "dashboard", label: "Dashboard", href: "/dashboard", Icon: LayoutDashboard },
];

const NAV_ITEMS_BOTTOM: Array<{ section: Extract<ShellSection, "databases" | "campaigns" | "presets">; label: string; href: string; Icon: typeof BookOpen }> = [
  { section: "databases", label: "Databases", href: "/databases", Icon: Database },
  { section: "campaigns", label: "Campaigns", href: "/campaigns", Icon: Megaphone },
  { section: "presets", label: "Presets", href: "/presets", Icon: ListChecks },
];

/**
 * The app chrome: fixed 280px sidebar + fluid content (§3.2/§4.4).
 *
 * Every section is its own route now (Enhancements spec §2) — the sidebar
 * is plain `Link`s, and every page owns its own data fetching rather than
 * swapping views inside a single-page builder's local state.
 *
 * The book list sits directly in the sidebar between Dashboard and the
 * rest of the nav (Enhancements spec §2 restructure): a live, capped
 * (`SIDEBAR_BOOK_LIMIT`) slice of the same `/api/books/list` data
 * BooksListDashboard renders in full on /books, followed by an "All"
 * link to that full list. Keywords/Competitors/Sources moved off the
 * top level into the single /databases page (see app/databases/page.tsx).
 */
export default function AppShell({ active, children }: AppShellProps) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [sidebarBooks, setSidebarBooks] = useState<SidebarBook[]>([]);

  useEffect(() => {
    fetch("/api/admin/access")
      .then((res) => setIsAdmin(res.ok))
      .catch(() => setIsAdmin(false));
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/books/list")
      .then((res) => (res.ok ? res.json() : { books: [] }))
      .then((body) => {
        if (!active) return;
        setSidebarBooks((body.books ?? []).slice(0, SIDEBAR_BOOK_LIMIT));
      })
      .catch(() => {
        if (active) setSidebarBooks([]);
      });
    return () => {
      active = false;
    };
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
          {NAV_ITEMS_TOP.map(({ section, label, href, Icon }) => (
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

          {/* Live book list (Enhancements spec §2) — hidden while collapsed, same as every other label. */}
          {sidebarOpen && sidebarBooks.length > 0 && (
            <div className="space-y-1 py-1" aria-label="Your books">
              {sidebarBooks.map((book) => (
                <Link
                  key={book.id}
                  href={`/books/${book.id}`}
                  className="nav-item"
                  title={book.author ? `${book.title} — ${book.author}` : book.title}
                >
                  <BookOpen size={20} className="shrink-0" style={{ color: "var(--icon-default)" }} />
                  <span className="truncate">{book.title}</span>
                </Link>
              ))}
            </div>
          )}

          <Link
            href="/books"
            className={itemClass("books")}
            aria-current={active === "books" ? "page" : undefined}
            title={sidebarOpen ? undefined : "All books"}
          >
            <BookOpen size={20} className="shrink-0" style={{ color: iconColor("books") }} />
            {sidebarOpen && <span>All</span>}
          </Link>

          {NAV_ITEMS_BOTTOM.map(({ section, label, href, Icon }) => (
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
