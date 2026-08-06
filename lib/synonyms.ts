// A curated genre/thematic thesaurus, applied to genre terms already
// extracted from metadata to surface related buyer search language for free.
//
// A full WordNet lookup was considered instead, but WordNet's synsets are
// general-purpose (nouns/verbs across the whole language) and would need a
// multi-megabyte dictionary dependency to produce mostly generic synonyms
// ("magic" -> "thaumaturgy") that aren't actually how book buyers search.
// This hand-built map is smaller, has no dependency, and only contains terms
// people plausibly type into Amazon/Google when looking for books.
const GENRE_SYNONYMS: Record<string, string[]> = {
  fantasy: ["magic", "wizards", "sorcery", "mythical creatures", "epic fantasy"],
  "epic fantasy": ["high fantasy", "sword and sorcery"],
  "urban fantasy": ["paranormal fantasy"],
  mystery: ["detective", "whodunit", "crime fiction", "sleuth"],
  thriller: ["suspense", "psychological thriller", "page turner"],
  horror: ["scary", "supernatural", "paranormal", "creepy"],
  "science fiction": ["sci-fi", "scifi", "space opera", "dystopian"],
  scifi: ["science fiction", "space opera"],
  romance: ["love story", "romantic", "steamy romance"],
  "young adult": ["ya", "teen fiction", "coming of age"],
  "historical fiction": ["period drama", "historical novel"],
  biography: ["memoir", "life story", "autobiography"],
  memoir: ["biography", "personal story"],
  "self help": ["self-improvement", "personal development", "motivational"],
  "self-help": ["self-improvement", "personal development", "motivational"],
  cookbook: ["recipes", "cooking guide"],
  "children's": ["kids books", "picture book"],
  poetry: ["poems", "verse"],
  "graphic novel": ["comic book", "manga"],
  business: ["entrepreneurship", "leadership", "management"],
  "true crime": ["crime documentary", "real crime story"],
  adventure: ["action adventure", "quest"],
  dystopian: ["post-apocalyptic", "dystopia"],
  paranormal: ["supernatural", "ghost story"],
  western: ["cowboy fiction", "wild west"],
  "literary fiction": ["contemporary fiction"],
  humor: ["comedy", "funny books"],
};

/**
 * Expands each of `terms` (typically the top genre/subject strings already
 * pulled from metadata) into any related buyer-search phrases from the
 * curated map above. Pure local lookup — no network call.
 */
export function expandSynonyms(terms: string[], limit = 8): string[] {
  const out = new Set<string>();
  for (const term of terms.slice(0, limit)) {
    const normalized = term.toLowerCase().trim();
    const direct = GENRE_SYNONYMS[normalized];
    if (direct) {
      for (const synonym of direct) out.add(synonym);
      continue;
    }
    for (const [key, synonyms] of Object.entries(GENRE_SYNONYMS)) {
      if (normalized.includes(key)) {
        for (const synonym of synonyms) out.add(synonym);
      }
    }
  }
  return Array.from(out);
}
