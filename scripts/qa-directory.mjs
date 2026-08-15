// Measures the real directory page: how tall it is, whether search and filters
// work, whether the record cards are scannable, and whether anything overflows.
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] || "http://127.0.0.1:5173";
const PORT = 9700 + Math.floor(Math.random() * 200);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const failures = [];

function check(label, condition, detail) {
  results.push({ label, ok: Boolean(condition), detail });
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

const profile = await mkdtemp(join(tmpdir(), "rwn-dir-"));
const chrome = spawn("chromium", [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--no-sandbox",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--enable-unsafe-swiftshader",
  "about:blank"
], { stdio: "ignore" });

async function endpoint(path) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (response.ok) return response.json();
    } catch {}
    await sleep(120);
  }
  throw new Error("Chromium never became available.");
}

const version = await endpoint("/json/version");
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

let messageId = 0;
const pending = new Map();
const events = [];
socket.onmessage = (message) => {
  const data = JSON.parse(message.data);
  if (data.id && pending.has(data.id)) {
    pending.get(data.id)(data);
    pending.delete(data.id);
  } else if (data.method) events.push(data);
};
const send = (method, params = {}, sessionId) => new Promise((resolve) => {
  messageId += 1;
  pending.set(messageId, resolve);
  socket.send(JSON.stringify({ id: messageId, method, params, sessionId }));
});

const target = await send("Target.createTarget", { url: "about:blank" });
const attached = await send("Target.attachToTarget", { targetId: target.result.targetId, flatten: true });
const session = attached.result.sessionId;
await send("Page.enable", {}, session);
await send("Runtime.enable", {}, session);
await send("Log.enable", {}, session);

const evaluate = async (expression) => {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, session);
  if (response.result?.exceptionDetails) {
    throw new Error(`evaluate failed: ${response.result.exceptionDetails.text}`);
  }
  return response.result?.result?.value;
};

const goto = async (path, width = 1440, height = 900, scale = 1, mobile = false) => {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile }, session);
  await send("Page.navigate", { url: `${base}${path}` }, session);
  await sleep(2200);
};

