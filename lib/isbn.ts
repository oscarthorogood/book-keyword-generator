/**
 * For print books, an Amazon ASIN *is* the ISBN-10 — Amazon assigns the
 * ISBN-10 directly as the ASIN for books that have one. So "enter the ASIN"
 * can just as well be "enter the ISBN": this accepts either an ASIN/ISBN-10
 * as-is, or an ISBN-13 (with or without hyphens/spaces), converting the
 * latter to its ISBN-10 equivalent to use as the ASIN.
 */

/** Amazon-assigned ASINs (non-ISBN products, and books without one) are all in the B0 namespace. */
const ASIN_PATTERN = /^B0[A-Z0-9]{8}$/;
const ISBN10_SHAPE_PATTERN = /^\d{9}[\dX]$/;
const ISBN13_PATTERN = /^\d{13}$/;

/**
 * Validates an ISBN-10 checksum (weighted sum of digits, mod 11 == 0).
 * Rejects well-formed-looking-but-fake strings like "CLOVERLEAF" wouldn't
 * even reach this check (they aren't digit-shaped), but also rejects
 * digit strings that merely look like an ISBN without being one.
 */
function isValidIsbn10Checksum(candidate: string): boolean {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(candidate[i]);
  const last = candidate[9] === "X" ? 10 : Number(candidate[9]);
  sum += last;
  return sum % 11 === 0;
}

/**
 * Converts an ISBN-13 to ISBN-10. Only possible for 978-prefixed ISBN-13s
 * (the ISBN-13 namespace introduced by 979 has no ISBN-10 equivalent) —
 * returns null for anything else.
 */
function isbn13ToIsbn10(isbn13: string): string | null {
  if (!isbn13.startsWith("978")) return null;

  const core = isbn13.slice(3, 12); // 9 digits identifying the title
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(core[i]);

  const remainder = (11 - (sum % 11)) % 11;
  const checkDigit = remainder === 10 ? "X" : String(remainder);
  return core + checkDigit;
}

/**
 * Normalizes a user-entered ASIN or ISBN (10 or 13 digit, with or without
 * hyphens/spaces) down to the 10-character ASIN/ISBN-10 form the rest of
 * the app expects. Returns null if the input doesn't match any recognized
 * shape (e.g. a 979-prefixed ISBN-13, which has no ASIN equivalent) or is
 * a 10-character string that merely has ASIN *shape* without being a real
 * Amazon-assigned ASIN or a checksum-valid ISBN-10 — e.g. "CLOVERLEAF"
 * (§0.3 regression fixture: arbitrary letter strings must be rejected, not
 * silently accepted as an ASIN).
 */
export function normalizeAsinOrIsbn(input: string): string | null {
  const cleaned = input.replace(/[-\s]/g, "").toUpperCase();

  if (ASIN_PATTERN.test(cleaned)) return cleaned;
  if (ISBN10_SHAPE_PATTERN.test(cleaned) && isValidIsbn10Checksum(cleaned)) return cleaned;
  if (ISBN13_PATTERN.test(cleaned)) return isbn13ToIsbn10(cleaned);
  return null;
}
