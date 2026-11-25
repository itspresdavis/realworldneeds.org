// Supabase's configured maximum rows can be lower than our requested range.
// Require a complete, stable read rather than presenting a partial download as
// the user's export. Notes are immutable to client roles; two reads also detect
// concurrent submissions/deletions. This is not a database transaction.
const MAX_NOTES = 10000;
const PAGE_SIZE = 1000;
const MAX_REQUESTS = 100;

export class ExportLimitError extends Error {}

async function readNotes(client, userId, signal) {
  const notes = [];
  const ids = new Set();
  let total;
  for (let request = 0; request < MAX_REQUESTS; request += 1) {
    signal.throwIfAborted();
    const { data, count, error } = await client
      .from("rwn_reviews")
      .select("id,location_id,note,created_at", { count: "exact" })
      .eq("author_id", userId)
      .order("created_at")
      .order("id")
      .range(notes.length, Math.min(notes.length + PAGE_SIZE, MAX_NOTES) - 1)
      .abortSignal(signal);
    signal.throwIfAborted();
    if (
      error ||
      !Array.isArray(data) ||
      !Number.isSafeInteger(count) ||
      count < 0
    )
      throw new Error("Export count unavailable.");
    if (count > MAX_NOTES) throw new ExportLimitError();
    if (total !== undefined && count !== total)
      throw new Error("Export changed during read.");
    total = count;
    if (data.length > PAGE_SIZE || notes.length + data.length > total)
      throw new Error("Export range did not match count.");
    for (const row of data) {
      if (
        !row ||
        typeof row.id !== "string" ||
        !row.id ||
        ids.has(row.id) ||
        typeof row.location_id !== "string" ||
        typeof row.note !== "string" ||
        typeof row.created_at !== "string" ||
        !Number.isFinite(Date.parse(row.created_at))
      )
        throw new Error("Export returned invalid or duplicate notes.");
      ids.add(row.id);
      // Keep an explicit private-export allowlist even if an upstream result
      // unexpectedly includes additional columns.
      notes.push({
        id: row.id,
        location_id: row.location_id,
        note: row.note,
        created_at: row.created_at,
      });
    }
    if (notes.length === total) return notes;
    if (!data.length) throw new Error("Export ended before its count.");
  }
  throw new Error("Export exceeded its bounded request budget.");
}

export async function exportNotes(client, userId) {
  const signal = AbortSignal.timeout(15000);
  const first = await readNotes(client, userId, signal);
  const second = await readNotes(client, userId, signal);
  if (JSON.stringify(first) !== JSON.stringify(second))
    throw new Error("Export changed between complete reads.");
  return second;
}
