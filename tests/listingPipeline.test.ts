/**
 * Listing capture → keyword corpus → bulksheet, end to end over fixture HTML.
 *
 * The metadata spec's definition of done asks for deterministic extraction
 * snapshots from fixture pages, a validated record with per-field coverage,
 * and a bulk-upload-compatible export. This covers all three without a
 * network call.
 */

import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { buildBulksheetCsv, buildBulksheetRows } from "../lib/bulksheet";
import {
  extractAvailableFormats,
  extractKindleUnlimited,
  extractListingHtmlMetadata,
  fallbackFormats,
  slugFromUrl,
} from "../lib/listingMetadata";
import { buildListingMetadataCandidates, scoreListingNgrams } from "../lib/listingKeywords";
import {
  listingRecordKey,
  normalizeListingText,
  summariseFieldCoverage,
  validateListingRecord,
  type ListingRecord,
} from "../lib/listingRecord";
import { buildFormatNegatives, buildNegativeKeywords } from "../lib/negativeKeywords";
import { buildBrandTargets, buildProductTargets } from "../lib/productTargets";

const FIXTURE_HTML = `
<html>
  <head>
    <title>Scars of the Past: A gripping Scottish crime thriller: Amazon.co.uk: New, Jacqueline: Books</title>
    <meta name="keywords" content="scottish crime thriller, edinburgh crime fiction, police procedural, dci mcneill" />
    <meta name="description" content="A gripping Scottish crime thriller set in Edinburgh." />
    <link rel="canonical" href="https://www.amazon.co.uk/Scars-Past-gripping-Scottish-thriller/dp/B0CLY37W22" />
    <script type="application/ld+json">{"@type":"Book","name":"Scars of the Past","author":"Jacqueline New"}</script>
  </head>
  <body>
    <span id="productTitle">Scars of the Past: A gripping Scottish crime thriller</span>
    <div id="bylineInfo">by Jacqueline New (Author)</div>
    <div id="tmmSwatches">
      <li><span class="a-button-text">Kindle Edition £0.99</span></li>
      <li><span class="a-button-text">Paperback £8.99</span></li>
    </div>
    <div id="twister"><li><span class="a-button-text">Large Print</span></li></div>
  </body>
</html>`;

function record(overrides: Partial<ListingRecord> = {}): ListingRecord {
  return {
    asin: "B0CLY37W22",
    marketplace: "UK",
    scrapedAt: "2026-03-15T10:00:00.000Z",
    sourceUrl: "https://www.amazon.co.uk/dp/B0CLY37W22",
    isCompetitor: false,
    title: "Scars of the Past: A gripping Scottish crime thriller",
    bullets: ["A gripping Scottish crime thriller", "First in the DCI McNeill series"],
    description: "When a body is found in an Edinburgh tower block, DCI Mac McNeill is called in.",
    brand: "Jacqueline New",
    categoryPath: ["Kindle Store", "Crime, Thriller & Mystery", "Scottish Crime Fiction"],
    variations: ["Kindle Edition", "Paperback"],
    htmlTitle: "Scars of the Past: A gripping Scottish crime thriller",
    metaKeywords: ["scottish crime thriller", "edinburgh crime fiction"],
    metaDescription: "A gripping Scottish crime thriller set in Edinburgh.",
    urlSlug: "scars past gripping scottish thriller",
    structuredData: [],
    bsr: [{ rank: 412, category: "Scottish Crime Fiction" }],
    relatedAsins: ["B0ABCDEFGH"],
    reviewSnippets: ["Outstanding Edinburgh noir."],
    qaSnippets: [],
    reviewCount: 955,
    rating: 4.5,
    price: 0.99,
    formats: ["kindle", "paperback"],
    isKindleUnlimited: false,
    language: "English",
    ...overrides,
  };
}

