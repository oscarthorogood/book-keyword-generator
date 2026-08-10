"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronLeft, ChevronRight, LogOut, Plus, Shield } from "lucide-react";
import BooksListDashboard from "@/components/BooksListDashboard";
import AddBookForm from "@/components/AddBookForm";
import BookDetailPage from "@/components/BookDetailPage";

type Page = "dashboard" | "add-book" | "book-detail";

export default function Home() {
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Only the id is held here — the detail page loads the book itself, so
  // there's no half-populated copy of the row to keep in sync.
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
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

  const onBooks = currentPage === "dashboard" || currentPage === "book-detail";

  return (
    <div className="app-shell flex min-h-screen">
      {/* Sidebar — fixed 280px, white, single gray-200 right border (§4.4). */}
      <aside
        className="fixed left-0 top-0 z-40 flex h-screen flex-col border-r bg-white transition-[width] duration-150"
        style={{
          width: sidebarOpen ? "var(--sidebar-width)" : "var(--sidebar-width-collapsed)",
          borderColor: "var(--line)",
        }}
      >
        <div className={`flex items-center gap-3 ${sidebarOpen ? "justify-between px-4 pt-6" : "justify-center px-3 pt-6"}`}>
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

        <nav className="flex-1 overflow-y-auto px-4 py-6" aria-label="Main">
          <button
            onClick={() => {
              setCurrentPage("dashboard");
              setSelectedBookId(null);
            }}
            className={`nav-item ${onBooks ? "nav-item-active" : ""} ${sidebarOpen ? "" : "justify-center px-0"}`}
            aria-current={onBooks ? "page" : undefined}
            title={sidebarOpen ? undefined : "Books"}
          >
            <BookOpen size={20} className="shrink-0" style={{ color: onBooks ? "var(--icon-active)" : "var(--icon-default)" }} />
            {sidebarOpen && <span>Books</span>}
          </button>

          <button
            onClick={() => setCurrentPage("add-book")}
            className={`nav-item mt-1 ${currentPage === "add-book" ? "nav-item-active" : ""} ${
              sidebarOpen ? "" : "justify-center px-0"
            }`}
            aria-current={currentPage === "add-book" ? "page" : undefined}
            title={sidebarOpen ? undefined : "Add book"}
          >
            <Plus
              size={20}
              className="shrink-0"
              style={{ color: currentPage === "add-book" ? "var(--icon-active)" : "var(--icon-default)" }}
            />
            {sidebarOpen && <span>Add book</span>}
          </button>
        </nav>

        {/* Bottom-pinned account area (§4.4). */}
        <div className="border-t px-4 py-4" style={{ borderColor: "var(--line)" }}>
          {isAdmin && (
            <a
              href="/admin"
              className={`nav-item ${sidebarOpen ? "" : "justify-center px-0"}`}
              title={sidebarOpen ? undefined : "Access"}
            >
              <Shield size={20} className="shrink-0" style={{ color: "var(--icon-default)" }} />
              {sidebarOpen && <span>Access</span>}
            </a>
          )}
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className={`nav-item mt-1 ${sidebarOpen ? "" : "justify-center px-0"}`}
            title={sidebarOpen ? undefined : "Sign out"}
          >
            <LogOut size={20} className="shrink-0" style={{ color: "var(--icon-default)" }} />
            {sidebarOpen && <span>{isLoggingOut ? "Signing out…" : "Sign out"}</span>}
          </button>
        </div>
      </aside>

      {/* Main content — fluid, offset by the sidebar. */}
      <div
        className="min-w-0 flex-1 transition-[margin] duration-150"
        style={{ marginLeft: sidebarOpen ? "var(--sidebar-width)" : "var(--sidebar-width-collapsed)" }}
      >
        {currentPage === "dashboard" && (
          <BooksListDashboard
            onAddBook={() => setCurrentPage("add-book")}
            onSelectBook={(bookId) => {
              setSelectedBookId(bookId);
              setCurrentPage("book-detail");
            }}
          />
        )}
        {currentPage === "add-book" && (
          <AddBookForm
            onBack={() => setCurrentPage("dashboard")}
            onSuccess={(bookId) => {
              setSelectedBookId(bookId);
              setCurrentPage("book-detail");
            }}
          />
        )}
        {currentPage === "book-detail" && selectedBookId && (
          <BookDetailPage
            bookId={selectedBookId}
            onBack={() => {
              setSelectedBookId(null);
              setCurrentPage("dashboard");
            }}
          />
        )}
      </div>
    </div>
  );
}
