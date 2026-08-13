import { KeywordCandidate, Marketplace } from "./types";

// Amazon Ads API endpoint host per marketplace region.
// https://advertising.amazon.com/API/docs/en-us/info/api-overview#api-endpoints
const AD_API_ENDPOINTS: Record<Marketplace, string> = {
  US: "https://advertising-api.amazon.com",
  CA: "https://advertising-api.amazon.com",
  UK: "https://advertising-api.eu",
  DE: "https://advertising-api.eu",
  FR: "https://advertising-api.eu",
  IT: "https://advertising-api.eu",
  ES: "https://advertising-api.eu",
};

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

interface AdsCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  profileId: string;
}

function getCredentials(): AdsCredentials | null {
  const clientId = process.env.AMAZON_ADS_CLIENT_ID;
  const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET;
  const refreshToken = process.env.AMAZON_ADS_REFRESH_TOKEN;
  const profileId = process.env.AMAZON_ADS_PROFILE_ID;

  if (!clientId || !clientSecret || !refreshToken || !profileId) {
    return null;
  }
  return { clientId, clientSecret, refreshToken, profileId };
}

async function refreshAccessToken(creds: AdsCredentials): Promise<string> {
  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });

  if (!res.ok) {
    throw new Error(`LWA token refresh failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

interface RawRecommendation {
  keyword?: string;
  keywordText?: string;
  matchType?: string;
  bid?: {
    suggested?: number;
    suggestedBid?: number;
    rangeStart?: number;
    rangeEnd?: number;
  };
}

/**
 * Calls the Amazon Ads API keyword-recommendations endpoint for a given ASIN.
 *
 * NOTE: the exact request/response shape below reflects the documented v3
 * `sp/targets/keywords/recommendations` contract as of this writing, but
 * Amazon revises Ads API contracts without much notice. Verify against the
 * live OpenAPI spec (advertising.amazon.com/API/docs) once real credentials
 * are in place, before depending on this in production.
 */
export async function getAdsApiKeywordRecommendations(
  asin: string,
  marketplace: Marketplace
): Promise<KeywordCandidate[]> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      "Amazon Ads API credentials are not configured (AMAZON_ADS_CLIENT_ID / AMAZON_ADS_CLIENT_SECRET / AMAZON_ADS_REFRESH_TOKEN / AMAZON_ADS_PROFILE_ID)."
    );
  }

  const accessToken = await refreshAccessToken(creds);
  const endpoint = AD_API_ENDPOINTS[marketplace];

  const res = await fetch(`${endpoint}/sp/targets/keywords/recommendations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/vnd.spkeywordsrecommendation.v3+json",
      Accept: "application/vnd.spkeywordsrecommendation.v3+json",
      Authorization: `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": creds.clientId,
      "Amazon-Advertising-API-Scope": creds.profileId,
    },
    body: JSON.stringify({
      recommendationType: "KEYWORDS_FOR_ASINS",
      asins: [asin],
      maxRecommendations: 200,
      sortDimension: "CONVERSIONS",
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Amazon Ads API keyword recommendations failed: ${res.status} ${await res.text()}`
    );
  }

  const json = (await res.json()) as { recommendations?: RawRecommendation[] };
  const recommendations = json.recommendations ?? [];

  const candidates: KeywordCandidate[] = [];
  for (const r of recommendations) {
    const text = (r.keyword ?? r.keywordText ?? "").trim().toLowerCase();
    if (!text) continue;
    candidates.push({
      text,
      sources: ["ads-api"],
      suggestedBid: r.bid?.suggested ?? r.bid?.suggestedBid,
    });
  }
  return candidates;
}

export function isAdsApiConfigured(): boolean {
  return getCredentials() !== null;
}

export interface BidRange {
  min: number;
  max: number;
}

/**
 * Fallback keyword/product-targeting bid bounds, used to clamp computed bids
 * (lib/competitorBidding.ts) when no live Ads API bid-range data is
 * available for the ASIN (see RawRecommendation.bid.rangeStart/rangeEnd
 * above) — typical Sponsored Products bid floor/ceiling.
 */
export const DEFAULT_COMPETITOR_BID_RANGE: BidRange = { min: 0.2, max: 2.5 };

/** Clamps a computed bid into a bid range, defaulting to DEFAULT_COMPETITOR_BID_RANGE. */
export function clampBid(bid: number, range: BidRange = DEFAULT_COMPETITOR_BID_RANGE): number {
  return Math.min(range.max, Math.max(range.min, bid));
}
