import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const widths = [320, 360, 375, 390, 430, 600, 768, 1024, 1280, 1440, 1920];
const noGraphics = async page => page.addInitScript(() => {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    return /webgl/i.test(type) ? null : original.call(this, type, ...args);
  };
});
const homeReady = page => expect(page.locator('html')).toHaveAttribute('data-finder-startup', 'ready');
const rows = page => page.locator('.directory-global-result');
async function noOverflow(page) {
  expect(await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))).toEqual(
    expect.objectContaining({ width: expect.any(Number) }));
  const size = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(size[0], `${new URL(page.url()).pathname} at ${size[1]}px must reflow without horizontal scrolling`).toBeLessThanOrEqual(size[1] + 1);
}
test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.__rwnErrors = errors;
});
test.afterEach(async ({ page }, info) => {
  await info.attach('runtime-errors', { body: JSON.stringify(page.__rwnErrors || []), contentType: 'application/json' });
  expect(page.__rwnErrors || [], 'uncaught browser errors').toEqual([]);
});

test('finder survives absent WebGL without requesting graphics assets', async ({ page }) => {
  await noGraphics(page);
  const requests = []; page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.goto('/'); await homeReady(page);
  await expect(page.locator('#globeFallback')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-globe-startup', 'unavailable');
  await page.locator('#resourceSearch').fill('Boston MA');
  await expect(page.locator('.resource-card').first()).toContainText(/Boston/);
  await page.locator('#jumpResults').click();
  await expect(page.locator('#resourceGrid')).toBeInViewport();
  expect(requests.filter(url => /\/vendor\/three|\/media\/earth|\/data\/countries/.test(url))).toEqual([]);
});

test('renderer controls recover from interrupted input on a capable browser', async ({ page, browserName }, info) => {
  await page.goto('/'); await homeReady(page);
  await expect(page.locator('html')).toHaveAttribute('data-globe-startup', /ready|unavailable/);
  const supported = await page.locator('html').getAttribute('data-globe-startup') === 'ready';
  await info.attach('graphics-capability', { body: JSON.stringify({ supported, browserName }), contentType: 'application/json' });
  if (browserName === 'chromium') expect(supported, 'configured software GPU must initialize the real renderer').toBe(true);
  test.skip(!supported, 'This browser environment has no usable WebGL; fallback is separately mandatory.');
  const canvas = page.locator('#globeCanvas');
  await canvas.scrollIntoViewIfNeeded();
  await page.locator('#zoomIn').click(); await page.locator('#zoomIn').click();
  await page.locator('#zoomOut').click();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .45, box.y + box.height * .5);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .7, box.y + box.height * .55, {steps: 12}); await page.mouse.up();
  await page.locator('#resetGlobe').click();
  for (const width of widths) {
    await page.setViewportSize({width,height:844});
    await noOverflow(page);
    await expect(canvas).toBeVisible();
    await expect(page.locator('#globeFallback')).toBeHidden();
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#zoomIn').click();
  await page.locator('#zoomOut').click();
  await expect(page.locator('#globeFallback')).toBeHidden();
  if (browserName === 'chromium') {
    const loss = await canvas.evaluate(canvas => {
      const gl=canvas.getContext('webgl2'), extension=gl?.getExtension('WEBGL_lose_context');
      if (!extension) return false; extension.loseContext(); return true;
    });
    expect(loss).toBe(true);
    await expect(page.locator('#globeFallback')).toBeVisible();
    await page.locator('#retryGlobe').click();
    await expect(page.locator('#globeFallback')).toBeHidden({timeout:30000});
  }
  await info.attach('globe', {body:await page.screenshot(),contentType:'image/png'});
});

test('directory search, geography, empty recovery, and history remain local', async ({page}) => {
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await page.goto('/directory');
  const input=page.locator('[data-directory-query]');
  await input.fill('Boston UK'); await expect(rows(page).first()).toContainText('Boston Foodbank');
  await expect(rows(page).first()).toContainText('United Kingdom');
  await input.fill('Boston MA'); await expect(rows(page).first()).toContainText('United States');
  await page.locator('[data-directory-country]').selectOption({label:'United Kingdom'});
  await expect(rows(page)).toHaveCount(0);
  await page.locator('[data-directory-clear]').click();
  await input.fill('zzzz-no-such-assistance'); await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('[data-directory-count]')).toContainText(/No|0/);
  await input.fill('WIC'); await expect(rows(page).first()).toContainText(/WIC/i);
  const first=rows(page).first(), href=await first.getAttribute('href');await first.click();
  await expect(page).toHaveURL(new RegExp(href+'$'));
  await page.goBack();await expect(input).toHaveValue('WIC');
  expect(requests.some(url=>/Boston|zzzz-no-such|[?&]q=/.test(url))).toBe(false);
});

