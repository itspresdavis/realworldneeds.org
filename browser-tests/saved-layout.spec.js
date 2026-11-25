import { test, expect } from '@playwright/test';
import { createCatalogUpgradeGate } from './catalog-upgrade-gate.js';

const widths = [320, 390, 768, 1024, 1440];
const ids = ['bowery-mission', 'womens-lunch-place'];
const rowFor = (page, id) => page.locator('[data-saved-list] .directory-global-result-wrap').filter({ has: page.locator(`a.directory-global-result[href="/service/${id}"]`) });

for (const upgraded of [false, true]) {
  test(`Saved facts and service actions stay readable ${upgraded ? 'after old-catalog recovery' : 'on a fresh page'}`, async ({ page, baseURL }, info) => {
    // CI uses the small real-worker fixture. An explicitly supplied local
    // historical build additionally verifies the actual old production worker.
    const legacyBuild = upgraded ? process.env.RWN_QA_LEGACY_BUILD : undefined;
    const gate = await createCatalogUpgradeGate(baseURL, { legacyBuild });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(gate.url + '/qa/bootstrap');
      await page.evaluate(ids => localStorage.setItem('rwn-saved-resources', JSON.stringify(ids)), ids);
      if (upgraded) {
        await page.evaluate(async () => {
          await navigator.serviceWorker.register('/sw.js', { scope: '/' });
          await navigator.serviceWorker.ready;
          if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
        });
        if (legacyBuild) expect(await page.evaluate(async () => (await (await fetch('/data/search-index.json')).json()).schemaVersion)).toBe('1.6');
        gate.useCandidate(); gate.setCatalogAvailable(false);
      }
      await page.goto(gate.url + '/directory#saved');
      if (upgraded) {
        const stale = await page.evaluate(async () => {
          const response = await fetch('/data/search-index.json?v=saved-layout');
          return { controlled: Boolean(navigator.serviceWorker.controller), schema: (await response.json()).schemaVersion, cache: response.headers.get('X-RWN-Catalog-Cache') };
        });
        expect(stale).toEqual({ controlled: true, schema: '1.6', cache: 'stale' });
        await expect(page.locator('[data-saved-retry]')).toBeVisible();
        gate.setCatalogAvailable(true);
        await page.locator('[data-saved-retry]').click();
      }
      await expect(page.locator('[data-saved-list] a.directory-global-result')).toHaveCount(2);
      await expect.poll(() => page.locator('[data-saved-clear]').evaluate(button => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      const bowery = rowFor(page, ids[0]), singleSite = rowFor(page, ids[1]);
      await expect(bowery.getByRole('link', { name: /^Shelter intake details/ })).toHaveAttribute('href', 'https://www.bowery.org/get-help/');
      const meal = bowery.getByRole('link', { name: /^Directions to meal service/ });
      expect(new URL(await meal.getAttribute('href')).searchParams.get('destination')).toContain('227 Bowery');
      await expect(singleSite.locator('.directory-global-result-actions a.is-map')).toHaveCount(2);
      const geometry = [];
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        // Settle viewport-relative CSS in Firefox/WebKit without time delays.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const measured = await page.locator('[data-saved-list] .directory-global-result-wrap').evaluateAll(rows => rows.map(row => {
          const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
          return { row: rect(row), facts: rect(row.querySelector('.directory-global-result')), actions: rect(row.querySelector('.directory-global-result-actions')), links: [...row.querySelectorAll('.directory-global-result-actions a')].map(link => ({ label: link.textContent, ...rect(link) })) };
        }));
        geometry.push({ width, measured });
        for (const entry of measured) {
          const readableWidth = width > 900 ? Math.min(400, entry.row.width / 2) : entry.row.width - 1;
          expect.soft(entry.facts.width, `readable facts at ${width}px`).toBeGreaterThanOrEqual(readableWidth);
          if (entry.actions.x >= entry.facts.right) expect.soft(entry.actions.y, `actions start beside facts at ${width}px`).toBeLessThanOrEqual(entry.facts.y + 2);
          for (const link of entry.links) {
            expect.soft(link.height, `${link.label} height at ${width}px`).toBeGreaterThanOrEqual(44);
            expect.soft(link.width, `${link.label} width at ${width}px`).toBeGreaterThanOrEqual(44);
            expect.soft(link.x, `${link.label} left boundary at ${width}px`).toBeGreaterThanOrEqual(entry.row.x - 1);
            expect.soft(link.right, `${link.label} right boundary at ${width}px`).toBeLessThanOrEqual(entry.row.right + 1);
          }
        }
        expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `no page overflow at ${width}px`).toBe(true);
        // Visual order remains DOM order: listing, each native action, Remove.
        await bowery.locator('a.directory-global-result').focus();
        for (const action of await bowery.locator('.directory-global-result-actions a').all()) {
          await page.keyboard.press('Tab');
          await expect(action).toBeFocused();
          expect(await action.evaluate(link => parseFloat(getComputedStyle(link).outlineWidth))).toBeGreaterThanOrEqual(2);
        }
        await page.keyboard.press('Tab');
        await expect(bowery.getByRole('button', { name: /^Remove/ })).toBeFocused();
        await info.attach(`saved-${upgraded ? 'upgraded' : 'fresh'}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      }
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rwn-saved-resources')))).toEqual(ids);
      await info.attach('saved-layout-geometry', { body: JSON.stringify({ upgraded, worker: legacyBuild ? 'complete historical build' : 'portable fixture', geometry }), contentType: 'application/json' });
      expect(errors).toEqual([]);
    } finally { await gate.close(); }
  });
}
