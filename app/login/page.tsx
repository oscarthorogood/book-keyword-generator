import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

function LoginPageContent() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="shell p-6 md:p-8 rounded-lg">
          <div className="mb-8 text-center">
            <div className="logo-mark mx-auto mb-4">PB</div>
            <h1 className="page-heading text-2xl md:text-3xl">Amazon Book Ads Builder</h1>
            <p className="text-sm mt-2" style={{ color: "var(--muted)" }}>
              Enter your email and we&apos;ll send you a sign-in link
            </p>
          </div>

          <Suspense fallback={<div className="text-center text-sm" style={{ color: "var(--muted)" }}>Loading...</div>}>
            <LoginForm />
          </Suspense>

          <p className="text-xs text-center mt-6" style={{ color: "var(--muted)" }}>
            This is a private application. New email addresses are reviewed by the administrator before access is granted.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <LoginPageContent />;
}
