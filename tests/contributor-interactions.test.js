import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/contribute.js", import.meta.url), "utf8");

function fixture() {
  const nodes = new Map();
  const element = (id) => {
    const listeners = new Map(), attributes = new Map();
    const node = {
      id, disabled: false, hidden: false, textContent: "", value: "", listeners,
      addEventListener(type, handler) { listeners.set(type, handler); },
      setAttribute(key, value) { attributes.set(key, value); },
      getAttribute(key) { return attributes.get(key); },
      click() { if (!this.disabled) return listeners.get("click")?.({ currentTarget: this }); },
    };
    nodes.set(`#${id}`, node);
    return node;
  };
  for (const id of ["accountForm", "accountStatus", "accountTitle", "accountIntro", "accountSubmit", "passwordLabel", "signupSwitch", "recoverSwitch"]) element(id);
  const form = nodes.get("#accountForm");
  form.elements = { email: { value: "reader@example.test" }, password: { value: "example-password" } };
  const requests = [], assigned = [];
  vm.runInNewContext(source, {
    document: { body: { dataset: { page: "join" } }, querySelector: id => nodes.get(id) },
    location: { search: "", assign: path => assigned.push(path) },
    URLSearchParams, AbortSignal: { timeout: () => ({}) },
    fetch(path, options) {
      let resolve, reject;
      const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
      requests.push({ path, body: JSON.parse(options.body), resolve: (data, ok = true) => resolve({ ok, status: ok ? 200 : 400, json: async () => data }), reject });
      return pending;
    },
  });
  return {
    form, requests, assigned, node: id => nodes.get(`#${id}`),
    submit: () => form.listeners.get("submit")({ preventDefault() {}, currentTarget: form }),
  };
}

function assertUnlocked(f) {
  for (const id of ["accountSubmit", "signupSwitch", "recoverSwitch"]) assert.equal(f.node(id).disabled, false, id);
  assert.equal(f.form.getAttribute("aria-busy"), "false");
}

test("pending recovery cannot become sign-in or redirect to the workspace", async () => {
  const f = fixture();
  f.node("recoverSwitch").click();
  const pending = f.submit();
  assert.equal(f.requests[0].body.action, "recover");
  const locked = ["accountSubmit", "signupSwitch", "recoverSwitch"].map(id => f.node(id).disabled);
  const busy = f.form.getAttribute("aria-busy");
  f.node("signupSwitch").click();
  const submittedLabel = f.node("accountSubmit").textContent;
  f.requests[0].resolve({ message: "Check your email for the reset link." });
  await pending;
  assert.deepEqual(f.assigned, []);
  assert.deepEqual(locked, [true, true, true]);
  assert.equal(busy, "true");
  assert.equal(submittedLabel, "Send reset link");
  assert.equal(f.node("accountStatus").textContent, "Check your email for the reset link.");
  assertUnlocked(f);
  f.node("signupSwitch").click();
  assert.equal(f.node("accountSubmit").textContent, "Sign in");
});

test("pending sign-in ignores mode changes and duplicate submit events", async () => {
  const f = fixture();
  const pending = f.submit();
  assert.equal(f.requests[0].body.action, "signin");
  // A queued or programmatic mode event must not change the submitted intent.
  f.node("recoverSwitch").listeners.get("click")();
  const duplicate = f.submit();
  assert.equal(f.requests.length, 1);
  await duplicate;
  assert.equal(f.node("passwordLabel").hidden, false);
  f.requests[0].resolve({});
  await pending;
  assert.deepEqual(f.assigned, ["/workspace"]);
  assertUnlocked(f);
});

test("failed request unlocks mode switches and allows a different request", async () => {
  const f = fixture();
  const pending = f.submit();
  f.requests[0].resolve({ error: "The email or password is incorrect." }, false);
  await pending;
  assert.deepEqual(f.assigned, []);
  assert.equal(f.node("accountStatus").textContent, "The email or password is incorrect.");
  assertUnlocked(f);
  f.node("recoverSwitch").click();
  const retry = f.submit();
  assert.equal(f.requests[1].body.action, "recover");
  f.requests[1].resolve({ message: "Reset link sent." });
  await retry;
  assert.equal(f.node("accountStatus").textContent, "Reset link sent.");
  assertUnlocked(f);
});

test("network rejection restores controls and keeps signup available", async () => {
  const f = fixture();
  const pending = f.submit();
  f.requests[0].reject(new TypeError("network unavailable"));
  await pending;
  assert.equal(f.node("accountStatus").textContent, "Connection interrupted. Please try again.");
  assertUnlocked(f);
  f.node("signupSwitch").click();
  const signup = f.submit();
  assert.equal(f.requests[1].body.action, "signup");
  f.requests[1].resolve({ signedIn: true });
  await signup;
  assert.deepEqual(f.assigned, ["/workspace"]);
  assertUnlocked(f);
});
