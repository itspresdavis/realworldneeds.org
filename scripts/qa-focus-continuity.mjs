import { resources } from "../src/data/resources.js";

// Run inside the established Chromium suite. Unit tests also reproduce the
// removal/hiding behavior, but only a browser proves real focus and key events.
export async function verifyFocusContinuity({ client, host, navigate, evaluate }) {
  const check = async (expression, message) => {
    if (!await evaluate(client, expression)) {
      const state = await evaluate(client, `({focus:document.activeElement?.id,save:document.getElementById('saveResource')?.getAttribute('aria-pressed'),heading:document.querySelector('#resourcePanel h2')?.textContent,message:document.getElementById('statusToast')?.textContent})`);
      throw new Error(`${message}: ${JSON.stringify(state)}`);
    }
  };
  const enter = async (id) => {
    await evaluate(client, `document.getElementById(${JSON.stringify(id)}).focus()`);
    // Enter needs its carriage-return text to generate Chromium's activation
    // keypress, matching Playwright's native Chromium keyboard implementation.
    await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
    await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  };
  const openResource = async (id) => {
    // The resource fragment is read at startup. A hash-only Page.navigate on
    // the current finder would keep the old selection and skip initialization.
    await navigate(client, "about:blank");
    await navigate(client, `${host}/#resource=${encodeURIComponent(id)}`);
  };
  const checkSearchRecovery = async (label) => {
    await check(`document.activeElement.id === 'resourceSearch' && !document.getElementById('resourceSearch').value && document.getElementById('resourcePanel').hidden && document.getElementById('openInspector').getClientRects().length === 0`, `${label} lost focus or changed search`);
    await check(`(() => {
      const input = document.activeElement, box = input.getBoundingClientRect();
      const exposed = [box.left + 8, box.right - 8, box.left + box.width / 2]
        .some(x => [box.top + 8, box.bottom - 8, box.top + box.height / 2].some(y => document.elementFromPoint(x, y) === input));
      return box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && exposed;
    })()`, `${label} focus is outside the visible viewport`);
  };
  for (const width of [390, 1440]) {
    await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: 1000 });
    await openResource(resources[1].id);
    await check(`!document.getElementById('resourcePanel').hidden && !!document.getElementById('saveResource')`, `Inspector did not open at ${width}px`);
    const initiallySaved = await evaluate(client, `document.getElementById('saveResource').getAttribute('aria-pressed')`);
    for (const saved of [initiallySaved !== "true", initiallySaved === "true"]) {
      await enter("saveResource");
      await check(`document.activeElement.id === 'saveResource' && document.activeElement.getAttribute('aria-pressed') === '${saved}'`, `Save/remove lost focus at ${width}px`);
    }
    await enter("nextResource");
    await check(`document.activeElement.id === 'nextResource' && !document.activeElement.disabled`, `Next lost its replacement control at ${width}px`);
    await enter("previousResource");
    await check(`document.activeElement.id === 'previousResource' && !document.activeElement.disabled`, `Previous lost its replacement control at ${width}px`);
    await enter("previousResource");
    await check(`document.activeElement.id === 'resourcePanelHeading' && document.getElementById('previousResource').disabled`, `First-result boundary lost focus at ${width}px`);
    await enter("closeInspector");
    // The public presentation intentionally hides the legacy map-only opener
    // at every width. Close must recover to exposed search instead.
    await checkSearchRecovery(`Close at ${width}px`);

    await openResource(resources.at(-2).id);
    await enter("nextResource");
    await check(`document.activeElement.id === 'resourcePanelHeading' && document.getElementById('nextResource').disabled`, `Last-result boundary lost focus at ${width}px`);
    // The real context-loss handler hides the map chrome, including the normal
    // inspector opener. Close must recover to visible search without changing it.
    await evaluate(client, `document.getElementById('globeCanvas').dispatchEvent(new Event('webglcontextlost', {cancelable:true}))`);
    await enter("closeInspector");
    await checkSearchRecovery(`Fallback Close at ${width}px`);
  }

  await openResource(resources[1].id);

  const clipboard = await evaluate(client, `(async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const shareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'share');
    const originalExecCommand = document.execCommand;
    const results = [];
    const wait = () => new Promise(resolve => setTimeout(resolve, 30));
    const run = async (id, expected) => {
      const control = document.getElementById(id);
      document.getElementById('statusToast').textContent = '';
      control.focus(); control.click(); await wait();
      const message = document.getElementById('statusToast').textContent;
      results.push({id, expected, message, passed: expected.test(message), focus: document.activeElement === control, cleaned: !document.querySelector('textarea')});
    };
    try {
      Object.defineProperty(navigator, 'share', {configurable:true, value:undefined});
      Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async () => {throw new Error('denied fixture');}}});
      await run('copyAddress', /could not be copied/);
      await run('shareResource', /could not be copied/);
      Object.defineProperty(navigator, 'clipboard', {configurable:true, value:undefined});
      for (const outcome of ['false','throw','success']) {
        document.execCommand = () => {if (outcome === 'throw') throw new Error('denied fixture'); return outcome === 'success';};
        await run('copyAddress', outcome === 'success' ? /^(Address|Coverage) copied$/ : /could not be copied/);
        await run('shareResource', outcome === 'success' ? /^Service link copied$/ : /could not be copied/);
      }
      let copies = 0;
      Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async () => {copies++;}}});
      Object.defineProperty(navigator, 'share', {configurable:true, value:async () => {throw new DOMException('cancelled fixture','AbortError');}});
      await run('shareResource', /^$/);
      results.push({passed:copies === 0, focus:true, cleaned:true, message:'Native Share cancellation stays silent'});
      return results;
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor); else delete navigator.clipboard;
      if (shareDescriptor) Object.defineProperty(navigator, 'share', shareDescriptor); else delete navigator.share;
      document.execCommand = originalExecCommand;
    }
  })()`);
  if (clipboard.some(result => !result.passed || !result.focus || !result.cleaned)) {
    throw new Error(`Inspector copy/share recovery failed: ${JSON.stringify(clipboard)}`);
  }
}
