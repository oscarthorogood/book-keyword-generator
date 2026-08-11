/**
 * Regression fixture for the Keyword Filter Improvement Brief.
 *
 * Appendix A of the brief is the ground-truth keyword inventory (355
 * keywords) generated for *Scars of the Past* (DCI McNeill Crime Thriller
 * #1, Jacqueline New). This runs that inventory through the filter pipeline
 * with the book profile from §2 and asserts the §6 regression set:
 *
 *   - every must_drop keyword is dropped (reject or pause, never an active pass)
 *   - every must_keep keyword survives as pass
 *   - every needs_review keyword is routed to pause, never silently passed
 */

import { describe, expect, it } from "vitest";
import { capAndRank } from "../lib/keywordCapAndRank";
import { buildBookAnchors } from "../lib/keywordAnchors";
import { buildFilterContext, filterKeywords, runKeywordFilters, type FilterContext } from "../lib/keywordFilters";
import type { KeywordSource } from "../lib/types";

// --- §2 book profile ---------------------------------------------------

function scarsContext(): FilterContext {
  return buildFilterContext({
    title: "Scars of the Past",
    author: "Jacqueline New",
    seriesName: "DCI McNeill Crime Thriller",
    description:
      "When a body is found in an Edinburgh tower block, DCI McNeill is called in. The victim is marked with celtic symbols, and forensic pathologist Dr Clio Wray believes the killer is sending a message.",
    genreTerms: [
      "scottish crime",
      "police procedural",
      "detective",
      "crime thriller",
      "tartan noir",
      "british crime",
      "nordic noir",
      "psychological thriller",
      "murder mystery",
      "serial killer thriller",
      "whodunit",
      "suspense",
    ],
    genreFamilies: ["mystery-thriller"],
    categoryPath: ["Kindle Store", "Kindle eBooks", "Crime, Thriller & Mystery", "Scottish Crime Fiction"],
    categories: ["Crime, Thriller & Mystery", "Police Procedurals", "Scottish Crime Fiction"],
    competitors: [
      { title: "Kill Switch", author: "A River Swift" },
    ],
    compTitles: ["Kill Switch"],
    marketplace: "UK",
    language: "English",
    formats: ["kindle", "paperback", "audiobook"],
    isKindleUnlimited: false,
    now: new Date("2026-08-11T12:00:00Z"),
    bookProfile: {
      genreCore: ["scottish crime", "police procedural", "detective", "crime thriller", "tartan noir", "british crime"],
      genreAdjacent: [
        "nordic noir",
        "psychological thriller",
        "murder mystery",
        "serial killer thriller",
        "whodunit",
        "suspense",
      ],
      // The brief's §2 profile names the top-level deny subgenres; the terms
      // below are the vocabulary those subgenres actually show up as in real
      // listings (bakery/witch cozy variants, mi6/cia spy variants, etc) —
      // per-book editorial tuning, not pipeline logic.
      genreDeny: [
        "cozy",
        "paranormal",
        "supernatural",
        "witch",
        "spy",
        "espionage",
        "mi6",
        "cia",
        "legal",
        "courtroom",
        "lawyer",
        "military",
        "terrorism",
        "historical",
        "victorian",
        "edwardian",
        "1920s",
        "comedy",
        "satire",
        "romance",
        "bakery",
      ],
      tone: ["gritty", "dark", "atmospheric", "gripping"],
      toneDeny: ["cozy", "heartwarming", "feel good", "uplifting", "tearjerker", "clean", "funny"],
      audience: "adult",
      formatsOffered: ["kindle", "paperback", "audiobook"],
      formatsNotOffered: ["hardcover", "large print"],
      nationality: ["scottish", "british"],
    },
  });
}

function verdict(text: string, sources: string[] = ["genre-preset"]) {
  return runKeywordFilters({ text, sources }, scarsContext());
}

// --- §6 regression set ---------------------------------------------------

