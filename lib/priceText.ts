/**
 * Locale-aware price parsing, shared by every source that reads a price off a
 * page or an API response (lib/scrape.ts, lib/serpApi.ts).
 *
 * This app buys ads in seven marketplaces (lib/marketplaceCurrency.ts) and
 * four of them — DE, FR, IT, ES — write money the continental way: "12,50 €"
 * for twelve-fifty, "1.234,56 €" for one-thousand-two-hundred-and-thirty-four.
 * The parsers this replaces both assumed the anglophone convention, and did
 * so in two different, both-wrong ways:
 *
 *  - scrape.ts required a dot with exactly two decimals (`[\d,]+\.\d{2}`), so
 *    "12,50 €" matched nothing at all and every EUR listing came back with no
 *    price;
 *  - serpApi.ts matched the digits and then stripped commas as if they were
 *    thousands separators, so "12,50" parsed as 1250 — a hundred times the
 *    real price, silently, with no sign anything was wrong.
 *
 * Both feed the same decisions: `isRaceToBottom` (lib/campaignSelection.ts)
 * excludes perma-free rivals by price, and `priceTier`
 * (lib/competitorBidding.ts) raises a bid for a pricier comp. A missing price
 * disables the first; a 100x price maxes out the second.
 *
 * Rather than switch on the marketplace — the raw string does not always
 * arrive with one, and a source can return either convention — the separator
 * is inferred from the number itself, which is unambiguous for real prices.
 */

/**
 * The last `.` or `,` in a number is its decimal separator when it is
 * followed by one or two digits; anything else is a grouping separator.
 *
 * That rule reads both conventions correctly for money: "1,234.56" and
 * "1.234,56" both give 1234.56, "12,50" and "12.50" both give 12.5, and
 * "1,250" / "1.250" are read as 1250 because three trailing digits are a
 * thousands group, not a fraction. Prices are never quoted to three decimal
 * places, which is what makes the rule safe here.
 */
function toNumber(digits: string): number {
  const lastSeparator = Math.max(digits.lastIndexOf("."), digits.lastIndexOf(","));
  if (lastSeparator === -1) return Number(digits);

  const fraction = digits.slice(lastSeparator + 1);
  const isDecimal = /^\d{1,2}$/.test(fraction) && lastSeparator > 0;
  if (!isDecimal) return Number(digits.replace(/[.,]/g, ""));

  const whole = digits.slice(0, lastSeparator).replace(/[.,]/g, "");
  return Number(`${whole || "0"}.${fraction}`);
}

/**
 * Reads a price out of whatever a source hands over — a number, or a string
 * like "£12.50", "12,50 €", "$1,234.56" or "1.234,56". Returns undefined when
 * there is no price in it, so callers can tell "not found" from "free".
 */
export function parsePriceText(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== "string") return undefined;

  // The first run of digits with its separators. Leading currency symbols,
  // trailing symbols and surrounding words are all ignored.
  const match = raw.match(/\d[\d.,]*/);
  if (!match) return undefined;

  // A trailing separator belongs to the sentence, not the number ("£12.").
  const value = toNumber(match[0].replace(/[.,]+$/, ""));
  return Number.isFinite(value) ? value : undefined;
}
