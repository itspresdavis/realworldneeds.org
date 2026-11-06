import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const mealLabel = 'Directions to meal service';
const shelterLabel = 'Shelter intake details';
const officialHelp = 'https://www.bowery.org/get-help/';

async function assertAccessActions(scope) {
  const meal = scope.getByRole('link', { name: new RegExp('^' + mealLabel) });
  const shelter = scope.getByRole('link', { name: new RegExp('^' + shelterLabel) });
  await expect(meal).toBeVisible();
  await expect(shelter).toHaveAttribute('href', officialHelp);
  const destination = new URL(await meal.getAttribute('href'));
  expect(destination.hostname).toBe('www.google.com');
  expect(destination.pathname).toBe('/maps/dir/');
  expect(destination.searchParams.get('destination')).toContain('227 Bowery');
  expect(destination.searchParams.get('destination')).not.toContain('90 Lafayette');
  // No generic organization-coordinate action may imply that shelter is at the meal site.
  await expect(scope.getByRole('link', { name: /^(Directions|Google Maps|Apple Maps)(?: for The Bowery Mission)?$/ })).toHaveCount(0);
}

test('Bowery access routes survive detail, copy, print, and Saved on mobile', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async text => { window.__copiedListing = text; }
    }});
    window.print = () => { window.__printedListing = true; };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/service/bowery-mission');
  await assertAccessActions(page.locator('.service-next-steps'));
  await expect(page.locator('.directory-record')).toContainText('90 Lafayette');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.locator('[data-service-copy]').click();
  const copied = await page.evaluate(() => window.__copiedListing);
  expect(copied).toContain('227 Bowery');
  expect(copied).toContain('90 Lafayette');
  expect(copied).toContain('Shelter intake');
  expect(copied).toContain('NY 10002 Meals at');
  expect(copied).toContain('NY 10013 Overnight shelter');
  expect(copied).toContain('2026-11-06 Shelter intake');
  await page.locator('[data-service-print]').click();
  expect(await page.evaluate(() => window.__printedListing)).toBe(true);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.directory-record')).toBeVisible();
  await expect(page.locator('.directory-record')).toContainText('90 Lafayette');
  await page.emulateMedia({ media: 'screen' });
  await info.attach('service-access-mobile', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await page.locator('[data-service-save]').click();
  await expect(page.locator('[data-service-save]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'View saved services', exact: true }).click();
  const saved = page.locator('[data-saved-services]');
  await expect(saved.locator('a.directory-global-result[href="/service/bowery-mission"]')).toHaveAttribute('href', '/service/bowery-mission');
  await assertAccessActions(saved);
  await page.reload();
  await assertAccessActions(saved);
  expect(errors).toEqual([]);
});

test('homepage and searchable text results use the same service destinations', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /webgl/i.test(type) ? null : original.call(this, type, ...args);
    };
  });
  const externalMaps = [];
  page.on('request', request => { if (/maps\.(google|apple)|www\.google\.com\/maps/.test(request.url())) externalMaps.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-finder-startup', 'ready');
  await page.locator('#resourceSearch').fill('Bowery');
  const card = page.locator('.resource-card[data-result-resource-id="bowery-mission"]');
  await assertAccessActions(card);
  await page.goto('/directory');
  await page.locator('[data-directory-query]').fill('Bowery');
  const result = page.locator('.directory-global-result-wrap').filter({ has: page.locator('a[href="/service/bowery-mission"]') });
  await assertAccessActions(result);
  expect(externalMaps).toEqual([]);
});

test('service-specific access is usable with JavaScript disabled', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto(baseURL + '/service/bowery-mission');
    await expect(page.getByRole('heading', { name: 'The Bowery Mission', exact: true })).toBeVisible();
    await assertAccessActions(page.locator('.service-next-steps'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.directory-record')).toContainText('90 Lafayette');
  } finally { await context.close(); }
});
