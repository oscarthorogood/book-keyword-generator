"use client";

import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import BookDetailPage from "@/components/BookDetailPage";

export default function BookPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  return (
    <AppShell active="books">
      <BookDetailPage bookId={params.id} onBack={() => router.push("/books")} />
    </AppShell>
  );
}