test('saved listing survives reload and can be removed', async ({page}) => {
  await page.goto('/service/womens-lunch-place');
  const save=page.locator('[data-service-save]');
  await save.click();await expect(save).toHaveAttribute('aria-pressed','true');
  await page.reload();await expect(save).toHaveAttribute('aria-pressed','true');
  await page.getByRole('link',{name:'View saved services',exact:true}).click();
  await expect(page.locator('[data-saved-services]')).toContainText("Women");
  await page.goto('/service/womens-lunch-place');await save.click();await expect(save).toHaveAttribute('aria-pressed','false');
});

test('saved services synchronize between two actual tabs', async ({page,context}) => {
  await page.goto('/service/womens-lunch-place');
  const directory=await context.newPage();
  directory.on('pageerror',error=>page.__rwnErrors.push(error.message));
  await directory.goto('/directory#saved');
  await expect(directory.locator('[data-saved-remove]')).toHaveCount(0);
  await page.locator('[data-service-save]').click();
  await expect(directory.locator('[data-saved-services]')).toContainText("Women");
  await directory.locator('[data-saved-remove]').click();
  await expect(page.locator('[data-service-save]')).toHaveAttribute('aria-pressed','false');
  await expect(directory.locator('[data-saved-remove]')).toHaveCount(0);
  await directory.close();
});

test('blocked storage gives an honest recovery without breaking service details', async ({page}) => {
  await page.addInitScript(()=>{Storage.prototype.getItem=function(){throw new DOMException('Storage denied','SecurityError')};});
  await page.goto('/service/womens-lunch-place');
  await expect(page.locator('[data-service-save]')).toBeDisabled();
  await expect(page.locator('.service-utility-actions')).toContainText(/unavailable/i);
  await expect(page.locator('h1')).toContainText(/Women/);
  await expect(page.locator('[data-service-print]')).toBeEnabled();
});

test('directory reload and search remain usable offline', async ({page,context,browserName}) => {
  await page.goto('/directory');
  const supported=await page.evaluate(()=> 'serviceWorker' in navigator);
  expect(supported,'service worker capability').toBe(true);
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  await page.locator('[data-directory-query]').fill('Boston');
  await expect(rows(page).first()).toBeVisible();
  // Read cache completion rather than sleeping through an installation race.
  await expect.poll(()=>page.evaluate(async()=>{for(const name of await caches.keys()){const cache=await caches.open(name);if((await cache.keys()).some(r=>new URL(r.url).pathname==='/data/search-index.json'))return true;}return false;})).toBe(true);
  await context.setOffline(true);await page.reload();
  await expect(page.locator('[data-directory-query]')).toBeVisible();
  await page.locator('[data-directory-query]').fill('Boston');
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator('body')).toContainText(/offline|cached/i);
  await expect(page.locator('html')).toHaveAttribute('data-rwn-catalog-cached','true');
  await expect.poll(()=>page.evaluate(()=>[...document.styleSheets].some(sheet=>/\/navigation-actions\.[a-f0-9]{12}\.css/.test(sheet.href||'')&&sheet.cssRules.length>0)),{message:'versioned mobile navigation styling remains loaded offline'}).toBe(true);
  // Verify reconnection finishes before testing the next navigation. Reloading
  // immediately cancels the online refresh; WebKit reports that cancellation
  // as an access-control console exception despite the handled fetch rejection.
  await context.setOffline(false);
  await expect(page.locator('html')).toHaveAttribute('data-rwn-catalog-cached','false');
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator('#offlineDirectoryNotice')).toBeHidden();
  await page.reload();await expect(page.locator('[data-directory-query]')).toBeVisible();
});

