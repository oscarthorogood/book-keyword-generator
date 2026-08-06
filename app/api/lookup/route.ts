import { NextRequest, NextResponse } from "next/server";
import { normalizeAsinOrIsbn } from "@/lib/isbn";
import { scrapeProductPage } from "@/lib/scrape";
import { Marketplace } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 20;

const MARKETPLACES: Marketplace[] = ["US", "UK", "CA", "DE", "FR", "IT", "ES"];

/**
 * Lightweight lookup used by the "Autofill" button on the Generate/Harvest
 * forms — scrapes just the target book's own product page (no comp crawl,
 * no keyword research) and returns title/author/series/price so the user
 * doesn't have to type them in by hand before they've even seen the book.
 */
export async function GET(req: NextRequest) {
  const rawAsin = req.nextUrl.searchParams.get("asin") ?? "";
  const asin = normalizeAsinOrIsbn(rawAsin);
  const marketplace = req.nextUrl.searchParams.get("marketplace") as Marketplace | null;

  if (!asin) {
    return NextResponse.json({ error: "Enter a valid ASIN, ISBN-10, or ISBN-13." }, { status: 400 });
  }
  if (!marketplace || !MARKETPLACES.includes(marketplace)) {
    return NextResponse.json(
      { error: `Marketplace must be one of ${MARKETPLACES.join(", ")}.` },
      { status: 400 }
    );
  }

  const productPage = await scrapeProductPage(asin, marketplace);
  if (!productPage.title) {
    const statusNote =
      productPage.fetchStatus !== undefined
        ? ` (upstream HTTP ${productPage.fetchStatus})`
        : " (no response — network error or timeout)";
    const error = productPage.blocked
      ? `Amazon blocked this request (bot/CAPTCHA check)${statusNote} instead of serving the real page — common when scraping from a cloud-hosted deployment (Vercel, etc.), much rarer from a home IP. Fill in the fields manually for now; see the README's 'Known open items' for mitigation options.`
      : `Couldn't load or parse that product page${statusNote}. Double check the ASIN and marketplace, or fill in the fields manually.`;
    return NextResponse.json(
      { error, blocked: productPage.blocked ?? false, fetchStatus: productPage.fetchStatus },
      { status: 502 }
    );
  }

  return NextResponse.json({
    asin,
    title: productPage.title,
    author: productPage.author,
    seriesName: productPage.seriesName,
    price: productPage.price,
  });
}
