import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Roboto_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

type RootLayoutProps = {
  children: ReactNode;
};

// Inter is the only typeface in the system (§1.1). Weights 400-600 do all the
// work; 700 exists but is rare.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Tabular data only — ASINs, IDs, code. Never body copy.
const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Amazon Book Ads Builder",
  description:
    "Enter a book ASIN/ISBN, gather metadata, and manage a curated keyword list for Amazon Ads targeting.",
};

// The design language is a light, neutral-first system (§0/§2.6): one page
// background, white, in both colour schemes.
export const viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${robotoMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white">
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
