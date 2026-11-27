import assert from "node:assert/strict";
import test from "node:test";
import { initCorrectionForm } from "../public/corrections.js";
import { CORRECTION_CATEGORIES } from "../public/correction-contract.js";
import { correctionRequest } from "../public/correction-request.js";
import { publicFixture, flush, deferred } from "./helpers/correction-dom.js";

const uuid = "c09386bc-02cd-49ab-b3f4-5273511262bd";
function fixture(request, search = "?resourceId=bowery-mission&query=private-search&note=private-context") {
  const f = publicFixture();
  initCorrectionForm(f.root, { request, location: { search }, crypto: { randomUUID: () => uuid } });
  return f;
}
for (const enabled of [false, undefined, "true", 1]) test(`public form fails closed for capability ${JSON.stringify(enabled)}`, async () => {
  const calls = [];
  const f = fixture(async (...args) => { calls.push(args); return { data: { enabled } }; });
  await flush();
  assert.equal(f.get("form").hidden, true); assert.equal(f.get("fields").disabled, true);
  await f.get("form").dispatch("submit"); assert.equal(calls.length, 1);
  assert.match(f.get("availability").textContent, /not available yet/);
});
for (const id of ["", "?resourceId=%3Cscript%3E", `?resourceId=${"a".repeat(161)}`]) test(`invalid listing context ${id.slice(0, 30)} makes no request`, async () => {
  const f = fixture(() => { throw new Error("Unexpected request"); }, id); await flush();
  assert.equal(f.get("form").hidden, true); assert.match(f.get("availability").textContent, /Choose a service listing/);
});
test("availability failure offers an intentional retry and prefills only listing identity", async () => {
  let attempts = 0;
  const f = fixture(async () => { if (++attempts === 1) throw new Error(); return { data: { enabled: true } }; });
  await flush(); assert.equal(f.get("retry").hidden, false); assert.equal(f.get("form").hidden, true);
  f.get("retry").focus();
  await f.get("retry").dispatch("click");
  assert.equal(f.document.activeElement, f.get("category"), "revealing the form must preserve a useful keyboard focus target");
  assert.equal(f.get("form").hidden, false); assert.equal(f.get("note").value, "");
  assert.equal(f.get("listing-id").textContent, "bowery-mission");
  assert.equal(f.get("listing-link").href, "/service/bowery-mission");
  assert.deepEqual(f.get("category").children.map(option => option.value), CORRECTION_CATEGORIES.filter(item => item.value !== "accessibility").map(item => item.value));
});
test("failed storage and duplicate clicks preserve payload identity until a confirmed durable receipt", async () => {
  const pending = deferred(), calls = [];
  const f = fixture(async (path, options) => {
    if (!options) return { data: { enabled: true } };
    calls.push(options.body); return calls.length === 1 ? pending.promise : { status: 201, data: { ok: true } };
  });
  await flush(); f.get("category").value = "wrong-address"; f.get("note").value = "Check the public entrance.";
  const first = f.get("form").dispatch("submit"); await f.get("form").dispatch("submit");
  assert.equal(calls.length, 1); assert.equal(f.get("fields").disabled, true);
  pending.reject({ status: 503 }); await first;
  assert.match(f.get("status").textContent, /could not confirm/); assert.equal(f.get("note").value, "Check the public entrance.");
  await f.get("form").dispatch("submit");
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["category", "note", "resourceId", "submissionId"]);
  assert.equal(calls[0].submissionId, uuid); assert.equal(f.get("note").value, "");
  assert.match(f.get("status").textContent, /saved for review.*not changed/);
  assert.equal(f.document.activeElement, f.get("status"));
});
for (const response of [{ status: 200, data: { ok: true } }, { status: 201, data: { ok: false } }]) test("ambiguous successful HTTP response never claims a saved report", async () => {
  const f = fixture(async (path, options) => options ? response : { data: { enabled: true } });
  await flush(); f.get("category").value = "closed-service"; await f.get("form").dispatch("submit");
  assert.match(f.get("status").textContent, /could not confirm/); assert.equal(f.get("submit").hidden, false);
});
test("unknown category and oversized note are rejected before transport with focused controls", async () => {
  let submitted = 0;
  const f = fixture(async (path, options) => { if (options) submitted++; return { data: { enabled: true } }; });
  await flush(); f.get("category").value = "other"; await f.get("form").dispatch("submit");
  assert.equal(f.document.activeElement, f.get("category"));
  f.get("category").value = "wrong-hours"; f.get("note").value = "x".repeat(1001); await f.get("form").dispatch("submit");
  assert.equal(f.document.activeElement, f.get("note")); assert.equal(submitted, 0);
});
test("rate-limited reply keeps the draft and gives a bounded retry instruction", async () => {
  const f = fixture(async (path, options) => { if (options) throw { status: 429, retryAfter: 60 }; return { data: { enabled: true } }; });
  await flush(); f.get("category").value = "broken-source"; f.get("note").value = "Official page unavailable.";
  await f.get("form").dispatch("submit");
  assert.match(f.get("status").textContent, /60 seconds/); assert.equal(f.get("note").value, "Official page unavailable.");
});
test("public transport omits cookies, private transport uses same-origin, and neither caches responses", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => { calls.push(options); return new Response('{"ok":true}', { status: 201 }); };
  await correctionRequest("/api/corrections", { body: { note: "fixture" }, fetchImpl });
  await correctionRequest("/api/correction-review", { privateRequest: true, fetchImpl });
  assert.equal(calls[0].credentials, "omit"); assert.equal(calls[1].credentials, "same-origin");
  assert.ok(calls.every(call => call.cache === "no-store"));
});
for (const stage of ["headers", "body"]) test(`transport bounds stalled ${stage} and aborts`, async () => {
  let signal;
  await assert.rejects(correctionRequest("/api/corrections", { timeout: 5, fetchImpl: async (_, options) => {
    signal = options.signal;
    return stage === "headers" ? new Promise(() => {}) : { ok: true, status: 201, json: () => new Promise(() => {}) };
  } }));
  assert.equal(signal.aborted, true);
});

test('service context and optional private details survive a failed retry and clear only after confirmation', async () => {
  const calls = []; let attempt = 0;
  const f = fixture(async (path, options) => {
    if (!options) return { data: { enabled: true, context: { name: 'Source-backed listing', services: [{ id: 'meals', label: 'Meal service' }] } } };
    calls.push(options.body); if (++attempt === 1) throw { status: 503 }; return { status: 201, data: { ok: true } };
  }, '?resourceId=bowery-mission&serviceId=meals&replyContact=not-prefilled@example.invalid');
  await flush(); assert.equal(f.get('service').value, 'meals'); assert.equal(f.get('reply').value, '');
  f.get('category').value = 'wrong-hours'; f.get('proposal').value = 'Check the afternoon session.'; f.get('source').value = 'https://www.bowery.org/get-help/'; f.get('reply').value = 'synthetic@example.invalid';
  await f.get('form').dispatch('submit'); assert.equal(f.get('reply').value, 'synthetic@example.invalid');
  await f.get('form').dispatch('submit'); assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0].serviceId, 'meals'); assert.equal(f.get('reply').value, '');
});
test('website accessibility has its own bounded context and truthful unavailable state', async () => {
  const f = fixture(async () => ({ data: { enabled: false } }), '?resourceId=rwn-website'); await flush();
  assert.deepEqual(f.get('category').children.map(node => node.value), ['accessibility']);
  assert.equal(f.get('listing-link').href, '/accessibility'); assert.match(f.get('availability').textContent, /monitored review channel has not been confirmed/);
});
