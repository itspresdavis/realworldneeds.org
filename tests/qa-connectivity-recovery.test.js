import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { phoneLinks } from "../src/utils/phone.js";
import { SAVED_RESOURCES_KEY } from "../src/utils/privacy.js";
import { contactFixtureResources as resources } from "../scripts/qa-contact-fixture-app.mjs";
import { directoryStartupClickPoint, directoryStartupClickWasDelivered } from "../scripts/qa-directory-startup.mjs";
import {
  connectivityRecoveryContext, assertConnectivityFailure, assertConnectivityRetained,
  assertConnectivityRecovered, assertConnectivityFocusReleased, pressConnectivityRecoveryKey,
  settleConnectivityFocus, observeConnectivityPointer
} from "../scripts/qa-connectivity-recovery.mjs";

const failureState = () => ({
  offline: true, overflow: 0, navigatorOnline: true, networkState: "offline", noticeVisible: true,
  href: "http://127.0.0.1:12345/directory#saved", timeOrigin: 123, historyLength: 3,
  query: "Synthetic QA", countryControlPresent: true, country: "United States", help: "Food", activeHelp: "Food",
  savedStorage: JSON.stringify(resources.map(resource => resource.id).reverse()),
  status: "Could not reach RWN. Check your connection and try again.",
  retry: { tag: "BUTTON", type: "button", text: "Retry connection", visible: true, disabled: false, ariaDisabled: "false" },
  focus: { connected: true, visible: true, inViewport: true, hit: true, inNotice: true, retry: false, body: false },
  events: { online: 0, clicks: [], checking: [] },
  rows: [...resources].reverse().map(resource => ({
    id: resource.id, text: `${resource.name} Phone or online help`, visible: true, clipped: false,
    facts: [resource.coverageNote, resource.eligibility, resource.phoneAccess, resource.accessUrl].filter(Boolean).map(text => ({ text, visible: true, fontSize: 14 })),
    actions: [
      ...phoneLinks(resource.phone).map(phone => ({ href: phone.href, text: `Call ${phone.label}`, visible: true, height: 44 })),
      ...(resource.accessUrl ? [{ href: resource.accessUrl, text: "Contact website", visible: false, height: 44 }] : []),
      ...(resource.kind === "direct" ? [
        { href: "https://maps.apple.com/?daddr=42,-71", text: "Apple Maps", visible: false, height: 44 },
        { href: "https://www.google.com/maps/dir/?destination=42,-71", text: "Google Maps", visible: false, height: 44 }
      ] : []),
      { href: `/service/${resource.id}`, text: "View details", visible: false, height: 44 }
    ],
    warning: resource.collectionStatus ? `${resource.collectionStatus} ${resource.collectionStatusCheckedOn}` : undefined,
    warningVisible: Boolean(resource.collectionStatus)
  }))
});

const recoveredState = before => ({
  ...structuredClone(before), offline: false, networkState: "online",
  status: "Connection restored. Listing details and online links are available.",
  focus: { connected: true, visible: true, inViewport: true, hit: true, inNotice: true, retry: true, body: false },
  events: { online: 0, clicks: [{ trusted: true, detail: 0 }], checking: [{ ariaDisabled: "true", oldAriaDisabled: "false", status: "Checking connection…" }] },
  rows: before.rows.map(row => ({ ...structuredClone(row), actions: row.actions.map(action => ({ ...action, visible: true })) }))
});

test("failed-probe baseline requires usable retry, native online state and focused notice", () => {
  const before = failureState();
  assertConnectivityFailure(before, resources);
  for (const change of [
    { navigatorOnline: false }, { networkState: "online" }, { noticeVisible: false }, { status: "" },
    { retry: { ...before.retry, tag: "A" } }, { retry: { ...before.retry, type: "submit" } },
    { retry: { ...before.retry, visible: false } }, { retry: { ...before.retry, disabled: true } },
    { retry: { ...before.retry, ariaDisabled: "true" } },
    { focus: { ...before.focus, inNotice: false } }, { focus: { ...before.focus, connected: false } },
    { events: { ...before.events, online: 1 } }, { events: { ...before.events, clicks: [{ trusted: false }] } }
  ]) assert.throws(() => assertConnectivityFailure({ ...before, ...change }, resources));
});

