/**
 * Parsing whatever the user pastes into the "add a book" box: a full Amazon
 * product link, a shortened share link path, or a bare ASIN/ISBN.
 *
 * A link carries its own marketplace (amazon.co.uk vs amazon.com), so pasting
 * one means the user doesn't have to also get the marketplace dropdown right
 * — picking US for a .co.uk link silently scrapes a different listing, or no
 * listing at all.
 */

import { normalizeAsinOrIsbn } from "./isbn";
import type { Marketplace } from "./types";

const DOMAIN_MARKETPLACES: Array<[string, Marketplace]> = [
  ["amazon.co.uk", "UK"],
  ["amazon.com.au", "US"], // no AU marketplace in this app; US listing data is the closest match
  ["amazon.ca", "CA"],
  ["amazon.de", "DE"],
  ["amazon.fr", "FR"],
  ["amazon.it", "IT"],
  ["amazon.es", "ES"],
  ["amazon.com", "US"],
];

// /dp/B0XXXXXXXX, /gp/product/B0XXXXXXXX, /gp/aw/d/B0XXXXXXXX,
// /product/B0XXXXXXXX and ?asin=B0XXXXXXXX all appear in links people copy.
const ASIN_IN_PATH = /\/(?:dp|gp\/product|gp\/aw\/d|product|-\/[a-z]{2}\/dp)\/([A-Z0-9]{10})/i;
const ASIN_IN_QUERY = /[?&](?:asin|ASIN)=([A-Z0-9]{10})/;

export interface ParsedAmazonInput {
  asin: string;
  /** Present only when the input was a link whose domain identified a marketplace. */
  marketplace?: Marketplace;
  source: "url" | "identifier";
}

/**
 * Returns the ASIN (and marketplace, for links) from a pasted product URL or a
 * bare ASIN/ISBN. ISBNs are normalized to the ISBN-10 form Amazon uses as the
 * ASIN for print books — see lib/isbn.ts.
 */
export function parseAmazonInput(input: string): ParsedAmazonInput | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const looksLikeUrl = /^(https?:\/\/|www\.)|amazon\./i.test(trimmed);
  if (looksLikeUrl) {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let parsed: URL;
    try {
      parsed = new URL(withScheme);
    } catch {
      return null;
    }

    const host = parsed.hostname.toLowerCase();
    const marketplace = DOMAIN_MARKETPLACES.find(([domain]) => host.endsWith(domain))?.[1];

    const match = parsed.pathname.match(ASIN_IN_PATH) ?? parsed.search.match(ASIN_IN_QUERY);
    const rawAsin = match?.[1];
    if (!rawAsin) return null;

    const asin = normalizeAsinOrIsbn(rawAsin);
    if (!asin) return null;

    return { asin, marketplace, source: "url" };
  }

  const asin = normalizeAsinOrIsbn(trimmed);
  return asin ? { asin, source: "identifier" } : null;
}
