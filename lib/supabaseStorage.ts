import { isSupabaseConfigured, supabaseAdmin } from "./supabaseAdmin";

/**
 * Server-side archive of generated bulksheets in Supabase Storage.
 *
 * The bucket is PRIVATE: nothing here is readable without a signed URL, and
 * the only credential that can write to it is the service-role key, which
 * must never reach the browser. Every call in this module is therefore
 * server-only — importing it from a Client Component would leak the key.
 *
 * Archiving is best-effort. The bulksheet is streamed straight back to the
 * caller regardless; a Storage outage or missing env vars must never turn a
 * successful generation into a failed request.
 */

const BUCKET = "bulksheets";

/** How long a returned download link stays valid. */
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface ArchivedBulksheet {
  /** Object path inside the bucket, e.g. "2026/08/07/abc123-my-campaign.xlsx". */
  path: string;
  /** Time-limited download URL, valid for SIGNED_URL_TTL_SECONDS. */
  signedUrl: string;
}

/**
 * True when Supabase is configured. Deployments without it keep working with
 * downloads only.
 */
export function isStorageConfigured(): boolean {
  return isSupabaseConfigured();
}

/**
 * Per-user, date-partitioned, collision-proof object key:
 * `<userId>/<YYYY>/<MM>/<DD>/<uuid>-<campaign>.xlsx`.
 *
 * The user prefix is what makes per-user history possible later — it's also
 * the prefix any future Storage policy would key off, so signed URLs stay the
 * only way across accounts. The uuid keeps two runs of the same campaign on
 * the same day from colliding, and the date folders make lifecycle rules and
 * manual cleanup straightforward.
 *
 * `userId` is optional so archiving still works for any caller without a
 * session; those land under "shared/".
 */
export function buildObjectPath(campaignName: string, userId?: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const slug =
    campaignName
      .replace(/[^a-z0-9\-_]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "campaign";
  // Only ever a Supabase user id (uuid) or the literal fallback — but sanitize
  // anyway so nothing can ever climb out of its own prefix with "../".
  const owner = userId?.replace(/[^a-z0-9-]/gi, "") || "shared";
  return `${owner}/${yyyy}/${mm}/${dd}/${crypto.randomUUID()}-${slug}.xlsx`;
}

/**
 * Upload a generated bulksheet and return a signed download URL.
 *
 * Never throws: returns null if Storage isn't configured or the upload fails,
 * after logging the reason.
 */
export async function archiveBulksheet(
  buffer: Buffer,
  campaignName: string,
  userId?: string
): Promise<ArchivedBulksheet | null> {
  if (!isStorageConfigured()) {
    return null;
  }

  const path = buildObjectPath(campaignName, userId);

  try {
    const storage = supabaseAdmin().storage.from(BUCKET);

    const { error: uploadError } = await storage.upload(
      path,
      // supabase-js wants an ArrayBuffer/Blob; a Node Buffer is a view into a
      // possibly larger pool, so copy out just this file's bytes.
      new Uint8Array(buffer),
      { contentType: XLSX_MIME, upsert: false }
    );
    if (uploadError) {
      console.error("Bulksheet archive upload failed:", uploadError.message);
      return null;
    }

    const { data, error: signError } = await storage.createSignedUrl(
      path,
      SIGNED_URL_TTL_SECONDS
    );
    if (signError || !data?.signedUrl) {
      console.error(
        "Bulksheet archived but signing failed:",
        signError?.message ?? "no URL returned"
      );
      // The object is stored; callers still get the path for later retrieval.
      return { path, signedUrl: "" };
    }

    return { path, signedUrl: data.signedUrl };
  } catch (err) {
    console.error(
      "Bulksheet archive failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** Re-sign an existing archived object, e.g. after the first link expires. */
export async function createDownloadUrl(path: string): Promise<string | null> {
  if (!isStorageConfigured()) {
    return null;
  }
  const { data, error } = await supabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    console.error("Signing archived bulksheet failed:", error?.message);
    return null;
  }
  return data.signedUrl;
}