test('all required widths, landscape and enlarged text reflow', async ({page},info) => {
  test.setTimeout(180000);
  await noGraphics(page);
  for(const path of ['/','/directory','/service/womens-lunch-place','/join']) {
    await page.goto(path);
    if(path==='/')await homeReady(page);
    for(const width of widths){await page.setViewportSize({width,height:900});await noOverflow(page);}
    for(const [width,height] of [[844,390],[1024,600]]){await page.setViewportSize({width,height});await noOverflow(page);}
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>document.documentElement.style.fontSize='200%');await noOverflow(page);
    if(path==='/') {
      const boxes=await Promise.all(['.site-header .brand','.site-menu > summary','.header-action'].map(selector=>page.locator(selector).boundingBox()));
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++) {
        const a=boxes[i],b=boxes[j];expect(a).not.toBeNull();expect(b).not.toBeNull();
        expect(a.x+a.width<=b.x+1||b.x+b.width<=a.x+1||a.y+a.height<=b.y+1||b.y+b.height<=a.y+1,'brand and navigation must not overlap at 200% text').toBe(true);
      }
      await page.locator('.filter-disclosure > summary').click();await noOverflow(page);
      await page.locator('.filter-disclosure > summary').click();
    }
    await info.attach(`enlarged-${path.replaceAll('/','-')||'home'}`,{body:await page.screenshot(),contentType:'image/png'});
    await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
    if(path==='/directory')await info.attach('mobile-directory',{body:await page.screenshot(),contentType:'image/png'});
  }
});

test('keyboard can reach search and dismiss mobile navigation', async ({page}) => {
  await noGraphics(page);await page.setViewportSize({width:320,height:844});
  await page.goto('/');await homeReady(page);
  await page.keyboard.press('Alt+/');await expect(page.locator('#resourceSearch')).toBeFocused();
  await page.locator('#resourceSearch').fill('Boston');
  await page.keyboard.press('Escape');await expect(page.locator('#resourceSearch')).toHaveValue('');
  await page.locator('.site-menu > summary').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.site-menu')).not.toHaveAttribute('open','');
  await expect(page.locator('.site-menu > summary')).toBeFocused();
});

for(const path of ['/','/directory','/service/womens-lunch-place','/transparency','/404','/join']) {
  test(`accessibility ${path}`,async({page},info)=>{
    await noGraphics(page);await page.setViewportSize({width:390,height:844});
    await page.goto(path);if(path==='/')await homeReady(page);
    const audit=await new AxeBuilder({page}).analyze();
    await info.attach('axe',{body:JSON.stringify(audit),contentType:'application/json'});
    expect(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
    expect(audit.incomplete.filter(v=>['aria-prohibited-attr','form-field-multiple-labels'].includes(v.id)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  });
}


test("finder stays usable while the graphics engine is delayed, then the globe becomes visible", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "This delayed-import regression requires the configured Chromium software GPU; other projects test capability fallback separately.");
  let releaseImport;
  const heldImport = new Promise(resolve => { releaseImport = resolve; });
  let imports = 0;
  await page.route(/\/vendor\/three\.module(?:[.-][a-f0-9]+)?\.js(?:\?|$)/, async route => {
    imports++;
    await heldImport;
    await route.continue();
  });
  try {
    // DOMContentLoaded does not wait for the optional dynamic import.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await homeReady(page);
    await expect.poll(() => imports, { message: "the capable browser requested the held engine" }).toBeGreaterThan(0);
    await expect(page.locator("html")).toHaveAttribute("data-globe-startup", "loading");
    await page.locator("#resourceSearch").fill("Boston MA");
    await expect(page.locator(".resource-card").first()).toContainText("Boston");
    // Cross several actual rendering opportunities while import remains held.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    await expect(page.locator("#globeFallback")).toBeHidden();
    await expect(page.locator(".globe-stage")).not.toHaveClass(/is-globe-unavailable/);
  } finally {
    releaseImport();
  }
  await expect(page.locator("html")).toHaveAttribute("data-globe-startup", "ready");
  await expect(page.locator("#globeCanvas")).toBeVisible();
  await expect(page.locator("#globeFallback")).toBeHidden();
});

test('normal motion can be explicitly started, paused, and resized', async ({page,browserName},info)=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('/');await homeReady(page);
  await expect(page.locator('html')).toHaveAttribute('data-globe-startup',/ready|unavailable/);
  const supported=await page.locator('html').getAttribute('data-globe-startup')==='ready';
  if(browserName==='chromium')expect(supported).toBe(true);
  test.skip(!supported,'Renderer unavailable in this environment; fallback tested separately.');
  const motion=page.locator('#toggleMotion');
  await expect(motion).toHaveAccessibleName('Resume globe rotation');
  await motion.click();await expect(motion).toHaveAccessibleName('Pause globe rotation');
  await page.setViewportSize({width:844,height:390});await noOverflow(page);
  await motion.click();await expect(motion).toHaveAccessibleName('Resume globe rotation');
  await page.locator('#resourceSearch').fill('Boston MA');
  await expect(page.locator('.resource-card').first()).toContainText('Boston');
  await expect(page.locator('#globeFallback')).toBeHidden();
  await info.attach('normal-motion-landscape',{body:await page.screenshot(),contentType:'image/png'});
});
