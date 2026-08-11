/**
 * Tunable blocklists / allowlists for the post-generation keyword filter
 * pipeline (lib/keywordFilters.ts).
 *
 * These deliberately live apart from the filter logic so they can be tuned
 * per marketplace or genre later without touching the pipeline itself.
 * Nothing here is book-specific: everything that depends on *this* book
 * (title, author, genre, setting, comparable authors) is derived at scrape
 * time in lib/keywordAnchors.ts.
 */

/**
 * Amazon page chrome and admin-UI labels that leak into the candidate pool
 * from breadcrumbs, detail bullets and the app's own metadata panel. Never
 * valid keywords, so this list runs first.
 *
 * Matched on word boundaries: "pages" must not kill "page turner".
 */
export const UI_POLLUTION_TERMS = [
  "pages",
  "page count",
  "enabled",
  "not enabled",
  "learn more",
  "read more",
  "sign out",
  "sign in",
  "back to books",
  "data points",
  "re-fetch",
  "refetch",
  "top 100",
  "see top",
  "kindle store",
  "kindle ebooks",
  "amazon reviewer",
  "publication date",
  "print length",
  "file size",
  "word wise",
  "text-to-speech",
  "screen reader",
  "simultaneous device usage",
  "book 1 of",
  "customer reviews",
  "add to basket",
  "add to cart",
  "buy now",
  "look inside",
  "follow the author",
  "report an issue",
];

/**
 * Detail-table labels. Rejected when the keyword *starts* with one, or when
 * the raw (pre-normalisation) text has one immediately followed by a colon —
 * "language: english" and "publisher: bookouture" are scraped rows, whereas
 * "sign language books" and "best rating books" are not, so a bare
 * word-boundary match anywhere would be too blunt for these.
 */
export const METADATA_LABEL_TERMS = [
  "language",
  "publisher",
  "price",
  "rating",
  "ratings",
  "reviews",
  "asin",
  "isbn",
  "isbn-10",
  "isbn-13",
  "marketplace",
  "metadata",
  "admin",
  "captured",
  "dimensions",
  "weight",
  "best sellers rank",
];

/**
 * Entities autocomplete drifts into when a seed term is ambiguous — the
 * "scottish fold cat" / "scars of the past turtle wow" family. Filtered
 * against the book's own anchors before use, so a book that really is about
 * dogs keeps its dog keywords (see lib/keywordFilters.ts#buildOffTopicTerms).
 */
export const OFF_TOPIC_ENTITY_TERMS = [
  // animals
  "cat", "cats", "dog", "dogs", "terrier", "deerhound", "fold", "puppy", "kitten",
  // sport
  "premier league", "premiership", "fixtures", "standings", "leaderboard", "open",
  "golf", "rugby", "football", "cricket", "tournament", "world cup",
  // audio / video content
  "asmr", "accent", "music", "bagpipes", "ambience", "murmurs", "gospel", "playlist",
  "karaoke", "lyrics", "podcast episode",
  // gaming / other media
  "wow", "turtle", "patch notes", "class changes", "last of us", "enterprise earth",
  "soul rift", "divine", "xbox", "playstation", "steam", "mod", "dlc", "walkthrough",
  // dictionary lookups
  "quotes", "meaning", "past tense", "definition", "synonym for", "pronunciation",
  // apparel / tourism / misc
  "rite", "flag", "highlands", "tartan", "kilt", "whisky distillery", "recipe",
  "tickets", "weather", "map of", "population of",
];

/**
 * A keyword from an autocomplete engine has to look like a book search, not
 * just avoid the blocklist above — the long tail of drift is far wider than
 * any list. Applied to the general-web autocomplete sources only; Amazon's
 * own autocomplete is already scoped to a shopping context.
 */
export const BOOK_DOMAIN_WORDS = [
  "book", "books", "novel", "novels", "author", "authors", "series", "kindle",
  "audiobook", "ebook", "read", "reads", "reading", "recommendations", "bestsellers",
  "best sellers", "paperback", "hardcover", "boxset", "box set", "trilogy",
];

