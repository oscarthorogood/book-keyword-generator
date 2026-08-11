/**
 * Manually curated comparable-author / comparable-title library, keyed by
 * ASIN. Used to seed comp-name/comp-title keyword generation, as candidate
 * seeds for the reverse-ASIN and Decodo import sources, and as the mention
 * list inside persona-llm prompts (lib/llmPersonaSource.ts) — and as the
 * approved comp-author allowlist for authorDisambiguationFilter
 * (lib/keywordFilters.ts).
 *
 * "expensive" authors are the highest-CPC, most fought-over names in the
 * genre: keep starting bids low and caps tight on keywords built from them
 * (see scoreForRank / capAndRank in lib/keywordCapAndRank.ts).
 */

export interface ManualCompetitorAuthor {
  name: string;
  /** High-CPC/heavily-advertised author — start bids low, cap keyword count tighter. */
  expensive?: boolean;
}

export interface ManualCompetitorEntry {
  authors: ManualCompetitorAuthor[];
  titles: string[];
}

/**
 * Crime/police-procedural comps for *Unforgiven (DS Mia McAllister)*,
 * B0H889WWGW. Representative of the genre — Angela Marsons, Jane Casey,
 * Cara Hunter, Robert Bryndza, M. W. Craven, LJ Ross, Ann Cleeves, Val
 * McDermid, Clare Mackintosh, Dervla McTiernan and their series-mates.
 */
export const manualCompetitors: Record<string, ManualCompetitorEntry> = {
  B0H889WWGW: {
    authors: [
      { name: "Angela Marsons" },
      { name: "Jane Casey" },
      { name: "Cara Hunter" },
      { name: "Robert Bryndza" },
      { name: "M. W. Craven" },
      { name: "LJ Ross" },
      { name: "Ann Cleeves", expensive: true },
      { name: "Val McDermid", expensive: true },
      { name: "Clare Mackintosh" },
      { name: "Dervla McTiernan" },
      { name: "Elly Griffiths", expensive: true },
      { name: "Rachel Abbott", expensive: true },
      { name: "Peter James" },
      { name: "Mark Billingham" },
      { name: "Ian Rankin" },
      { name: "Karin Slaughter" },
      { name: "Mel Sherratt" },
      { name: "Rachel Caine" },
      { name: "Faith Martin" },
      { name: "Helen Fields" },
      { name: "Joy Ellis" },
      { name: "David Baldacci" },
      { name: "Lisa Gardner" },
      { name: "Tana French" },
      { name: "Susie Steiner" },
      { name: "Denise Mina" },
      { name: "Stuart MacBride" },
      { name: "Simon Kernick" },
      { name: "Alex Kava" },
      { name: "Rachel Amphlett" },
      { name: "J.D. Kirk" },
      { name: "Robert Bailey" },
      { name: "Damien Boyd" },
      { name: "Adam Croft" },
      { name: "Michael Wood" },
      { name: "Rachael Blok" },
      { name: "Angela Marchetti" },
      { name: "Carla Kovach" },
      { name: "Rachel Rhys" },
      { name: "Alex Coombs" },
      { name: "Alison Belsham" },
      { name: "Neil Lancaster" },
      { name: "Trevor Wood" },
      { name: "Steve Cavanagh" },
      { name: "Chris Carter" },
      { name: "Simon Toyne" },
      { name: "Nadine Matheson" },
      { name: "Roz Watkins" },
      { name: "Alex Gray" },
      { name: "Craig Robertson" },
      { name: "Caro Ramsay" },
      { name: "Lin Anderson" },
      { name: "Val Wood" },
      { name: "Sarah Hilary" },
      { name: "Mari Hannah" },
      { name: "Angela Clarke" },
      { name: "Kate London" },
      { name: "Gytha Lodge" },
      { name: "T.M. Logan" },
      { name: "Clare Empson" },
    ],
    titles: [
      "Silent Scream",
      "Evil Games",
      "The Burning",
      "Cruel Justice",
      "The Cutting Place",
      "How the Dead Speak",
      "Close to Home",
      "The Missing",
      "The Boy in the Woods",
      "Force of Nature",
      "The Girl Who Died",
      "Nine Elms",
      "Nine Lessons",
      "The Retreat",
      "The Puppet Show",
      "Black Summer",
      "The Curator",
      "Holy Island",
      "Sycamore Gap",
      "Twenty Years Dead",
      "Dead Man's Grave",
      "Long Bay",
      "The Rúin",
      "The Scholar",
      "The Good Turn",
      "I Let You Go",
      "Let Me Lie",
      "After the End",
      "Broadchurch",
      "In the Dark",
      "The Dark Room",
      "Wire in the Blood",
      "The Mermaids Singing",
      "Insidious Intent",
      "1989",
      "Raven Black",
      "Thin Air",
      "The Long Call",
      "Dead Simple",
      "Not Dead Enough",
      "Love You Dead",
      "Sleepyhead",
      "Scaredy Cat",
      "Rain Dogs",
      "Knots and Crosses",
      "Black and Blue",
      "A Song for the Dark Times",
      "Pretty Girls",
      "The Good Daughter",
      "Naked in Death",
      "Watching You",
      "Six Wounds",
      "The Coroner",
      "The Reckoning",
      "The Innocent",
      "In the Blood",
      "The Girl Who Lied",
      "The Photographer",
      "The Widow",
      "The Perfect Murder",
      "The Last Mrs Parrish",
      "The Chalk Man",
      "Look What You Made Me Do",
      "Behind Closed Doors",
      "The Silent Patient",
      "Anatomy of a Scandal",
      "Local Girl Missing",
      "The Foundling",
      "The Puppet Master",
      "Dark Waters",
      "Blood Loss",
      "Blood and Bone",
      "The Killing Files",
      "In Cold Blood",
      "The Interrogation",
      "Cold Case",
      "The Eleventh Hour",
      "The Missing Ones",
      "The Whisper Man",
      "Then She Was Gone",
      "Someone Else's Skin",
      "No Other Darkness",
      "The Deepest Grave",
      "Broken Ground",
      "The Dark Room II",
      "The Wych Elm",
      "In the Woods",
      "Faithful Place",
      "The Trespasser",
    ],
  },
};

/** True when `name` is the book's actual author or an approved comp author for `asin`. */
export function isApprovedAuthor(name: string, actualAuthor: string, asin?: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === actualAuthor.trim().toLowerCase()) return true;
  const entry = asin ? manualCompetitors[asin] : undefined;
  const pool = entry ? entry.authors : Object.values(manualCompetitors).flatMap((e) => e.authors);
  return pool.some((author) => author.name.trim().toLowerCase() === normalized);
}
