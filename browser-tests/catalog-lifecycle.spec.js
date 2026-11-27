import { test, expect } from '@playwright/test';

for (const saved of [false, true]) {
  test(`${saved ? 'Saved' : 'directory'} does not restart catalog work after pagehide and returns usefully`, async ({ page }, info) => {
    const errors = [], departingRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.text() === 'RWN_QA_CATALOG_AFTER_PAGEHIDE') departingRequests.push(message.text());
    });
    if (saved) {
      await page.goto('/service/womens-lunch-place');
      await page.locator('[data-service-save]').click();
      await expect(page.locator('[data-service-save]')).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('link', { name: 'View saved services', exact: true }).click();
      await expect(page.locator('[data-saved-services]')).toContainText('Women');
    } else {
      await page.goto('/directory');
      await page.locator('[data-directory-query]').fill('WIC');
      await expect(page.locator('.directory-global-result')).toHaveCount(60);
    }
    await page.evaluate(() => {
      let departed = false;
      const fetch = window.fetch;
      window.fetch = (...args) => {
        if (departed && new URL(args[0], location.href).pathname === '/data/search-index.json') {
          console.info('RWN_QA_CATALOG_AFTER_PAGEHIDE');
        }
        return fetch.apply(window, args);
      };
      // A worker activation can race document navigation. Deliver that real
      // application event after the native pagehide, without delaying departure.
      addEventListener('pagehide', () => {
        departed = true;
        navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
      }, { once: true });
      addEventListener('pageshow', () => { departed = false; });
    });
    await page.goto('/service/womens-lunch-place');
    await expect(page.locator('h1')).toContainText('Women');
    await info.attach('runtime-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await info.attach('departing-catalog-requests', { body: JSON.stringify(departingRequests), contentType: 'application/json' });
    expect(departingRequests, 'a detached document must not start a replacement catalog fetch').toEqual([]);
    await page.goBack();
    if (saved) await expect(page.locator('[data-saved-services]')).toContainText('Women');
    else {
      await expect(page.locator('[data-directory-query]')).toHaveValue('WIC');
      await expect(page.locator('.directory-global-result')).toHaveCount(60);
    }
    expect(errors, 'uncaught browser errors').toEqual([]);
  });
}