describe("HTML-level listing metadata", () => {
  const $ = cheerio.load(FIXTURE_HTML);
  const metadata = extractListingHtmlMetadata($, "https://www.amazon.co.uk/dp/B0CLY37W22");

  it("reads the page title, meta keywords and meta description", () => {
    expect(metadata.htmlTitle).toContain("Scars of the Past");
    expect(metadata.metaKeywords).toContain("edinburgh crime fiction");
    expect(metadata.metaDescription).toContain("Edinburgh");
  });

  it("prefers the canonical URL's slug", () => {
    expect(metadata.urlSlug).toBe("scars past gripping scottish thriller");
  });

  it("parses JSON-LD", () => {
    expect(metadata.structuredData[0]).toMatchObject({ "@type": "Book" });
  });

  it("reads formats off the swatch strip, not the whole page", () => {
    expect(extractAvailableFormats($).sort()).toEqual(["kindle", "large print", "paperback"]);
  });

  it("does not claim Kindle Unlimited without the badge", () => {
    expect(extractKindleUnlimited($)).toBe(false);
    const inKu = cheerio.load('<div id="ku-pitch">Read with Kindle Unlimited</div>');
    expect(extractKindleUnlimited(inKu)).toBe(true);
  });

  it("records which fields it found and which it missed", () => {
    expect(metadata.fieldsFound).toContain("meta_keywords");
    expect(metadata.fieldsFound).toContain("url_slug");
  });

  it("falls back to the edition rows when no swatch strip rendered", () => {
    expect(fallbackFormats({ bindingType: "Hardcover" })).toEqual(["hardcover"]);
    expect(fallbackFormats({})).toEqual([]);
  });

  it("ignores a slug that carries no words", () => {
    expect(slugFromUrl("https://www.amazon.co.uk/gp/product/B0CLY37W22")).toBeUndefined();
    expect(slugFromUrl(undefined)).toBeUndefined();
  });
});

describe("ListingRecord validation", () => {
  it("accepts a complete record and reports coverage", () => {
    const result = validateListingRecord(record());
    expect(result.valid).toBe(true);
    expect(result.completeness).toBeGreaterThan(0.8);
    expect(result.coverage.title).toBe(true);
    expect(result.coverage.qaSnippets).toBe(false);
  });

  it("rejects a record with no title and no description — that is a blocked page", () => {
    const result = validateListingRecord(record({ title: undefined, description: undefined }));
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("not read");
  });

  it("catches a malformed ASIN and an out-of-range rating", () => {
    const result = validateListingRecord(record({ asin: "NOPE", rating: 9 }));
    expect(result.errors.some((error) => error.includes("ASIN"))).toBe(true);
    expect(result.errors.some((error) => error.includes("0-5"))).toBe(true);
  });

  it("dedupes on asin + marketplace", () => {
    expect(listingRecordKey(record())).toBe("B0CLY37W22:UK");
    expect(listingRecordKey(record({ marketplace: "US" }))).not.toBe(listingRecordKey(record()));
  });

  it("decodes entities and collapses whitespace, preserving casing", () => {
    expect(normalizeListingText("Crime  &amp;  Thriller\n")).toBe("Crime & Thriller");
  });

  it("flags fields below the 80% success threshold across a batch", () => {
    const results = [
      validateListingRecord(record()),
      validateListingRecord(record({ metaKeywords: [], urlSlug: undefined })),
    ];
    const summary = summariseFieldCoverage(results);
    expect(summary.records).toBe(2);
    expect(summary.weakFields).toContain("metaKeywords");
    expect(summary.weakFields).toContain("qaSnippets");
    expect(summary.weakFields).not.toContain("title");
  });
});

