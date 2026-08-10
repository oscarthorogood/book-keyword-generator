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

    // Title - try multiple selectors as Amazon structure varies
    let titleElement = $("h1 span#productTitle").text().trim();
    if (!titleElement) titleElement = $("h1[data-feature-name='title']").text().trim();
    if (!titleElement) titleElement = $("span#productTitle").text().trim();
    if (!titleElement) {
      const h1Text = $("h1").text().trim();
      if (h1Text && h1Text.length > 0 && h1Text.length < 500) titleElement = h1Text;
    }
    if (titleElement) data.title = titleElement;

    // Author - try multiple selectors
    let authorElement = $("a.a-link-normal.contributorNameID").first().text().trim();
    if (!authorElement) authorElement = $("span.author").first().text().trim();
    if (!authorElement) authorElement = $("a[data-a-target='author-link']").first().text().trim();
    if (!authorElement) {
      // Try to find author in byline section
      const bylineText = $("[data-feature-name='bylineInfo']").text().trim();
      if (bylineText) authorElement = bylineText.split(" by ").pop() || "";
    }
    if (authorElement) data.author = authorElement;

    // Price - try multiple selectors
    let priceText = $(".a-price.a-text-price.a-size-medium.apexPriceToPay").first().text().trim();
    if (!priceText) priceText = $(".a-price-whole").first().text().trim();
    if (!priceText) priceText = $("span.a-price-whole").first().text().trim();
    if (priceText) {
      const priceMatch = priceText.match(/[\d,]+\.?\d*/);
      if (priceMatch) data.price = parseFloat(priceMatch[0].replace(/,/g, ""));
    }

    // Rating - try multiple selectors
    let ratingText = $(".a-icon-star.a-star-small.a-star-mine").text().trim();
    if (!ratingText) ratingText = $("[data-feature-name='acUserReviewsSummary'] .a-star span").first().text().trim();
    if (!ratingText) ratingText = $("span.a-icon-star span").first().text().trim();
    if (ratingText) {
      const ratingMatch = ratingText.match(/[\d.]+/);
      if (ratingMatch) data.rating = parseFloat(ratingMatch[0]);
    }

    // Review count
    let reviewCountText = $("#acrCustomerReviewText").text().trim();
    if (!reviewCountText) reviewCountText = $("span[data-hook='total-review-count']").text().trim();
    if (reviewCountText) {
      const countMatch = reviewCountText.match(/[\d,]+/);
      if (countMatch) data.reviewCount = parseInt(countMatch[0].replace(/,/g, ""));
    }

    // Description - try multiple selectors
    let description = $("#feature-bullets .a-list-item").first().text().trim();
    if (!description) description = $("div[data-feature-name='featurebullets'] .a-list-item").first().text().trim();
    if (!description) description = $("[data-feature-name='featurebullets'] li").first().text().trim();
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
  // ASIN: starts with B0 and is 10 chars (may contain letters)
  // ISBN-10: exactly 10 digits
  // ISBN-13: exactly 13 digits
  const isAsin = normalized.startsWith("B0") && normalized.length === 10;
  const isIsbn10 = /^\d{10}$/.test(normalized);
  const isIsbn13 = /^\d{13}$/.test(normalized);

  let amazonData: Partial<AmazonBookData> = { asin: normalized };

  // If it's an ASIN, scrape Amazon directly (Amazon /dp/ URLs only work with ASINs)
  if (isAsin) {
    amazonData = await scrapeAmazonBook(normalized, marketplace);
  }

  // Enrich with metadata from other sources
  // For ISBNs, this will lookup Google Books/Open Library using the ISBN
  // For ASINs that didn't return full data, enrich with additional sources
  const enrichment = await enrichBookMetadata({
    isbn10: isIsbn10 ? normalized : amazonData.isbn10,
    isbn13: isIsbn13 ? normalized : amazonData.isbn13,
    title: amazonData.title,
    author: amazonData.author,
  });

  // Merge enrichment data - Open Library is used as fallback when Amazon fails
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
    publisher: amazonData.publisher || (enrichment.publisher as any),
    publicationDate: amazonData.publicationDate || (enrichment.publicationDate as any),
    pageCount: amazonData.pageCount || (enrichment.pageCount as any),
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
