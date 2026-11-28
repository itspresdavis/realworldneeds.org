// Shared by the static build budget and correction publication verifier.
// This bounds decoded bytes, including streamed responses without Content-Length.
// Raise only after reviewing export size, verification memory and timeout costs.
export const MAX_PUBLISHED_CATALOG_BYTES = 16_000_000;