try {
  // --- Desktop directory ---
  await goto("/directory");
  const metrics = await evaluate(`(() => ({
    height: document.documentElement.scrollHeight,
    overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    records: document.querySelectorAll('.directory-record').length,
    firstRecordHeight: document.querySelector('.directory-record')?.getBoundingClientRect().height || 0,
    hasSearch: Boolean(document.querySelector('[data-directory-query]')),
    chips: document.querySelectorAll('[data-directory-categories] button').length
  }))()`);
  check("directory has a search field", metrics.hasSearch);
  check("directory offers category filters", metrics.chips >= 4, `${metrics.chips} chips`);
  check("directory page is not absurdly tall", metrics.height < 20000, `${metrics.height}px tall for ${metrics.records} records`);
  check("record cards are compact enough to scan", metrics.firstRecordHeight < 420, `first card is ${Math.round(metrics.firstRecordHeight)}px`);
  check("directory has no horizontal overflow", metrics.overflowX <= 2, `${metrics.overflowX}px`);

  // --- Search behaviour ---
  // Searching swaps the paged records for a whole-catalog result list, so the
  // meaningful signal is that list, not the static records on the page.
  const search = await evaluate(`(async () => {
    const input = document.querySelector('[data-directory-query]');
    input.focus();
    input.value = 'shower';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const rows = [...document.querySelectorAll('.directory-global-result')];
    return {
      rows: rows.length,
      countText: document.querySelector('[data-directory-count]')?.textContent || '',
      firstName: rows[0]?.querySelector('strong')?.textContent || '',
      pagedRecordsHidden: [...document.querySelectorAll('.directory-record')].every((node) => node.offsetParent === null)
    };
  })()`);
  check("search returns whole-catalog results", search.rows > 0, JSON.stringify(search));
  check("search replaces the paged list cleanly", search.pagedRecordsHidden, JSON.stringify(search));
  check("search reports a result count", /\d/.test(search.countText), search.countText);

  const semanticSearch = await evaluate(`(async () => {
    const input = document.querySelector('[data-directory-query]');
    const run = async (query) => {
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 700));
      const rows = [...document.querySelectorAll('.directory-global-result')];
      return {
        rows: rows.length,
        firstName: rows[0]?.querySelector('strong')?.textContent || '',
        firstMeta: rows[0]?.querySelector('small')?.textContent || ''
      };
    };
    return {
      wifi: await run('wifi'),
      nycShelter: await run('NYC shelter'),
      typo: await run('shleter'),
      water: await run('water')
    };
  })()`);
  check("directory finds the verified free Wi-Fi utility", semanticSearch.wifi.rows > 0 && /LinkNYC/i.test(semanticSearch.wifi.firstName), JSON.stringify(semanticSearch.wifi));
  check("directory understands NYC as New York City", semanticSearch.nycShelter.rows > 0, JSON.stringify(semanticSearch.nycShelter));
  check("directory recovers an obvious shelter typo", semanticSearch.typo.rows > 0, JSON.stringify(semanticSearch.typo));
  check("directory ranks water access ahead of incidental place names", /Water/i.test(semanticSearch.water.firstMeta), JSON.stringify(semanticSearch.water));

  const cleared = await evaluate(`(async () => {
    const input = document.querySelector('[data-directory-query]');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 700));
    return [...document.querySelectorAll('.directory-record')].filter((node) => node.offsetParent !== null).length;
  })()`);
  check("clearing search restores every record", cleared === metrics.records, `${cleared} of ${metrics.records}`);

  const noMatch = await evaluate(`(async () => {
    const input = document.querySelector('[data-directory-query]');
    input.value = 'zzzzqqqq-no-such-service';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 700));
    const visible = [...document.querySelectorAll('.directory-record')].filter((node) => node.offsetParent !== null).length;
    const body = document.body.innerText;
    return { visible, hasGuidance: /no (?:match|result|listing)/i.test(body), hasRecovery: Boolean(document.querySelector('.directory-global-empty button')) };
  })()`);
  check("a search with no matches explains itself", noMatch.visible === 0 && noMatch.hasGuidance && noMatch.hasRecovery, JSON.stringify(noMatch));

  // --- Tap target sizes on mobile ---
  await goto("/directory", 390, 844, 3, true);
  const mobile = await evaluate(`(() => {
    // WCAG permits inline text links to remain inline. This checks the controls
    // that are deliberately presented as tappable directory UI: search, filters,
    // record actions/disclosures, and navigation-menu triggers.
    const selector = [
      '.directory-search-field input',
      '.directory-search-tools__clear',
      '.directory-category-chips button',
      '.directory-record h2 a',
      '.directory-record__actions a',
      '.directory-record__more > summary',
      '.directory-advanced > summary',
      '.directory-browse-more > summary',
      '.rwn-page-menu > summary'
    ].join(',');
    const small = [];
    for (const node of document.querySelectorAll(selector)) {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.height < 40) small.push((node.textContent || node.getAttribute('aria-label') || node.tagName).trim().slice(0, 34));
    }
    return {
      overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      smallCount: small.length,
      samples: small.slice(0, 8),
      height: document.documentElement.scrollHeight
    };
  })()`);
  check("mobile directory has no horizontal overflow", mobile.overflowX <= 2, `${mobile.overflowX}px`);
  check("mobile directory controls meet the 40px minimum", mobile.smallCount === 0, `${mobile.smallCount} too small: ${mobile.samples.join(" | ")}`);

  // --- Keyboard accessibility ---
  await goto("/directory");
  const keyboard = await evaluate(`(() => {
    const focusable = [...document.querySelectorAll('a[href], button, input, select, [tabindex]:not([tabindex="-1"])')]
      .filter((node) => node.offsetParent !== null);
    const skip = document.querySelector('.skip-link');
    return { focusable: focusable.length, hasSkipLink: Boolean(skip) };
  })()`);
  check("directory exposes a skip link", keyboard.hasSkipLink);

  // --- Service detail page ---
  await goto("/service/bowery-mission");
  const detail = await evaluate(`(() => ({
    overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    hasSource: /Visit original source|official source|original source/i.test(document.body.innerText),
    hasChecked: /Checked/i.test(document.body.innerText),
    h1: document.querySelector('h1')?.textContent?.trim() || ''
  }))()`);
  check("service page names the service", detail.h1.length > 3, detail.h1);
  check("service page cites its source", detail.hasSource);
  check("service page shows the review date", detail.hasChecked);
  check("service page has no horizontal overflow", detail.overflowX <= 2, `${detail.overflowX}px`);

  // --- Console hygiene across the visited pages ---
  const consoleErrors = events
    .filter((event) => event.method === "Log.entryAdded" && event.params.entry.level === "error")
    .map((event) => event.params.entry.text);
  const exceptions = events
    .filter((event) => event.method === "Runtime.exceptionThrown")
    .map((event) => event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text);
  check("no console errors on directory pages", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  check("no uncaught exceptions on directory pages", exceptions.length === 0, exceptions.slice(0, 3).join(" | "));

  await mkdir("qa-screenshots", { recursive: true });
  await goto("/directory", 1440, 900);
  const shot = await send("Page.captureScreenshot", { format: "png" }, session);
  if (shot.result?.data) await writeFile("qa-screenshots/directory-desktop.png", Buffer.from(shot.result.data, "base64"));
} finally {
  socket.close();
  chrome.kill("SIGKILL");
  // Chromium can still be flushing its profile as it dies, so cleanup is
  // best-effort and must never mask a real test failure.
  await sleep(400);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.label}${result.detail ? `  (${result.detail})` : ""}`);
}
if (failures.length) {
  console.error(`\n${failures.length} directory check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${results.length} directory checks passed.`);
