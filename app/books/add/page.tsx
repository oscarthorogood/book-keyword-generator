"use client";

import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import AddBookForm from "@/components/AddBookForm";

export default function AddBookPage() {
  const router = useRouter();

  return (
    <AppShell active="books">
      <AddBookForm onBack={() => router.push("/books")} onSuccess={(bookId) => router.push(`/books/${bookId}`)} />
    </AppShell>
  );
}
