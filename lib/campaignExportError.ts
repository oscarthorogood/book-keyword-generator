/**
 * Turns a raw Storage/Postgres failure from a campaign export into something
 * a human can act on.
 *
 * Every campaign export uploads two files to the `bulksheets` bucket — the
 * Amazon-importable `*-upload.xlsx` and the archival `*-review.csv`. That
 * bucket is created by hand in the Supabase dashboard
 * (sql/02-storage-bucket-policies.sql), and dashboard bucket creation defaults
 * `allowed_mime_types` to a single type. When it ends up holding only the xlsx
 * type, the CSV half fails with a bare "mime type text/csv is not supported"
 * and the whole export rolls back to `draft` — a message that says nothing
 * about which bucket, which file, or what to do. sql/30 is the fix; this
 * points at it.
 */
export function describeExportFailure(message: string): string {
  if (/mime type/i.test(message)) {
    return (
      `${message} — the \`bulksheets\` storage bucket is rejecting one of the two files every export uploads ` +
      "(the .xlsx bulksheet and the .csv review copy). Run sql/30-bulksheets-bucket-mime-types.sql to widen its " +
      "allowed MIME types, then retry."
    );
  }
  return message;
}
