import { createHash } from "node:crypto";

// Verification is an explicit reviewer action, never a build-time source fetch.
// The destination is fixed, sends no credentials, rejects redirects and bounds
// the complete streamed response. Reports cannot supply a fetch URL.
const origin = "https://www.realworldneeds.org";
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export class CorrectionPublicationError extends Error {
  constructor(status = 503) { super("Public release verification could not be completed."); this.status = status; }
}

export async function verifyCorrectionPublication(report, { fetchImpl = globalThis.fetch, timeout = 12000 } = {}) {
  if (!report || !["applied", "resolved"].includes(report.status) || !report.appliedRecord || report.appliedRecord.id !== report.resourceId)
    throw new CorrectionPublicationError(409);
  const controller = new AbortController();
  let timer;
  const read = async (path, maxBytes) => {
    const response = await fetchImpl(`${origin}${path}`, { redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (response.status !== 200 || !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") || "") || Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel(); throw new CorrectionPublicationError();
    }
    const reader = response.body?.getReader();
    if (!reader) throw new CorrectionPublicationError();
    const chunks = []; let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > maxBytes) { await reader.cancel(); throw new CorrectionPublicationError(); }
        chunks.push(part.value);
      }
      return Buffer.concat(chunks);
    } finally { reader.releaseLock(); }
  };
  try {
    return await Promise.race([
      (async () => {
        const before = JSON.parse((await read("/data/release.json", 64000)).toString("utf8"));
        const catalogBytes = await read("/data/resources.json", 8000000);
        const after = JSON.parse((await read("/data/release.json", 64000)).toString("utf8"));
        // The catalog and no-store manifest may come from different cache
        // generations. Bind the exact bytes before parsing or trusting facts.
        // This is unsigned release integrity evidence, not an attestation.
        if (!/^[0-9a-f]{12}$/.test(before?.release || "") || !equal(before, after)
          || !/^[0-9a-f]{64}$/.test(before?.catalogSha256 || "")
          || createHash("sha256").update(catalogBytes).digest("hex") !== before.catalogSha256)
          throw new CorrectionPublicationError(409);
        const catalog = JSON.parse(catalogBytes.toString("utf8"));
        if (!Array.isArray(catalog.resources)
          || catalog.resources.length > 50000 || catalog.resourceCount !== catalog.resources.length || before.resourceCount !== catalog.resources.length
          || new Set(catalog.resources.map(record => record.id)).size !== catalog.resources.length)
          throw new CorrectionPublicationError(409);
        const record = catalog.resources.find(item => item.id === report.resourceId);
        if (!record || !equal(record, report.appliedRecord)) throw new CorrectionPublicationError(409);
        return { record, release: before.release };
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new CorrectionPublicationError()); }, timeout); }),
    ]);
  } catch (error) {
    throw error instanceof CorrectionPublicationError ? error : new CorrectionPublicationError();
  } finally { clearTimeout(timer); }
}
