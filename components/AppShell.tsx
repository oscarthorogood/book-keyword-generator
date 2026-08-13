"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Plus,
  Shield,
} from "lucide-react";

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

interface SidebarBook {
  id: string;
  title: string;
  author: string;
  coverImageUrl?: string;
}

/** Sidebar shows only the most-recent books — it's a fixed 280px rail, not the full list (see /books "All"). */
const SIDEBAR_BOOK_LIMIT = 8;

/**
 * The app chrome: fixed 280px sidebar + fluid content (§3.2/§4.4).
 *
 * Every section is its own route (Enhancements spec §2) — the sidebar is
 * plain `Link`s, and every page owns its own data fetching.
 *
 * The sidebar is deliberately short: an "Add New Book" button, Dashboard,
 * and then the books themselves — a live, capped (`SIDEBAR_BOOK_LIMIT`)
 * slice of `/api/books/list` listed flat with no section header, ending in
 * an "All" link to the full list on /books. The database tables (Campaigns, Results,
 * Presets, Keywords & ASINs) are still real routes, reached from the pages
 * that own them rather than from a second nav group here.
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
        const books = (body.books ?? []) as Array<{ id: string; title: string; author: string; metadata_json?: { coverImageUrl?: string } | null }>;
        setSidebarBooks(
          books.slice(0, SIDEBAR_BOOK_LIMIT).map((b) => ({
            id: b.id,
            title: b.title,
            author: b.author,
            coverImageUrl: b.metadata_json?.coverImageUrl,
          }))
        );
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
    `nav-item w-full ${active === section ? "nav-item-active" : ""} ${sidebarOpen ? "" : "justify-center px-0"}`;

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
          {/* Add New Book sits directly above Dashboard, the only action in the nav. */}
          <Link
            href="/books/add"
            className={`btn btn-primary mt-2 w-full ${sidebarOpen ? "" : "btn-icon px-0"}`}
            title={sidebarOpen ? undefined : "Add New Book"}
          >
            <Plus size={20} className="shrink-0" />
            {sidebarOpen && <span>Add New Book</span>}
          </Link>

          {/* Dashboard: no dropdown, bigger button (spec: simplified sidebar). */}
          <Link
            href="/dashboard"
            className={`${itemClass("dashboard")} py-3 text-md font-semibold`}
            aria-current={active === "dashboard" ? "page" : undefined}
            title={sidebarOpen ? undefined : "Dashboard"}
          >
            <LayoutDashboard size={22} className="shrink-0" style={{ color: iconColor("dashboard") }} />
            {sidebarOpen && <span>Dashboard</span>}
          </Link>

          {/* The books themselves, listed flat below Dashboard, with "All" last. */}
          {sidebarOpen && (
            <div className="space-y-1 pt-4" aria-label="Your books">
              {sidebarBooks.map((book) => (
                <Link
                  key={book.id}
                  href={`/books/${book.id}`}
                  className="nav-item"
                  title={book.author ? `${book.title} — ${book.author}` : book.title}
                >
                  {book.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Amazon CDN host isn't in next.config images.remotePatterns
                    <img
                      src={book.coverImageUrl}
                      alt=""
                      className="h-6 w-5 shrink-0 rounded-sm border object-cover"
                      style={{ borderColor: "var(--line)" }}
                    />
                  ) : (
                    <BookOpen size={20} className="shrink-0" style={{ color: "var(--icon-default)" }} />
                  )}
                  <span className="truncate">{book.title}</span>
                </Link>
              ))}
              <Link
                href="/books"
                className={`nav-item ${active === "books" ? "nav-item-active" : ""}`}
                aria-current={active === "books" ? "page" : undefined}
              >
                <BookOpen size={20} className="shrink-0" style={{ color: iconColor("books") }} />
                <span>All</span>
              </Link>
            </div>
          )}
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
