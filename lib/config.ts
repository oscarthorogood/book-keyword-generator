/**
 * Centralized configuration for auth and API behavior.
 * Replaces duplicated constants scattered across lib/auth.ts and middleware.ts
 */

export const AUTH_CONFIG = {
  SECRET_KEY: new TextEncoder().encode(process.env.AUTH_SECRET || "your-secret-key-change-this-in-production"),
  TOKEN_EXPIRY: "7d",
  COOKIE_CONFIG: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  },
  PUBLIC_PATHS: ["/login", "/api/login", "/api/logout"],
};

export const API_CONFIG = {
  MAX_DURATION: 60, // Vercel function timeout in seconds
  COMMON_ERROR: { error: "Internal server error" },
};

export const KEYWORD_CONFIG = {
  MARKETPLACES: ["US", "UK", "CA", "DE", "FR", "IT", "ES"] as const,
  MATCH_TYPES: ["broad", "phrase", "exact"] as const,
  RECOMMENDED_MIN_KEYWORDS: 100,
  RECOMMENDED_MAX_KEYWORDS: 200,
  COMP_NAME_MAX_KEYWORDS: 20,
  PRODUCT_TARGET_MAX: 30,
  ALL_KEYWORD_SOURCES: [
    "ads-api",
    "autocomplete",
    "google-autocomplete",
    "youtube-autocomplete",
    "duckduckgo-autocomplete",
    "comp-title",
    "comp-name",
    "genre-metadata",
    "buyer-intent",
    "book-content",
    "review-language",
    "book-description",
    "customer-qna",
    "synonym",
    "wikipedia",
    "wikidata",
    "loc-subjects",
    "author-catalog",
    "goodreads-tags",
    "user-tag",
    "key-trope", // User-provided tropes/themes/settings from the form
  ] as const,
  ALL_KEYWORD_GROUP_TYPES: ["tropes", "comp-names", "product-targeting"] as const,
};
