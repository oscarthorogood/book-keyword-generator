/**
 * Acceptance tests for the keyword filter pipeline.
 *
 * Fixtures are the real failure modes from a generate run for *Scars of the
 * Past* (DCI McNeill Book 1, ASIN B0CLY37W22, amazon.co.uk, Kindle crime
 * thriller): the 302-keyword output that motivated the filters, with the
 * expected verdict and rejecting filter for each.
 *
 * This is the only place a specific book's anchors are allowed to be
 * spelled out. Everywhere else they are derived from the scrape — so the
 * context below is built the same way the generate route builds it, from
 * metadata rather than a hand-written anchor list.
 */

import { describe, expect, it } from "vitest";
import { buildBookAnchors, coreTitle, extractCharacterNames } from "../lib/keywordAnchors";
import {
  buildFilterContext,
  completeDanglingModifier,
  filterKeywords,
  normalizeKeyword,
  runKeywordFilters,
  type FilterContext,
} from "../lib/keywordFilters";

const SCARS_DESCRIPTION = `When a body is found in an Edinburgh tower block, DCI Mac McNeill is called in.
The victim is marked with celtic symbols, and forensic pathologist Dr Clio Wray believes the killer is
sending a message. As a second body emerges, the case spirals into the city's darkest secrets.`;

const SCARS_REVIEWS = [
  "A gripping Scottish crime thriller — better than books written by Ian Rankin, and that is saying something.",
  "Mac made a fascinating lead character and the way his team was put together is credit to a superb writer.",
  "Outstanding Edinburgh noir. My goodness what a ride.",
];

function scarsContext(overrides: Partial<Parameters<typeof buildFilterContext>[0]> = {}): FilterContext {
  return buildFilterContext({
    title: "Scars of the Past: A gripping Scottish crime thriller (DCI McNeill Book 1)",
    author: "Jacqueline New",
    seriesName: "DCI McNeill Crime Thrillers",
    description: SCARS_DESCRIPTION,
    genreTerms: [
      "scottish crime fiction",
      "crime thriller",
      "crime fiction",
      "police procedural",
      "murder mystery",
      "scottish",
    ],
    genreFamilies: ["mystery-thriller"],
    categoryPath: ["Kindle Store", "Kindle eBooks", "Crime, Thriller & Mystery", "Scottish Crime Fiction"],
    categories: ["Crime, Thriller & Mystery", "Police Procedurals", "Scottish Crime Fiction"],
    goodreadsTags: ["crime", "mystery", "police procedural", "scotland"],
    competitors: [
      { title: "Knots and Crosses", author: "Ian Rankin" },
      { title: "The Blood Strand", author: "Chris Ould" },
      { title: "A Dark So Deadly", author: "Stuart MacBride" },
      { title: "Dead Man's Grave", author: "Neil Lancaster" },
    ],
    compTitles: ["Knots and Crosses", "Rebus: The Early Years", "A Dark So Deadly"],
    reviewSnippets: SCARS_REVIEWS,
    marketplace: "UK",
    language: "English",
    // Kindle-only listing, not in Kindle Unlimited — the state that makes
    // "jacqueline new hardcover" and "kindle unlimited books" invalid.
    formats: ["kindle"],
    isKindleUnlimited: false,
    // Fixed so season windows don't make the suite date-dependent.
    now: new Date("2026-03-15T12:00:00Z"),
    ...overrides,
  });
}

/** Runs one keyword against the fixture book. */
function verdict(text: string, sources: string[] = [], context = scarsContext()) {
  return runKeywordFilters({ text, sources }, context);
}

