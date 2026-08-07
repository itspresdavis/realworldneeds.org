import { chromium } from "playwright";

const baseURL = process.env.STRESS_BASE_URL || "http://127.0.0.1:4173";

async function runScenario(label, options) {
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
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);

  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console:${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(baseURL)) problems.push(`request:${request.url()}:${request.failure()?.errorText || "failed"}`);
  });
  page.on("response", (response) => {
    if (response.url().startsWith(baseURL) && response.status() >= 500) problems.push(`http:${response.status()}:${response.url()}`);
  });

  await page.addInitScript(() => {
    window.__chaosLongTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__chaosLongTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    } catch {}
  });

  await page.goto(`${baseURL}/`, { waitUntil: "networkidle", timeout: 40_000 });
  await page.locator("#globeCanvas").waitFor({ state: "visible" });

  const initial = await page.evaluate(async () => {
    const canvas = document.getElementById("globeCanvas");
    const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
    const response = await fetch("/data/resources.json", { cache: "no-store" });
    const data = await response.json();
    return {
      resources: data.resourceCount ?? data.resources?.length ?? (Array.isArray(data) ? data.length : -1),
      webgl: Boolean(gl),
      gpuClass: canvas?.closest(".globe-stage")?.classList.contains("has-gpu-points") || false,
      canvasWidth: canvas?.width || 0,
      canvasHeight: canvas?.height || 0
    };
  });

  if (initial.resources !== 1984) throw new Error(`${label}: expected 1984 resources, got ${initial.resources}`);
  if (!initial.webgl) throw new Error(`${label}: WebGL unavailable`);
  if (!initial.gpuClass) throw new Error(`${label}: GPU service-point layer did not initialize`);
  if (!initial.canvasWidth || !initial.canvasHeight) throw new Error(`${label}: globe canvas has no render surface`);

  await page.evaluate(async () => {
    const canvas = document.getElementById("globeCanvas");
    const rect = canvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

    // 80 rapid mouse-style drag gestures with 8 moves each.
    for (let round = 0; round < 80; round += 1) {
      const pointerId = 1000 + round;
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, cancelable: true, pointerId, pointerType: "mouse",
        clientX: centerX, clientY: centerY, buttons: 1
      }));
      for (let step = 0; step < 8; step += 1) {
        canvas.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true, cancelable: true, pointerId, pointerType: "mouse",
          clientX: centerX + ((round % 2 ? -1 : 1) * (40 + step * 22)),
          clientY: centerY + Math.sin((round + step) * 0.45) * 70,
          buttons: 1
        }));
      }
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true, cancelable: true, pointerId, pointerType: "mouse",
        clientX: centerX, clientY: centerY, buttons: 0
      }));
      canvas.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true, cancelable: true, deltaY: round % 2 ? 520 : -620
      }));
      if (round % 8 === 0) await frame();
    }

    // Rapid search updates across multiple animation frames.
    const input = document.getElementById("resourceSearch");
    const terms = ["food", "London", "voucher", "Boston", "shelter", "water", "Belfast", "health", "Manchester", "clothing"];
    for (let batch = 0; batch < 16; batch += 1) {
      for (let index = 0; index < 12; index += 1) {
        input.value = terms[(batch + index) % terms.length];
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
      }
      await frame();
    }
    input.value = "";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    await frame();

    // Hammer category/filter controls without Playwright actionability waits.
    const filters = [...document.querySelectorAll("[data-type]")];
    for (let index = 0; index < 120; index += 1) filters[index % filters.length]?.click();
    document.getElementById("toggleAll")?.click();
    document.getElementById("toggleAll")?.click();

    // Hammer zoom / motion / region controls.
    for (let index = 0; index < 100; index += 1) {
      document.getElementById(index % 2 ? "zoomIn" : "zoomOut")?.click();
      if (index % 10 === 0) document.getElementById("toggleMotion")?.click();
    }
    const region = document.getElementById("regionFocus");
    const regions = ["world", "americas", "europeAfrica", "asia", "oceania"];
    for (let index = 0; index < 50; index += 1) {
      region.value = regions[index % regions.length];
      region.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // Force repeated scroll work while the globe is visible/offscreen.
    for (let index = 0; index < 60; index += 1) {
      window.scrollTo(0, index % 2 ? document.body.scrollHeight : 0);
      window.dispatchEvent(new Event("scroll"));
    }
    window.scrollTo(0, 0);
    await frame();
  });

  if (options.hasTouch) {
    const canvas = page.locator("#globeCanvas");
    const box = await canvas.boundingBox();
    const cdp = await context.newCDPSession(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (let round = 0; round < 20; round += 1) {
      const start = round % 2 ? 100 : 38;
      const end = round % 2 ? 38 : 108;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: cx - start, y: cy, id: 1 }, { x: cx + start, y: cy, id: 2 }]
      });
      for (let step = 1; step <= 4; step += 1) {
        const gap = start + (end - start) * (step / 4);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: cx - gap, y: cy - step, id: 1 }, { x: cx + gap, y: cy + step, id: 2 }]
        });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
  }

  await page.waitForTimeout(400);
  const afterChaos = await page.evaluate(() => ({
    gpuClass: document.querySelector(".globe-stage")?.classList.contains("has-gpu-points") || false,
    canvasWidth: document.getElementById("globeCanvas")?.width || 0,
    selectedPins: document.querySelectorAll(".globe-pin.is-selected").length,
    longTasks: window.__chaosLongTasks || [],
    bodyHeight: document.body.scrollHeight
  }));
  if (!afterChaos.gpuClass || !afterChaos.canvasWidth) problems.push("globe render surface lost after chaos");

  await page.goto(`${baseURL}/directory`, { waitUntil: "load", timeout: 40_000 });
  const directoryCount = await page.locator(".directory-record").count();
  if (directoryCount !== 1984) problems.push(`directory count ${directoryCount}/1984`);
  await page.evaluate(() => {
    for (let i = 0; i < 80; i += 1) window.scrollTo(0, i % 2 ? document.body.scrollHeight : 0);
  });

  await page.goto(`${baseURL}/`, { waitUntil: "load", timeout: 40_000 });
  await page.locator("#globeCanvas").waitFor({ state: "visible" });
  const recovered = await page.evaluate(() => document.querySelector(".globe-stage")?.classList.contains("has-gpu-points") || false);
  if (!recovered) problems.push("GPU point layer failed after route churn");

  const longTasks = afterChaos.longTasks;
  const metrics = {
    count: longTasks.length,
    worstMs: longTasks.length ? Math.max(...longTasks) : 0,
    over100: longTasks.filter((duration) => duration > 100).length,
    over500: longTasks.filter((duration) => duration > 500).length
  };
  if (metrics.worstMs > 2000) problems.push(`worst long task ${metrics.worstMs.toFixed(1)}ms`);

  console.log(JSON.stringify({ label, initial, directoryCount, metrics, problems }, null, 2));
  await browser.close();
  if (problems.length) throw new Error(`${label}: ${problems.join(" | ")}`);
}

await runScenario("desktop-chaos", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await runScenario("mobile-touch-chaos", {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36"
});