test("recovery assertions reject the original hidden-action defect and synthetic online workarounds", () => {
  const before = failureState();
  const after = recoveredState(before);
  assertConnectivityRecovered(before, after, resources);
  for (const change of [
    { offline: true }, { networkState: "offline" }, { navigatorOnline: false },
    { events: { ...after.events, online: 1 } }, { events: { ...after.events, clicks: [{ trusted: false }] } },
    { events: { ...after.events, clicks: [] } }, { events: { ...after.events, clicks: [{ trusted: true }, { trusted: true }] } },
    { events: { ...after.events, checking: [] } }, { status: "Checking connection…" },
    { retry: { ...after.retry, ariaDisabled: "true" } }, { retry: { ...after.retry, disabled: true } },
    { noticeVisible: false }, { focus: { ...after.focus, visible: false } },
    { focus: { ...after.focus, inViewport: false } }, { focus: { ...after.focus, hit: false } },
    { focus: { ...after.focus, retry: false } }, { focus: { ...after.focus, connected: false } },
    { focus: { ...after.focus, body: true } }
  ]) assert.throws(() => assertConnectivityRecovered(before, { ...after, ...change }, resources));
  for (const text of ["View details", "Apple Maps", "Google Maps", "Contact website", "Call 211"]) {
    const broken = structuredClone(after);
    for (const row of broken.rows) for (const action of row.actions) if (action.text === text) action.visible = false;
    assert.throws(() => assertConnectivityRecovered(before, broken, resources), text);
  }
  const changedPhone = structuredClone(after);
  changedPhone.rows.find(row => row.id === "qa-contact-phone").actions[0].href = "tel:+1211";
  assert.throws(() => assertConnectivityRecovered(before, changedPhone, resources), /phone action/);
});

test("retry preserves document, URL, history, filters, Saved IDs, ordered rows and source warnings", () => {
  const before = failureState();
  const after = recoveredState(before);
  assertConnectivityRetained(before, after);
  for (const field of ["href", "timeOrigin", "historyLength", "query", "countryControlPresent", "country", "help", "activeHelp", "savedStorage"]) {
    assert.throws(() => assertConnectivityRetained(before, { ...after, [field]: "changed" }), /changed the search\/Saved state/, field);
  }
  assert.throws(() => assertConnectivityRetained(before, { ...after, rows: [...after.rows].reverse() }), /order or membership/);
  assert.throws(() => assertConnectivityRetained(before, { ...after, rows: after.rows.slice(1) }), /order or membership/);
  const changedDestination = structuredClone(after);
  changedDestination.rows[0].actions.find(action => action.text === "Apple Maps").href = "https://maps.apple.com/?daddr=0,0";
  assert.throws(() => assertConnectivityRetained(before, changedDestination), /action destination or label/);
  const changedWarning = structuredClone(after);
  changedWarning.rows.find(row => row.warning).warning = "Current availability verified";
  assert.throws(() => assertConnectivityRetained(before, changedWarning), /availability warning/);
  const hiddenWarning = structuredClone(after);
  hiddenWarning.rows.find(row => row.warning).warningVisible = false;
  assert.throws(() => assertConnectivityRetained(before, hiddenWarning), /availability warning/);
});

test("notice is dismissed only after visible focus leaves it", () => {
  const before = failureState();
  const released = { ...recoveredState(before), noticeVisible: false, focus: { connected: true, visible: true, inNotice: false, retry: false, body: false } };
  assertConnectivityFocusReleased(before, released);
  for (const change of [
    { noticeVisible: true }, { networkState: "offline" },
    { focus: { ...released.focus, inNotice: true } }, { focus: { ...released.focus, connected: false } },
    { focus: { ...released.focus, visible: false } }, { focus: { ...released.focus, body: true } },
    { events: { ...released.events, online: 1 } }
  ]) assert.throws(() => assertConnectivityFocusReleased(before, { ...released, ...change }));
});

