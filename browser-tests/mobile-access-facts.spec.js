import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test('homepage retains consequential access facts at narrow and enlarged-text layouts', async ({ page }, info) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return /webgl/i.test(kind) ? null : original.call(this, kind, ...args); };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-finder-startup', 'ready');
  const search = page.locator('#resourceSearch');
  for (const fixture of [
    { query: 'Rosie', id: 'rosies-place-boston', fact: /women/i },
    { query: 'Bridge Over Troubled Waters', id: 'bridge-over-troubled-waters', fact: /ages 14–24/i },
  ]) {
    await search.fill(fixture.query); await search.press('Enter');
    await expect.poll(() => page.evaluate(() => history.state?.rwnFinder?.query)).toBe(fixture.query);
    const card = page.locator(`[data-result-resource-id="${fixture.id}"]`);
    const access = card.locator('.resource-row__access');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(access).toBeVisible();
      await expect(access).toContainText(fixture.fact);
      await card.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const bounds = await card.evaluate(card => {
        const row = card.getBoundingClientRect(), fact = card.querySelector('.resource-row__access').getBoundingClientRect();
        return { row: {left: row.left, right: row.right, bottom: row.bottom}, fact: {left: fact.left, right: fact.right, bottom: fact.bottom} };
      });
      expect(bounds.fact.left).toBeGreaterThanOrEqual(bounds.row.left);
      expect(bounds.fact.right).toBeLessThanOrEqual(bounds.row.right + 1);
      expect(bounds.fact.bottom).toBeLessThanOrEqual(bounds.row.bottom + 1);
      if (width === 390) await info.attach(`${fixture.id}-${width}`, {body: await page.screenshot(), contentType: 'image/png'});
    }
    await page.setViewportSize({ width: 320, height: 844 });
    await page.evaluate(() => document.documentElement.style.fontSize = '200%');
    await expect(access).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
  }
  expect(errors).toEqual([]);
});