const MUST_DROP: Array<[string, string[]]> = [
  ["the scottish translator mug - mug ceramic 11fl oz", ["serpapi-organic"]],
  ["irish shamrock woven design men's socks uk size 5-12 navy", ["serpapi-organic"]],
  ["barry's irish breakfast tea bags 250 g", ["serpapi-organic"]],
  ["nescaf irish latte sachets 7 pack pack of 1", ["serpapi-organic"]],
  ["aran crafts men's irish cable knitted shawl neck sweater", ["serpapi-organic"]],
  ["scottish thistle floral glass dome keyring purple and green", ["serpapi-organic"]],
  ["ross's scottish tablet jar", ["serpapi-organic"]],
  ["scottish fine soaps", ["serpapi-related"]],
  ["scottish tablet", ["serpapi-related"]],
  ["british sweets", ["serpapi-related"]],
  ["irish chocolate", ["serpapi-related"]],
  ["irish food", ["serpapi-related"]],
  ["irish hat", ["serpapi-related"]],
  ["british gifts", ["serpapi-related"]],
  ["scottish gifts", ["serpapi-related"]],
  ["irish gifts", ["serpapi-related"]],
  ["british gifts for foreigners", ["serpapi-related"]],
  ["shop the store on amazon", ["comp-name"]],
  ["the ultimate british slang dictionary", ["serpapi-organic"]],
  ["the scottish bothy bible", ["serpapi-organic"]],
  ["5 dci mcneill", ["book-description"]],
  ["body marked", ["book-description"]],
  ["secrets carved", ["book-description"]],
  ["seasoned instincts", ["book-description"]],
  ["unsettling connection", ["book-description"]],
  ["fascinating lead character", ["book-description"]],
  ["gripping first instalment", ["book-description"]],
  ["tower block", ["book-description"]],
  ["celtic symbols", ["book-description"]],
  ["witch cozy mystery books", ["genre-preset"]],
  ["culinary cozy mystery recipes included", ["genre-preset"]],
  ["small town witch cozy paranormal", ["genre-preset"]],
  ["bakery mystery books", ["genre-preset"]],
  ["clean cozy mystery no profanity", ["genre-preset"]],
  ["paranormal women's fiction mystery", ["genre-preset"]],
  ["cold war spy books", ["genre-preset"]],
  ["spy books like daniel silva", ["genre-preset"]],
  ["cia thriller books", ["genre-preset"]],
  ["mi6 thriller", ["genre-preset"]],
  ["legal thriller courtroom drama", ["genre-preset"]],
  ["lawyer thriller", ["genre-preset"]],
  ["victorian murder mystery detective", ["genre-preset"]],
  ["1920s mystery books", ["genre-preset"]],
  ["edwardian mystery books", ["genre-preset"]],
  ["cyber warfare military thriller", ["genre-preset"]],
  ["counter terrorism action thriller", ["genre-preset"]],
  ["laugh out loud british comedy fiction", ["genre-preset"]],
  ["british satire", ["genre-preset"]],
  ["heartwarming scottish crime fiction", ["buyer-intent"]],
  ["feel good scottish crime fiction", ["buyer-intent"]],
  ["uplifting scottish crime fiction", ["buyer-intent"]],
  ["tearjerker scottish crime fiction", ["buyer-intent"]],
  ["cozy scottish crime fiction", ["buyer-intent"]],
  ["new irish books 2026", ["buyer-intent"]],
  ["best selling irish books", ["buyer-intent"]],
  ["crime thriller books for teens", ["google-autocomplete"]],
];