test("serialized recovery snapshot reports actual focus, controls and saved storage", () => {
  let top = 20, covered = false;
  const box = () => ({ x: 20, y: top, left: 20, top, right: 200, bottom: top + 44, width: 180, height: 44 });
  const retry = { tagName: "BUTTON", type: "button", textContent: "Retry connection", isConnected: true, disabled: false, getBoundingClientRect: box, getAttribute: () => "false" };
  const status = { textContent: "Connection restored." };
  const notice = { dataset: { networkState: "online" }, isConnected: true, getBoundingClientRect: box, contains: node => node === retry, querySelector: selector => selector === "[data-directory-reconnect]" ? retry : status };
  const controls = {
    "[data-directory-query]": { value: "Synthetic QA" }, "[data-directory-country]": { value: "United States" },
    "[data-directory-need]": { value: "Food" }, '[data-directory-category][aria-pressed="true"]': { dataset: { directoryCategory: "Food" } }
  };
  const context = {
    document: { activeElement: retry, body: {}, getElementById: () => notice, querySelector: selector => controls[selector], elementFromPoint: () => covered ? {} : retry },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    innerWidth: 390, innerHeight: 844,
    location: { href: "http://127.0.0.1:12345/directory" }, performance: { timeOrigin: 234 }, history: { length: 4 }, navigator: { onLine: true },
    localStorage: { getItem: key => key === SAVED_RESOURCES_KEY ? '["qa-contact-phone"]' : null },
    __rwnConnectivityRecoveryQA: { online: 0, clicks: [{ trusted: true, detail: 0 }], checking: [{ ariaDisabled: "true" }], keyboard: [{ type: "keypress", key: "Enter", trusted: true, defaultPrevented: false }] }
  };
  const run = () => vm.runInNewContext(`(${connectivityRecoveryContext})(${JSON.stringify(SAVED_RESOURCES_KEY)})`, context);
  const state = run();
  assert.equal(state.focus.retry, true);
  assert.equal(state.focus.inNotice, true);
  assert.equal(state.focus.visible, true);
  assert.equal(state.focus.inViewport, true);
  assert.equal(state.focus.hit, true);
  assert.equal(state.retry.visible, true);
  assert.equal(state.savedStorage, '["qa-contact-phone"]');
  assert.equal(state.help, "Food");
  assert.equal(state.countryControlPresent, true);
  assert.equal(state.country, "United States");
  assert.equal(state.events.clicks[0].trusted, true);
  assert.equal(state.events.keyboard[0].type, "keypress");
  assert.equal(state.events.keyboard[0].trusted, true);
  covered = true;
  retry.contains = () => false;
  assert.equal(run().focus.hit, false);
  covered = false;
  top = -100;
  assert.equal(run().focus.visible, true);
  assert.equal(run().focus.inViewport, false);
  assert.equal(run().focus.hit, false);
  top = 20;
  delete controls["[data-directory-country]"];
  assert.equal(run().countryControlPresent, false);
  assert.equal(run().country, null);
  retry.isConnected = false;
  assert.equal(run().focus.connected, false);
  assert.equal(run().focus.visible, false);
  assert.equal(run().retry.visible, false);
});

test("repeated same-document recovery keeps cumulative exact trusted activation counts", () => {
  const before = failureState();
  const failed = { ...failureState(), events: { online: 0, clicks: [{ trusted: true }, { trusted: true }], checking: [] } };
  assertConnectivityFailure(failed, resources, { expectedClicks: 2 });
  assert.throws(() => assertConnectivityFailure(failed, resources), /retry count/);
  const recovered = recoveredState(before);
  recovered.events.clicks = [{ trusted: true }, { trusted: true }, { trusted: true }];
  assertConnectivityRecovered(before, recovered, resources, { expectedClicks: 3 });
  assert.throws(() => assertConnectivityRecovered(before, recovered, resources), /exact expected/);
  recovered.events.clicks[1].trusted = false;
  assert.throws(() => assertConnectivityRecovered(before, recovered, resources, { expectedClicks: 3 }), /exact expected/);
});

