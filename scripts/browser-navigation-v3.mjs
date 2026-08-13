import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = "http://127.0.0.1:4183";
const CDP_PORT = 9231;
const CDP_HOST = `http://127.0.0.1:${CDP_PORT}`;
const QA_DIR = "qa-screenshots";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(125);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

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
      const timer = setTimeout(() => reject(new Error("Timed out connecting to Chrome DevTools.")), 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Chrome DevTools WebSocket failed.")); }, { once: true });
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
    setTimeout(() => { off(); resolve(); }, 8000).unref?.();
  });
  await client.call("Page.navigate", { url });
  await loaded;
  await sleep(800);
}

async function capture(client, name) {
  await mkdir(QA_DIR, { recursive: true });
  const { data } = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(join(QA_DIR, name), Buffer.from(data, "base64"));
}

async function run() {
  const chrome = findChrome();
  const profile = await mkdtemp(join(tmpdir(), "rwn-navigation-v3-"));
  const server = spawn(process.execPath, ["scripts/serve.mjs", "4183"], { stdio: ["ignore", "pipe", "pipe"] });
  let browser;
  let client;
  const exceptions = [];

  try {
    await waitFor(`${HOST}/`);
    const payload = await (await fetch(`${HOST}/data/resources.json`)).json();
    const resource = payload.resources.find((item) => item.kind === "direct" && item.phone && Number.isFinite(item.lat) && Number.isFinite(item.lng));
    if (!resource) throw new Error("Navigation QA needs a direct service with phone and coordinates.");

    browser = spawn(chrome, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--no-first-run",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      "about:blank"
    ], { stdio: ["ignore", "pipe", "pipe"] });

    await waitFor(`${CDP_HOST}/json/version`);
    const targetResponse = await fetch(`${CDP_HOST}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    if (!targetResponse.ok) throw new Error(`Could not create browser target: ${targetResponse.status}`);
    const target = await targetResponse.json();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await Promise.all([client.call("Page.enable"), client.call("Runtime.enable")]);
    client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails?.exception?.description || exceptionDetails?.text || "Unknown browser exception"));

    await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
    await navigate(client, `${HOST}/`);
    const home = await evaluate(client, `new Promise((resolve) => {
      const started = performance.now();
      const check = () => {
        const menu = document.querySelector('.site-menu');
        const summary = menu?.querySelector('summary');
        if (summary?.textContent?.trim() === 'Menu') {
          menu.open = true;
          const links = [...menu.querySelectorAll('nav a')].map((a) => a.textContent.trim());
          return resolve({
            links,
            summaryHeight: Math.round(summary.getBoundingClientRect().height),
            overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
            action: document.querySelector('.header-action')?.textContent?.trim() || '',
            desktopLinks: [...document.querySelectorAll('.primary-nav a')].map((a) => a.textContent.trim())
          });
        }
        if (performance.now() - started > 10000) return resolve({ timeout: true });
        setTimeout(check, 50);
      };
      check();
    })`);
    const expectedMobile = ["Find help", "Browse directory", "How listings are checked", "Transparency"];
    const expectedDesktop = ["Find help", "How listings are checked", "Transparency"];
    if (home.timeout || home.summaryHeight < 44 || home.overflow > 1 || home.action !== "Browse directory" || JSON.stringify(home.links) !== JSON.stringify(expectedMobile) || JSON.stringify(home.desktopLinks) !== JSON.stringify(expectedDesktop)) {
      throw new Error(`Homepage navigation QA failed: ${JSON.stringify(home)}`);
    }
    await capture(client, "navigation-home-mobile.png");

    await navigate(client, `${HOST}/directory`);
    const directory = await evaluate(client, `new Promise((resolve) => {
      const input = document.querySelector('[data-directory-query]');
      if (!input) return resolve({ missingSearch: true });
      input.value = ${JSON.stringify(resource.name)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const started = performance.now();
      const check = () => {
        const row = document.querySelector('.directory-global-result');
        if (row) {
          const actions = [...row.querySelectorAll('.directory-global-result__actions a')].map((a) => ({
            label: a.textContent.trim(),
            href: a.href,
            height: Math.round(a.getBoundingClientRect().height)
          }));
          const menu = document.querySelector('.rwn-site-menu');
          if (menu) menu.open = true;
          return resolve({
            actions,
            menuLabel: menu?.querySelector('summary')?.textContent?.trim() || '',
            menuLinks: [...(menu?.querySelectorAll('nav a') || [])].map((a) => a.textContent.trim()),
            overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
            browseCollapsed: !document.querySelector('.directory-browse')?.open,
            dataCollapsed: !document.querySelector('.directory-data-tools')?.open
          });
        }
        if (performance.now() - started > 8000) return resolve({ timeout: true });
        setTimeout(check, 80);
      };
      check();
    })`);
    const labels = directory.actions?.map((action) => action.label) || [];
    if (directory.timeout || directory.overflow > 1 || directory.menuLabel !== "Menu" || JSON.stringify(directory.menuLinks) !== JSON.stringify(expectedMobile) || !directory.browseCollapsed || !directory.dataCollapsed || !["Call", "Apple Maps", "Google Maps", "View details"].every((label) => labels.includes(label)) || directory.actions.some((action) => action.height < 44)) {
      throw new Error(`Directory navigation/action QA failed: ${JSON.stringify(directory)}`);
    }
    const apple = directory.actions.find((action) => action.label === "Apple Maps")?.href || "";
    const google = directory.actions.find((action) => action.label === "Google Maps")?.href || "";
    if (!apple.includes("maps.apple.com/?daddr=") || !google.includes("google.com/maps/dir/?api=1&destination=")) {
      throw new Error(`Directory direction links are not true directions: ${JSON.stringify({ apple, google })}`);
    }
    await capture(client, "navigation-directory-mobile.png");

    await navigate(client, `${HOST}/service/${encodeURIComponent(resource.id)}`);
    const service = await evaluate(client, `(() => {
      const next = document.querySelector('.service-next-steps--v3');
      const actions = [...(next?.querySelectorAll('a') || [])].map((a) => ({ label: a.querySelector('strong')?.textContent?.trim() || '', href: a.href, height: Math.round(a.getBoundingClientRect().height) }));
      const menu = document.querySelector('.rwn-site-menu');
      if (menu) menu.open = true;
      return {
        actions,
        heading: next?.querySelector(':scope > div:first-child > span')?.textContent?.trim() || '',
        menuLabel: menu?.querySelector('summary')?.textContent?.trim() || '',
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
      };
    })()`);
    const serviceLabels = service.actions.map((action) => action.label);
    if (service.heading !== "Contact and directions" || service.menuLabel !== "Menu" || service.overflow > 1 || !["Call", "Apple Maps", "Google Maps", "Official website", "RWN map"].every((label) => serviceLabels.includes(label)) || service.actions.some((action) => action.height < 44)) {
      throw new Error(`Service navigation/action QA failed: ${JSON.stringify(service)}`);
    }
    await capture(client, "navigation-service-mobile.png");

    await client.call("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1366, screenHeight: 900 });
    await navigate(client, `${HOST}/directory`);
    const desktop = await evaluate(client, `(() => ({
      links: [...document.querySelectorAll('.rwn-primary-nav a')].map((a) => a.textContent.trim()),
      action: document.querySelector('.rwn-header-action')?.textContent?.trim() || '',
      menuDisplay: getComputedStyle(document.querySelector('.rwn-site-menu')).display,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
    }))()`);
    if (JSON.stringify(desktop.links) !== JSON.stringify(expectedDesktop) || desktop.action !== "Browse directory" || desktop.menuDisplay !== "none" || desktop.overflow > 1) {
      throw new Error(`Desktop generated navigation QA failed: ${JSON.stringify(desktop)}`);
    }

    if (exceptions.length) throw new Error(`Navigation QA browser exceptions: ${exceptions.slice(0, 4).join(" | ")}`);
    console.log(`RWN navigation v3 QA passed for ${resource.id}: one mobile/desktop navigation model, immediate call, Apple Maps, Google Maps and details actions, 44px+ targets, collapsed secondary directory tools, and no horizontal overflow.`);
  } finally {
    client?.close();
    await stopProcess(browser);
    await stopProcess(server);
    await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
