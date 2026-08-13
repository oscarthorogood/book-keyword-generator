/**
 * Centralized configuration for auth and API behavior.
 * Replaces duplicated constants scattered across lib/auth.ts and middleware.ts
 */

/**
 * The development-only fallback for AUTH_SECRET. This value is committed to
 * the repository, so anything signed with it is forgeable by anyone who can
 * read the source — it must never be used to sign a real approve/deny link.
 */
const DEV_AUTH_SECRET = "your-secret-key-change-this-in-production";

/**
 * Minimum length for a usable secret. HS256 keys shorter than this are
 * brute-forceable; a real deployment should use 32+ random bytes.
 */
const MIN_AUTH_SECRET_LENGTH = 32;

export const AUTH_CONFIG = {
  /**
   * Key for the one-click approve/deny links emailed to the admin. Session
   * handling itself is Supabase's job — this secret no longer mints sessions.
   *
   * Resolved lazily, on use, rather than at module load: this module is
   * imported by `proxy.ts` and by route handlers that Next evaluates while
   * collecting page data at build time, where the runtime env is not
   * necessarily present. Throwing at import time would break the build
   * instead of the one request that actually needs the key.
   *
   * Fails closed in production. Previously this silently fell back to
   * DEV_AUTH_SECRET, which meant a deployment missing AUTH_SECRET signed its
   * admin approve links with a value published in this repo — letting anyone
   * mint a valid "approved" token for their own address and grant themselves
   * access. A missing or too-short secret is now a hard error in production.
   */
  secretKey(): Uint8Array {
    const secret = process.env.AUTH_SECRET;

    if (process.env.NODE_ENV === "production") {
      if (!secret || secret === DEV_AUTH_SECRET) {
        throw new Error(
          "AUTH_SECRET is not set. It signs the admin approve/deny links, so " +
            "running without it would let anyone forge an access approval. Set " +
            "AUTH_SECRET to a long random value and redeploy."
        );
      }
      if (secret.length < MIN_AUTH_SECRET_LENGTH) {
        throw new Error(
          `AUTH_SECRET is too short (${secret.length} chars). Use at least ` +
            `${MIN_AUTH_SECRET_LENGTH} characters of random data.`
        );
      }
    }

    return new TextEncoder().encode(secret || DEV_AUTH_SECRET);
  },
  // Reachable without a session. Anything here is also matched as a prefix,
  // so "/auth" covers "/auth/confirm".
  PUBLIC_PATHS: [
    "/login",
    "/auth", // magic-link landing (/auth/confirm)
    "/api/auth", // sign-in request + admin approve/deny
    "/api/logout",
  ],
};

export const API_CONFIG = {
  MAX_DURATION: 60, // Vercel function timeout in seconds
  COMMON_ERROR: { error: "Internal server error" },
};

export const KEYWORD_CONFIG = {
  MARKETPLACES: ["US", "UK", "CA", "DE", "FR", "IT", "ES"] as const,
  MATCH_TYPES: ["broad", "phrase", "exact"] as const,
  // NOTE: keyword caps deliberately do NOT live here. The live values are
  // RECOMMENDED_MIN/MAX_KEYWORDS + COMP_NAME_MAX_KEYWORDS in lib/keywordMerge.ts
  // and PRODUCT_TARGET_MAX in lib/productTargets.ts, next to the scoring code
  // that reads them. Duplicating them here previously left two contradicting
  // sets of numbers, with the copies in this file silently unused.
  //
  // The same applies to the source list: the live one is ALL_KEYWORD_SOURCES
  // in app/api/books/[id]/keywords/generate/route.ts, next to the pipeline
  // that reads it. A duplicate used to live here too — always stale, never
  // imported by anything — and was removed.
  ALL_KEYWORD_GROUP_TYPES: ["tropes", "comp-names", "product-targeting"] as const,
};