test("focus settling waits through native scrolling without moving or repairing focus", async () => {
  let frame = 0, top = 10;
  const positions = [100, 230, 240, 240, 240];
  const focus = { getBoundingClientRect: () => ({ x: 20, y: top, width: 180, height: 44 }) };
  const context = {
    scrollX: 0, scrollY: 0,
    document: { activeElement: focus, getElementById: () => ({ hidden: false }) },
    requestAnimationFrame: callback => { top = positions[Math.min(frame++, positions.length - 1)]; queueMicrotask(callback); }
  };
  const settled = await vm.runInNewContext(`(${settleConnectivityFocus})()`, context);
  assert.equal(frame, 5);
  assert.equal(settled.rect[1], 240);
  frame = 0;
  context.requestAnimationFrame = callback => { top = ++frame; queueMicrotask(callback); };
  await assert.rejects(() => vm.runInNewContext(`(${settleConnectivityFocus})()`, context), /did not settle/);
  assert.equal(frame, 120);
});

test("pointer evidence captures trusted targets before interception and final cancellation before navigation", () => {
  const listeners = new Map(), timers = [], reports = [];
  const target = { tagName: "A", textContent: "View details", contains: () => false, closest: () => target, getAttribute: () => "/service/qa-physical-3" };
  const context = {
    location: { origin: "http://127.0.0.1:12345", href: "http://127.0.0.1:12345/directory#saved" }, scrollX: 0, scrollY: 200,
    document: { querySelector: () => target },
    window: { addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: type => listeners.delete(type) },
    setTimeout: callback => timers.push(callback), report: value => reports.push(JSON.parse(value))
  };
  vm.runInNewContext(`(${observeConnectivityPointer})('.is-details','report','saved-390-1','http://127.0.0.1:12345')`, context);
  const event = { type: "click", target, isTrusted: true, clientX: 195, clientY: 500, defaultPrevented: false };
  listeners.get("click")(event);
  assert.equal(reports[0].phase, "capture");
  assert.equal(reports[0].expected, true);
  assert.equal(reports[0].trusted, true);
  assert.equal(reports[0].defaultPrevented, false);
  event.defaultPrevented = true;
  listeners.get("pagehide")();
  assert.equal(reports[1].phase, "settled");
  assert.equal(reports[1].defaultPrevented, true);
  assert.equal(listeners.size, 0, "completed pointer observation must end before a later keyboard activation");
  listeners.get("click")?.({ ...event, detail: 0 });
  timers.forEach(callback => callback());
  assert.equal(reports.length, 2, "pagehide flush must not duplicate timer evidence");
  context.__rwnConnectivityPointerQA.stop();
  assert.equal(listeners.size, 0);
});

