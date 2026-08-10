"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Folder, LogOut, Shield, ChevronLeft, ChevronRight } from "lucide-react";
import BooksListDashboard from "@/components/BooksListDashboard";
import AddBookForm from "@/components/AddBookForm";
import BookDetailPage from "@/components/BookDetailPage";
import CampaignGenerationForm from "@/components/CampaignGenerationForm";

type Page = "dashboard" | "add-book" | "book-detail" | "create-campaign";

interface Book {
  id: string;
  asin: string;
  title: string;
  author: string;
  marketplace: string;
  campaign_count: number;
  total_keywords: number;
  created_at: string;
}

export default function Home() {
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [selectedBookIdForCampaign, setSelectedBookIdForCampaign] = useState<string | null>(null);
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

  const mainNavItems = [{ icon: Folder, label: "Books" }];

  return (
    <div className="flex min-h-screen bg-white">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? "w-72" : "w-20"
        } bg-white border-r border-gray-200 transition-all duration-300 flex flex-col fixed h-screen left-0 top-0 z-40`}
      >
        {/* Logo/Header */}
        <div className={`border-b border-gray-200 ${sidebarOpen ? "p-6" : "p-4"}`}>
          <div className={`flex items-center gap-3 ${sidebarOpen ? "justify-between" : "flex-col"}`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-lg">📚</span>
              </div>
              {sidebarOpen && (
                <div>
                  <div className="font-bold text-gray-900 text-sm">Ads Assistant</div>
                  <div className="text-xs text-gray-500">Book Manager</div>
                </div>
              )}
            </div>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-all"
              title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              {sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {mainNavItems.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                if (item.label === "Books") {
                  setCurrentPage("dashboard");
                  setSelectedBook(null);
                }
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                (currentPage === "dashboard" || currentPage === "book-detail") && item.label === "Books"
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <item.icon size={20} className="flex-shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Account */}
        <nav className="p-4 border-t border-gray-200 space-y-1">
          {isAdmin && (
            <a
              href="/admin"
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-all"
            >
              <Shield size={20} className="flex-shrink-0" />
              {sidebarOpen && <span>Admin</span>}
            </a>
          )}
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-50"
          >
            <LogOut size={20} className="flex-shrink-0" />
            {sidebarOpen && <span>{isLoggingOut ? "Signing out…" : "Sign out"}</span>}
          </button>
        </nav>
      </div>

      {/* Main Content */}
      <div className={`flex-1 transition-all duration-300 ${sidebarOpen ? "ml-72" : "ml-20"}`}>
        {currentPage === "dashboard" && !selectedBook && (
          <BooksListDashboard
            onAddBook={() => setCurrentPage("add-book")}
            onSelectBook={(book) => {
              setSelectedBook(book);
              setCurrentPage("book-detail");
            }}
          />
        )}
        {currentPage === "add-book" && (
          <AddBookForm
            onBack={() => setCurrentPage("dashboard")}
            onSuccess={() => setCurrentPage("dashboard")}
          />
        )}
        {currentPage === "book-detail" && selectedBook && (
          <BookDetailPage
            bookId={selectedBook.id}
            onBack={() => {
              setSelectedBook(null);
              setCurrentPage("dashboard");
            }}
            onCreateCampaign={(bookId) => {
              setSelectedBookIdForCampaign(bookId);
              setCurrentPage("create-campaign");
            }}
          />
        )}
        {currentPage === "create-campaign" && selectedBookIdForCampaign && (
          <CampaignGenerationForm
            bookId={selectedBookIdForCampaign}
            onBack={() => {
              setCurrentPage("book-detail");
              setSelectedBookIdForCampaign(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
