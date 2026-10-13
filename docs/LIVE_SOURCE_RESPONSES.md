# USDA live-response boundaries

The live USDA helpers preserve the existing endpoint, active-on-search-day SQL,
one-decimal location rounding, 160 km radius, field list and result limit. They
make no additional pagination or source requests. The reviewed static catalog
and its cache policy are unchanged.

## Request lifetime and source health

- Each attempt has one seven-second deadline covering fetch headers, JSON body
  completion and payload validation. There are at most three attempts, separated
  by the existing 250 ms and 750 ms delays: 22 seconds total, plus event-loop
  scheduling. A blocked JavaScript event loop cannot be preempted by a timer.
- Deadline or caller cancellation aborts the transport and settles the helper even
  if a supplied fetch/body promise ignores its signal. Late promises remain
  handled but cannot win the result. Successful, failed, timed-out and canceled
  paths remove the timer and caller listener. Backoff is also abortable.
- HTTP/ArcGIS 408, 425, 429 and 5xx responses retain their transient retries;
  network/body transport failures and deadlines also retry. Nonretryable status
  errors, including 400/403/404, stop immediately. Malformed JSON, invalid
  envelopes and semantic validation failures stop immediately without retry.
- Source success is recorded only after validation. A terminal logical request
  increments the existing shared circuit once, regardless of its attempts.
  Valid zero/empty results reset it like other valid successes. Caller
  cancellation and late completion after cancellation/timeout do not change it.
  The shared three-failure/60-second circuit scope is unchanged.

## Payload policy

- National count must be a numeric safe nonnegative integer, including zero.
  No numeric-string compatibility contract is assumed. Null, missing, strings,
  booleans, containers, nonfinite, negative, fractional and unsafe values fail.
- The top-level response must be an object. An ArcGIS error must contain a
  numeric integer code before status-based retry policy can be used. Nearby
  success requires an explicit features array. Only a valid empty array can
  establish an empty result set.
- A true or malformed `exceededTransferLimit` flag makes nearby information
  unavailable. Missing or false is compatible. Pagination and partial-result
  presentation are separate work, not silently inferred here.
- Feature coordinates must already be finite numbers in world bounds. Real zero
  remains valid; null/blank/boolean/string coordinates are not converted to zero.
- Existing optional source dates use numeric Unix milliseconds. Missing/null
  timestamps stay unknown; supplied malformed or unrepresentable timestamps and
  reversed windows exclude the record. Full representable ISO calendar dates are
  preserved, including expanded years. The helper does not substitute an audit
  date, retrieval date or epoch for an unknown date, or change the server's
  active-on-search-day selection semantics.
- Mixed lists retain usable records and exclude malformed individual records, as
  the mapper already intended. A nonempty list with no usable records is
  unavailable, never authoritative zero. Valid identities and IDs retain their
  existing format; duplicate/colliding mapped IDs make the whole nearby result
  unavailable instead of silently confusing selection and ranking.

## Evidence and limits

`tests/live-source-lifecycle.test.js` uses source-exact VM helpers, fake timers,
synthetic payloads and the actual app loader/Clear functions. It covers bounded
headers/body stalls, late results, immediate cancellation in each phase, retry
policy, listener/timer cleanup, strict parsing, source-health accounting,
independent outcomes and interrupted/replacement searches. Existing count
presentation, country containment and location-interruption suites still apply.

`qa-live-source-counts.mjs` extends the existing CI browser verifier using real
Response/ReadableStream bodies, the full unchanged world maps, fixed fictional
locations and existing trusted keyboard controls. It covers malformed count,
truncated nearby results, pending-header/body Clear and replacement, and one
full three-attempt body timeout with recovery. The timeout case runs only at
desktop width to avoid multiplying the 22-second delay; semantic/interruption
cases also run at narrow width. Fixture state is temporary, and source requests
never reach the live endpoint. CI must pass for the exact release head; Node
fixtures alone are not browser-release evidence or screen-reader evidence.
