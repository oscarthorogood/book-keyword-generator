/**
 * Static catalogue of every data source the generation pipelines can draw
 * on — keyword generation (app/api/books/[id]/keywords/generate/route.ts),
 * competitor-ASIN generation (app/api/books/[id]/competitors/generate/
 * route.ts), or both. Backs the Sources page (app/sources/page.tsx): each
 * entry's live "configured" flag and usage counts are computed by
 * app/api/sources/route.ts, but the id/label/description/env-var mapping
 * lives here so the page and the route agree on what a "source" is.
 *
 * `id` matches the string actually written to keywords.source /
 * competitor_asins.source — see lib/types.ts's KeywordSource union and the
 * liveGroups keys in the two generate routes.
 */

export type SourceKind = "keywords" | "competitors";

export interface SourceDefinition {
  id: string;
  label: string;
  description: string;
  usedFor: SourceKind[];
  /** Env var gating this source. Unset means the source needs no API key (a free/unofficial endpoint, or user-supplied data). */
  configEnvVar?: string;
}

export const SOURCE_REGISTRY: SourceDefinition[] = [
  { id: "ads-api", label: "Amazon Ads API", description: "Official keyword recommendations for the ASIN.", usedFor: ["keywords", "competitors"], configEnvVar: "AMAZON_ADS_CLIENT_ID" },
  { id: "autocomplete", label: "Amazon autocomplete", description: "Unofficial Amazon search-box suggestions.", usedFor: ["keywords"] },
  { id: "amazon-autocomplete", label: "Amazon autocomplete", description: "Unofficial Amazon search-box suggestions (ASIN discovery).", usedFor: ["competitors"] },
  { id: "google-autocomplete", label: "Google autocomplete", description: "Google's unofficial search-suggest endpoint.", usedFor: ["keywords", "competitors"] },
  { id: "youtube-autocomplete", label: "YouTube autocomplete", description: "YouTube search-box suggestions (BookTok/BookTube register).", usedFor: ["keywords", "competitors"] },
  { id: "duckduckgo-autocomplete", label: "DuckDuckGo autocomplete", description: "DuckDuckGo's unofficial autocomplete endpoint.", usedFor: ["keywords", "competitors"] },
  { id: "serpapi-related", label: "SerpApi (related searches)", description: "Amazon's own \"related searches\" via SerpApi.", usedFor: ["keywords"], configEnvVar: "SERPAPI_API_KEY" },
  { id: "serpapi-organic", label: "SerpApi (organic)", description: "Competitor titles/authors ranking for a seed term.", usedFor: ["keywords"], configEnvVar: "SERPAPI_API_KEY" },
  { id: "serpapi-autocomplete", label: "SerpApi (autocomplete)", description: "Amazon search-bar suggestions via SerpApi.", usedFor: ["keywords"], configEnvVar: "SERPAPI_API_KEY" },
  { id: "serpapi", label: "SerpApi", description: "SerpApi Amazon Search results (ASIN discovery).", usedFor: ["competitors"], configEnvVar: "SERPAPI_API_KEY" },
  { id: "decodo", label: "Decodo", description: "Decodo SERP Scraping API — live fetch or pasted CSV/JSON export.", usedFor: ["keywords", "competitors"], configEnvVar: "DECODO_API_KEY" },
  { id: "zenrows", label: "ZenRows", description: "ZenRows scraping API — live Amazon search-results HTML, parsed locally.", usedFor: ["keywords", "competitors"], configEnvVar: "ZENROWS_API_KEY" },
  { id: "persona-llm", label: "Persona LLM (OpenRouter)", description: "LLM-generated buyer search queries via OpenRouter.", usedFor: ["keywords", "competitors"], configEnvVar: "OPENROUTER_API_KEY" },
  { id: "groq-persona", label: "Persona LLM (Groq)", description: "LLM-generated buyer search queries via Groq.", usedFor: ["keywords", "competitors"], configEnvVar: "GROQ_API_KEY" },
  { id: "firecrawl", label: "Firecrawl", description: "LLM-extracted categories/keywords/features from the product page.", usedFor: ["keywords"], configEnvVar: "FIRECRAWL_API_KEY" },
  { id: "comp-title", label: "Comp titles", description: "Competitor titles crawled from the product page's \"also bought\" carousel.", usedFor: ["keywords"] },
  { id: "comp-name", label: "Comp names", description: "Competitor author/title names from tracked competitor ASINs.", usedFor: ["keywords"] },
  { id: "author-catalog", label: "Author catalog", description: "The author's other books, crawled from their Amazon author page.", usedFor: ["keywords"] },
  { id: "genre-metadata", label: "Genre metadata", description: "Google Books / Open Library category and subject data.", usedFor: ["keywords"] },
  { id: "book-content", label: "Book content", description: "Recurring terms mined from the book's own listing content.", usedFor: ["keywords"] },
  { id: "buyer-intent", label: "Buyer intent", description: "Templated buyer-intent phrases (format, series-order, recency).", usedFor: ["keywords"] },
  { id: "book-description", label: "Book description", description: "Phrases mined from the publisher/author blurb.", usedFor: ["keywords"] },
  { id: "review-language", label: "Review language", description: "\"Voice of the customer\" phrasing mined from review excerpts.", usedFor: ["keywords"] },
  { id: "customer-qna", label: "Customer Q&A", description: "Real reader questions from the product page's Q&A section.", usedFor: ["keywords"] },
  { id: "synonym", label: "Synonyms", description: "Curated synonym expansion of the book's genre terms.", usedFor: ["keywords"] },
  { id: "wikipedia", label: "Wikipedia", description: "Wikipedia category data for the title/author.", usedFor: ["keywords"] },
  { id: "wikidata", label: "Wikidata", description: "Wikidata genre statements for the title/author.", usedFor: ["keywords"] },
  { id: "loc-subjects", label: "LoC subjects", description: "Library of Congress subject headings.", usedFor: ["keywords"] },
  { id: "goodreads-tags", label: "Goodreads tags", description: "Reader-applied shelf tags from Goodreads.", usedFor: ["keywords"] },
  { id: "amazon-recs", label: "Amazon recommendations", description: "\"Frequently bought together\" / \"Compare with similar items\".", usedFor: ["keywords"] },
  { id: "listing-metadata", label: "Listing metadata", description: "<title>, meta keywords, URL slug, variation swatches.", usedFor: ["keywords"] },
  { id: "user-tag", label: "User tags", description: "Known tags supplied by the user in the generate form.", usedFor: ["keywords"] },
  { id: "key-trope", label: "Key tropes", description: "User-provided tropes/themes/settings from the generate form.", usedFor: ["keywords"] },
  { id: "search-term-report", label: "Search term report", description: "Amazon Ads Search Term Report rows, imported from CSV.", usedFor: ["keywords"] },
  { id: "reverse-asin", label: "Reverse ASIN", description: "Reverse-ASIN tool exports (Helium 10 Cerebro etc.), pasted in.", usedFor: ["keywords"] },
  { id: "storygraph-tags", label: "StoryGraph tags", description: "StoryGraph mood/pace tags, pasted in.", usedFor: ["keywords"] },
  { id: "library-subjects", label: "Library subjects", description: "Library-catalogue subject headings, pasted in.", usedFor: ["keywords"] },
  { id: "critics-blurbs", label: "Critics' blurbs", description: "Descriptor phrases mined from critic blurbs/listicles, pasted in.", usedFor: ["keywords"] },
  { id: "auto-crawl", label: "Snapshot crawl", description: "Competitor ASINs found in the metadata snapshot captured when the book was added.", usedFor: ["competitors"] },
  { id: "genre-preset", label: "Genre presets", description: "Applied from the user's preset competitor-ASIN library.", usedFor: ["competitors"] },
  { id: "manual", label: "Manual", description: "Added or pasted in by hand.", usedFor: ["keywords", "competitors"] },
  { id: "kdpradar", label: "KDP Rocket / Radar", description: "Pasted in from KDP Rocket/Radar exports.", usedFor: ["competitors"] },
  { id: "datadive", label: "DataDive", description: "Pasted in from DataDive exports.", usedFor: ["competitors"] },
  { id: "helium10", label: "Helium 10", description: "Pasted in from Helium 10 exports.", usedFor: ["competitors"] },
  { id: "sellersprite", label: "SellerSprite", description: "Pasted in from SellerSprite exports.", usedFor: ["competitors"] },
];
