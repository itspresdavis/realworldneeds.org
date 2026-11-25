import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [390, 1280]) {
  test(`optional account consent, suggestions, clear and signout at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    let signedIn = false;
    let saved = null;
    const writes = [];
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const body = route.request().postDataJSON();
      if (url.pathname === '/api/preferences' && url.searchParams.has('action')) return route.fulfill({ json: { enabled: true } });
      if (url.pathname === '/api/account') {
        if (body?.action === 'signin') { signedIn = true; return route.fulfill({ json: { signedIn: true } }); }
        if (body?.action === 'signout') { signedIn = false; return route.fulfill({ json: { ok: true } }); }
        return route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { user: { email: 'fixture@example.invalid' } } : { error: 'Please sign in.' } });
      }
      if (url.pathname === '/api/preferences') {
        if (body) { writes.push(body); saved = body.action === 'save' ? body.preferences : null; return route.fulfill({ json: { ok: true } }); }
        return route.fulfill({ json: { preferences: saved } });
      }
      return route.abort();
    });
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Your resources', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse without an account' })).toHaveAttribute('href','/directory');
    await page.getByLabel('Email', { exact: true }).fill('fixture@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('fixture-password-only');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByText('Signed in as fixture@example.invalid')).toBeVisible();
    await page.getByLabel('Food', { exact: true }).check();
    await page.getByLabel('City, city and country, or U.S. ZIP (optional)').fill('Boston, United States');
    await page.getByRole('button',{name:'Save answers and find resources'}).click();
    expect(writes).toHaveLength(0);
    await page.getByRole('checkbox',{name:/I agree to store/}).check();
    await page.getByRole('button',{name:'Save answers and find resources'}).click();
    await expect(page.locator('#preferencesStatus')).toContainText('Answers saved.');
    await expect(page.locator('#personalSuggestions li').first()).toBeVisible();
    expect(writes[0]).toEqual({ action:'save', preferences:{topics:['food'],area:'Boston, United States',consent:true} });
    await expect(page.getByRole('checkbox',{name:/I agree to store/})).not.toBeChecked();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('#main').analyze()).violations).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`resource-account-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'Delete my saved answers'}).click();
    await expect(page.locator('#preferencesStatus')).toHaveText('Your saved answers have been deleted.');
    expect(saved).toBeNull();
    await expect(page.locator('#personalSuggestions li')).toHaveCount(0);
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
    await expect(page.locator('#personalIdentity')).toBeEmpty();
    expect(errors).toEqual([]);
  });
}
test('unavailable account service never shows a working signup claim or blocks the directory',async({page})=>{
  await page.route('**/api/preferences?action=availability',route=>route.fulfill({json:{enabled:false}}));
  await page.goto('/account');
  await expect(page.locator('#accountAvailability')).toContainText('coming soon');
  await expect(page.locator('#signinPanel')).toBeHidden();
  await page.getByRole('link',{name:'Browse without an account'}).click();
  await expect(page).toHaveURL(/\/directory\/?$/);
  await expect(page.locator('h1')).toBeVisible();
});
