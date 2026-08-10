import * as cheerio from "cheerio";
import { enrichBookMetadata } from "./bookMetadata";
import { normalizeAsinOrIsbn } from "./isbn";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 10000;

const MARKETPLACE_DOMAINS = {
  US: "amazon.com",
  UK: "amazon.co.uk",
  CA: "amazon.ca",
  DE: "amazon.de",
  FR: "amazon.fr",
  IT: "amazon.it",
  ES: "amazon.es",
};

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        ...init?.headers,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export interface AmazonBookData {
  asin: string;
  title: string;
  author: string;
  price?: number;
  rating?: number;
  reviewCount?: number;
  description?: string;
  isbn10?: string;
  isbn13?: string;
  publisher?: string;
  publicationDate?: string;
  pageCount?: number;
  language?: string;
  dimensions?: string;
  categoryPath?: string[];
  bestSellerRanks?: Array<{ rank: number; category: string }>;
  bulletPoints?: string[];
  coverImageUrl?: string;
  qaCount?: number;
  availability?: string;
  compDetails?: Array<{ asin: string; title: string; author?: string; rating?: number; reviewCount?: number }>;
  frequentlyBoughtTogether?: Array<{ asin: string; title: string }>;
  compareWithSimilar?: Array<{ asin: string; title: string }>;
  googleBooksCategories?: string[];
  openLibrarySubjects?: string[];
  goodreadsTags?: string[];
}

/**
 * Scrape Amazon product page for book metadata
 */
export async function scrapeAmazonBook(asin: string, marketplace: keyof typeof MARKETPLACE_DOMAINS = "US"): Promise<Partial<AmazonBookData>> {
  const domain = MARKETPLACE_DOMAINS[marketplace];
  const url = `https://${domain}/dp/${asin}`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { asin };

    const html = await res.text();
    const $ = cheerio.load(html);

    const data: Partial<AmazonBookData> = { asin };

    // Title
    const titleElement = $("h1 span#productTitle").text().trim();
    if (titleElement) data.title = titleElement;

    // Author - look for author link in byline
    const authorElement = $("a.a-link-normal.contributorNameID").first().text().trim();
    if (authorElement) data.author = authorElement;

    // Price
    const priceText = $(".a-price.a-text-price.a-size-medium.apexPriceToPay").first().text().trim();
    if (priceText) {
      const priceMatch = priceText.match(/[\d,]+\.?\d*/);
      if (priceMatch) data.price = parseFloat(priceMatch[0].replace(/,/g, ""));
    }

    // Rating
    const ratingText = $(".a-icon-star.a-star-small.a-star-mine").text().trim();
    if (ratingText) {
      const ratingMatch = ratingText.match(/[\d.]+/);
      if (ratingMatch) data.rating = parseFloat(ratingMatch[0]);
    }

    // Review count
    const reviewCountText = $("#acrCustomerReviewText").text().trim();
    if (reviewCountText) {
      const countMatch = reviewCountText.match(/[\d,]+/);
      if (countMatch) data.reviewCount = parseInt(countMatch[0].replace(/,/g, ""));
    }

    // Description
    const description = $("#feature-bullets .a-list-item").first().text().trim();
    if (description) data.description = description;

    // Product information (ISBN, publisher, etc.)
    const productInfo = $("table.a-keyvalue.prodDetTable");
    productInfo.find("tr").each((_, row) => {
      const label = $(row).find("th").text().trim().toLowerCase();
      const value = $(row).find("td").text().trim();

      if (label.includes("isbn")) {
        if (label.includes("10")) data.isbn10 = value;
        else if (label.includes("13")) data.isbn13 = value;
        else if (value.length === 10) data.isbn10 = value;
        else if (value.length === 13) data.isbn13 = value;
      } else if (label.includes("publisher")) {
        data.publisher = value;
      } else if (label.includes("publication")) {
        data.publicationDate = value;
      } else if (label.includes("pages")) {
        const pageMatch = value.match(/\d+/);
        if (pageMatch) data.pageCount = parseInt(pageMatch[0]);
      } else if (label.includes("language")) {
        data.language = value;
      } else if (label.includes("dimensions")) {
        data.dimensions = value;
      }
    });

    // Bullet points
    const bulletPoints: string[] = [];
    $("#feature-bullets .a-list-item").each((_, item) => {
      const text = $(item).text().trim();
      if (text) bulletPoints.push(text);
    });
    if (bulletPoints.length > 0) data.bulletPoints = bulletPoints.slice(0, 5);

    // Best seller rank
    const ranks: Array<{ rank: number; category: string }> = [];
    $("#productDetails_detailBullets_sections1 .a-list-item").each((_, item) => {
      const text = $(item).text().trim();
      if (text.includes("#")) {
        const rankMatch = text.match(/#([\d,]+)/);
        if (rankMatch) {
          const category = text.split("in ").pop()?.trim() || "Books";
          ranks.push({
            rank: parseInt(rankMatch[1].replace(/,/g, "")),
            category,
          });
        }
      }
    });
    if (ranks.length > 0) data.bestSellerRanks = ranks;

    // Cover image
    const coverImage = $("img.a-dynamic-image").first().attr("src");
    if (coverImage) data.coverImageUrl = coverImage;

    // Q&A count (if visible)
    const qaText = $("[data-a-color='base']").filter((_, el) => $(el).text().includes("Q&A")).text();
    if (qaText) {
      const qaMatch = qaText.match(/(\d+)/);
      if (qaMatch) data.qaCount = parseInt(qaMatch[1]);
    }

    // Category path
    const categoryPath: string[] = [];
    $("a.a-breadcrumb-link").each((_, el) => {
      const text = $(el).text().trim();
      if (text && text !== "Amazon.com" && text !== "Your Amazon.com") categoryPath.push(text);
    });
    if (categoryPath.length > 0) data.categoryPath = categoryPath;

    return data;
  } catch (error) {
    console.error(`Error scraping Amazon (${asin}):`, error);
    return { asin };
  }
}

