export class CorrectionRequestError extends Error {
  constructor(status = 0, retryAfter = 0) {
    super("Correction request could not finish.");
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// Bound headers and body parsing; do not expose response text or private errors.
export async function correctionRequest(path, { body, method, privateRequest = false, fetchImpl = globalThis.fetch, timeout = 16000 } = {}) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(path, {
          method: method || (body ? "POST" : "GET"),
          credentials: privateRequest ? "same-origin" : "omit",
          cache: "no-store",
          headers: body ? { "Content-Type": "application/json" } : {},
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new CorrectionRequestError(response.status, Math.min(3600, Math.max(0, Number(response.headers?.get("Retry-After")) || 0)));
        }
        const data = await response.json();
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new CorrectionRequestError();
        return { status: response.status, data };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new CorrectionRequestError());
        }, timeout);
      }),
    ]);
  } catch (error) {
    throw error instanceof CorrectionRequestError ? error : new CorrectionRequestError();
  } finally {
    clearTimeout(timer);
  }
}
