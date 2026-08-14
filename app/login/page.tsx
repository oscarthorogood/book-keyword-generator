import { Suspense } from "react";
import { BookOpen } from "lucide-react";
import { LoginForm } from "@/components/LoginForm";

function LoginPageContent() {
  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-16"
      style={{ background: "var(--bg-subtle)" }}
    >
      <div className="w-full max-w-md">
        <div className="shell p-8">
          <div className="mb-8 text-center">
            <span className="icon-tile icon-tile-lg icon-tile-dark mx-auto mb-5">
              <BookOpen size={24} />
            </span>
            <h1 className="text-display-xs font-semibold" style={{ color: "var(--text-primary)" }}>
              Amazon Book Ads Builder
            </h1>
            <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
              Enter your email and we&apos;ll send you a sign-in link.
            </p>
          </div>

          <Suspense
            fallback={
              <p className="text-center text-sm" style={{ color: "var(--text-secondary)" }}>
                Loading…
              </p>
            }
          >
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
          This is a private application. Anyone with a plausible email address can sign in; an administrator
          can block a specific address afterward.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <LoginPageContent />;
}
