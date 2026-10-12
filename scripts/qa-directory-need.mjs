// Select the visible responsive control using native keyboard input. Desktop
// keeps its scan-friendly buttons; narrow pages expose a native select.
export async function selectDirectoryNeed({ client, evaluate, click }, value) {
  const prepared = await evaluate(client, `(() => {
    const select = document.querySelector('[data-directory-need]');
    if (!select || !select.getBoundingClientRect().height) return null;
    const index = [...select.options].findIndex(option => option.value === ${JSON.stringify(value)});
    if (select.disabled || index < 0) throw new Error('Need option unavailable');
    select.scrollIntoView({ block: 'center', behavior: 'instant' }); select.focus();
    if (document.activeElement !== select) throw new Error('Visible need select did not receive focus');
    const events = [], record = event => events.push({ value: select.value, trusted: event.isTrusted });
    globalThis.__rwnNeedQA?.stop();
    select.addEventListener('change', record);
    globalThis.__rwnNeedQA = { events, before: select.value, stop: () => select.removeEventListener('change', record) };
    return { index, before: select.value };
  })()`);
  if (!prepared) return click(`[data-directory-category=${JSON.stringify(value)}]`);
  try {
    for (const key of ['Home', ...Array(prepared.index).fill('ArrowDown')]) {
      const code = key === 'Home' ? 36 : 40;
      await client.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    }
    const evidence = await evaluate(client, `({ value: document.querySelector('[data-directory-need]').value, active: document.querySelector('[data-directory-category][aria-pressed="true"]')?.dataset.directoryCategory, events: globalThis.__rwnNeedQA.events })`);
    if (evidence.value !== value || evidence.active !== value || evidence.events.some(event => !event.trusted) || prepared.before !== value && !evidence.events.length) {
      throw new Error('Native need selection did not synchronize: ' + JSON.stringify(evidence));
    }
    return evidence;
  } finally {
    await evaluate(client, 'globalThis.__rwnNeedQA?.stop()');
  }
}