describe("field-weighted n-gram mining", () => {
  it("weights a title phrase above the same phrase in the description", () => {
    const scored = scoreListingNgrams(
      record({
        title: "Scottish crime thriller",
        htmlTitle: undefined,
        metaKeywords: [],
        bullets: [],
        urlSlug: undefined,
        reviewSnippets: [],
        variations: [],
        description: "A scottish crime thriller, and a quiet village mystery.",
      })
    );
    const scottish = scored.find((gram) => gram.text === "scottish crime thriller");
    const village = scored.find((gram) => gram.text === "quiet village mystery");
    expect(scottish!.weight).toBeGreaterThan(village!.weight);
  });

  it("emits meta keywords, the slug and the variations as candidates", () => {
    const candidates = buildListingMetadataCandidates(record()).map((candidate) => candidate.text);
    expect(candidates).toContain("scottish crime thriller");
    expect(candidates).toContain("edinburgh crime fiction");
    expect(candidates.every((text) => text.split(" ").length >= 2)).toBe(true);
  });
});

describe("product and brand targeting", () => {
  const competitors = [
    { asin: "B0AAAAAAAA", title: "Knots and Crosses", author: "Ian Rankin", rating: 4.4, reviewCount: 5200, bestSellerRank: 90 },
    { asin: "B0BBBBBBBB", title: "A Dark So Deadly", author: "Stuart MacBride", rating: 4.3, reviewCount: 900 },
    { asin: "B0CCCCCCCC", title: "Debut Novel", author: "Ian Rankin", rating: 3.9, reviewCount: 12 },
    { asin: "not-an-asin", title: "Broken row", author: "Nobody" },
  ];

  it("ranks the strongest competitor first and drops non-ASINs", () => {
    const targets = buildProductTargets(competitors, ["B0DDDDDDDD"]);
    expect(targets[0].asin).toBe("B0AAAAAAAA");
    expect(targets.map((target) => target.asin)).not.toContain("NOT-AN-ASIN");
    expect(targets.map((target) => target.asin)).toContain("B0DDDDDDDD");
  });

  it("aggregates brands across their titles", () => {
    const brands = buildBrandTargets(competitors);
    expect(brands[0].brand).toBe("ian rankin");
    expect(brands[0].titles).toBe(2);
  });
});

describe("negative keywords", () => {
  const rejections = [
    { text: "scottish fold cat", originalText: "scottish fold cat", verdict: "reject" as const, filter: "offTopicEntity", reason: 'off-topic entity: "cat"', rewritten: false },
    { text: "crime thriller books malayalam", originalText: "crime thriller books malayalam", verdict: "reject" as const, filter: "languageMarket", reason: "non-market language", rewritten: false },
    { text: "264 pages", originalText: "264 pages", verdict: "reject" as const, filter: "uiPollution", reason: "chrome", rewritten: false },
    { text: "fast paced scottish", originalText: "fast paced scottish", verdict: "reject" as const, filter: "phraseShape", reason: "dangling", rewritten: false },
  ];

  it("only negates rejections that describe a real search intent", () => {
    const negatives = buildNegativeKeywords(rejections).map((negative) => negative.text);
    expect(negatives).toContain("scottish fold cat");
    expect(negatives).toContain("crime thriller books malayalam");
    expect(negatives).not.toContain("264 pages");
    expect(negatives).not.toContain("fast paced scottish");
  });

  it("negates the formats the listing doesn't have", () => {
    const negatives = buildFormatNegatives(["kindle"]).map((negative) => negative.text);
    expect(negatives).toEqual(["hardcover", "paperback", "audiobook", "large print"]);
  });
});

