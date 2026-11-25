/** Rendered navigation bounds and genuine keyboard/pointer input at reduced CSS viewports.
 * Browser zoom is checked separately through the ordinary cloud browser UI. */
export const menuViewports = [[320, 568], [320, 379], [320, 250], [568, 250], [390, 180], [320, 189], [900, 250]];

const links = [
  ["/directory", "Find Help"], ["/our-story", "Why RWN?"], ["/get-involved", "Get Involved"],
  ["/impact", "Impact"], ["/donate", "Donations"], ["/contact", "Contact"]
];

export async function verifyMenuReflow({ client, host, navigate, evaluate, capture }) {
  const key = async (key, code, virtualKey) => {
    await client.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey });
    await client.call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey });
  };
  const click = async (point) => {
    await client.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  };
  const frame = () => evaluate(client, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const openMenu = async () => {
    const point = await evaluate(client, `(() => {
      const rect = document.querySelector('.site-menu > summary').getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await click(point);
    await frame();
  };
  const cases = [];
  for (const [width, height] of menuViewports) {
    await client.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
    await navigate(client, `${host}/`);
    await openMenu();
    const bounds = await evaluate(client, `(() => {
      const menu = document.querySelector('.site-menu');
      const nav = menu.querySelector('nav');
      const box = nav.getBoundingClientRect();
      return { open: menu.open, left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
        viewportHeight: innerHeight, overflowY: getComputedStyle(nav).overflowY,
        scrollable: nav.scrollHeight > nav.clientHeight, destinations: [...nav.querySelectorAll('a')].map(a => [a.getAttribute('href'), a.textContent.trim()]) };
    })()`);
    if (!bounds.open || JSON.stringify(bounds.destinations) !== JSON.stringify(links) || bounds.left < 0 || bounds.right > bounds.clientWidth + 1 || bounds.top < 0 || bounds.bottom > height || bounds.scrollWidth > bounds.clientWidth + 1 || bounds.overflowY !== 'auto') {
      throw new Error(`Navigation bounds failed at ${width}x${height}: ${JSON.stringify(bounds)}`);
    }
    const focus = [];
    for (let index = 0; index < links.length; index += 1) {
      await key('Tab', 'Tab', 9);
      await frame();
      const current = await evaluate(client, `(() => {
        const nav = document.querySelector('.site-menu nav');
        const link = nav.querySelectorAll('a')[${index}];
        const box = link.getBoundingClientRect();
        const panel = nav.getBoundingClientRect();
        return { focused: document.activeElement === link, text: link.textContent.trim(), top: box.top, bottom: box.bottom,
          visible: box.left >= panel.left && box.right <= panel.right && box.top >= panel.top && box.bottom <= panel.bottom && box.top >= 0 && box.bottom <= innerHeight,
          scrollTop: nav.scrollTop };
      })()`);
      focus.push(current);
      if (!current.focused || !current.visible) throw new Error(`Keyboard link ${index} is clipped at ${width}x${height}: ${JSON.stringify(current)}`);
    }
    if (bounds.scrollable && focus.at(-1).scrollTop <= 0) throw new Error(`Keyboard did not scroll the short menu at ${width}x${height}`);
    await capture(client, `menu-keyboard-${width}x${height}.png`);
    await key('Escape', 'Escape', 27);
    const dismissed = await evaluate(client, `({ closed: !document.querySelector('.site-menu').open, summaryFocused: document.activeElement === document.querySelector('.site-menu > summary') })`);
    if (!dismissed.closed || !dismissed.summaryFocused) throw new Error(`Escape focus changed at ${width}x${height}`);

    await openMenu();
    // Reset the scroll fixture so a native wheel gesture must expose the final primary destination.
    const point = await evaluate(client, `(() => {
      const nav = document.querySelector('.site-menu nav');
      nav.scrollTop = 0;
      const box = nav.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`);
    await client.call('Input.dispatchMouseEvent', { type: 'mouseWheel', deltaX: 0, deltaY: 600, ...point });
    const pointer = await evaluate(client, `(async () => {
      const nav = document.querySelector('.site-menu nav');
      for (let attempt = 0; attempt < 30 && nav.scrollHeight > nav.clientHeight && nav.scrollTop === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      const link = nav.querySelector('a:last-child');
      const box = link.getBoundingClientRect();
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      return { x, y, scrollTop: nav.scrollTop, visible: box.top >= nav.getBoundingClientRect().top && box.bottom <= innerHeight,
        hit: document.elementFromPoint(x, y) === link, text: link.textContent.trim(), href: link.getAttribute('href') };
    })()`);
    if (!pointer.visible || !pointer.hit || pointer.text !== 'Contact' || pointer.href !== '/contact' || (bounds.scrollable && pointer.scrollTop <= 0)) throw new Error(`Pointer cannot reach final link at ${width}x${height}: ${JSON.stringify(pointer)}`);
    await capture(client, `menu-pointer-${width}x${height}.png`);
    const loaded = new Promise((resolve) => {
      const off = client.on('Page.loadEventFired', () => { off(); resolve(); });
      setTimeout(() => { off(); resolve(); }, 8000).unref?.();
    });
    await click({ x: pointer.x, y: pointer.y });
    await loaded;
    const reachedContact = await evaluate(client, `location.pathname === '/contact' || location.pathname === '/contact.html'`);
    if (!reachedContact) throw new Error(`Contact pointer navigation failed at ${width}x${height}`);
    cases.push({ width, height, bounds, focus, pointer, reachedContact });
  }
  // The contributor destination still works, but lives in the footer rather
  // than the help-first primary menu. Use real wheel and pointer input.
  const [width, height] = [390, 180];
  await client.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
  await navigate(client, `${host}/`);
  let footer;
  for (let attempt = 0; attempt < 14; attempt++) {
    footer = await evaluate(client, `(() => {
      const link = document.querySelector('.site-footer a[href="/join"]');
      const r = link?.getBoundingClientRect();
      if (!r || link.textContent.trim() !== 'Contributor workspace') return null;
      const edge = document.querySelector('.site-header').getBoundingClientRect().bottom;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      return { x, y, hit: r.top >= edge && r.bottom <= innerHeight && document.elementFromPoint(x, y) === link,
        delta: y - (edge + (innerHeight - edge) / 2) };
    })()`);
    if (!footer || footer.hit) break;
    await client.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width / 2, y: height / 2, deltaX: 0, deltaY: footer.delta });
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  if (!footer?.hit) throw new Error(`Pointer cannot reach the contributor workspace: ${JSON.stringify(footer)}`);
  await capture(client, "menu-pointer-contributor-footer.png");
  const joined = new Promise((resolve) => {
    const off = client.on('Page.loadEventFired', () => { off(); resolve(); });
    setTimeout(() => { off(); resolve(); }, 8000).unref?.();
  });
  await click({ x: footer.x, y: footer.y });
  await joined;
  if (!await evaluate(client, `location.pathname === '/join' || location.pathname === '/join.html'`))
    throw new Error("Contributor workspace pointer navigation failed");
  console.log(`Menu viewport QA passed: ${JSON.stringify(cases)}`);
  return cases;
}
