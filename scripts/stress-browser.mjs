import { chromium } from "playwright";

const baseURL = process.env.STRESS_BASE_URL || "http://127.0.0.1:4173";

async function exercise(label, contextOptions) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-gl=angle",
      "--use-angle=swiftshader-webgl",
      "--disable-dev-shm-usage"
    ]
  });
  const context = await browser.newContext(contextOptions);
  await context.addInitScript(() => {
    window.__rwnStress = { longTasks: [] };
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__rwnStress.longTasks.push(entry.duration);
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {}
  });
  const page = await context.newPage();
  const errors = [];
  const failedRequests = [];
  const badResponses = [];

  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(baseURL)) failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`);
  });
  page.on("response", (response) => {
    if (response.url().startsWith(baseURL) && response.status() >= 500) badResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`${baseURL}/`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator("#globeCanvas").waitFor({ state: "visible", timeout: 30000 });

  const resourceCount = await page.evaluate(async () => {
    const response = await fetch("/data/resources.json", { cache: "no-store" });
    const data = await response.json();
    return Array.isArray(data) ? data.length : Array.isArray(data.resources) ? data.resources.length : -1;
  });
  if (resourceCount < 1900) throw new Error(`${label}: expected >=1900 published resources, got ${resourceCount}`);

  const renderer = await page.evaluate(() => {
    const canvas = document.getElementById("globeCanvas");
    const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
    if (!gl) return { available: false };
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      available: true,
      renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : "unknown",
      vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : "unknown"
    };
  });
  if (!renderer.available) throw new Error(`${label}: WebGL is unavailable in the stress browser; GPU point path was not exercised`);

  const canvas = page.locator("#globeCanvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error(`${label}: globe canvas has no layout box`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  for (let round = 0; round < 18; round += 1) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let step = 0; step < 7; step += 1) {
      const direction = round % 2 === 0 ? 1 : -1;
      await page.mouse.move(
        cx + direction * Math.min(box.width * 0.38, 70 + step * 24),
        cy + Math.sin((round + step) * 0.7) * Math.min(box.height * 0.18, 80),
        { steps: 2 }
      );
    }
    await page.mouse.up();
    await page.mouse.wheel(0, round % 2 === 0 ? -520 : 430);
  }

  for (let index = 0; index < 36; index += 1) {
    await page.locator(index % 2 ? "#zoomIn" : "#zoomOut").click({ force: true });
  }

  const regionValues = ["americas", "europeAfrica", "asia", "oceania", "world"];
  for (let index = 0; index < 20; index += 1) {
    await page.locator("#regionFocus").selectOption(regionValues[index % regionValues.length]);
  }

  const search = page.locator("#resourceSearch");
  const searches = ["food", "London", "shelter", "Boston", "voucher", "showers", "Belfast", "water", "Manchester", "health"];
  for (let index = 0; index < 45; index += 1) {
    await search.fill(searches[index % searches.length]);
  }
  await search.fill("");

  const layerButtons = page.locator("[data-type]");
  const layerCount = await layerButtons.count();
  for (let index = 0; index < Math.min(42, layerCount * 6); index += 1) {
    await layerButtons.nth(index % layerCount).click({ force: true });
  }
  await page.locator("#toggleAll").click({ force: true });
  await page.locator("#toggleAll").click({ force: true });

  const navSelectors = ["a[href='#about']", "a[href='#standards']", "a[href='#finder']"];
  for (let index = 0; index < 18; index += 1) {
    const locator = page.locator(navSelectors[index % navSelectors.length]).first();
    await locator.click({ force: true });
  }

  await page.evaluate(() => {
    for (let index = 0; index < 16; index += 1) {
      window.scrollTo({ top: index % 2 ? document.body.scrollHeight : 0, behavior: "auto" });
    }
  });
  await page.waitForTimeout(250);

  await page.goto(`${baseURL}/directory`, { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(() => {
    for (let index = 0; index < 24; index += 1) {
      window.scrollTo({ top: index % 2 ? document.body.scrollHeight : 0, behavior: "auto" });
    }
  });
  await page.waitForTimeout(200);
  await page.goBack({ waitUntil: "networkidle", timeout: 60000 });
  await page.locator("#globeCanvas").waitFor({ state: "visible", timeout: 30000 });

  const metrics = await page.evaluate(() => {
    const longTasks = window.__rwnStress?.longTasks || [];
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      longTaskCount: longTasks.length,
      worstLongTaskMs: longTasks.length ? Math.max(...longTasks) : 0,
      domContentLoadedMs: nav?.domContentLoadedEventEnd || 0,
      loadEventMs: nav?.loadEventEnd || 0,
      heap: performance.memory?.usedJSHeapSize || null
    };
  });

  if (metrics.worstLongTaskMs > 2500) errors.push(`worst long task was ${metrics.worstLongTaskMs.toFixed(1)}ms`);
  if (failedRequests.length) errors.push(...failedRequests.map((item) => `requestfailed: ${item}`));
  if (badResponses.length) errors.push(...badResponses.map((item) => `bad response: ${item}`));

  console.log(JSON.stringify({ label, resourceCount, renderer, metrics, errors }, null, 2));
  await browser.close();
  if (errors.length) throw new Error(`${label}: browser stress detected ${errors.length} problem(s)`);
}

await exercise("desktop", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await exercise("mobile-touch", {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36"
});