describe("anchor derivation", () => {
  const anchors = buildBookAnchors({
    title: "Scars of the Past: A gripping Scottish crime thriller (DCI McNeill Book 1)",
    author: "Jacqueline New",
    seriesName: "DCI McNeill Crime Thrillers",
    description: SCARS_DESCRIPTION,
    genreTerms: ["scottish crime fiction", "crime thriller", "crime fiction", "police procedural"],
    genreFamilies: ["mystery-thriller"],
    categoryPath: ["Kindle Store", "Crime, Thriller & Mystery", "Scottish Crime Fiction"],
    competitors: [{ title: "Knots and Crosses", author: "Ian Rankin" }],
    compTitles: ["Knots and Crosses"],
    reviewSnippets: SCARS_REVIEWS,
  });

  it("strips subtitle and series furniture from the title", () => {
    expect(coreTitle("Scars of the Past: A gripping Scottish crime thriller (DCI McNeill Book 1)")).toBe(
      "scars of the past"
    );
  });

  it("finds character names, with and without their rank", () => {
    const names = extractCharacterNames(SCARS_DESCRIPTION);
    expect(names).toContain("dci mac mcneill");
    expect(names).toContain("mcneill");
    expect(names).toContain("clio wray");
  });

  it("anchors the book's own identity", () => {
    expect(anchors.bookSpecific).toContain("scars of the past");
    expect(anchors.bookSpecific).toContain("jacqueline new");
    expect(anchors.bookSpecific).toContain("mcneill");
  });

  it("anchors genre vocabulary, including allowed synonyms of it", () => {
    expect(anchors.genre).toContain("crime thriller");
    expect(anchors.genre).toContain("crime");
    expect(anchors.genre).toContain("detective fiction");
    expect(anchors.genre).toContain("page turner");
  });

  it("anchors the setting, and the setting+genre combination readers search", () => {
    expect(anchors.setting).toContain("scottish");
    expect(anchors.setting).toContain("edinburgh");
    expect(anchors.setting).toContain("scottish crime");
  });

  it("anchors comparable authors from the crawl", () => {
    expect(anchors.comps).toContain("ian rankin");
  });

  it("never treats a generic book-intent word as a qualifying anchor", () => {
    for (const word of ["book", "books", "kindle", "read"]) {
      expect(anchors.genre).not.toContain(word);
      expect(anchors.bookSpecific).not.toContain(word);
    }
  });

  it("derives a genre phrase to complete dangling modifiers with", () => {
    expect(anchors.primaryGenrePhrase.split(" ").length).toBeGreaterThan(1);
    expect(anchors.primaryGenrePhrase).toContain("crime");
  });
});

describe("normalisation", () => {
  it("lowercases, collapses whitespace and drops punctuation noise", () => {
    expect(normalizeKeyword("  Publication date:  27 Oct. 2023 ")).toBe("publication date 27 oct 2023");
    expect(normalizeKeyword("LAW-BREAKING books")).toBe("law-breaking books");
  });
});

describe("filter 1 — UI/metadata pollution", () => {
  const rejected = [
    "264 pages",
    "publication date: 27 oct. 2023",
    "see top 100 in kindle store",
    "learn more",
    "enabled",
    "language: english",
    "amazon reviewer",
    "ian rankin amazon reviewer",
    "superb plot amazon reviewer",
    "outstanding amazon reviewer",
    "best learn more books",
    "new learn more books 2026",
    "book 1 of 6: dci mcneill crime thriller",
  ];

  for (const keyword of rejected) {
    it(`rejects "${keyword}"`, () => {
      const result = verdict(keyword);
      expect(result.verdict).toBe("reject");
      expect(result.filter).toBe("uiPollution");
    });
  }

  it('does not let "pages" kill "page turner"', () => {
    expect(verdict("page turner").verdict).toBe("pass");
  });
});

describe("filter 2 — off-topic entities (autocomplete drift)", () => {
  const rejected = [
    "scottish fold cat",
    "scottish fold",
    "scottish terrier",
    "scottish deerhound",
    "scottish premier league",
    "scottish premier league fixtures",
    "scottish premier league standings",
    "scottish premiership",
    "scottish open",
    "scottish open leaderboard",
    "scottish open 2026",
    "scottish accent",
    "scottish music",
    "scottish bagpipes",
    "scottish asmr",
    "scottish ambience",
    "scottish murmurs",
    "scottish rite",
    "scottish flag",
    "scottish highlands",
    "scars of the past turtle wow",
    "scars of the past turtle",
    "scars of the past wow",
    "scars of the past patch notes",
    "scars of the past class changes",
    "scars of the past enterprise earth",
    "scars of the past soul rift",
    "scars the last of us",
    "scars the divine",
    "scars gospel",
    "scar the past tense",
    "scars from the past quotes",
    "scars from the past meaning",
  ];

  for (const keyword of rejected) {
    it(`rejects "${keyword}"`, () => {
      expect(verdict(keyword, ["google-autocomplete"]).verdict).toBe("reject");
    });
  }

  const kept = [
    "crime thriller book recommendations",
    "crime thriller books best sellers",
    "scars of the past novel",
    "crime thriller books 2026",
  ];

  for (const keyword of kept) {
    it(`keeps "${keyword}"`, () => {
      expect(verdict(keyword, ["google-autocomplete"]).verdict).toBe("pass");
    });
  }

  it("rejects an autocomplete suggestion with no book-domain word at all", () => {
    const result = verdict("scotland travel", ["duckduckgo-autocomplete"]);
    expect(result.verdict).toBe("reject");
    expect(result.filter).toBe("offTopicEntity");
  });
});

