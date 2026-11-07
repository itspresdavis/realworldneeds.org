import { resources } from "../src/data/resources.js";
import { test, expect } from '@playwright/test';

// These expectations come from the published catalog's service/source fields,
// not from the matcher under test. They do not certify current availability.
const mealSites = [
  'boston-homeless-services', 'southampton-shelter', 'woods-mullen-shelter',
  'pine-street-mens-inn', 'pine-street-yawkey', 'st-francis-house-boston',
  'rosies-place-boston', 'womens-lunch-place', 'bridge-over-troubled-waters',
  'whittier-day-engagement', 'cardinal-medeiros-day',
].sort();
// Independent geographic oracle uses published country/city fields, never the matcher.
const mexicoSites = resources.filter(record => record.country === 'Mexico' || record.city === 'Mexico').map(record => record.id).sort();
const mexicoCountrySites = resources.filter(record => record.country === 'Mexico').map(record => record.id).sort();
const taunton = ['ma-wic-tauntonattleboro-wic-program-main-clinic', 'taunton-community-table-meals'].sort();
const surfaces = ['/', '/directory'];

// No provider request or location service is needed to search this catalog.
// Service-worker behavior has its own suite; disable it here so every request
// is bounded to the explicitly selected local test origin.
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const external = [], errors = [];
  page.__searchEvidence = { external, errors };
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (/^https?:$/.test(url.protocol) && url.origin !== origin) {
      external.push(url.origin + url.pathname);
      return route.abort();
    }
    return route.continue();
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /webgl/i.test(type) ? null : original.call(this, type, ...args);
    };
    window.__locationRequests = 0;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition(_success, failure) {
        window.__locationRequests += 1;
        queueMicrotask(() => failure({ code: 1, message: 'Permission denied by browser test fixture' }));
      },
    } });
  });
});
test.afterEach(async ({ page }, info) => {
  const evidence = page.__searchEvidence;
  await info.attach('search-runtime', { body: JSON.stringify(evidence), contentType: 'application/json' });
  expect(evidence.errors, 'uncaught browser errors').toEqual([]);
  expect(evidence.external, 'local search must not request third-party services').toEqual([]);
});

async function openSurface(page, path) {
  await page.goto(path);
  if (path === '/') await expect(page.locator('html')).toHaveAttribute('data-finder-startup', 'ready');
  return path === '/' ? page.locator('#resourceSearch') : page.locator('[data-directory-query]');
}

async function search(page, path, query) {
  const input = path === '/' ? page.locator('#resourceSearch') : page.locator('[data-directory-query]');
  await input.fill(query);
  if (path === '/') await input.press('Enter');
  // Wait for the real input transaction to commit, including empty-to-empty
  // transitions; an unchanged row count alone can accidentally observe old UI.
  await expect.poll(() => page.evaluate(home => history.state?.[home ? 'rwnFinder' : 'rwnDirectory']?.query, path === '/')).toBe(query);
  await expect(input).toHaveValue(query);
  return input;
}

async function resultIds(page, path) {
  if (path === '/') {
    // All fixtures below fit within two result batches. Use the real control
    // to compare complete results, not just whichever names fit the viewport.
    const more = page.locator('#showMoreResults');
    for (let batch = 0; batch < 4 && await more.isVisible(); batch += 1) await more.click();
    await expect(more).toBeHidden();
    return page.locator('.resource-card[data-result-resource-id]').evaluateAll(cards => cards.map(card => card.dataset.resultResourceId));
  }
  return page.locator('a.directory-global-result').evaluateAll(links => links.map(link => link.getAttribute('href').split('/').pop()));
}

function resultScope(page, path, id) {
  return path === '/'
    ? page.locator(`.resource-card[data-result-resource-id="${id}"]`)
    : page.locator('.directory-global-result-wrap').filter({ has: page.locator(`a.directory-global-result[href="/service/${id}"]`) });
}

