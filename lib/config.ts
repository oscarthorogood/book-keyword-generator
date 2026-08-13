/**
 * Auth configuration, shared by the proxy and the route handlers.
 *
 * This file used to carry API_CONFIG and KEYWORD_CONFIG too. Both were dead:
 * nothing imported either one, and KEYWORD_CONFIG's marketplace/match-type
 * lists and caps duplicated the live values in lib/types.ts and
 * lib/keywordMerge.ts — the exact drift its own comment warned about.
 */

export const AUTH_CONFIG = {
  // Reachable without a session. Anything here is also matched as a prefix,
  // so "/auth" covers "/auth/confirm".
  PUBLIC_PATHS: [
    "/login",
    "/auth", // magic-link landing (/auth/confirm)
    "/api/auth", // sign-in request
    "/api/logout",
  ],
};