describe("filter 3 — review n-gram quality", () => {
  const rejected = [
    "all 5 dci",
    "5 dci mcneill",
    "mcneill books and would",
    "good if not better",
    "better than books written",
    "written by ian rankin",
    "written by ian",
    "goodness what a ride",
    "what a ride",
    "ride this book outstanding",
    "mac made a fascinating",
    "made a fascinating lead",
    "made a fascinating",
    "character and the way",
    "way his team",
    "his team was put",
    "team was put together",
    "team was put",
    "put together is credit",
    "together is credit",
    "credit to a superb",
    "what a fantastic",
  ];

  for (const keyword of rejected) {
    it(`rejects "${keyword}"`, () => {
      const result = verdict(keyword, ["review-language"]);
      expect(result.verdict).toBe("reject");
      expect(result.filter).toBe("reviewFragment");
    });
  }

  it("keeps review phrasing that names the genre or setting", () => {
    expect(verdict("outstanding edinburgh noir", ["review-language"]).verdict).toBe("pass");
    expect(verdict("great psychological thriller", ["review-language"]).verdict).toBe("pass");
  });

  it("pauses clean reader phrasing with no anchor", () => {
    const result = verdict("fascinating lead character", ["review-language"]);
    expect(result.verdict).toBe("pause");
  });
});

describe("filter 4 — synonym expansion quality", () => {
  const rejected = [
    "scot books",
    "scotch books",
    "scotia books",
    "scotsman books",
    "erse books",
    "brit books",
    "britain books",
    "english books",
    "british people books",
    "irish people books",
    "irish whiskey books",
    "irish whisky books",
    "irish gaelic books",
    "law-breaking books",
    "criminality books",
    "perpetrator books",
    "felon books",
    "criminal books",
    "infringement books",
    "hot books",
    "sensationalism books",
    "thrill books",
    "exciting books",
    "excitement books",
    "genre fiction books",
    "forensic science books",
    "howcatchem books",
  ];

  for (const keyword of rejected) {
    it(`rejects "${keyword}"`, () => {
      expect(verdict(keyword, ["synonym"]).verdict).toBe("reject");
    });
  }

  it("keeps synonyms that come from the controlled genre map", () => {
    expect(verdict("detective fiction", ["synonym"]).verdict).toBe("pass");
    expect(verdict("detective fiction books", ["synonym"]).verdict).toBe("pass");
    expect(verdict("police procedural books", ["synonym"]).verdict).toBe("pass");
    expect(verdict("page turner", ["synonym"]).verdict).toBe("pass");
  });

  it("pauses a bare genre term plus book intent", () => {
    expect(verdict("suspense books", ["synonym"]).verdict).toBe("pause");
  });
});

describe("filter 5 — language & marketplace", () => {
  const rejected = [
    "crime thriller books malayalam",
    "crime thriller novel malayalam",
    "crime thriller books tamil",
    "crime thriller novels tamil",
    "crime thriller books in hindi",
  ];

  for (const keyword of rejected) {
    it(`rejects "${keyword}"`, () => {
      const result = verdict(keyword);
      expect(result.verdict).toBe("reject");
      expect(result.filter).toBe("languageMarket");
    });
  }

  it("pauses the marketplace's own language", () => {
    const result = verdict("crime thriller books in english");
    expect(result.verdict).toBe("pause");
    expect(result.filter).toBe("languageMarket");
  });

  it("allows a foreign language when the listing is in it", () => {
    const german = scarsContext({ marketplace: "DE", language: "German" });
    expect(runKeywordFilters({ text: "krimi thriller books german" }, german).verdict).not.toBe("reject");
  });
});

describe("filter 6 — format availability", () => {
  const rejected = [
    "jacqueline new hard back",
    "jacqueline new hardcover",
    "jacqueline new paperback",
    "scottish audiobook",
    "large print books",
    "kindle unlimited books",
  ];

  for (const keyword of rejected) {
    it(`rejects "${keyword}" for a Kindle-only listing`, () => {
      const result = verdict(keyword);
      expect(result.verdict).toBe("reject");
      expect(result.filter).toBe("formatAvailability");
    });
  }

  it("keeps a format keyword once the scrape confirms that edition", () => {
    const withHardcover = scarsContext({ formats: ["kindle", "hardcover"] });
    expect(runKeywordFilters({ text: "jacqueline new hardcover" }, withHardcover).verdict).toBe("pass");
  });

  it("keeps Kindle Unlimited keywords when the book is enrolled", () => {
    const inKu = scarsContext({ isKindleUnlimited: true });
    expect(runKeywordFilters({ text: "kindle unlimited crime thriller" }, inKu).verdict).toBe("pass");
  });
});