/** Generic book-intent words. Never qualify a keyword on their own — see the anchor gate. */
export const BOOK_INTENT_WORDS = [
  "book", "books", "novel", "novels", "series", "author", "authors", "kindle",
  "read", "reads", "reading", "recommendations", "bestsellers", "best sellers",
  "audiobook", "ebook", "boxset", "box set", "trilogy", "saga",
];

/**
 * Connective tissue that gives away a raw review n-gram ("his team was put",
 * "credit to a superb"). Reviews are prose; search queries are not.
 */
export const REVIEW_FILLER_FRAGMENTS = [
  "would say", "and would", "if not", "not better", "as good", "good if",
  "better than", "written by", "my goodness", "what a ride", "made a",
  "and the way", "his team", "her team", "was put", "put together", "is credit",
  "credit to", "to a superb", "this book", "what a", "i would", "i was",
  "couldn't wait", "could not wait", "looking forward", "can't wait",
];

/** A phrase that starts or ends on one of these is a fragment, not a query. */
export const WEAK_CONNECTORS = [
  "and", "by", "to", "of", "the", "a", "an", "was", "is", "were", "are", "would",
  "even", "but", "or", "in", "on", "for", "with", "that", "this", "it", "as",
  "so", "if", "than", "very", "just", "all", "his", "her", "their", "my",
];

/** Stopwords used for the review-fragment stopword-ratio rule. */
export const REVIEW_STOPWORDS = new Set([
  ...WEAK_CONNECTORS,
  "be", "been", "being", "have", "has", "had", "do", "did", "does", "not", "no",
  "at", "from", "into", "about", "out", "up", "down", "over", "again", "then",
  "there", "here", "who", "what", "when", "where", "how", "you", "we", "they",
  "he", "she", "i", "me", "him", "them", "us", "our", "your", "its",
]);

/**
 * Thesaurus output that reads like a dictionary rather than a search box.
 * These are the words a general-purpose synonym API returns for "crime",
 * "scottish" and "thrill" — none of which anyone types when buying a book.
 */
export const BAD_SYNONYM_TERMS = [
  "law-breaking", "lawbreaking", "criminality", "perpetrator", "felon", "felony",
  "infringement", "malfeasance", "wrongdoing", "misdemeanour", "misdemeanor",
  "hot", "sensationalism", "excitement", "thrill", "thrills", "exciting", "titillation",
  "scotch", "scotia", "erse", "brit", "brits", "scotsman", "scotswoman", "scot", "scots",
  "britisher", "british people", "irish people", "irish whiskey", "irish whisky",
  "irish gaelic", "scots english", "gaelic", "english", "britain", "great britain", "hibernia",
  "forensic science", "genre fiction", "criminal", "howcatchem", "constabulary",
  "gumshoe", "shamus", "sleuthhound", "malefactor", "transgression",
];

/**
 * The only permitted synonym expansion. Open-ended thesaurus lookups on
 * individual tokens are what produced "felon books" and "erse books"; genre
 * phrases expand to other *genre phrases* or not at all.
 */
export const ALLOWED_GENRE_SYNONYMS: Record<string, string[]> = {
  "crime fiction": ["detective fiction", "murder mystery", "police procedural", "noir"],
  crime: ["crime fiction", "crime thriller"],
  thriller: ["suspense thriller", "psychological thriller", "page turner"],
  detective: ["sleuth", "whodunit", "police procedural", "detective fiction"],
  mystery: ["murder mystery", "whodunit", "cozy mystery", "detective fiction"],
  "police procedural": ["detective fiction", "crime fiction"],
  romance: ["love story", "romance novel", "contemporary romance"],
  fantasy: ["epic fantasy", "high fantasy", "sword and sorcery"],
  "science fiction": ["space opera", "dystopian fiction", "hard science fiction"],
  horror: ["supernatural horror", "gothic horror", "psychological horror"],
  "historical fiction": ["historical novel", "period drama"],
  memoir: ["autobiography", "true story"],
  "self help": ["personal development", "self improvement"],
  cookbook: ["recipe book", "cooking guide"],
};

/**
 * Words that must never be synonym-expanded: nationality/setting terms (a
 * thesaurus turns "scottish" into "erse" and "scotch") and bare emotional
 * tokens (which turn into "titillation").
 */