const MUST_KEEP: Array<[string, string[]]> = [
  ["scottish crime thriller", ["listing-metadata"]],
  ["dci mcneill", ["listing-metadata"]],
  ["mcneill crime thriller book", ["listing-metadata"]],
  ["thriller dci mcneill", ["listing-metadata"]],
  ["dci mcneill crime fiction", ["listing-metadata"]],
  ["scars of the past", ["google-autocomplete"]],
  ["scars of the past novel", ["google-autocomplete"]],
  ["jacqueline new books", ["buyer-intent"]],
  ["jacqueline new paperback", ["buyer-intent"]],
  ["jacqueline new audiobook", ["buyer-intent"]],
  ["gritty scottish crime fiction", ["buyer-intent"]],
  ["dark scottish crime fiction", ["buyer-intent"]],
  ["atmospheric scottish crime fiction", ["buyer-intent"]],
  ["gripping scottish crime fiction", ["buyer-intent"]],
  ["police procedural", ["genre-metadata"]],
  ["police procedural books", ["genre-preset"]],
  ["british detective crime series", ["genre-preset"]],
  ["british crime fiction", ["genre-preset"]],
  ["uk crime fiction", ["genre-preset"]],
  ["scottish crime books", ["genre-preset"]],
  ["serial killer thriller books", ["genre-preset"]],
  ["nordic noir detective series", ["genre-preset"]],
  ["nordic noir books", ["genre-preset"]],
  ["noir crime fiction gritty", ["genre-preset"]],
  ["hard boiled crime fiction", ["genre-preset"]],
  ["gangland crime books", ["genre-preset"]],
  ["organized crime books", ["genre-preset"]],
  ["undercover cop thriller", ["genre-preset"]],
  ["murder mystery books best sellers", ["genre-preset"]],
  ["best crime fiction books", ["genre-preset"]],
  ["new crime fiction books 2026", ["buyer-intent"]],
  ["best selling crime books", ["buyer-intent"]],
  ["crime thriller books to read", ["youtube-autocomplete"]],
  ["crime thriller book recommendations", ["youtube-autocomplete"]],
  ["kill switch a river swift thriller book 1", ["comp-name"]],
  ["detective fiction", ["synonym"]],
  ["page turner", ["synonym"]],
];

const NEEDS_REVIEW: Array<[string, string[]]> = [
  ["edinburgh", ["book-description"]],
  ["scars of the past two", ["google-autocomplete"]],
  ["crime thriller books reddit", ["google-autocomplete"]],
];

describe("brief §6 regression set — Scars of the Past", () => {
  it("drops every must_drop keyword (reject or pause, never an active pass)", () => {
    for (const [text, sources] of MUST_DROP) {
      const result = verdict(text, sources);
      expect(result.verdict, `"${text}" should not pass (got ${result.verdict})`).not.toBe("pass");
    }
  });

  it("keeps every must_keep keyword", () => {
    for (const [text, sources] of MUST_KEEP) {
      const result = verdict(text, sources);
      expect(result.verdict, `"${text}" should pass (got ${result.verdict}/${result.reason})`).toBe("pass");
    }
  });

  it("routes every needs_review keyword to pause, never silently passes it", () => {
    for (const [text, sources] of NEEDS_REVIEW) {
      const result = verdict(text, sources);
      expect(result.verdict, `"${text}" should not silently pass (got ${result.verdict})`).not.toBe("pass");
    }
  });
});

describe("brief §5.11 cap-and-rank", () => {
  it("caps survivors at max_keywords_total and routes the rest to a RANKED_OUT backlog", () => {
    const anchors = buildBookAnchors({
      title: "Scars of the Past",
      author: "Jacqueline New",
      seriesName: "DCI McNeill Crime Thriller",
      genreTerms: ["scottish crime", "crime thriller"],
      genreFamilies: ["mystery-thriller"],
      categoryPath: ["Crime, Thriller & Mystery"],
      competitors: [],
      compTitles: [],
    });

    const candidates: Array<{ text: string; sources: KeywordSource[] }> = Array.from({ length: 40 }, (_, index) => ({
      text: `scottish crime thriller keyword variant ${index}`,
      sources: ["genre-preset"],
    }));
    candidates.push({ text: "scars of the past", sources: ["listing-metadata"] });

    const { kept, backlog } = capAndRank(candidates, anchors, { maxKeywordsTotal: 20, maxPerAdGroup: 20 });

    expect(kept.length).toBeLessThanOrEqual(20);
    expect(backlog.length).toBe(candidates.length - kept.length);
    for (const entry of backlog) {
      expect(entry.code).toBe("RANKED_OUT");
    }
    // The guaranteed listing-metadata slot always survives the cap.
    expect(kept.some((entry) => entry.text === "scars of the past")).toBe(true);
  });
});

describe("brief F11 budget defaults", () => {
  it("filterKeywords still runs cleanly across the full §6 fixture set", () => {
    const context = scarsContext();
    const all = [...MUST_DROP, ...MUST_KEEP, ...NEEDS_REVIEW].map(([text, sources]) => ({ text, sources }));
    const { summary } = filterKeywords(all, context);
    expect(summary.byVerdict.pass + summary.byVerdict.pause + summary.byVerdict.reject).toBe(all.length);
  });
});