describe("filter 7 — seasonal & gift", () => {
  it("rejects seasonal terms with no book intent", () => {
    for (const keyword of ["christmas", "halloween", "christmas scottish", "halloween scottish"]) {
      const result = verdict(keyword);
      expect(result.verdict).toBe("reject");
    }
  });

  it("pauses valid seasonal phrases with no anchor", () => {
    for (const keyword of ["beach reads", "summer reads", "holiday reads", "cozy winter reads"]) {
      expect(verdict(keyword).verdict).toBe("pause");
    }
  });

  it("keeps a seasonal keyword that carries both intent and an anchor, in season", () => {
    const inSeason = scarsContext({ now: new Date("2026-12-01T12:00:00Z") });
    expect(runKeywordFilters({ text: "crime thriller christmas gift" }, inSeason).verdict).toBe("pass");
  });

  it("pauses the same keyword out of season", () => {
    const result = verdict("crime thriller christmas gift");
    expect(result.verdict).toBe("pause");
    expect(result.filter).toBe("seasonalGift");
  });

  it("rejects nationality-fan gift intent but pauses the reader variant", () => {
    expect(verdict("gifts for scottish lovers").verdict).toBe("reject");
    expect(verdict("gifts for scottish fans").verdict).toBe("reject");
    expect(verdict("gifts for scottish readers").verdict).toBe("pause");
  });
});

describe("filter 8 — single word", () => {
  const rejected = [
    "scottish", "british", "irish", "english", "gripping", "mac", "made", "heart",
    "trail", "detective", "criminal", "hot", "thrill", "suspense", "christmas",
    "halloween", "scot", "scotch", "scotia", "scotsman", "brit", "britain", "erse",
    "law-breaking", "criminality", "perpetrator", "felon", "infringement", "exciting",
    "sensationalism", "enabled",
  ];

  for (const keyword of rejected) {
    it(`rejects "${keyword}"`, () => {
      expect(verdict(keyword).verdict).toBe("reject");
    });
  }

  it("pauses distinctive single place/genre terms", () => {
    for (const keyword of ["edinburgh", "scotland", "whodunit", "sleuth"]) {
      const result = verdict(keyword);
      expect(result.verdict).toBe("pause");
      expect(result.filter).toBe("singleWord");
    }
  });

  it("keeps an author or series token", () => {
    expect(verdict("mcneill").verdict).toBe("pass");
  });
});

describe("filter 9 — phrase shape (dangling modifiers)", () => {
  const dangling = [
    "fast paced scottish",
    "slow burn scottish",
    "feel good scottish",
    "cozy scottish",
    "dark scottish",
    "heartwarming scottish",
    "uplifting scottish",
    "emotional scottish",
    "gripping scottish",
    "atmospheric scottish",
    "tearjerker scottish",
    "gritty scottish",
    "award winning scottish",
    "must read scottish",
    "bestselling scottish",
  ];

  for (const keyword of dangling) {
    it(`rewrites "${keyword}" instead of dropping it`, () => {
      const result = verdict(keyword);
      expect(result.verdict).toBe("pass");
      expect(result.rewritten).toBe(true);
      expect(result.text).toBe(`${keyword} crime thriller`);
    });
  }

  it("leaves established phrases alone", () => {
    expect(verdict("scottish crime").verdict).toBe("pass");
    expect(verdict("scottish crime").rewritten).toBe(false);
  });

  it("completes a modifier without repeating a word it already has", () => {
    expect(completeDanglingModifier("dark scottish crime", "crime thriller")).toBe("dark scottish crime thriller");
  });
});

