import { NextRequest, NextResponse } from "next/server";
import { scrapeProductPage } from "@/lib/scrape";
import { Marketplace } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 20;

const MARKETPLACES: Marketplace[] = ["US", "UK", "CA", "DE", "FR", "IT", "ES"];
const ASIN_PATTERN = /^[A-Z0-9]{10}$/i;

/**
 * Lightweight lookup used by the "Autofill" button on the Generate/Harvest
 * forms — scrapes just the target book's own product page (no comp crawl,
 * no keyword research) and returns title/author/series/price so the user
 * doesn't have to type them in by hand before they've even seen the book.
 */
export async function GET(req: NextRequest) {
  const asin = req.nextUrl.searchParams.get("asin")?.trim().toUpperCase() ?? "";
  const marketplace = req.nextUrl.searchParams.get("marketplace") as Marketplace | null;

  if (!ASIN_PATTERN.test(asin)) {
    return NextResponse.json({ error: "ASIN must be a 10-character alphanumeric code." }, { status: 400 });
  }
  if (!marketplace || !MARKETPLACES.includes(marketplace)) {
    return NextResponse.json(
      { error: `Marketplace must be one of ${MARKETPLACES.join(", ")}.` },
      { status: 400 }
    );
  }

  const productPage = await scrapeProductPage(asin, marketplace);
  if (!productPage.title) {
    return NextResponse.json(
      {
        error:
          "Couldn't load or parse that product page. Double check the ASIN and marketplace, or fill in the fields manually.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    title: productPage.title,
    author: productPage.author,
    seriesName: productPage.seriesName,
    price: productPage.price,
  });
}