test('manual place search works before and after deliberate location denial', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSurface(page, '/');
  await search(page, '/', 'Taunton MA assistance');
  expect((await resultIds(page, '/')).sort()).toEqual(taunton);
  expect(await page.evaluate(() => window.__locationRequests)).toBe(0);
  await page.locator('#locateMe').click();
  await expect(page.locator('#locationRecovery')).toContainText('Location permission was not granted');
  await expect(page.locator('#locationRecovery')).toContainText('Search by city, ZIP or postcode instead');
  expect(await page.evaluate(() => window.__locationRequests)).toBe(1);
  await expect(page.locator('#clearLocation')).toBeHidden();
  expect((await resultIds(page, '/')).sort()).toEqual(taunton);
  await search(page, '/', '90 Lafayette shelter');
  expect(await resultIds(page, '/')).toEqual(['bowery-mission']);
  expect(await page.evaluate(() => window.__locationRequests)).toBe(1);
  await info.attach('denied-location-manual-search', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('Mexico ambiguity stays visible until the visitor supplies a country or region', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of surfaces) {
    await openSurface(page, path);
    const hint = page.locator(path === '/' ? '#searchGeographyHint' : '[data-geography-hint]');
    for (const query of ['Mexico', 'México']) {
      await search(page, path, query);
      expect((await resultIds(page, path)).sort()).toEqual(mexicoSites);
      await expect(hint).toBeVisible();
      await expect(hint).toContainText('country Mexico');
      await expect(hint).toContainText('Mexico, United States');
      await expect(hint).toContainText('Add a country or region');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await info.attach(path === '/' ? 'finder-mexico-choice' : 'directory-mexico-choice', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    if (path === '/directory') {
      await page.locator('[data-directory-country]').selectOption({ label: 'Mexico' });
      await expect(page.locator('a.directory-global-result')).toHaveCount(mexicoCountrySites.length);
      expect((await resultIds(page, path)).sort()).toEqual(mexicoCountrySites);
      await expect(hint).toBeHidden();
      await expect(page.locator('[data-directory-query]')).toHaveValue('México');
      await page.locator('[data-directory-country]').selectOption('');
      await expect(page.locator('a.directory-global-result')).toHaveCount(mexicoSites.length);
    }
    await search(page, path, 'Mexico NY');
    expect(await resultIds(page, path)).toEqual(['ny-wic-214-05']);
    await expect(hint).toBeHidden();
    expect(await page.evaluate(() => window.__locationRequests)).toBe(0);
  }
});

test('meal-specific queries return catalog meal services consistently, including shelter meal listings', async ({ page }) => {
  for (const path of surfaces) {
    await openSurface(page, path);
    await search(page, path, 'Boston US meals');
    expect((await resultIds(page, path)).sort()).toEqual(mealSites);
    await expect(resultScope(page, path, 'rosies-place-boston')).toBeVisible();
    await expect(resultScope(page, path, 'st-francis-house-boston')).toBeVisible();
  }
});

test('drinking-water intent does not turn a provider name into a service claim', async ({ page }) => {
  for (const path of surfaces) {
    await openSurface(page, path);
    await search(page, path, 'water Boston');
    expect(await resultIds(page, path)).toEqual([]);
    await search(page, path, 'Bridge Over Troubled Waters');
    expect(await resultIds(page, path)).toEqual(['bridge-over-troubled-waters']);
    await expect(resultScope(page, path, 'bridge-over-troubled-waters')).toContainText('Bridge Over Troubled Waters');
  }
});

test('shelter intake address finds Bowery with the reviewed service-specific next step on both surfaces', async ({ page }) => {
  for (const path of surfaces) {
    await openSurface(page, path);
    await search(page, path, '90 Lafayette shelter');
    expect(await resultIds(page, path)).toEqual(['bowery-mission']);
    const card = resultScope(page, path, 'bowery-mission');
    await expect(card.getByRole('link', { name: 'Shelter intake details for The Bowery Mission', exact: true })).toHaveAttribute('href', 'https://www.bowery.org/get-help/');
    const meal = card.getByRole('link', { name: 'Directions to meal service for The Bowery Mission', exact: true });
    expect(new URL(await meal.getAttribute('href')).searchParams.get('destination')).toContain('227 Bowery');
    await expect(card.getByRole('link', { name: /^(Directions|Google Maps|Apple Maps)(?: for .+)?$/ })).toHaveCount(0);
  }
});

test('Spanish diaper vocabulary reaches the labeled network without claiming a local site', async ({ page }) => {
  for (const path of surfaces) {
    await openSurface(page, path);
    await search(page, path, 'pañales');
    expect(await resultIds(page, path)).toEqual(['national-diaper-bank-network']);
    const card = resultScope(page, path, 'national-diaper-bank-network');
    await expect(card).toContainText('National Diaper Bank Network');
    await expect(card).toContainText(/network|finder/i);
    await expect(card.getByRole('link', { name: /^(Directions|Google Maps|Apple Maps)(?: for .+)?$/ })).toHaveCount(0);
  }
});

test('thin regional coverage gives honest empty states and preserves the original search', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of surfaces) {
    await openSurface(page, path);
    for (const query of ['Providence showers', 'Rosarito food', 'Tijuana shelter']) {
      await search(page, path, query);
      expect(await resultIds(page, path)).toEqual([]);
      const empty = page.locator(path === '/' ? '#resourceGrid .results-empty' : '.directory-global-empty');
      await expect(empty).toBeVisible();
      await expect(empty).toContainText(path === '/' ? 'RWN may not have every service' : 'A missing result does not mean help is unavailable');
      await expect(empty.getByRole('button', { name: path === '/' ? 'Clear search and filters' : 'Clear all filters', exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.__locationRequests)).toBe(0);
    }
    if (path === '/directory') await expect(page.locator('.directory-global-empty').getByRole('link', { name: 'browse global resource finders' })).toHaveAttribute('href', '/directory/global');
    await info.attach(path === '/' ? 'finder-thin-coverage' : 'directory-thin-coverage', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  }
});
