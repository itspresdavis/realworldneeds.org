import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('offscreen globe waits while the visitor uses text search, then loads on exploration', async ({ page, browserName }, info) => {
  await page.setViewportSize({ width: 390, height: 500 });
  const graphics = [], errors = [];
  page.on('request', request => { if (/\/vendor\/three|\/media\/earth|\/data\/countries/.test(request.url())) graphics.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-finder-startup', 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-globe-startup', /deferred|unavailable/);
  const supported = await page.locator('html').getAttribute('data-globe-startup') === 'deferred';
  await info.attach('graphics-capability', { body: JSON.stringify({ supported, browserName }), contentType: 'application/json' });
  if (browserName === 'chromium') expect(supported, 'configured software GPU must support the map').toBe(true);
  test.skip(!supported, 'This engine has no usable WebGL; the immediate text fallback is a separate mandatory case.');
  await page.locator('#resourceSearch').fill('Boston');
  await expect(page.locator('.resource-card').first()).toContainText('Boston');
  expect(graphics).toEqual([]);
  await page.locator('#globeCanvas').scrollIntoViewIfNeeded();
  await expect(page.locator('html')).toHaveAttribute('data-globe-startup', /ready|unavailable/);
  if (await page.locator('html').getAttribute('data-globe-startup') === 'ready') {
    expect(graphics.some(url => /\/vendor\/three/.test(url))).toBe(true);
    await page.locator('#zoomIn').click();
    await page.locator('#zoomOut').click();
    await expect(page.locator('#globeFallback')).toBeHidden();
  } else {
    await expect(page.locator('#globeFallback')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('unavailable graphics immediately offer the text path even when the map is offscreen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  const graphics = [];
  page.on('request', request => { if (/\/vendor\/three|\/media\/earth|\/data\/countries/.test(request.url())) graphics.push(request.url()); });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /webgl/i.test(type) ? null : original.call(this, type, ...args); };
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-finder-startup', 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-globe-startup', 'unavailable');
  await expect(page.locator('#globeFallback a')).toHaveAttribute('href', '/directory');
  await page.locator('#resourceSearch').fill('Boston');
  await expect(page.locator('.resource-card').first()).toContainText('Boston');
  expect(graphics).toEqual([]);
});

test('context loss before exploration preserves text search without loading the engine', async ({ page, browserName }, info) => {
  await page.setViewportSize({ width: 390, height: 500 });
  const graphics = [], errors = [], initializationWarnings = [];
  page.on('request', request => { if (/\/vendor\/three|\/media\/earth|\/data\/countries/.test(request.url())) graphics.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/WebGL globe could not be initialized/.test(message.text())) initializationWarnings.push(message.text()); });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-globe-startup', /deferred|unavailable/);
  const supported = await page.locator('html').getAttribute('data-globe-startup') === 'deferred';
  if (browserName === 'chromium') expect(supported).toBe(true);
  test.skip(!supported, 'This engine has no usable WebGL; the immediate text fallback is separately mandatory.');
  const injected = await page.locator('#globeCanvas').evaluate(canvas => new Promise(resolve => {
    const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!extension) return resolve(false);
    canvas.addEventListener('webglcontextlost', () => resolve(true), { once: true });
    extension.loseContext();
  }));
  await info.attach('deferred-context-loss-capability', { body: JSON.stringify({ injected, browserName }), contentType: 'application/json' });
  if (browserName === 'chromium') expect(injected).toBe(true);
  test.skip(!injected, 'This engine does not expose the context-loss testing extension.');
  await page.locator('#globeCanvas').scrollIntoViewIfNeeded();
  await expect(page.locator('html')).toHaveAttribute('data-globe-startup', 'unavailable');
  await expect(page.locator('#globeFallback')).toBeVisible();
  await page.locator('#resourceSearch').fill('Boston');
  await expect(page.locator('.resource-card').first()).toContainText('Boston');
  expect(graphics).toEqual([]);
  expect(initializationWarnings).toEqual([]);
  expect(errors).toEqual([]);
});
