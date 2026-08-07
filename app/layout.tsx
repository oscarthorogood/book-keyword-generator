import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { isCurrentUserAdmin } from "@/lib/admin";
import "./globals.css";

type RootLayoutProps = {
  children: ReactNode;
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Amazon Book Ads Builder",
  description:
    "Enter a book ASIN/ISBN, gather metadata, scrape keyword candidates from every source, and get an AI-reviewed shortlist for a Manual Sponsored Products campaign.",
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1eef7" },
    { media: "(prefers-color-scheme: dark)", color: "#131218" },
  ],
};

export default async function RootLayout({ children }: RootLayoutProps) {
  // Resolved here so every page gets the same nav without a client round-trip.
  // Never throw out of the layout: on /login there is no session yet, and a
  // misconfigured deployment should still be able to render the login page.
  let isAdmin = false;
  try {
    isAdmin = await isCurrentUserAdmin();
  } catch {
    isAdmin = false;
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Header isAdmin={isAdmin} />
        {children}
      </body>
    </html>
  );
}