describe("filter 10 — description shaping", () => {
  it("rejects two-word verb fragments", () => {
    for (const keyword of ["killer leaves", "case spirals", "mac made", "put together"]) {
      const result = verdict(keyword, ["book-description"]);
      expect(result.verdict).toBe("reject");
      expect(result.filter).toBe("descriptionShape");
    }
  });

  it("pauses longer sentence fragments", () => {
    expect(verdict("case challenges even", ["book-description"]).verdict).toBe("pause");
    expect(verdict("second body emerges", ["book-description"]).verdict).toBe("pause");
  });

  it("drops bare two-word noun fragments with no profile/genre anchor (brief §5.6, §6 must_drop)", () => {
    // "celtic symbols" reads as jewellery, not a book search; these are the
    // brief's own must_drop examples for the FRAGMENT reason code.
    for (const keyword of ["celtic symbols", "tower block", "ancient symbology"]) {
      const result = verdict(keyword, ["book-description"]);
      expect(result.verdict).toBe("reject");
      expect(result.filter).toBe("descriptionShape");
    }
  });

  it("keeps thematic noun phrases that do carry a profile anchor, capped at phrase match", () => {
    // "darkest secrets" alone has no anchor and is dropped above by the
    // brief's short-fragment rule; paired with a genre/series token it still
    // reads as a real query, so composing rather than shipping raw n-grams
    // (the brief's own recommendation) keeps it.
    const result = verdict("darkest secrets edinburgh crime thriller", ["book-description"]);
    expect(result.verdict).toBe("pass");
    expect(result.matchTypeCeiling).toBe("phrase");
  });

  it("keeps character names", () => {
    expect(verdict("dr clio wray", ["book-description"]).verdict).toBe("pass");
  });
});

describe("filter 11 — anchor relevance (final gate)", () => {
  const kept = [
    "scottish crime",
    "dci mcneill crime thriller",
    "crime thriller books",
    "psychological thriller books",
    "jacqueline new books",
    "books like ian rankin",
    "detective fiction books",
    "page turner",
  ];

  for (const keyword of kept) {
    it(`passes "${keyword}"`, () => {
      expect(verdict(keyword).verdict).toBe("pass");
    });
  }

  it("rejects generic book intent with nothing specific to the book", () => {
    const result = verdict("best selling books 2026");
    expect(result.verdict).toBe("reject");
    expect(result.filter).toBe("anchorRelevance");
  });
});

describe("batch behaviour", () => {
  it("summarises verdicts and per-filter counts", () => {
    const { results, summary } = filterKeywords(
      [
        { text: "264 pages" },
        { text: "scottish fold cat", sources: ["google-autocomplete"] },
        { text: "felon books", sources: ["synonym"] },
        { text: "crime thriller books" },
        { text: "edinburgh" },
      ],
      scarsContext()
    );

    expect(results).toHaveLength(5);
    expect(summary.byVerdict.reject).toBe(3);
    expect(summary.byVerdict.pause).toBe(1);
    expect(summary.byVerdict.pass).toBe(1);
    expect(summary.byFilter.uiPollution).toBe(1);
    expect(summary.byFilter.offTopicEntity).toBe(1);
  });

  it("keeps the best verdict when two candidates rewrite to the same phrase", () => {
    const { results } = filterKeywords(
      [{ text: "gripping scottish" }, { text: "gripping scottish crime thriller" }],
      scarsContext()
    );
    expect(results).toHaveLength(1);
    expect(results[0].verdict).toBe("pass");
  });

  it("rejects a rate of keywords in the range the spec expects", () => {
    // A representative slice of the 302-keyword run: roughly a third should
    // be rejected outright, with a handful paused for review.
    const fixture = [
      ...["264 pages", "enabled", "learn more", "language: english", "amazon reviewer"].map((text) => ({ text })),
      ...["scottish fold cat", "scottish open leaderboard", "scars of the past turtle wow"].map((text) => ({
        text,
        sources: ["google-autocomplete"],
      })),
      ...["his team was put", "credit to a superb", "what a ride"].map((text) => ({
        text,
        sources: ["review-language"],
      })),
      ...["felon books", "erse books", "hot books"].map((text) => ({ text, sources: ["synonym"] })),
      ...["scottish", "british", "irish", "detective"].map((text) => ({ text })),
      ...["edinburgh", "scotland", "beach reads"].map((text) => ({ text })),
      ...[
        "scottish crime",
        "crime thriller books",
        "dci mcneill crime thriller",
        "jacqueline new books",
        "books like ian rankin",
        "psychological thriller books",
      ].map((text) => ({ text })),
    ];

    const { summary } = filterKeywords(fixture, scarsContext());
    expect(summary.byVerdict.reject).toBe(18);
    expect(summary.byVerdict.pause).toBe(3);
    expect(summary.byVerdict.pass).toBe(6);
  });
});