export const NEVER_EXPAND_TERMS = [
  "scottish", "scotland", "british", "britain", "english", "england", "irish",
  "ireland", "welsh", "wales", "american", "australian", "canadian", "european",
  "crime", "thrill", "hot", "dark", "gritty", "new", "best", "top",
];

/** Nationality/language adjectives. Dangling on the end of a phrase, they name no product. */
export const DEMONYM_TERMS = [
  "scottish", "british", "irish", "english", "welsh", "american", "australian",
  "canadian", "european", "french", "german", "italian", "spanish", "nordic",
  "scandinavian", "japanese", "indian", "african", "cornish", "yorkshire",
];

/** Languages a UK/US English listing has no business bidding on. */
export const NON_MARKET_LANGUAGES = [
  "malayalam", "tamil", "hindi", "telugu", "kannada", "urdu", "bengali", "marathi",
  "punjabi", "gujarati", "spanish", "french", "german", "italian", "portuguese",
  "dutch", "polish", "russian", "japanese", "chinese", "korean", "arabic", "turkish",
  "swedish", "norwegian", "danish", "finnish", "greek", "hebrew", "thai", "vietnamese",
];

/** The marketplace's own language — "in english" is valid but low value, so it pauses rather than rejects. */
export const MARKET_LANGUAGES: Record<string, string> = {
  US: "english",
  UK: "english",
  CA: "english",
  DE: "german",
  FR: "french",
  IT: "italian",
  ES: "spanish",
};

/** Format words, and the pattern that recognises each in a keyword. Only kept when the ASIN really has that edition. */
export const FORMAT_PATTERNS: Array<{ format: string; pattern: RegExp }> = [
  { format: "hardcover", pattern: /\b(hardcover|hard ?back|hardbound)\b/ },
  { format: "paperback", pattern: /\b(paperback|soft ?back|softcover)\b/ },
  { format: "audiobook", pattern: /\b(audio ?book|audible|narrated)\b/ },
  { format: "large print", pattern: /\blarge print\b/ },
  { format: "kindle", pattern: /\b(kindle|ebook|e-book)\b/ },
];

/** Kindle Unlimited is an enrolment, not an edition, so it gets its own check. */
export const KINDLE_UNLIMITED_PATTERN = /\bkindle unlimited\b/;

/** Seasonal/gift vocabulary. Valid only with a book-intent word *and* a real anchor. */
export const SEASONAL_TERMS = [
  "christmas", "xmas", "halloween", "easter", "valentine", "valentines",
  "thanksgiving", "black friday", "boxing day", "new year", "advent",
  "stocking filler", "stocking stuffer", "summer", "winter", "autumn", "spring",
  "beach", "holiday", "holidays", "vacation", "gift", "gifts", "present", "presents",
];

/** Season activation windows (MM-DD). Outside its window a seasonal keyword is created paused. */
export const SEASON_WINDOWS: Record<string, { start: string; end: string }> = {
  christmas: { start: "11-01", end: "12-25" },
  xmas: { start: "11-01", end: "12-25" },
  advent: { start: "11-01", end: "12-25" },
  "stocking filler": { start: "11-01", end: "12-25" },
  "stocking stuffer": { start: "11-01", end: "12-25" },
  halloween: { start: "10-01", end: "10-31" },
  valentine: { start: "01-15", end: "02-14" },
  valentines: { start: "01-15", end: "02-14" },
  easter: { start: "03-01", end: "04-15" },
  summer: { start: "06-01", end: "08-31" },
  beach: { start: "05-01", end: "08-31" },
  winter: { start: "11-01", end: "02-28" },
  autumn: { start: "09-01", end: "11-30" },
  spring: { start: "03-01", end: "05-31" },
};

/**
 * "gifts for scottish lovers" is nationality-fan intent, not book intent —
 * only the reader-facing variants survive, and only paused.
 */
export const GIFT_AUDIENCE_REJECT_WORDS = ["lovers", "fans", "enthusiasts", "obsessed"];
export const GIFT_AUDIENCE_PAUSE_WORDS = ["readers", "reader", "book lovers", "bookworms"];

/** Single words distinctive enough to be worth keeping, but too broad to activate unreviewed. */
export const SINGLE_WORD_PAUSE_TERMS = ["whodunit", "sleuth", "noir", "romantasy", "cozy"];

