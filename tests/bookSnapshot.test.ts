/**
 * The capture's time budget.
 *
 * Written against a production failure: "add a book" returned a 504 with no
 * body. The capture ran phase after phase of per-source timeouts with nothing
 * bounding the total, so a slow Amazon read walked past the route's 60s
 * ceiling and the function was killed before the book could be written. What
 * these cover is that a slow or failing source now costs metadata rather than
 * the whole book.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hang = () => new Promise<never>(() => {});

const emptyProductPage = {
  compTitles: [],
  compDetails: [],
  categories: [],
  categoryPath: [],
  bestSellerRanks: [],
  compAsins: [],
  reviewSnippets: [],
  bulletPoints: [],
  authorOtherBooks: [],
  formatVariants: [],
  previewImages: [],
  frequentlyBoughtTogether: [],
  compareWithSimilar: [],
  seriesBooks: [],
  ratingDistribution: [],
  allCategoryRanks: [],
  tableOfContents: [],
  contentWarnings: [],
  languages: [],
  deliveryOptions: [],
  awards: [],
  awardNominations: [],
};

const scrapeMocks = vi.hoisted(() => ({
  scrapeProductPage: vi.fn(),
  scrapeRelatedCompetitors: vi.fn(),
  scrapeCustomerQnA: vi.fn(),
  scrapeCustomerReviews: vi.fn(),
  scrapeAuthorCatalog: vi.fn(),
}));

vi.mock("../lib/scrape", async () => {
  const actual = await vi.importActual<typeof import("../lib/scrape")>("../lib/scrape");
  return {
    ...actual,
    scrapeProductPage: scrapeMocks.scrapeProductPage,
    scrapeRelatedCompetitors: scrapeMocks.scrapeRelatedCompetitors,
    scrapeCustomerQnA: scrapeMocks.scrapeCustomerQnA,
    scrapeCustomerReviews: scrapeMocks.scrapeCustomerReviews,
    scrapeAuthorCatalog: scrapeMocks.scrapeAuthorCatalog,
  };
});

// External catalogues: irrelevant to timing here, and none of them should be
// reached over the network in a unit test.
vi.mock("../lib/bookMetadata", () => ({
  enrichBookMetadata: vi.fn(async () => ({ categories: [], subjects: [], commonTerms: [] })),
  lookupLocSubjects: vi.fn(async () => []),
  lookupWikidataGenres: vi.fn(async () => []),
  lookupWikipediaCategories: vi.fn(async () => []),
}));
vi.mock("../lib/goodreads", () => ({ getGoodreadsTags: vi.fn(async () => []) }));
vi.mock("../lib/firecrawl", () => ({
  isFirecrawlConfigured: () => false,
  extractAmazonMetadata: vi.fn(async () => ({})),
  scrapeMarkdown: vi.fn(async () => undefined),
}));
vi.mock("../lib/serpApi", () => ({
  isSerpApiConfigured: () => false,
  crawlAmazonViaSerpApi: vi.fn(async () => ({ phrases: [], asins: [], competitors: [], creditsUsed: 0 })),
}));

import { captureBookSnapshot, createCaptureDeadline, describeCapture } from "../lib/bookSnapshot";

describe("createCaptureDeadline", () => {
  it("clamps a per-source cap to what is left of the overall budget", () => {
    let now = 1000;
    const deadline = createCaptureDeadline(5000, () => now);

    expect(deadline.allow(2000)).toBe(2000);

    now += 4000;
    expect(deadline.remaining()).toBe(1000);
    // The source's own cap is 2s, but only 1s of the capture's budget is left.
    expect(deadline.allow(2000)).toBe(1000);

    now += 2000;
    expect(deadline.remaining()).toBe(0);
    expect(deadline.allow(2000)).toBe(0);
    expect(deadline.expired()).toBe(true);
  });
});

describe("captureBookSnapshot time budget", () => {
  beforeEach(() => {
    scrapeMocks.scrapeProductPage.mockReset();
    scrapeMocks.scrapeRelatedCompetitors.mockReset();
    scrapeMocks.scrapeCustomerQnA.mockReset();
    scrapeMocks.scrapeCustomerReviews.mockReset();
    scrapeMocks.scrapeAuthorCatalog.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a snapshot within the budget when every source hangs", async () => {
    scrapeMocks.scrapeProductPage.mockImplementation(hang);
    scrapeMocks.scrapeRelatedCompetitors.mockImplementation(hang);
    scrapeMocks.scrapeCustomerQnA.mockImplementation(hang);
    scrapeMocks.scrapeCustomerReviews.mockImplementation(hang);

    const startedAt = Date.now();
    const snapshot = await captureBookSnapshot("B0TESTHANG", "US", { budgetMs: 400 });
    const elapsed = Date.now() - startedAt;

    // The point of the budget: the caller gets an answer, not a killed
    // function. Generous upper bound so the assertion is about the bound
    // existing, not about machine speed.
    expect(elapsed).toBeLessThan(3000);
    expect(snapshot.asin).toBe("B0TESTHANG");
    expect(snapshot.capture.ok).toBe(false);
    expect(snapshot.capture.timedOut).toBe(true);
    expect(describeCapture(snapshot)).toMatch(/could not be read|too long/i);
  });

  it("does not start a dependent source once the budget is spent", async () => {
    scrapeMocks.scrapeProductPage.mockImplementation(hang);
    scrapeMocks.scrapeRelatedCompetitors.mockResolvedValue({
      categories: [],
      competitors: [],
      productTargetAsins: [],
      reviewSnippets: [],
    });
    scrapeMocks.scrapeCustomerQnA.mockResolvedValue([]);
    scrapeMocks.scrapeCustomerReviews.mockResolvedValue([]);

    await captureBookSnapshot("B0TESTHANG", "US", { budgetMs: 300 });

    // The first phase used the whole budget, so the crawls that depend on it
    // are skipped outright rather than fired and abandoned.
    expect(scrapeMocks.scrapeRelatedCompetitors).not.toHaveBeenCalled();
    expect(scrapeMocks.scrapeCustomerQnA).not.toHaveBeenCalled();
    expect(scrapeMocks.scrapeCustomerReviews).not.toHaveBeenCalled();
  });

  it("captures normally, and reports no timeout, when the sources answer", async () => {
    scrapeMocks.scrapeProductPage.mockResolvedValue({
      ...emptyProductPage,
      title: "The Silent Patient",
      author: "Alex Michaelides",
      description: "A psychological thriller.",
      categoryPath: ["Books", "Mystery, Thriller & Suspense", "Psychological Thrillers"],
    });
    scrapeMocks.scrapeRelatedCompetitors.mockResolvedValue({
      categories: [],
      competitors: [],
      productTargetAsins: [],
      reviewSnippets: [],
    });
    scrapeMocks.scrapeCustomerQnA.mockResolvedValue([]);
    scrapeMocks.scrapeCustomerReviews.mockResolvedValue([]);

    const snapshot = await captureBookSnapshot("B07SBNW6XT", "US", { budgetMs: 5000 });

    expect(snapshot.title).toBe("The Silent Patient");
    expect(snapshot.capture.ok).toBe(true);
    expect(snapshot.capture.timedOut).toBe(false);
  });

  it("keeps the book when a source rejects instead of failing the capture", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    scrapeMocks.scrapeProductPage.mockResolvedValue({ ...emptyProductPage, title: "A Book" });
    scrapeMocks.scrapeRelatedCompetitors.mockRejectedValue(new Error("comp crawl exploded"));
    scrapeMocks.scrapeCustomerQnA.mockResolvedValue([]);
    scrapeMocks.scrapeCustomerReviews.mockResolvedValue([]);

    const snapshot = await captureBookSnapshot("B0TESTFAIL", "US", { budgetMs: 5000 });

    expect(snapshot.title).toBe("A Book");
    expect(snapshot.competitors).toEqual([]);
  });
});
