import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return /webgl/i.test(kind) ? null : original.call(this, kind, ...args); };
  });
});

test('language switching preserves finder task, provider facts and Saved IDs', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-finder-startup', 'ready');
  const input = page.locator('#resourceSearch'); await input.fill('Rosie'); await input.press('Enter');
  await expect.poll(() => page.evaluate(() => history.state?.rwnFinder?.query)).toBe('Rosie');
  const card = page.locator('[data-result-resource-id="rosies-place-boston"]');
  await expect(card.locator('.resource-row__access')).toContainText('Services for women');
  const before = await page.evaluate(() => ({ state: history.state, href: location.href }));
  await page.locator('[data-language-control] select').selectOption('es');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(input).toHaveValue('Rosie');
  await expect(card.locator('.resource-row__access')).toContainText('Services for women');
  await expect(card.locator('.resource-row__access')).toHaveAttribute('lang', 'en');
  await expect(page.locator('[data-language-notice]')).toContainText('no confirma que el proveedor atienda en español');
  await expect(page.locator('.header-action')).toHaveText('Guardados');
  await expect(page.locator('.about-rwn')).toHaveAttribute('lang', 'en');
  expect(await page.evaluate(() => ({ state: history.state, href: location.href }))).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await card.scrollIntoViewIfNeeded();
  await info.attach('spanish-mobile-result', {body: await page.screenshot(), contentType:'image/png'});
  await page.evaluate(() => localStorage.setItem('rwn-saved-resources', JSON.stringify(['rosies-place-boston','bowery-mission'])));
  await page.goto('/directory#saved');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('[data-saved-list] .saved-service-row')).toHaveCount(2);
  await expect(page.locator('#saved-services-heading')).toHaveText('Servicios guardados');
  await expect(page.locator('[data-saved-list] [data-saved-remove]').first()).toHaveText('Quitar');
  const directions = page.locator('[data-saved-list] a[href*="destination="]').first();
  const href = await directions.getAttribute('href');
  await page.locator('[data-language-control] select').selectOption('en');
  await expect(page.locator('#saved-services-heading')).toHaveText('Saved services');
  expect(await directions.getAttribute('href')).toBe(href);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rwn-saved-resources')))).toEqual(['rosies-place-boston','bowery-mission']);
  await page.locator('[data-language-control] select').focus();
  expect(await page.locator('[data-language-control] select').evaluate(el=>parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThanOrEqual(2);
  const scan = await new AxeBuilder({page}).include('.rwn-language-bar').analyze();
  expect(scan.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test('language switching works when preference storage is denied and never translates form values', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = function(){ throw new DOMException('Blocked', 'SecurityError'); };
    Storage.prototype.getItem = function(){ throw new DOMException('Blocked', 'SecurityError'); };
  });
  await page.goto('/directory');
  const input = page.locator('[data-directory-query]');
  await input.fill('shelter Boston');
  await page.locator('[data-language-control] select').selectOption('es');
  await expect(input).toHaveValue('shelter Boston');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(input).toHaveAttribute('aria-label', 'Buscar en este directorio');
  await page.locator('[data-language-control] select').selectOption('en');
  await expect(input).toHaveValue('shelter Boston');
  await expect(input).toHaveAttribute('aria-label', 'Search this directory');
});

test('translated detail page settles and keeps original service destinations', async ({ page }) => {
  await page.goto('/service/bowery-mission');
  const destination = page.locator('a[href*="destination="]').first();
  const href = await destination.getAttribute('href');
  await page.locator('[data-language-control] select').selectOption('es');
  await expect(page.locator('#service-details-heading')).toHaveText('Detalles del servicio');
  expect(await destination.getAttribute('href')).toBe(href);
  await expect(page.locator('.service-facts')).toContainText('227 Bowery');
  await expect(page.locator('.service-facts')).toContainText('90 Lafayette');
  const mutations = await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    let changes=0;const observer=new MutationObserver(records=>changes+=records.length);
    observer.observe(document.querySelector('#service'),{subtree:true,characterData:true,childList:true});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));observer.disconnect();return changes;
  });
  expect(mutations).toBe(0);
  const scan = await new AxeBuilder({page}).analyze();
  expect(scan.violations).toEqual([]);
});

test('Spanish directory retains its search through offline and connection recovery', async ({ page, context }) => {
  await page.goto('/directory');
  await page.locator('[data-directory-query]').fill('Boston');
  await expect(page.locator('[data-global-list] .directory-global-result').first()).toBeVisible();
  await page.locator('[data-language-control] select').selectOption('es');
  await context.setOffline(true);
  await expect(page.locator('#offlineDirectoryNotice')).toBeVisible();
  await expect(page.locator('#offlineDirectoryNotice')).toContainText(/conexión|conectarte/);
  await expect(page.locator('[data-directory-query]')).toHaveValue('Boston');
  await context.setOffline(false);
  const retry = page.locator('[data-directory-reconnect]');
  if (await retry.isVisible()) await retry.click();
  await expect(page.locator('[data-global-list] .directory-global-result').first()).toBeVisible();
  await expect(page.locator('[data-directory-query]')).toHaveValue('Boston');
  await page.locator('[data-language-control] select').selectOption('en');
  await expect(page.locator('[data-directory-count]')).toContainText(/matching listing/);
  await expect(page.locator('[data-directory-count]')).not.toContainText('copia sin conexión');
});
