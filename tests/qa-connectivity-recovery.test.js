import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { phoneLinks } from "../src/utils/phone.js";
import { SAVED_RESOURCES_KEY } from "../src/utils/privacy.js";
import { contactFixtureResources as resources } from "../scripts/qa-contact-fixture-app.mjs";
import {
  connectivityRecoveryContext, assertConnectivityFailure, assertConnectivityRetained,
  assertConnectivityRecovered, assertConnectivityFocusReleased, pressConnectivityRecoveryKey
} from "../scripts/qa-connectivity-recovery.mjs";

const failureState = () => ({
  offline: true, overflow: 0, navigatorOnline: true, networkState: "offline", noticeVisible: true,
  href: "http://127.0.0.1:12345/directory#saved", timeOrigin: 123, historyLength: 3,
  query: "Synthetic QA", countryControlPresent: true, country: "United States", help: "Food", activeHelp: "Food",
  savedStorage: JSON.stringify(resources.map(resource => resource.id).reverse()),
  status: "Could not reach RWN. Check your connection and try again.",
  retry: { tag: "BUTTON", type: "button", text: "Retry connection", visible: true, disabled: false, ariaDisabled: "false" },
  focus: { connected: true, visible: true, inNotice: true, retry: false, body: false },
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
  focus: { connected: true, visible: true, inNotice: true, retry: true, body: false },
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
  const box = () => ({ width: 180, height: 44 });
  const retry = { tagName: "BUTTON", type: "button", textContent: "Retry connection", isConnected: true, disabled: false, getBoundingClientRect: box, getAttribute: () => "false" };
  const status = { textContent: "Connection restored." };
  const notice = { dataset: { networkState: "online" }, isConnected: true, getBoundingClientRect: box, contains: node => node === retry, querySelector: selector => selector === "[data-directory-reconnect]" ? retry : status };
  const controls = {
    "[data-directory-query]": { value: "Synthetic QA" }, "[data-directory-country]": { value: "United States" },
    "[data-directory-need]": { value: "Food" }, '[data-directory-category][aria-pressed="true"]': { dataset: { directoryCategory: "Food" } }
  };
  const context = {
    document: { activeElement: retry, body: {}, getElementById: () => notice, querySelector: selector => controls[selector] },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    location: { href: "http://127.0.0.1:12345/directory" }, performance: { timeOrigin: 234 }, history: { length: 4 }, navigator: { onLine: true },
    localStorage: { getItem: key => key === SAVED_RESOURCES_KEY ? '["qa-contact-phone"]' : null },
    __rwnConnectivityRecoveryQA: { online: 0, clicks: [{ trusted: true, detail: 0 }], checking: [{ ariaDisabled: "true" }], keyboard: [{ type: "keypress", key: "Enter", trusted: true, defaultPrevented: false }] }
  };
  const run = () => vm.runInNewContext(`(${connectivityRecoveryContext})(${JSON.stringify(SAVED_RESOURCES_KEY)})`, context);
  const state = run();
  assert.equal(state.focus.retry, true);
  assert.equal(state.focus.inNotice, true);
  assert.equal(state.focus.visible, true);
  assert.equal(state.retry.visible, true);
  assert.equal(state.savedStorage, '["qa-contact-phone"]');
  assert.equal(state.help, "Food");
  assert.equal(state.countryControlPresent, true);
  assert.equal(state.country, "United States");
  assert.equal(state.events.clicks[0].trusted, true);
  assert.equal(state.events.keyboard[0].type, "keypress");
  assert.equal(state.events.keyboard[0].trusted, true);
  delete controls["[data-directory-country]"];
  assert.equal(run().countryControlPresent, false);
  assert.equal(run().country, null);
  retry.isConnected = false;
  assert.equal(run().focus.connected, false);
  assert.equal(run().focus.visible, false);
  assert.equal(run().retry.visible, false);
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
