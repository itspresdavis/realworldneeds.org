import { test, expect } from '@playwright/test';
import { createCatalogUpgradeGate } from './catalog-upgrade-gate.js';

const savedKey = 'rwn-saved-resources';
const savedIds = ['bowery-mission', 'womens-lunch-place'];

test.beforeEach(async ({ context, page }) => {
  const errors = [], external = [];
  page.__upgradeEvidence = { errors, external };
  const observe = tab => tab.on('pageerror', error => errors.push(error.message));
  observe(page); context.on('page', observe);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (/^https?:$/.test(url.protocol) && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      external.push(url.origin + url.pathname); return route.abort();
    }
    return route.continue();
  });
});
test.afterEach(async ({ page }, info) => {
  await info.attach('upgrade-runtime-evidence', { body: JSON.stringify(page.__upgradeEvidence), contentType: 'application/json' });
  expect(page.__upgradeEvidence.errors).toEqual([]);
  expect(page.__upgradeEvidence.external).toEqual([]);
});

async function installLegacyWorker(page, gate) {
  await page.goto(gate.url + '/qa/bootstrap');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  gate.setCatalogAvailable(false);
  await proveLegacyCatalog(page, gate, 'bootstrap');
}

async function proveLegacyCatalog(page, gate, stage) {
  const evidence = await page.evaluate(async () => {
    const response = await fetch('/data/search-index.json?v=new-page-version');
    const payload = await response.json();
    return { controller: navigator.serviceWorker.controller.scriptURL, cached: response.headers.get('X-RWN-Catalog-Cache'), schema: payload.schemaVersion, routes: payload.records[0].serviceActions ?? null };
  });
  expect(evidence).toEqual({ controller: gate.url + '/sw.js', cached: 'stale', schema: '1.6', routes: null });
  await test.info().attach('legacy-controller-' + stage, { body: JSON.stringify(evidence), contentType: 'application/json' });
}

async function expectSafeBowery(scope) {
  await expect(scope.getByRole('link', { name: /^Shelter intake details/ })).toHaveAttribute('href', 'https://www.bowery.org/get-help/');
  const meal = scope.getByRole('link', { name: /^Directions to meal service/ });
  const url = new URL(await meal.getAttribute('href'));
  expect(url.searchParams.get('destination')).toContain('227 Bowery');
  expect(url.searchParams.get('destination')).not.toContain('90 Lafayette');
  await expect(scope.getByRole('link', { name: /^(Directions|Google Maps|Apple Maps)(?: for .+)?$/ })).toHaveCount(0);
}

test('new directory and Saved reject a legacy-controller catalog, then retry without losing saved IDs', async ({ page, baseURL }) => {
  const gate = await createCatalogUpgradeGate(baseURL);
  let savedPage;
  try {
    await installLegacyWorker(page, gate);
    await page.evaluate(({ key, ids }) => localStorage.setItem(key, JSON.stringify(ids)), { key: savedKey, ids: savedIds });
    await page.goto(gate.url + '/directory');
    await proveLegacyCatalog(page, gate, 'new-directory-page');
    await page.locator('[data-directory-query]').fill('Bowery');
    await expect(page.locator('[data-directory-retry]')).toBeVisible();
    await expect(page.locator('[data-directory-count]')).toHaveText('Search unavailable. Browse below or retry.');
    await expect(page.locator('a.directory-global-result')).toHaveCount(0);
    await expect(page.locator('[data-directory-query]')).toHaveValue('Bowery');
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), savedKey)).toEqual(savedIds);
    savedPage = await page.context().newPage();
    await savedPage.goto(gate.url + '/directory#saved');
    await proveLegacyCatalog(savedPage, gate, 'new-saved-page');
    await expect(savedPage.locator('[data-saved-summary]')).toContainText('listing details could not load');
    await expect(savedPage.locator('[data-saved-retry]')).toBeVisible();
    await expect(savedPage.locator('[data-saved-list] a.directory-global-result')).toHaveCount(0);
    expect(await savedPage.evaluate(key => JSON.parse(localStorage.getItem(key)), savedKey)).toEqual(savedIds);
    gate.setCatalogAvailable(true);
    await savedPage.locator('[data-saved-retry]').click();
    const bowery = savedPage.locator('[data-saved-list] .directory-global-result-wrap').filter({ has: savedPage.locator('a[href="/service/bowery-mission"]') });
    await expectSafeBowery(bowery);
    await expect(savedPage.locator('[data-saved-list] a.directory-global-result')).toHaveCount(2);
    expect(await savedPage.evaluate(key => JSON.parse(localStorage.getItem(key)), savedKey)).toEqual(savedIds);
    // The original error page stays open through the other tab's recovery.
    await page.locator('[data-directory-retry]').click();
    await expectSafeBowery(page.locator('.directory-global-results'));
    await expect(page.locator('[data-directory-query]')).toHaveValue('Bowery');
    expect(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL)).toBe(gate.url + '/sw.js');
  } finally { await savedPage?.close(); await gate.close(); }
});