/**
 * Fetch book metadata from Amazon and enrich with data from other sources
 */
export async function fetchAmazonBookMetadata(
  asinOrIsbn: string,
  marketplace: keyof typeof MARKETPLACE_DOMAINS = "US"
): Promise<AmazonBookData> {
  const normalized = normalizeAsinOrIsbn(asinOrIsbn);
  if (!normalized) {
    throw new Error("Invalid ASIN/ISBN format");
  }

  // Determine if it's an ASIN or ISBN
  const isAsin = normalized.startsWith("B0") && normalized.length === 10;
  const isIsbn = normalized.length === 10 || normalized.length === 13;

  let amazonData: Partial<AmazonBookData> = { asin: normalized };

  // Try to scrape Amazon — works for both ASINs and ISBNs
  // Amazon product pages can be accessed via /dp/ASIN or via ISBN lookups
  amazonData = await scrapeAmazonBook(normalized, marketplace);

  // Enrich with metadata from other sources
  const enrichment = await enrichBookMetadata({
    isbn10: isIsbn && normalized.length === 10 ? normalized : amazonData.isbn10,
    isbn13: isIsbn && normalized.length === 13 ? normalized : amazonData.isbn13,
    title: amazonData.title,
    author: amazonData.author,
  });

  // Merge enrichment data
  const result: AmazonBookData = {
    asin: normalized,
    title: amazonData.title || enrichment.title || "Unknown Title",
    author: amazonData.author || enrichment.author || "Unknown Author",
    price: amazonData.price,
    rating: amazonData.rating,
    reviewCount: amazonData.reviewCount,
    description: amazonData.description || enrichment.description,
    isbn10: amazonData.isbn10 || enrichment.isbn10,
    isbn13: amazonData.isbn13 || enrichment.isbn13,
    publisher: amazonData.publisher,
    publicationDate: amazonData.publicationDate,
    pageCount: amazonData.pageCount,
    language: amazonData.language,
    dimensions: amazonData.dimensions,
    categoryPath: amazonData.categoryPath,
    bestSellerRanks: amazonData.bestSellerRanks,
    bulletPoints: amazonData.bulletPoints,
    coverImageUrl: amazonData.coverImageUrl,
    qaCount: amazonData.qaCount,
    availability: amazonData.availability,
    compDetails: amazonData.compDetails,
    frequentlyBoughtTogether: amazonData.frequentlyBoughtTogether,
    compareWithSimilar: amazonData.compareWithSimilar,
    googleBooksCategories: enrichment.categories,
    openLibrarySubjects: enrichment.subjects,
    goodreadsTags: [],
  };

  return result;
}
