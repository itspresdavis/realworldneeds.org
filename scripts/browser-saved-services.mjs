import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = "http://127.0.0.1:4181";
const CDP_PORT = 9231;
const CDP_HOST = `http://127.0.0.1:${CDP_PORT}`;
const QA_DIR = "qa-screenshots";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stopProcess(child, timeoutMs = 1800) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish();
    }, timeoutMs);
    timer.unref?.();
    child.once("exit", finish);
    try { child.kill("SIGTERM"); } catch { finish(); }
  });
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const candidate of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    const result = spawnSync("which", [candidate], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error("Chrome/Chromium was not found. Set CHROME_PATH or install a browser.");
}

async function waitFor(url, attempts = 80) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(125);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out connecting to Chrome DevTools.")), 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Chrome DevTools WebSocket failed.")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const list = this.listeners.get(method) || [];
    list.push(listener);
    this.listeners.set(method, list);
    return () => this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== listener));
  }

  close() { this.ws?.close(); }
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed.");
  return result.result?.value;
}

async function navigate(client, url) {
  const loaded = new Promise((resolve) => {
    const off = client.on("Page.loadEventFired", () => { off(); resolve(); });
    setTimeout(() => { off(); resolve(); }, 6000).unref?.();
  });
  await client.call("Page.navigate", { url });
  await loaded;
  await sleep(550);
}

async function capture(client, name) {
  await mkdir(QA_DIR, { recursive: true });
  const { data } = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(join(QA_DIR, name), Buffer.from(data, "base64"));
}

async function captureClip(client, name, clip) {
  await mkdir(QA_DIR, { recursive: true });
  const { data } = await client.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 }
  });
  await writeFile(join(QA_DIR, name), Buffer.from(data, "base64"));
}

