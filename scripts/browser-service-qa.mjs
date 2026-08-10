import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = "http://127.0.0.1:4175";
const CDP_PORT = 9224;
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
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.ws?.close(); }
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed.");
  return result.result?.value;
}

async function navigate(client, url) {
  await client.call("Page.navigate", { url });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await evaluate(client, "document.readyState === 'complete'");
    if (ready) break;
    await sleep(75);
  }
  await sleep(350);
}

async function capture(client, name) {
  await mkdir(QA_DIR, { recursive: true });
  const { data } = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(join(QA_DIR, name), Buffer.from(data, "base64"));
}

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return String(value || "");
  }
}

async function run() {
  const chrome = findChrome();
  const profile = await mkdtemp(join(tmpdir(), "rwn-service-qa-"));
  const server = spawn(process.execPath, ["scripts/serve.mjs", "4175"], { stdio: ["ignore", "pipe", "pipe"] });
  let browser;
  let client;

  try {
    await waitFor(`${HOST}/`);
    const payload = await (await fetch(`${HOST}/data/resources.json`)).json();
    const resource = payload.resources.find((item) => item.kind === "direct" && item.phone)
      || payload.resources.find((item) => item.kind === "direct")
      || payload.resources[0];
    if (!resource) throw new Error("No reviewed service exists for browser QA.");

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

    const serviceUrl = `${HOST}/service/${encodeURIComponent(resource.id)}`;
    await client.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 1000 });
    await navigate(client, serviceUrl);
    const desktop = await evaluate(client, `(() => {
      const next = document.querySelector(".service-next-steps");
      const policy = document.querySelector("#service .policy-note");
      const primary = next?.querySelector("a.is-primary");
      const phone = next?.querySelector('a[href^="tel:"]');
      const interactive = [...(next?.querySelectorAll("a") || [])].find((link) => link.getAttribute("href")?.startsWith("/#resource="));
      const rect = next?.getBoundingClientRect();
      const links = [...(next?.querySelectorAll("a") || [])];
      return {
        title: document.querySelector("#service h1")?.textContent?.trim() || "",
        nextSteps: Boolean(next),
        actionCount: links.length,
        primaryHref: primary?.href || "",
        primaryExternal: Boolean(primary && primary.protocol === "https:"),
        phoneHref: phone?.getAttribute("href") || "",
        interactiveHref: interactive?.getAttribute("href") || "",
        aboveFold: Boolean(rect && rect.top < innerHeight - 70 && rect.bottom > 0),
        beforePolicy: Boolean(next && policy && (next.compareDocumentPosition(policy) & Node.DOCUMENT_POSITION_FOLLOWING)),
        mapActions: links.filter((link) => /Maps|Directions/.test(link.textContent || "")).length,
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
      };
    })()`);
    await capture(client, "service-desktop.png");
    const sourceMatches = normalizedUrl(desktop.primaryHref) === normalizedUrl(resource.sourceUrl);
    const phoneAction = resource.phone ? desktop.phoneHref.startsWith("tel:") : true;
    const privateMapLink = desktop.interactiveHref.startsWith("/#resource=") && !desktop.interactiveHref.includes("?resource=");
    if (!desktop.nextSteps || desktop.actionCount < 3 || !desktop.primaryExternal || !sourceMatches || !phoneAction || !privateMapLink || !desktop.aboveFold || !desktop.beforePolicy || desktop.mapActions < 2 || desktop.overflow > 8) {
      throw new Error(`Desktop service landing page failed: ${JSON.stringify({ ...desktop, sourceMatches, phoneAction, privateMapLink })}`);
    }

    await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
    await navigate(client, serviceUrl);
    const mobile = await evaluate(client, `(() => {
      const next = document.querySelector(".service-next-steps");
      const rect = next?.getBoundingClientRect();
      const actions = [...(next?.querySelectorAll("a") || [])];
      return {
        nextSteps: Boolean(next),
        aboveFold: Boolean(rect && rect.top < innerHeight && rect.bottom > 0),
        minimumActionHeight: actions.length ? Math.min(...actions.map((link) => link.getBoundingClientRect().height)) : 0,
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
      };
    })()`);
    await capture(client, "service-mobile.png");
    if (!mobile.nextSteps || !mobile.aboveFold || mobile.minimumActionHeight < 44 || mobile.overflow > 8) {
      throw new Error(`Mobile service landing page failed: ${JSON.stringify(mobile)}`);
    }

    await navigate(client, `${HOST}/directory`);
    const directoryMobile = await evaluate(client, `(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitUntil = async (predicate, attempts = 80) => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (predicate()) return true;
          await sleep(25);
        }
        return false;
      };
      const tools = document.querySelector("[data-directory-search]");
      const input = document.querySelector("[data-directory-query]");
      const list = document.querySelector("[data-global-list]");
      const toolsRect = tools?.getBoundingClientRect();
      const chips = [...document.querySelectorAll("[data-directory-category]")];
      if (!tools || !input || !list || chips.length < 2) return { ok: false, reason: "directory mobile controls missing" };
      const catalog = await fetch("/data/search-index.json").then((response) => response.json());
      const target = catalog.records.find((record) => record.kind === "direct") || catalog.records[0];
      if (!target) return { ok: false, reason: "search catalog empty" };
      input.value = target.name;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const targetHref = "/service/" + encodeURIComponent(target.id);
      const found = await waitUntil(() => [...list.querySelectorAll("a")].some((link) => new URL(link.href).pathname === targetHref));
      return {
        ok: true,
        searchAboveFold: Boolean(toolsRect && toolsRect.top < innerHeight - 44 && toolsRect.bottom > 0),
        minimumChipHeight: Math.min(...chips.map((chip) => chip.getBoundingClientRect().height)),
        found,
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
      };
    })()`);
    await capture(client, "directory-mobile.png");
    if (!directoryMobile.ok || !directoryMobile.searchAboveFold || directoryMobile.minimumChipHeight < 44 || !directoryMobile.found || directoryMobile.overflow > 8) {
      throw new Error(`Mobile directory failed: ${JSON.stringify(directoryMobile)}`);
    }

    console.log(`RWN service/directory mobile QA passed for ${resource.id}: verified source action, phone/map next steps, above-fold task flow, private map deep-link, mobile directory search, touch targets, no overflow, and screenshots.`);
  } finally {
    client?.close();
    await stopProcess(browser);
    await stopProcess(server);
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 125 });
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});