"use client";

import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import BooksListDashboard from "@/components/BooksListDashboard";

export default function BooksPage() {
  const router = useRouter();

  return (
    <AppShell active="books">
      <BooksListDashboard
        onAddBook={() => router.push("/books/add")}
        onSelectBook={(bookId) => router.push(`/books/${bookId}`)}
      />
    </AppShell>
  );
}