test('actual legacy renderer cannot manufacture generic Bowery maps from the new compact index', async ({ page, baseURL }) => {
  const gate = await createCatalogUpgradeGate(baseURL);
  try {
    await page.goto(gate.url + '/qa/bootstrap');
    await page.evaluate(async () => {
      const { createResultRow } = await import('/qa/legacy-renderer.js');
      const payload = await (await fetch('/data/search-index.json')).json();
      const notice = document.createElement('p'); notice.id = 'legacy-notice'; document.body.append(notice);
      for (const id of ['bowery-mission', 'womens-lunch-place']) {
        const record = payload.records.find(record => record.id === id);
        if (!record) throw Error('Required real catalog record is missing: ' + id);
        const row = createResultRow(record, notice); row.dataset.fixtureId = id; document.body.append(row);
      }
    });
    const bowery = page.locator('[data-fixture-id="bowery-mission"]');
    await expect(bowery.locator('a.is-map')).toHaveCount(0);
    await expect(bowery.locator('a.is-call')).toHaveAttribute('href', 'tel:2122266214');
    await expect(bowery.locator('a.is-details')).toHaveAttribute('href', gate.url + '/service/bowery-mission');
    await expect(bowery.locator('a.is-details')).toBeVisible();
    // Ordinary single-site clients retain both established mapping actions.
    await expect(page.locator('[data-fixture-id="womens-lunch-place"] a.is-map')).toHaveCount(2);
  } finally { await gate.close(); }
});

test('offline action enhancement rejects legacy cached rows and recovers with explicit retry', async ({ page, baseURL }) => {
  const gate = await createCatalogUpgradeGate(baseURL);
  try {
    await installLegacyWorker(page, gate);
    await page.evaluate(async () => {
      document.body.innerHTML = '<aside id="offlineDirectoryNotice"><p>Cached directory information. Reconnect before travel.</p></aside><section class="directory-global-results"><a class="directory-global-result" href="/service/bowery-mission">The Bowery Mission</a></section>';
      await import('/offline-status.js?qa=compatibility');
    });
    await expect(page.locator('body')).toContainText('Listing actions are unavailable. Reconnect and retry.');
    await expect(page.locator('.directory-global-result-actions a')).toHaveCount(0);
    await expect(page.locator('a.directory-global-result')).toHaveAttribute('href', '/service/bowery-mission');
    gate.setCatalogAvailable(true);
    await page.locator('[data-directory-reconnect]').click();
    await expectSafeBowery(page.locator('.directory-global-results'));
    await expect(page.locator('body')).not.toContainText('Listing actions are unavailable. Reconnect and retry.');
  } finally { await gate.close(); }
});

test('worker replacement removes withdrawn fallback-owned actions without replacing normal renderer rows', async ({ page, baseURL }) => {
  const gate = await createCatalogUpgradeGate(baseURL);
  try {
    await installLegacyWorker(page, gate);
    gate.setCatalogAvailable(true);
    const payload = await page.evaluate(async () => (await fetch('/data/search-index.json')).json());
    await page.evaluate(async payload => {
      document.body.innerHTML = '<aside id="offlineDirectoryNotice"><p>Cached directory information. Reconnect before travel.</p></aside><section class="directory-global-results"><a class="directory-global-result" href="/service/bowery-mission">The Bowery Mission</a></section>';
      const { createResultRow } = await import('/qa/legacy-renderer.js');
      const normal = createResultRow(payload.records.find(record => record.id === 'womens-lunch-place'), document.getElementById('offlineDirectoryNotice'));
      normal.dataset.normalOwner = ''; window.normalOwnedRow = normal;
      document.querySelector('.directory-global-results').append(normal);
      await import('/offline-status.js?qa=compatibility');
    }, payload);
    const bowery = page.locator('.directory-global-result-wrap').filter({ has: page.locator('a.directory-global-result[href="/service/bowery-mission"]') });
    await expectSafeBowery(bowery);
    const normal = page.locator('[data-normal-owner]');
    await expect(normal.locator('a.is-map')).toHaveCount(2);
    gate.setCatalogPayload({ ...payload, records: payload.records.filter(record => record.id !== 'bowery-mission'), scopes: { '/directory': [] } });
    gate.replaceWorker();
    await page.evaluate(async () => {
      const changed = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update(); await changed;
    });
    await expect(page.getByRole('link', { name: /^Directions to meal service/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Shelter intake details/ })).toHaveCount(0);
    await expect(page.locator('a[href="/service/bowery-mission"]')).toHaveCount(1);
    await expect(normal.locator('a.is-map')).toHaveCount(2);
    expect(await normal.evaluate(node => node === window.normalOwnedRow)).toBe(true);
  } finally { await gate.close(); }
});
