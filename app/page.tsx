"use client";

import { useState } from "react";
import AppShell from "@/components/AppShell";
import BooksListDashboard from "@/components/BooksListDashboard";
import AddBookForm from "@/components/AddBookForm";
import BookDetailPage from "@/components/BookDetailPage";

type Page = "dashboard" | "add-book" | "book-detail";

export default function Home() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  // Only the id is held here — the detail page loads the book itself, so
  // there's no half-populated copy of the row to keep in sync.
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  return (
    <AppShell
      active={currentPage === "add-book" ? "add-book" : "books"}
      onNavigate={(target) => {
        if (target === "books") {
          setCurrentPage("dashboard");
          setSelectedBookId(null);
        } else {
          setCurrentPage("add-book");
        }
      }}
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
    </AppShell>
  );
}
