/**
 * HTML-level listing metadata: the parts of an Amazon product page that
 * aren't the product copy but still carry keyword signal — the `<title>`
 * tag, Amazon's own `<meta name="keywords">`, the canonical URL slug,
 * embedded JSON-LD, the variation swatches, and which editions/formats
 * actually exist for the ASIN.
 *
 * Kept apart from lib/scrape.ts (which is already large) and written against
 * a Cheerio document so it can be exercised against fixture HTML without a
 * network call.
 *
 * Every field goes through `pick`, which tries selectors in order and
 * records which one worked. Amazon changes selectors constantly, so a field
 * that silently returns nothing is indistinguishable from a field the page
 * doesn't have unless the attempt itself is logged — see
 * lib/listingRecord.ts for the per-field success reporting this feeds.
 */

import type * as cheerio from "cheerio";

export interface ListingHtmlMetadata {
  /** The `<title>` tag — often a cleaner version of the on-page product title. */
  htmlTitle?: string;
  /** Amazon's own associated terms, when the page carries them. */
  metaKeywords: string[];
  metaDescription?: string;
  /** Human-readable URL segment before /dp/ — a canonical keyword phrase. */
  urlSlug?: string;
  /** Brand/publisher from the byline or the detail table. */
  brand?: string;
  /** Variation swatch labels: sizes, colours, pack counts, styles. */
  variations: string[];
  /** Formats confirmed present on the ASIN or its sibling editions. */
  availableFormats: string[];
  isKindleUnlimited: boolean;
  /** JSON-LD / microdata blocks, parsed, when present. */
  structuredData: Array<Record<string, unknown>>;
  /** Which fields the extraction actually found, for per-field success rates. */
  fieldsFound: string[];
  fieldsMissing: string[];
}

/** Canonical format vocabulary, shared with the format-availability filter. */
export const KNOWN_FORMATS = ["kindle", "paperback", "hardcover", "audiobook", "large print"] as const;

const FORMAT_ALIASES: Array<{ format: string; pattern: RegExp }> = [
  { format: "kindle", pattern: /\b(kindle|ebook|e-book)\b/i },
  { format: "paperback", pattern: /\b(paperback|mass market|softcover)\b/i },
  { format: "hardcover", pattern: /\b(hardcover|hardback|hard cover|library binding)\b/i },
  { format: "audiobook", pattern: /\b(audiobook|audio book|audible|audio cd|mp3 cd)\b/i },
  { format: "large print", pattern: /\blarge print\b/i },
];

/**
 * Tries each selector in turn and returns the first non-empty text. Amazon
 * renames these regularly, which is why every field has more than one.
 */
function pick($: cheerio.CheerioAPI, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const value = $(selector).first().text().replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return undefined;
}

function attr($: cheerio.CheerioAPI, selectors: string[], attribute: string): string | undefined {
  for (const selector of selectors) {
    const value = $(selector).first().attr(attribute)?.replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return undefined;
}

/** "/Scars-Past-gripping-Scottish-thriller/dp/B0CLY37W22" → "scars past gripping scottish thriller". */
export function slugFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = url.match(/\/([^/]+)\/dp\//i);
  if (!match) return undefined;
  const slug = match[1]
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  // Amazon falls back to a generic slug when the title has no ASCII form.
  if (!slug || slug === "dp" || /^(gp|product)$/.test(slug)) return undefined;
  return slug;
}

function parseStructuredData($: cheerio.CheerioAPI): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) blocks.push(...parsed.filter((entry) => entry && typeof entry === "object"));
      else if (parsed && typeof parsed === "object") blocks.push(parsed);
    } catch {
      // Amazon ships malformed JSON-LD often enough that a parse failure is
      // routine, not an error worth surfacing.
    }
  });
  return blocks;
}

/**
 * Variation swatches — size, colour, pack count, style. These are the
 * modifier keywords readers add to a query ("large print", "box set").
 */
function extractVariations($: cheerio.CheerioAPI): string[] {
  const variations = new Set<string>();
  const selectors = [
    "#variation_style_name li .a-size-base",
    "#variation_size_name li .a-size-base",
    "#variation_color_name li img",
    "#twister li .a-button-text",
    "#tmmSwatches .a-button-text",
    ".swatchElement .a-button-text",
  ];
  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const text = ($(el).attr("alt") || $(el).text() || "").replace(/\s+/g, " ").trim();
      if (text && text.length <= 40) variations.add(text);
    });
  }
  return Array.from(variations).slice(0, 20);
}

/**
 * Which editions actually exist. Read from the format swatch strip
 * (#tmmSwatches / #formats) rather than from a page-wide text search: the
 * word "hardcover" appears in the footer, the "other sellers" box and half
 * the also-bought carousel on a Kindle-only listing, so a whole-page regex
 * says every book has every format — which is exactly the bug that let
 * "jacqueline new hardcover" into a Kindle-only book's keyword list.
 */
