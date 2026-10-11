// Real browser regression for need + country, refresh and uncached history return.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function verifyDirectoryDiscovery({ client, host, navigate, evaluate, capture }) {
  const state = () => evaluate(client, `(() => ({
    query: document.querySelector('[data-directory-query]')?.value,
    country: document.querySelector('[data-directory-country]')?.value,
    category: document.querySelector('[data-directory-category][aria-pressed="true"]')?.textContent,
    rows: [...document.querySelectorAll('.directory-global-result')].map(row => ({ href: row.getAttribute('href'), text: row.textContent })),
    more: !document.querySelector('[data-directory-more]')?.hidden,
    count: document.querySelector('[data-directory-count]')?.textContent,
    focus: document.activeElement?.getAttribute('href'), scroll: scrollY,
    focusedId: document.activeElement?.id,
    focusVisible: (() => { const rect = document.activeElement?.getBoundingClientRect(); return rect?.height > 0 && rect.bottom > (document.querySelector('.legal-header')?.getBoundingClientRect().bottom || 0) && rect.top < innerHeight; })(),
    saved: document.querySelector('.directory-shell')?.classList.contains('has-saved-view'),
    menuOpen: Boolean(document.querySelector('.rwn-page-menu[open]')),
    href: location.href, history: history.state?.rwnDirectory,
    heading: document.querySelector('h1')?.textContent, timeOrigin: performance.timeOrigin,
    overflow: document.documentElement?.scrollWidth > innerWidth + 1,
    empty: document.querySelector('.directory-global-empty')?.textContent
  }))()`);
  const wait = async (condition, label) => {
    let latest;
    for (let i = 0; i < 120; i++) {
      latest = await state(); if (condition(latest)) return latest; await sleep(50);
    }
    throw new Error(`${label}: ${JSON.stringify(latest)}`);
  };
  const click = async selector => {
    const point = await evaluate(client, `(() => {
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.getBoundingClientRect().height && node.getBoundingClientRect().width);
      if (!node) throw new Error('Control missing');
      let r = node.getBoundingClientRect();
      const edge = node.closest('.legal-header') ? 0 : (document.querySelector('.legal-header')?.getBoundingClientRect().bottom || 0);
      if (r.top < edge || r.bottom > innerHeight) { node.scrollIntoView({ block: 'center', behavior: 'instant' }); r = node.getBoundingClientRect(); }
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  };
  const type = async text => {
    await evaluate(client, `(() => { const input = document.querySelector('[data-directory-query]'); input.focus(); input.select(); })()`);
    await client.call('Input.insertText', { text });
  };
  const goEntry = async id => {
    await client.call('Page.navigateToHistoryEntry', { entryId: id });
    await sleep(300);
  };
  const evidence = [];

  for (const width of [1440, 390]) {
    await client.call('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600 });
    await navigate(client, 'about:blank');
    await navigate(client, `${host}/directory`);
    await capture(client, `directory-discovery-start-${width}.png`);
    await evaluate(client, `(() => {
      const input = document.querySelector('[data-directory-query]'); window.__directoryInputs = [];
      input.addEventListener('input', event => __directoryInputs.push(event.isTrusted));
      const country = document.querySelector('[data-directory-country]');
      country.value = 'United States'; country.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await type('WIC');
    await wait(s => s.query === 'WIC' && s.rows.length === 60 && s.country === 'United States', 'Country and program search did not settle');
    if (!(await evaluate(client, 'window.__directoryInputs.length > 0 && window.__directoryInputs.every(Boolean)'))) throw new Error('Search was not entered through native browser input');
    await click('[data-directory-category="Food"]');
    await wait(s => s.category === 'Food' && s.rows.length === 60, 'Need filter did not settle');
    await click('[data-directory-more]');
    const before = await wait(s => s.rows.length === 120 && s.focus === s.rows[60].href, 'Second result batch did not focus its first listing');
    if (before.overflow || before.rows.some(row => !row.text.includes('United States') || !row.text.includes('Source checked'))) throw new Error('Country reach, source metadata or layout failed');
    const directoryHistory = await client.call('Page.getNavigationHistory');
    const directoryId = directoryHistory.entries[directoryHistory.currentIndex].id;
    const target = before.rows[60].href;
    await click(`.directory-global-result[href="${target}"]`);
    await wait(s => new URL(s.href).pathname === target && Boolean(s.heading), 'Native listing navigation failed');
    const serviceHistory = await client.call('Page.getNavigationHistory');
    const serviceId = serviceHistory.entries[serviceHistory.currentIndex].id;
    await goEntry(directoryId);
    const returned = await wait(s => s.query === 'WIC' && s.country === 'United States' && s.category === 'Food' && s.rows.length === 120, 'Back lost query, country, need or loaded rows');
    if (returned.scroll < 200) throw new Error('Back lost the visitor’s place in the results');
    await client.call('Page.reload', { ignoreCache: true });
    const reloaded = await wait(s => s.timeOrigin !== returned.timeOrigin && s.query === 'WIC' && s.country === 'United States' && s.category === 'Food' && s.rows.length === 120, 'Reload lost directory state');
    await wait(s => s.focus === target && s.scroll > 200, 'Reload did not restore listing focus and scroll');
    if (new URL(reloaded.href).search || new URL(reloaded.href).hash) throw new Error('Private filters leaked into the URL');
    await capture(client, `directory-discovery-return-${width}.png`);
    await goEntry(serviceId); await wait(s => new URL(s.href).pathname === target && Boolean(s.heading), 'Forward did not return to the listing');
    await goEntry(directoryId); await wait(s => s.rows.length === 120 && s.country === 'United States', 'Repeated Back lost filters');

    await client.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width / 2, y: 400, deltaY: 500, deltaX: 0 });
    await sleep(200);
    const savedFrom = await state();
    if (width < 900) await click('.rwn-page-menu > summary');
    await click('.legal-header a[href="/directory#saved"]');
    await wait(s => s.saved && !s.menuOpen && s.focusedId === 'saved-services-heading', 'Saved did not close its navigation overlay and own focus');
    await sleep(250);
    if (!(await state()).saved || (await state()).focusedId !== 'saved-services-heading') throw new Error('Pending directory restoration stole Saved focus');
    await capture(client, `directory-discovery-saved-${width}.png`);
    await goEntry(directoryId);
    await wait(s => !s.saved && !s.menuOpen && s.query === 'WIC' && s.country === 'United States' && s.rows.length === 120 && s.focusVisible && s.focus?.startsWith('/service/') && Math.abs(s.scroll - savedFrom.scroll) < 5, 'Saved Back did not restore the latest scroll with an unobscured return target');

    await client.call('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'Slash', windowsVirtualKeyCode: 191 });
    await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: '/', code: 'Slash', windowsVirtualKeyCode: 191 });
    await wait(s => s.focusVisible && s.scroll < 500, 'Search shortcut left the editable field offscreen after Saved Back');

    await type('zzzz-no-service-here');
    await wait(s => s.empty?.includes('does not mean help is unavailable'), 'No-match coverage explanation missing');
    if (await evaluate(client, `Boolean(document.querySelector('.directory-global-empty a[href="/directory"]'))`)) throw new Error('Global empty results offer a self-restoring full-directory link');
    await capture(client, `directory-discovery-empty-${width}.png`);
    await click('[data-fewer-words]');
    await wait(s => s.query === '' && s.country === 'United States' && s.category === 'Food' && s.rows.length === 60, 'Fewer words erased country or need');
    await click('[data-directory-clear]');
    const cleared = await wait(s => s.query === '' && s.country === '' && s.category === 'All help' && s.rows.length === 0, 'Clear filters did not restore ordinary browsing');
    await client.call('Page.reload', { ignoreCache: true });
    await wait(s => s.timeOrigin !== cleared.timeOrigin && s.query === '' && s.country === '' && s.rows.length === 0, 'Cleared filters reappeared on reload');
    evidence.push({ width, back: true, refresh: true, forward: true, secondBatch: true, recovery: true });
  }

  // Country-scoped pages have no redundant location dropdown. Their search
  // cannot silently widen to other countries; a sparse result offers alternatives.
  await navigate(client, `${host}/directory/france`);
  await type('zzzz-no-service-here');
  await wait(s => s.country === undefined && s.empty?.includes('browse global resource finders'), 'Scoped fallback is missing');
  await capture(client, 'directory-discovery-scoped-empty.png');
  await click('.directory-global-empty a[href="/directory"]');
  await wait(s => new URL(s.href).pathname === '/directory' && s.query === '' && s.rows.length === 0, 'Scoped full-directory recovery retained the failed search');
  await navigate(client, `${host}/directory/global`);
  await type('zzzz-no-service-here');
  await wait(s => Boolean(s.empty), 'Global scoped empty state is missing');
  if (await evaluate(client, `Boolean(document.querySelector('.directory-global-empty a[href="/directory/global"]'))`)) throw new Error('Global resource directory offers a self-restoring link');
  await click('.directory-global-empty a[href="/directory"]');
  await wait(s => s.query === '' && s.country === '', 'Global scoped recovery did not broaden to the directory');
  await type('Drinking fountains for London');
  const finder = await wait(s => s.rows.length > 0, 'Finder example did not match');
  if (!finder.rows.some(row => row.text.includes('Help finder or referral · check coverage'))) throw new Error('A coverage finder appears to be a service location');
  await capture(client, 'directory-discovery-finder-reach.png');
  console.log(`PASS directory discovery: ${JSON.stringify(evidence)}; scoped recovery and source/reach metadata`);
}