for (const shifted of [false, true]) test(`actual pointer orchestration records delivery and never retries (${shifted ? "shifted target" : "stable target"})`, async () => {
  const source = await readFile(new URL("../scripts/qa-connectivity-recovery.mjs", import.meta.url), "utf8");
  const closure = source.match(/  const click = async selector => \{[\s\S]*?\n  \};/)?.[0];
  assert.ok(closure);
  let top = 100, frame = 0, down;
  const listeners = new Map(), timers = [], calls = [], evidence = [], clickRecords = new Map();
  const target = {
    tagName: "A", textContent: "View details", hidden: false, disabled: false, scrollIntoView() {}, contains: () => false,
    closest: () => target, getAttribute: () => "/service/qa-physical-3",
    getBoundingClientRect: () => ({ x: 100, y: top, width: 80, height: 44 })
  };
  const other = { tagName: "BODY", textContent: "Outside the target" };
  const hit = (x, y) => x >= 100 && x <= 180 && y >= top && y <= top + 44 ? target : other;
  const globals = {
    innerWidth: 390, innerHeight: 1000, scrollX: 0, scrollY: 0,
    location: { origin: "http://127.0.0.1:12345", href: "http://127.0.0.1:12345/directory#saved" },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    requestAnimationFrame: callback => { frame++; queueMicrotask(callback); },
    setTimeout: callback => timers.push(callback),
    document: { querySelector: () => target, elementFromPoint: hit, addEventListener() {}, removeEventListener() {} },
    window: { addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: type => listeners.delete(type) },
    report: payload => { const event = JSON.parse(payload); clickRecords.get(event.token).events.push(event); }
  };
  const dispatch = (type, node, x, y) => listeners.get(type)?.({ type, target: node, clientX: x, clientY: y, isTrusted: true, defaultPrevented: false });
  const client = { call: async (_method, { type, x, y }) => {
    calls.push(type);
    const node = hit(x, y);
    if (type === "mousePressed") { down = node; dispatch("pointerdown", node, x, y); dispatch("mousedown", node, x, y); }
    else { dispatch("pointerup", node, x, y); dispatch("mouseup", node, x, y); if (down === node) dispatch("click", node, x, y); }
  } };
  const evaluate = async (_client, expression) => {
    const result = await vm.runInNewContext(expression, globals);
    if (shifted) top += 200;
    return result;
  };
  const click = vm.runInNewContext(`${closure}; click`, {
    currentCase: { label: "saved-390" }, clickRecords, evidence, client, evaluate, binding: "report", app: { host: globals.location.origin },
    directoryStartupClickPoint, directoryStartupClickWasDelivered, observeConnectivityPointer,
    pause: async () => { while (timers.length) timers.shift()(); },
    check: (condition, message, detail) => assert.ok(condition, `${message}: ${JSON.stringify(detail)}`)
  });
  if (shifted) await assert.rejects(() => click(".is-details"), /did not reach its settled target/);
  else await click(".is-details");
  assert.deepEqual(calls, ["mousePressed", "mouseReleased"]);
  assert.equal(frame, 2);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].events.find(event => event.type === "click" && event.phase === "capture").expected, !shifted);
  assert.equal(evidence[0].events.find(event => event.type === "click" && event.phase === "settled").defaultPrevented, false);
});

test("native retry Enter includes its activation character while Tab remains raw key input", async () => {
  const calls = [];
  const client = { call: async (method, params) => calls.push({ method, params }) };
  await pressConnectivityRecoveryKey(client, "Enter", 13);
  await pressConnectivityRecoveryKey(client, "Tab", 9);
  assert.deepEqual(calls, [
    { method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" } },
    { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 } },
    { method: "Input.dispatchKeyEvent", params: { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 } },
    { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 } }
  ]);
});

test("QA uses the existing CI browser with one local fixture, trusted retry and no online dispatch", async () => {
  const source = await readFile(new URL("../scripts/qa-connectivity-recovery.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /spawn\(|execFile\(|remote-debugging|findChrome|setOfflineMode|emulateNetworkConditions/);
  assert.doesNotMatch(source, /dispatchEvent\([^\n]*['"]online['"]|new Event\(['"]online['"]/);
  assert.match(source, /for \(const width of \[1440, 390\]\)/);
  assert.match(source, /for \(const view of \["search", "saved"\]\)/);
  assert.equal((source.match(/await createContactFixtureApp\(/g) || []).length, 1);
  assert.match(source, /urls: \[`\$\{app\.host\}\/data\/release\.json\*`\]/);
  assert.match(source, /Input\.dispatchMouseEvent/);
  assert.match(source, /Input\.dispatchKeyEvent/);
  assert.match(source, /await key\("Tab", 9\)/);
  assert.match(source, /await key\("Enter", 13\)/);
  assert.match(source, /trusted:event\.isTrusted/);
  assert.match(source, /const recovery = context\.fixture && currentCase \? await snapshot\(currentCase\.selector\)/);
  assert.match(source, /evidence\.push\(\{ error: error\.message, label: currentCase\?\.label, context, recovery \}\)/);
  assert.match(source, /await app\.cleanup\(\)/);
  assert.match(source, /join\(qaDir, "connectivity-recovery\.json"\)/);
});