export function extractAvailableFormats($: cheerio.CheerioAPI): string[] {
  const formats = new Set<string>();

  const swatchText: string[] = [];
  // #twister carries the edition variations (large print, box set) that
  // Amazon keeps out of the format strip proper.
  $("#tmmSwatches li, #formats li, #twister li, #mediaTabs_tabSet a, .swatchElement").each(
    (_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text) swatchText.push(text);
    }
  );

  // The binding row in the detail table names the edition being viewed even
  // when the swatch strip didn't render.
  const bindingRow = pick($, [
    "#detailBullets_feature_div li:contains('Print length')",
    "#productDetails_detailBullets_sections1 tr:contains('Publisher')",
    "#productSubtitle",
    "#productBinding",
  ]);
  if (bindingRow) swatchText.push(bindingRow);

  for (const text of swatchText) {
    for (const { format, pattern } of FORMAT_ALIASES) {
      if (pattern.test(text)) formats.add(format);
    }
  }

  return Array.from(formats);
}

/** Kindle Unlimited enrolment — the badge/pitch only renders when the title is actually in KU. */
export function extractKindleUnlimited($: cheerio.CheerioAPI): boolean {
  const selectors = [
    "#ku-pitch",
    "#kindle-unlimited-logo",
    "[data-feature-name='kindleUnlimitedLogo']",
    "#tmm-grid-swatch-KINDLE_UNLIMITED",
    "#a-autoid-0-announce",
  ];
  for (const selector of selectors) {
    const text = $(selector).first().text();
    if (/kindle unlimited/i.test(text)) return true;
  }
  return /read with kindle unlimited/i.test($("#buybox, #rightCol, #kuMessaging").text());
}

/**
 * Extracts everything above from one loaded product page. `sourceUrl` is the
 * page's own URL: the slug is read from the canonical link when the page has
 * one, and falls back to the requested URL.
 */
export function extractListingHtmlMetadata($: cheerio.CheerioAPI, sourceUrl?: string): ListingHtmlMetadata {
  const fieldsFound: string[] = [];
  const fieldsMissing: string[] = [];
  const track = <T>(field: string, value: T, present: boolean): T => {
    (present ? fieldsFound : fieldsMissing).push(field);
    return value;
  };

  const htmlTitle = pick($, ["title"]) ?? attr($, ["meta[property='og:title']"], "content");

  const metaKeywordsRaw = attr($, ["meta[name='keywords']", "meta[name='Keywords']"], "content");
  const metaKeywords = metaKeywordsRaw
    ? metaKeywordsRaw
        .split(",")
        .map((keyword) => keyword.replace(/\s+/g, " ").trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 40)
    : [];

  const metaDescription =
    attr($, ["meta[name='description']", "meta[property='og:description']"], "content") ?? undefined;

  const canonical = attr($, ["link[rel='canonical']"], "href");
  const urlSlug = slugFromUrl(canonical) ?? slugFromUrl(sourceUrl);

  const brand = pick($, [
    "#bylineInfo",
    "#brand",
    "#detailBullets_feature_div li:contains('Publisher')",
    "tr.po-brand td.a-span9",
  ]);

  const variations = extractVariations($);
  const availableFormats = extractAvailableFormats($);
  const structuredData = parseStructuredData($);

  return {
    htmlTitle: track("html_title", htmlTitle, !!htmlTitle),
    metaKeywords: track("meta_keywords", metaKeywords, metaKeywords.length > 0),
    metaDescription: track("meta_description", metaDescription, !!metaDescription),
    urlSlug: track("url_slug", urlSlug, !!urlSlug),
    brand: track("brand", brand, !!brand),
    variations: track("variations", variations, variations.length > 0),
    availableFormats: track("formats", availableFormats, availableFormats.length > 0),
    isKindleUnlimited: extractKindleUnlimited($),
    structuredData: track("structured_data", structuredData, structuredData.length > 0),
    fieldsFound,
    fieldsMissing,
  };
}

/**
 * Formats implied by a book's own format flags when the swatch strip didn't
 * render at all (a bot-checked or partially loaded page). Deliberately
 * conservative: the format the listing *is* counts, page-wide mentions of
 * other formats do not.
 */
export function fallbackFormats(params: {
  bindingType?: string;
  format?: string;
  formatVariants?: Array<{ format: string }>;
}): string[] {
  const formats = new Set<string>();
  const texts = [params.bindingType, params.format, ...(params.formatVariants ?? []).map((v) => v.format)];
  for (const text of texts) {
    if (!text) continue;
    for (const { format, pattern } of FORMAT_ALIASES) {
      if (pattern.test(text)) formats.add(format);
    }
  }
  return Array.from(formats);
}