async function run() {
  const profile = await mkdtemp(join(tmpdir(), "rwn-saved-"));
  const server = spawn(process.execPath, ["scripts/serve.mjs", "4181"], { stdio: ["ignore", "pipe", "pipe"] });
  let browser, client;
  const check = (condition, message, data) => { if (!condition) throw new Error(`${message}: ${JSON.stringify(data)}`); };
  const waitForUI = async (expression) => {
    for (let i = 0; i < 80; i++) { if (await evaluate(client, expression)) return; await sleep(100); }
    throw new Error(`UI did not settle: ${expression}`);
  };
  try {
    await waitFor(`${HOST}/`);
    const records = (await (await fetch(`${HOST}/data/search-index.json`)).json()).records;
    const ids = records.slice(0, 85).map((record) => record.id);
    browser = spawn(findChrome(), ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking", "--disable-extensions", "--no-first-run", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
    await waitFor(`${CDP_HOST}/json/version`);
    const target = await (await fetch(`${CDP_HOST}/json/new?about:blank`, { method: "PUT" })).json();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await Promise.all([client.call("Page.enable"), client.call("Runtime.enable"), client.call("Network.enable")]);
    await client.call("Network.setBypassServiceWorker", { bypass: true });
    await client.call("Network.setCacheDisabled", { cacheDisabled: true });
    const exceptions = [];
    client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.exception?.description || exceptionDetails.text));
    await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate(client, `${HOST}/service/${ids[0]}`);
    let result = await evaluate(client, `(() => {
      const button = document.querySelector('[data-service-save]');
      const untouched = localStorage.getItem('rwn-saved-resources') === null;
      button.focus(); button.click();
      const saved = button.getAttribute('aria-pressed') === 'true' && JSON.parse(localStorage.getItem('rwn-saved-resources')).includes(${JSON.stringify(ids[0])});
      button.click(); button.click();
      const repeated = button.getAttribute('aria-pressed') === 'true' && JSON.parse(localStorage.getItem('rwn-saved-resources')).length === 1;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error('quota fixture'); };
      // Remove succeeds, but adding again must fail without a success state.
      button.click(); button.click();
      const quota = button.getAttribute('aria-pressed') === 'false' && /could not be changed/.test(document.querySelector('[data-service-action-status]').textContent);
      Storage.prototype.setItem = original;
      button.click();
      const read = Storage.prototype.getItem;
      Storage.prototype.getItem = () => { throw new Error('blocked fixture'); };
      window.dispatchEvent(new PageTransitionEvent('pageshow'));
      const denied = button.disabled && /unavailable/.test(document.querySelector('[data-service-action-status]').textContent);
      Storage.prototype.getItem = read;
      window.dispatchEvent(new PageTransitionEvent('pageshow'));
      return { untouched, saved, repeated, quota, denied, recovered: !button.disabled && button.getAttribute('aria-pressed') === 'true', focus: document.activeElement === button, height: button.getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    })()`);
    check(result.untouched && result.saved && result.repeated && result.quota && result.denied && result.recovered && result.height >= 44 && !result.overflow, "Explicit service saving or storage feedback failed", result);
    await evaluate(client, `document.querySelector('[data-service-utility]').scrollIntoView({block:'center'})`);
    await capture(client, "saved-service-mobile.png");

    await navigate(client, `${HOST}/directory`);
    result = await evaluate(client, `({lazy: !performance.getEntriesByType('resource').some(entry => new URL(entry.name).pathname.startsWith('/saved-services.') && new URL(entry.name).pathname.endsWith('.js')), canvas: !!document.querySelector('canvas'), hidden: getComputedStyle(document.getElementById('saved')).display === 'none'})`);
    check(result.lazy && result.hidden && !result.canvas, "Ordinary directory must not load Saved or require a map", result);
    await evaluate(client, `location.hash = 'saved'`);
    await waitForUI(`document.querySelectorAll('[data-saved-remove]').length === 1`);
    result = await evaluate(client, `({name: document.querySelector('[data-saved-list]').textContent, focused: document.activeElement.id, overflow: document.documentElement.scrollWidth > innerWidth + 1, requestURLs: performance.getEntriesByType('resource').filter(entry => /search-index/.test(entry.name)).map(entry => entry.name)})`);
    check(result.name.includes(records[0].name) && result.focused === "saved-services-heading" && !result.overflow && result.requestURLs.every(url => !url.includes(ids[0])), "Saved view failed", result);
    await capture(client, "saved-list-mobile.png");
    await evaluate(client, `document.querySelector('.saved-services__heading a').click()`);
    await waitForUI(`location.hash === '#directory-results' && !document.querySelector('.has-saved-view')`);
    check(await evaluate(client, `document.activeElement.id === 'directory-results'`), "Browse directory lost keyboard focus");
    await evaluate(client, `history.back()`);
    await waitForUI(`location.hash === '#saved' && document.querySelectorAll('[data-saved-remove]').length === 1`);
    await evaluate(client, `history.forward()`);
    await waitForUI(`location.hash === '#directory-results' && !document.querySelector('.has-saved-view')`);

    // A legacy/removed ID stays removable. Untrusted local values never become markup.
    await evaluate(client, `localStorage.setItem('rwn-saved-resources', JSON.stringify([${JSON.stringify(ids[0])}, 'removed-service', '<img src=x onerror=alert(1)>'])); location.hash='saved'`);
    await waitForUI(`document.querySelectorAll('[data-saved-remove]').length === 2`);
    check(await evaluate(client, `document.querySelector('[data-saved-list]').textContent.includes('no longer in the current directory') && !document.querySelector('[data-saved-list] img')`), "Removed/hostile saved ID handling failed");
    await evaluate(client, `document.querySelector('[data-saved-remove="removed-service"]').focus(); document.activeElement.click()`);
    await waitForUI(`document.querySelectorAll('[data-saved-remove]').length === 1`);
    check(await evaluate(client, `document.activeElement.matches('[data-saved-remove]')`), "Removal lost focus");

    // Pagination and background storage refresh preserve the active row.
    await evaluate(client, `localStorage.setItem('rwn-saved-resources', ${JSON.stringify(JSON.stringify(ids))}); window.dispatchEvent(new StorageEvent('storage', {key:'rwn-saved-resources'}))`);
    await waitForUI(`document.querySelectorAll('[data-saved-remove]').length === 60`);
    await evaluate(client, `document.querySelector('[data-saved-more]').click(); const button = document.querySelectorAll('[data-saved-remove]')[79]; button.focus(); button.click()`);
    await waitForUI(`document.querySelectorAll('[data-saved-remove]').length === 84`);
    check(await evaluate(client, `document.activeElement.dataset.savedRemove === ${JSON.stringify(ids[80])}`), "Pagination removal jumped away from the next row");
    await evaluate(client, `window.dispatchEvent(new StorageEvent('storage', {key:'rwn-saved-resources'}))`);
    await waitForUI(`document.activeElement.dataset.savedRemove === ${JSON.stringify(ids[80])}`);

    await evaluate(client, `document.querySelector('[data-saved-clear]').click()`);
    check(await evaluate(client, `document.activeElement.matches('[data-saved-cancel]') && !document.querySelector('[data-saved-confirmation]').hidden`), "Clear confirmation did not focus safe action");
    await evaluate(client, `window.dispatchEvent(new StorageEvent('storage', {key:'rwn-saved-resources'}))`);
    await sleep(150);
    check(await evaluate(client, `document.activeElement.matches('[data-saved-cancel]') && !document.querySelector('[data-saved-confirmation]').hidden`), "Storage refresh dismissed the focused confirmation");
    await evaluate(client, `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
    check(await evaluate(client, `document.querySelector('[data-saved-confirmation]').hidden && document.activeElement.matches('[data-saved-clear]')`), "Escape did not return Clear focus");
    await evaluate(client, `localStorage.setItem('qa-unrelated','keep'); document.querySelector('[data-saved-clear]').click(); document.querySelector('[data-saved-confirm]').click()`);
    await waitForUI(`document.querySelector('[data-saved-summary]').textContent.includes('No saved services yet')`);
    check(await evaluate(client, `localStorage.getItem('rwn-saved-resources') === null && localStorage.getItem('qa-unrelated') === 'keep' && document.activeElement.id === 'saved-services-heading'`), "Clear removed unrelated data or lost focus");

    // Background list changes can hide controls without replacing their nodes.
    await evaluate(client, `localStorage.setItem('rwn-saved-resources', ${JSON.stringify(JSON.stringify(ids))}); window.dispatchEvent(new StorageEvent('storage', {key:'rwn-saved-resources'}))`);
    // Earlier pagination intentionally remains expanded across refreshes. Start
    // a new document so this fixture has an actual, visible Show more control.
    await navigate(client, "about:blank");
    await navigate(client, `${HOST}/directory#saved`);
    await waitForUI(`!document.querySelector('[data-saved-more]').hidden`);
    await evaluate(client, `document.querySelector('[data-saved-more]').focus(); localStorage.setItem('rwn-saved-resources', ${JSON.stringify(JSON.stringify(ids.slice(0, 2)))}); window.dispatchEvent(new StorageEvent('storage', {key:'rwn-saved-resources'}))`);
    await waitForUI(`document.querySelector('[data-saved-more]').hidden && document.activeElement.id === 'saved-services-heading'`);
    await evaluate(client, `document.querySelector('[data-saved-clear]').focus(); window.dispatchEvent(new StorageEvent('storage', {key:'rwn-saved-resources'}))`);
    await sleep(100);
    check(await evaluate(client, `document.activeElement.matches('[data-saved-clear]')`), "Refresh stole focus from an available Clear control");
    await evaluate(client, `localStorage.removeItem('rwn-saved-resources'); window.dispatchEvent(new StorageEvent('storage', {key:'rwn-saved-resources'}))`);
    check(await evaluate(client, `document.querySelector('[data-saved-clear]').hidden && document.activeElement.id === 'saved-services-heading'`), "Cross-tab clear lost focus from the hidden Clear control");
    await evaluate(client, `localStorage.setItem('rwn-saved-resources', ${JSON.stringify(JSON.stringify(ids))}); window.dispatchEvent(new StorageEvent('storage', {key:'rwn-saved-resources'}))`);
    await waitForUI(`!document.querySelector('[data-saved-more]').hidden`);
    await evaluate(client, `document.querySelector('[data-saved-more]').focus(); localStorage.setItem('rwn-saved-resources', ${JSON.stringify(JSON.stringify(ids.slice(0, 2)))}); window.dispatchEvent(new StorageEvent('storage', {key:'rwn-saved-resources'})); document.querySelector('.saved-services__heading a').focus()`);
    await waitForUI(`document.querySelector('[data-saved-more]').hidden`);
    check(await evaluate(client, `document.activeElement === document.querySelector('.saved-services__heading a')`), "Background refresh overrode newer deliberate focus");

    // A failed catalog request never deletes the IDs; explicit retry recovers.
    await evaluate(client, `localStorage.setItem('rwn-saved-resources', ${JSON.stringify(JSON.stringify(ids.slice(0,2)))})`);
    // Leave the document: navigating to the same #saved URL would correctly
    // retain its already-loaded catalog and never exercise the failed request.
    await navigate(client, "about:blank");
    await client.call("Network.setBlockedURLs", { urls: ["*search-index.json*"] });
    await navigate(client, `${HOST}/directory#saved`);
    await waitForUI(`document.querySelector('[data-saved-summary]').textContent.includes('could not load')`);
    check(await evaluate(client, `JSON.parse(localStorage.getItem('rwn-saved-resources')).length === 2 && !document.querySelector('[data-saved-retry]').hidden`), "Index failure lost IDs or retry");
    await evaluate(client, `document.querySelector('[data-saved-retry]').focus(); document.activeElement.click()`);
    await waitForUI(`document.querySelector('[data-saved-summary]').textContent.includes('could not load')`);
    check(await evaluate(client, `document.activeElement.matches('[data-saved-retry]')`), "Repeated failed retry lost focus");
    await client.call("Network.setBlockedURLs", { urls: [] });
    await evaluate(client, `document.querySelector('[data-saved-retry]').focus(); document.activeElement.click()`);
    await waitForUI(`document.querySelectorAll('[data-saved-remove]').length === 2`);

    check(await evaluate(client, `document.activeElement.id === 'saved-services-heading'`), "Retry completion lost focus");

    // The real connectivity probe, rather than only navigator.onLine, protects
    // Saved rows created after a hard network failure.
    await client.call("Network.setBlockedURLs", { urls: ["*data/release.json*"] });
    await evaluate(client, `window.dispatchEvent(new Event('online'))`);
    await waitForUI(`document.getElementById('offlineDirectoryNotice').dataset.networkState === 'offline'`);
    await evaluate(client, `window.dispatchEvent(new StorageEvent('storage', {key:'rwn-saved-resources'}))`);
    await sleep(250);
    result = await evaluate(client, `(() => {
      const links = [...document.querySelectorAll('[data-saved-list] .directory-global-result-actions a')].filter(a => !a.getAttribute('href').startsWith('tel:'));
      const before = location.href;
      document.querySelector('[data-saved-list] .is-details').click();
      document.querySelector('[data-saved-list] .directory-global-result').click();
      return {hidden: links.every(link => link.hidden && getComputedStyle(link).display === 'none'), stayed: location.href === before, focus: document.activeElement.id === 'offlineDirectoryNotice', removable: document.querySelector('[data-saved-remove]').getBoundingClientRect().height >= 44};
    })()`);
    check(result.hidden && result.stayed && result.focus && result.removable, "Hard-offline Saved navigation was not guarded", result);
    await client.call("Network.setBlockedURLs", { urls: [] });
    await evaluate(client, `window.dispatchEvent(new Event('online'))`);
    await waitForUI(`document.getElementById('offlineDirectoryNotice').dataset.networkState === 'online'`);

    for (const width of [320, 1440]) {
      await client.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await evaluate(client, `document.getElementById('saved').scrollIntoView({block:'start'})`);
      check(await evaluate(client, `document.documentElement.scrollWidth <= innerWidth + 1`), `Saved view overflows ${width}px`);
      await capture(client, `saved-list-${width}.png`);
    }
    check(exceptions.length === 0, "Unexpected browser exceptions", exceptions);
    console.log("Saved-services browser QA passed: explicit local saving, denied/quota storage, lazy loading, history, unavailable IDs, pagination/focus, cross-tab refresh, confirmation, retry, hard-offline safeguards, and 320/390/1440px layouts.");
  } finally {
    client?.close();
    await stopProcess(browser);
    await stopProcess(server);
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 125 });
  }
}
run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