/** Endings that mean the phrase names a product ("... crime thriller", "... books"). */
export const VALID_GENRE_ENDINGS = [
  "thriller", "thrillers", "mystery", "mysteries", "noir", "fiction", "procedural",
  "books", "book", "novel", "novels", "series", "reads", "read", "turner",
  "whodunit", "audiobook", "audiobooks", "bestsellers", "saga", "sagas", "stories",
  "romance", "fantasy", "memoir", "cookbook", "guide", "biography", "poems",
];

/**
 * Established phrases that end on a modifier but are how readers really
 * search. Extended per book with the setting anchors the scrape derives.
 */
export const ALLOWLISTED_MODIFIER_PHRASES = [
  "scottish crime", "crime thriller", "psychological thriller", "murder mystery",
  "police procedural", "crime fiction", "noir crime", "edinburgh noir",
  "nordic noir", "domestic thriller", "true crime", "historical crime",
  "british crime", "irish crime", "tartan noir",
];

/**
 * Verb forms that give away a sentence fragment lifted out of the blurb
 * ("killer leaves", "case spirals"). A keyword is a noun phrase.
 */
export const DESCRIPTION_VERB_TOKENS = [
  "leaves", "leave", "spirals", "spiral", "emerges", "emerge", "challenges",
  "challenge", "made", "makes", "make", "put", "puts", "say", "says", "said",
  "goes", "go", "went", "comes", "come", "came", "takes", "take", "took",
  "gets", "get", "got", "finds", "find", "found", "knows", "know", "knew",
  "begins", "begin", "began", "returns", "return", "uncovers", "uncover",
  "hunts", "hunt", "must", "will", "can", "should",
];

/** Sources whose text comes from the book's own metadata, so the anchor gate would be tautological. */
export const SELF_ANCHORED_SOURCES = [
  "manual",
  "user-tag",
  "key-trope",
  "ads-api",
  "book-description",
  "book-content",
];

/** Sources that are general-web autocomplete, subject to the extra book-domain requirement. */
export const WEB_AUTOCOMPLETE_SOURCES = [
  "google-autocomplete",
  "youtube-autocomplete",
  "duckduckgo-autocomplete",
];

/**
 * Machine-readable reason codes (brief §5.10). One codes field alongside the
 * existing human-readable `reason` string, so runs stay auditable.
 */
