// Lightweight local RAKE (Rapid Automatic Keyword Extraction) implementation.
// No network calls, no dependencies — pure text-in, phrases-out. Used to turn
// free-form scraped text (product descriptions, review bodies, Q&A) into
// keyword phrase candidates without needing an LLM or paid NLP API.

const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "all", "am", "an", "and", "any",
  "are", "as", "at", "be", "because", "been", "before", "being", "below",
  "between", "both", "but", "by", "can", "did", "do", "does", "doing", "down",
  "during", "each", "few", "for", "from", "further", "had", "has", "have",
  "having", "he", "her", "here", "hers", "herself", "him", "himself", "his",
  "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just", "me",
  "more", "most", "my", "myself", "no", "nor", "not", "now", "of", "off",
  "on", "once", "only", "or", "other", "our", "ours", "ourselves", "out",
  "over", "own", "s", "same", "she", "should", "so", "some", "such", "t",
  "than", "that", "the", "their", "theirs", "them", "themselves", "then",
  "there", "these", "they", "this", "those", "through", "to", "too", "under",
  "until", "up", "very", "was", "we", "were", "what", "when", "where",
  "which", "while", "who", "whom", "why", "will", "with", "you", "your",
  "yours", "yourself", "yourselves", "it's", "don't", "didn't", "doesn't",
  "isn't", "wasn't", "book", "books", "author", "read", "reader", "readers",
]);

const SPLIT_DELIMITERS = /[.,;:!?()[\]{}"'“”‘’\-–—/\\|\n\r\t]+/;
const MIN_PHRASE_LENGTH = 3;
const MAX_PHRASE_LENGTH = 60;
const MAX_PHRASE_WORDS = 4;

/**
 * Splits `text` on stopwords/punctuation into candidate phrases, scores each
 * unique word by RAKE's degree/frequency ratio (words that co-occur with
 * many other words in longer phrases score higher than isolated common
 * words), then scores each phrase as the sum of its word scores. Returns the
 * top `maxPhrases` phrases, best first.
 */
export function extractKeyPhrases(text: string | undefined, maxPhrases = 15): string[] {
  if (!text) return [];

  const tokens = text.toLowerCase().split(SPLIT_DELIMITERS).join(" ").split(/\s+/);

  const phrases: string[][] = [];
  let current: string[] = [];
  for (const token of tokens) {
    const clean = token.replace(/[^a-z0-9']/g, "");
    if (!clean || STOPWORDS.has(clean)) {
      if (current.length) phrases.push(current);
      current = [];
    } else {
      current.push(clean);
    }
  }
  if (current.length) phrases.push(current);

  const freq = new Map<string, number>();
  const coOccurrence = new Map<string, number>();
  for (const phrase of phrases) {
    for (const word of phrase) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
      coOccurrence.set(word, (coOccurrence.get(word) ?? 0) + phrase.length);
    }
  }

  const phraseScores = new Map<string, number>();
  for (const phrase of phrases) {
    if (phrase.length === 0 || phrase.length > MAX_PHRASE_WORDS) continue;
    const text = phrase.join(" ");
    if (text.length < MIN_PHRASE_LENGTH || text.length > MAX_PHRASE_LENGTH) continue;

    const score = phrase.reduce((sum, word) => {
      const wordFreq = freq.get(word) ?? 1;
      const wordDegree = coOccurrence.get(word) ?? wordFreq;
      return sum + wordDegree / wordFreq;
    }, 0);

    phraseScores.set(text, Math.max(phraseScores.get(text) ?? 0, score));
  }

  return Array.from(phraseScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxPhrases)
    .map(([text]) => text);
}
