"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Megaphone,
  Shield,
  Tags,
} from "lucide-react";

export type ShellSection = "dashboard" | "books" | "databases" | "campaigns" | "presets" | "access";

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

/** Sub-links shown under the "Databases" dropdown. */
const DATABASE_LINKS: Array<{ section: Extract<ShellSection, "campaigns" | "presets" | "databases">; label: string; href: string; Icon: typeof BookOpen }> = [
  { section: "campaigns", label: "Campaigns", href: "/campaigns", Icon: Megaphone },
  { section: "presets", label: "Presets", href: "/presets", Icon: ListChecks },
  { section: "databases", label: "Keywords", href: "/databases?tab=keywords", Icon: Database },
  { section: "databases", label: "ASINs", href: "/databases?tab=competitors", Icon: Tags },
  { section: "databases", label: "Sources", href: "/databases?tab=sources", Icon: Database },
];

const DATABASE_SECTIONS: ShellSection[] = ["databases", "campaigns", "presets"];

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
  const [booksExpanded, setBooksExpanded] = useState(active === "books");
  const [databasesExpanded, setDatabasesExpanded] = useState(DATABASE_SECTIONS.includes(active));

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

  const databasesGroupClass = `nav-item w-full ${DATABASE_SECTIONS.includes(active) ? "nav-item-active" : ""} ${
    sidebarOpen ? "" : "justify-center px-0"
  }`;

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

          {/* Books: dropdown listing recent books (with cover icons) + "All". */}
          <div>
            <button
              onClick={() => setBooksExpanded((v) => !v)}
              className={itemClass("books")}
              aria-expanded={booksExpanded}
              title={sidebarOpen ? undefined : "Books"}
            >
              <BookOpen size={20} className="shrink-0" style={{ color: iconColor("books") }} />
              {sidebarOpen && (
                <>
                  <span className="flex-1 text-left">Books</span>
                  <ChevronDown
                    size={16}
                    className={`shrink-0 transition-transform ${booksExpanded ? "rotate-180" : ""}`}
                  />
                </>
              )}
            </button>

            {sidebarOpen && booksExpanded && (
              <div className="space-y-1 py-1 pl-2" aria-label="Your books">
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
          </div>

          {/* Databases: dropdown for Campaigns, Presets, Keywords, ASINs, Sources. */}
          <div>
            <button
              onClick={() => setDatabasesExpanded((v) => !v)}
              className={databasesGroupClass}
              aria-expanded={databasesExpanded}
              title={sidebarOpen ? undefined : "Databases"}
            >
              <Database
                size={20}
                className="shrink-0"
                style={{ color: DATABASE_SECTIONS.includes(active) ? "var(--icon-active)" : "var(--icon-default)" }}
              />
              {sidebarOpen && (
                <>
                  <span className="flex-1 text-left">Databases</span>
                  <ChevronDown
                    size={16}
                    className={`shrink-0 transition-transform ${databasesExpanded ? "rotate-180" : ""}`}
                  />
                </>
              )}
            </button>

            {sidebarOpen && databasesExpanded && (
              <div className="space-y-1 py-1 pl-2" aria-label="Databases">
                {DATABASE_LINKS.map(({ section, label, href, Icon }) => (
                  <Link key={label} href={href} className="nav-item">
                    <Icon size={20} className="shrink-0" style={{ color: iconColor(section) }} />
                    <span>{label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
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
