import Link from "next/link";
import { SearchX } from "lucide-react";

/**
 * Replaces Next's built-in 404, which renders in the browser's default font
 * and colours — outside the design system entirely. This page is reachable
 * in normal use: /admin calls notFound() for non-admins rather than 403, so
 * the page's existence isn't advertised.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center px-4 py-16" style={{ background: "var(--bg-subtle)" }}>
      <div className="empty-state max-w-lg">
        <span className="icon-tile icon-tile-lg icon-tile-dark">
          <SearchX size={24} />
        </span>
        <div className="space-y-2">
          <p className="empty-state-title">Page not found</p>
          <p className="empty-state-body">
            That page doesn&apos;t exist, or you don&apos;t have access to it. Check the link, or head back
            to your books.
          </p>
        </div>
        <Link href="/" className="btn btn-primary no-underline">
          Back to books
        </Link>
      </div>
    </main>
  );
}