export const REASON_CODES = [
  "PRODUCT",
  "GIFT_INTENT",
  "BOILERPLATE",
  "OFF_SUBGENRE",
  "TONE_MISMATCH",
  "NATIONALITY_MISMATCH",
  "FRAGMENT",
  "AUDIENCE_MISMATCH",
  "FORMAT_NOT_OFFERED",
  "LANGUAGE_MISMATCH",
  "PLATFORM_META",
  "TITLE_COLLISION",
  "DUPLICATE",
  "OVERBROAD",
  "RANKED_OUT",
  "MEDIA_COLLISION",
  "PLATFORM_NOISE",
  "AUTHOR_DISAMBIGUATION",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

// --- 5.1 Physical-product detector -----------------------------------------

/** Unit/size/pack markers — a product listing, not a book. */
export const PRODUCT_UNIT_PATTERNS: RegExp[] = [
  /\b\d+\s?(g|kg|ml|l|fl ?oz|oz|cm|mm)\b/,
  /\bpack of \d+\b/,
  /\b\d+ ?pack\b/,
  /\buk size \d+(-\d+)?\b/,
  /\bsize [a-z0-9]+\b/,
];

/** Strong signal: this candidate names a physical product, not a book. */
export const PRODUCT_NOUNS = [
  "mug", "mugs", "jar", "keyring", "keychain", "socks", "sweater", "jumper",
  "tea", "tea bags", "coffee", "sachets", "chocolate", "sweets", "biscuits",
  "shortbread", "fudge", "tablet", "soap", "soaps", "candle", "tea towel",
  "hat", "scarf", "flag", "sticker", "poster", "t shirt", "hoodie", "tote",
  "ornament", "souvenir", "gift set",
];

/** Weak signal: material/colour tokens that co-occur with product listings. */
export const PRODUCT_WEAK_SIGNALS = [
  "ceramic", "woven", "knitted", "cotton", "navy", "purple", "cable",
  "shawl neck", "glass dome", "fine soaps",
];

/** A candidate carrying any of these is unambiguously a book, whatever else it says. */
export const BOOK_SIGNAL_WORDS = [
  "book", "books", "novel", "fiction", "paperback", "kindle", "ebook",
  "audiobook", "author", "series", "trilogy", "thriller", "mystery", "crime",
  "whodunit",
];

// --- 5.2 Gift/marketplace intent --------------------------------------------

/** Souvenir/gift-shop queries that fail the book-intent gate outright. */
export const GIFT_INTENT_TERMS = [
  "gifts", "gift", "gifts for foreigners", "gift set", "souvenir", "souvenirs",
];

// --- 5.3 Marketplace boilerplate --------------------------------------------

export const MARKETPLACE_BOILERPLATE_TERMS = [
  "shop the store", "on amazon", "amazon best sellers", "add to basket",
  "add to cart", "free delivery", "prime", "see all results",
  "customer reviews", "best sellers rank",
];

/** Sources this gate applies to (brief §5.2): marketplace/SERP scrapes with no book guarantee. */
export const MARKETPLACE_SERP_SOURCES = ["serpapi-organic", "serpapi-related", "comp-name"];

// --- 5.6 Fragment quality gate extension ------------------------------------

/** Review-language patterns that mean "book-description" text is review-speak, not a query. */
export const REVIEW_SPEAK_ADJECTIVES = ["gripping", "fascinating", "compelling", "stunning"];
export const REVIEW_SPEAK_NOUNS = ["lead character", "instalment", "installment", "debut", "read"];

// --- 5.7 Audience / format / language / platform guards --------------------

export const AUDIENCE_MISMATCH_TERMS = ["for teens", "for kids", "young adult"];
export const PLATFORM_META_TERMS = ["reddit", "tiktok", "booktok", "youtube", "quora"];

// --- 5.8 Title-collision detection ------------------------------------------

/** Collision vocabulary shared with the negative-keyword library (Appendix B): games, media, dictionary lookups. */
export const TITLE_COLLISION_TERMS = [
  "wow", "turtle wow", "patch notes", "class changes", "lyrics", "song", "band",
  "game", "movie", "quotes", "meaning", "past tense", "asmr", "enterprise earth",
  "soul rift", "the divine", "the last of us",
];

/** Numeric/word tails that are ambiguous rather than a clean collision — series book vs unrelated media. */
export const AMBIGUOUS_TITLE_TAILS = ["two", "2", "ii", "part two", "part 2"];

// --- Media-type collision (§5.1) --------------------------------------------

/**
 * Music/TV/video vocabulary that autocomplete drags in alongside a book title
 * that also happens to be a song, album or episode name — "the unforgiven
 * guitar tab" (Metallica), "the unforgiven full movie", not the DS Mia
 * McAllister novel.
 */
export const MEDIA_FORM_TERMS = [
  "solo",
  "guitar",
  "bass",
  "lyrics",
  "tab",
  "karaoke",
  "acoustic",
  "soundtrack",
  "full movie",
  "episode",
  "season",
  "trailer",
];

// --- Platform/marketplace noise (§5.4) --------------------------------------

/**
 * Streaming/social/marketplace platform vocabulary. On its own it's platform
 * navigation, not book-shopping intent; only kept when the keyword also
 * carries a clear book anchor (title/author/series plus book intent).
 */
export const PLATFORM_TERMS = [
  "reddit",
  "tiktok",
  "booktok",
  "youtube",
  "facebook",
  "instagram",
  "twitter",
  "x.com",
  "netflix",
  "britbox",
  "hulu",
  "disney+",
  "prime video",
  "kindle store",
  "amazon co uk",
  "amazon.co.uk",
  "amazon.com",
  "quora",
];

// --- Author-surname disambiguation (§5.2) -----------------------------------

/**
 * Matches phrases of the shape "[first] [last] mcallister book series" —
 * autocomplete's habit of dragging in an unrelated author who shares a
 * surname with a series character/comp. The captured name is checked against
 * the book's actual author and its approved comp-author list.
 */
export const AUTHOR_DISAMBIGUATION_PATTERN =
  /^([a-z]+ [a-z]+) (book series|books in order|series|books)$/;
