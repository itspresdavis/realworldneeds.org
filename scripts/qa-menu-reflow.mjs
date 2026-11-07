/** Rendered navigation bounds and genuine keyboard/pointer input at reduced CSS viewports.
 * Browser zoom is checked separately through the ordinary cloud browser UI. */
export const menuViewports = [[320, 568], [320, 379], [320, 250], [568, 250], [390, 180], [320, 189], [900, 250]];

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
        scrollable: nav.scrollHeight > nav.clientHeight, count: nav.querySelectorAll('a').length };
    })()`);
    if (!bounds.open || bounds.count !== 5 || bounds.left < 0 || bounds.right > bounds.clientWidth + 1 || bounds.top < 0 || bounds.bottom > height || bounds.scrollWidth > bounds.clientWidth + 1 || bounds.overflowY !== 'auto') {
      throw new Error(`Navigation bounds failed at ${width}x${height}: ${JSON.stringify(bounds)}`);
    }
    const focus = [];
    for (let index = 0; index < bounds.count; index += 1) {
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
    // Reset the scroll fixture so a native wheel gesture must expose Get involved.
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
        hit: document.elementFromPoint(x, y) === link, text: link.textContent.trim() };
    })()`);
    if (!pointer.visible || !pointer.hit || pointer.text !== 'Get involved' || (bounds.scrollable && pointer.scrollTop <= 0)) throw new Error(`Pointer cannot reach final link at ${width}x${height}: ${JSON.stringify(pointer)}`);
    await capture(client, `menu-pointer-${width}x${height}.png`);
    const loaded = new Promise((resolve) => {
      const off = client.on('Page.loadEventFired', () => { off(); resolve(); });
      setTimeout(() => { off(); resolve(); }, 8000).unref?.();
    });
    await click({ x: pointer.x, y: pointer.y });
    await loaded;
    const reachedParticipation = await evaluate(client, `location.pathname === '/get-involved' || location.pathname === '/get-involved/'`);
    if (!reachedParticipation) throw new Error(`Get involved pointer navigation failed at ${width}x${height}`);
    cases.push({ width, height, bounds, focus, pointer, reachedJoin });
  }
  console.log(`Menu viewport QA passed: ${JSON.stringify(cases)}`);
  return cases;
}
