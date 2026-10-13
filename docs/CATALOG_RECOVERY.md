# Catalog loading recovery

Reviewed against `647f1be7992304b72ab73a5a79c7f355019fe45a` on 2026-10-13.

## Visitor behavior

- Directory and Saved share a readable loader implementation, bundled separately into each self-contained offline entry.
- An eight-second deadline covers both response headers and JSON parsing. Aborting transport and racing an explicit rejection prevents an uncooperative request from keeping the UI in Loading forever.
- Concurrent consumers and repeated Retry activations share one request. Failures clear that promise. Network transitions replace unfinished requests; a successful versioned offline snapshot remains usable.
- Search exposes Retry search while retaining filters and static browsing. A focused Retry remains visible while busy; success moves its focus to search (or the Saved heading). Deliberately moved focus is never reclaimed.
- Clear, Back, newer searches, and worker replacement invalidate stale presentation. Loading never removes Saved IDs, including IDs absent from the latest catalog.

## Worker ordering and offline safety

The active service worker previously read response bodies inside its serialized cache-write queue. One stalled body could block every healthy retry behind it.

The worker now reads a complete response outside that queue, with a six-second whole-network/body deadline. That leaves time for an allowed offline fallback before the page's eight-second limit. Timeout aborts the fetch, cancels the reader, releases its lock, and clears the timer. Late headers are canceled. Only complete, parseable JSON with records and scopes can enter the write queue.

The generation is checked before enqueueing and immediately before the actual write. Actual CacheStorage writes remain serialized: an old body or superseded queued response cannot overwrite newer withdrawn-record data. Explicit reloads after worker replacement still never fall back to old catalog data. Existing release, immutable-asset and rollback rules are unchanged.

Residual limitation: CacheStorage itself offers no cancellation for an already-started write. An indefinitely stalled storage API can still block subsequent cache writes. The page reaches its finite failure state, but this change deliberately does not let an uncancellable old write later overwrite a newer catalog.

## Payload decision

The directory's raw shipped-JavaScript ceiling is explicitly increased from 15,000 to 16,000 bytes for this recovery work. Other source, feature, corpus, and static-scale budgets are unchanged.

| Shipped entry | Main baseline raw / gzip | Recovery raw / gzip | Increase raw / gzip |
| --- | ---: | ---: | ---: |
| Directory | 14,914 / 6,348 | 15,564 / 6,583 | 650 / 235 |
| Saved | 8,929 / 3,499 | 9,547 / 3,741 | 618 / 242 |

The first combined implementation measured 15,578 raw / 6,590 gzip; replacing a promise chain with ordinary async code reduced it slightly. Further Terser passes did not save bytes. Keeping readable shared source and self-contained offline entries avoids fragile source golfing, unsafe compiler transformations, and an extra runtime dependency during offline upgrades. The final directory has 436 bytes of headroom under the new ceiling; future increases need another explicit review.

## Verification

- Immutable-baseline tests reproduce hung headers and hung JSON on both page entries, plus the active-worker stalled-body write-queue defect.
- Fake-clock and native-stream tests cover whole-request deadlines, repeated retry, rejection, malformed/truncated bodies, cleanup, late responses, release replacement, withdrawn-record ordering, valid offline fallback and explicit-reload refusal.
- Entry/DOM tests preserve Saved IDs, country/category/query intersections, static browsing, Clear/Back, startup/history restoration, and keyboard focus.
- CI adds four native browser cases against a clearly labeled, isolated synthetic server: Directory and Saved, each with stalled headers and body bytes. They use the actual active service worker and unchanged deadlines, then recover through native mouse/keyboard Retry. The server withholds success while coalescing and focused busy state are checked.
- Browser coverage is a release gate. Node checks alone do not establish that the four rendered cases passed; consult the exact-commit Quality run and its `catalog-recovery.json`/screenshots before merging.

No live listings, public data exports, database records, credentials, security settings, or real-service availability are changed.
