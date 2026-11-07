import assert from "node:assert/strict";
import test from "node:test";
import { initCorrectionReview } from "../public/correction-review.js";
import { documentFixture, walk, flush, deferred } from "./helpers/correction-dom.js";
const id = "c09386bc-02cd-49ab-b3f4-5273511262bd";
const report = { id, resourceId: "bowery-mission", listingName: "The Bowery Mission", category: "wrong-address", note: "Check the entrance.", status: "open", priority: "urgent", assignedTo: null, revision: 1, createdAt: "2026-11-06T12:00:00Z" };
const queue = records => ({ data: { reports: records, page: 0, hasMore: false } });
const detail = value => ({ data: { report: value, events: [] } });
function fixture(request) {
  const f = documentFixture(); f.root.hidden = true;
  initCorrectionReview(f.root, { request });
  return { ...f, button: label => walk(f.root).find(node => node.tagName === "BUTTON" && node.textContent === label), field: name => walk(f.root).find(node => node.name === name), form: () => walk(f.root).find(node => node.tagName === "FORM") };
}
for (const status of [401, 403]) test(`review queue denies status ${status} without rendering report data`, async () => {
  const f = fixture(async () => { throw { status }; }); await flush();
  assert.equal(f.root.textContent.includes("The Bowery Mission"), false);
  if (status === 403) assert.equal(f.root.hidden, true);
  else assert.match(f.root.textContent, /session has ended/);
});
test("queue unavailable is retryable and all review requests require same-origin credentials", async () => {
  const calls = [];
  const f = fixture(async (path, options) => { calls.push(options); if (calls.length === 1) throw { status: 503 }; return queue([]); });
  await flush(); assert.match(f.root.textContent, /queue is unavailable/); assert.equal(f.root.hidden, false);
  await f.button("Refresh correction queue").dispatch("click");
  assert.match(f.root.textContent, /No correction reports/); assert.ok(calls.every(options => options.privateRequest));
});
test("untrusted report text stays literal and unsafe history URLs never become links", async () => {
  const payload = '<img src=x onerror="throw 1">';
  const f = fixture(async path => path.includes("?id=") ? { data: { report: { ...report, note: payload }, events: [{ status: "rejected", reason: payload, evidenceUrl: "https://user:pass@example.org", createdAt: "today" }] } } : queue([{ ...report, listingName: payload }]));
  await flush(); await f.button("Review correction").dispatch("click");
  assert.match(f.root.textContent, /<img src=x/);
  assert.equal(walk(f.root).filter(node => node.tagName === "IMG").length, 0);
  assert.equal(walk(f.root).filter(node => node.href?.includes("user:pass")).length, 0);
});
test("source-backed decision requires evidence, coalesces requests, and confirms review without publication", async () => {
  const pending = deferred(), patches = [];
  const f = fixture(async (path, options) => {
    if (options.method === "PATCH") { patches.push(options.body); return pending.promise; }
    return path.includes("?id=") ? detail(report) : queue([report]);
  });
  await flush(); await f.button("Review correction").dispatch("click");
  f.field("status").value = "ready"; f.field("reason").value = "Checked the official provider intake page.";
  await f.form().dispatch("submit"); assert.equal(patches.length, 0); assert.equal(f.document.activeElement, f.field("evidenceUrl"));
  f.field("evidenceUrl").value = "https://www.bowery.org/get-help/";
  const save = f.form().dispatch("submit"); await f.form().dispatch("submit"); assert.equal(patches.length, 1);
  assert.equal(patches[0].revision, 1); assert.equal(patches[0].assignment, "keep");
  pending.resolve(detail({ ...report, revision: 2, status: "ready" })); await save;
  assert.match(f.root.textContent, /No public listing was changed or published/);
  assert.match(f.root.textContent, /Ready for catalog review/); assert.equal(f.field("reason").value, "");
});
test("revision conflict retains draft and cannot overwrite until explicit reload and another save", async () => {
  let revision = 1, patches = 0;
  const f = fixture(async (path, options) => {
    if (options.method === "PATCH") { patches++; if (patches === 1) { revision = 2; throw { status: 409 }; } return detail({ ...report, revision: 3 }); }
    return path.includes("?id=") ? detail({ ...report, revision }) : queue([report]);
  });
  await flush(); await f.button("Review correction").dispatch("click");
  f.field("reason").value = "Need to verify the current source.";
  await f.form().dispatch("submit"); await f.form().dispatch("submit");
  assert.equal(patches, 1); assert.match(f.root.textContent, /Another reviewer changed/);
  await f.button("Reload report and keep my draft").dispatch("click");
  assert.equal(f.field("reason").value, "Need to verify the current source."); assert.equal(patches, 1);
  await f.form().dispatch("submit"); assert.equal(patches, 2);
});
test("role revocation clears private rows and supersedes a delayed report response", async () => {
  const old = deferred(); let requests = 0;
  const f = fixture(async path => {
    if (path.includes("?id=")) return old.promise;
    if (++requests === 1) return queue([report]);
    throw { status: 403 };
  });
  await flush(); const inspect = f.button("Review correction").dispatch("click");
  await f.button("Refresh correction queue").dispatch("click");
  old.resolve(detail(report)); await inspect;
  assert.equal(f.root.hidden, true); assert.equal(f.root.textContent.includes(report.listingName), false);
});
test("a changed status filter during a pending load triggers the requested queue after completion", async () => {
  const old = deferred(), paths = [];
  const f = fixture(async path => { paths.push(path); return paths.length === 1 ? old.promise : queue([]); });
  const filter = walk(f.root).find(node => node.tagName === "SELECT"); filter.value = "ready"; await filter.dispatch("change");
  old.resolve(queue([report])); await flush();
  assert.equal(paths.length, 2); assert.match(paths[1], /status=ready$/); assert.match(f.root.textContent, /No correction reports/);
});

test('switching review language preserves controls, draft and literal provider text', async () => {
  const { setLocale } = await import('../src/utils/localization.js');
  const { translateCorrections } = await import('../public/correction-localization.js');
  const f = fixture(async path => path.includes('?id=') ? detail({ ...report, note: 'Open' }) : queue([report]));
  await flush(); await f.button('Review correction').dispatch('click');
  const reason = f.field('reason'); reason.value = 'Unsaved independent source findings.';
  try {
    setLocale('es'); translateCorrections(f.root);
    assert.equal(f.field('reason'), reason, 'language switching must not remove a nested label control');
    assert.equal(reason.value, 'Unsaved independent source findings.');
    assert.match(f.root.textContent, /Guardar decisión/);
    assert.match(walk(f.root).find(node => node.tagName === "BUTTON" && node.textContent === "Revisar corrección").getAttribute("aria-label"), /^Revisar corrección de /);
    assert.ok(walk(f.root).some(node => node.tagName === 'P' && node.textContent === 'Open'), 'submitted text must retain its original language');
  } finally { setLocale('en'); }
});