describe("bulksheet export", () => {
  const rows = buildBulksheetRows({
    bookTitle: "Scars of the Past",
    keywords: [
      { text: "scottish crime books", matchType: "phrase", bid: 0.42, status: "active", source: "genre-metadata" },
      { text: "ian rankin", matchType: "exact", bid: 0.6, status: "active", source: "comp-name", group: "comp-names" },
      { text: "edinburgh", matchType: "broad", bid: null, status: "paused", source: "genre-metadata" },
    ],
    negatives: [{ text: "scottish fold cat", matchType: "phrase", reason: "off-topic" }],
    productTargets: [{ asin: "B0AAAAAAAA", title: "Knots and Crosses", score: 0.9 }],
    brandTargets: [{ brand: "ian rankin", titles: 2, score: 0.8 }],
  });

  it("writes a campaign and ad group before their keywords", () => {
    expect(rows[0].Entity).toBe("Campaign");
    expect(rows[1].Entity).toBe("Ad Group");
    expect(rows[2].Entity).toBe("Keyword");
  });

  it("splits comparable names into their own exact-match campaign", () => {
    const compRow = rows.find((row) => row["Keyword or Product Targeting"] === "ian rankin");
    expect(compRow!["Campaign Name"]).toContain("Titles & Authors");
    expect(compRow!["Match Type"]).toBe("exact");
  });

  it("carries paused keywords through as paused, not dropped", () => {
    const paused = rows.find((row) => row["Keyword or Product Targeting"] === "edinburgh");
    expect(paused!.State).toBe("paused");
  });

  it("writes negatives and ASIN/brand targeting expressions", () => {
    expect(rows.some((row) => row["Match Type"] === "negative phrase")).toBe(true);
    expect(rows.some((row) => row["Keyword or Product Targeting"] === 'asin="B0AAAAAAAA"')).toBe(true);
    expect(rows.some((row) => row["Keyword or Product Targeting"] === 'brand="ian rankin"')).toBe(true);
  });

  it("adds an Auto Discovery campaign with the four targeting groups, at a small budget slice (§17)", () => {
    const autoCampaignRow = rows.find(
      (row) => row.Entity === "Campaign" && row["Campaign Name"].includes("Auto Discovery")
    );
    expect(autoCampaignRow).toBeDefined();
    expect(autoCampaignRow!["Campaign Targeting Type"]).toBe("auto");
    // Default daily budget in this fixture is $10 — auto should be a small slice, not $10.
    expect(Number(autoCampaignRow!["Daily Budget"])).toBeLessThan(10);

    const autoCampaignName = autoCampaignRow!["Campaign Name"];
    const autoRows = rows.filter((row) => row["Campaign Name"] === autoCampaignName);
    for (const expression of ["close-match", "substitutes", "loose-match", "complements"]) {
      expect(
        autoRows.some((row) => row["Keyword or Product Targeting"] === `targetingExpression="${expression}"`)
      ).toBe(true);
    }

    const closeBid = Number(
      autoRows.find((row) => row["Keyword or Product Targeting"] === 'targetingExpression="close-match"')!.Bid
    );
    const substitutesBid = Number(
      autoRows.find((row) => row["Keyword or Product Targeting"] === 'targetingExpression="substitutes"')!.Bid
    );
    const looseBid = Number(
      autoRows.find((row) => row["Keyword or Product Targeting"] === 'targetingExpression="loose-match"')!.Bid
    );
    const complementsBid = Number(
      autoRows.find((row) => row["Keyword or Product Targeting"] === 'targetingExpression="complements"')!.Bid
    );
    expect(closeBid).toBeGreaterThan(substitutesBid);
    expect(substitutesBid).toBeGreaterThan(looseBid);
    expect(looseBid).toBeGreaterThan(complementsBid);
  });

  it("ships negatives in every campaign, not just Descriptive (§23.7)", () => {
    const negativeCampaigns = new Set(
      rows.filter((row) => row.Entity === "Negative Keyword").map((row) => row["Campaign Name"])
    );
    // Descriptive, Titles & Authors, Auto Discovery, and Product Targeting all created in this fixture.
    expect(negativeCampaigns.size).toBeGreaterThanOrEqual(4);
  });

  it("renders CSV with a header and quotes fields containing commas", () => {
    const csv = buildBulksheetCsv({
      bookTitle: "Scars of the Past",
      keywords: [{ text: "crime, thriller", matchType: "phrase", bid: 0.5 }],
    });
    const [header, ...lines] = csv.split("\n");
    expect(header.startsWith("Product,Entity,Operation")).toBe(true);
    expect(lines.some((line) => line.includes('"crime, thriller"'))).toBe(true);
  });
});
