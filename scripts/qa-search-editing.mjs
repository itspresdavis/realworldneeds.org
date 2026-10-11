// Browser-owned editing, rather than assigning whole search values. This catches
// handlers that remove the separator before a visitor can type the next word.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function verifyFinderEditing({ client, host, navigate, evaluate, capture }) {
  const read = () => evaluate(client, `(() => {
    const input = document.getElementById('resourceSearch');
    return { value: input.value, start: input.selectionStart, end: input.selectionEnd,
      committed: history.state?.rwnFinder?.query, count: document.getElementById('resultCount').textContent,
      rows: [...document.querySelectorAll('.result-row-link')].map(row => row.innerText),
      href: location.href, events: window.__rwnEditingEvents };
  })()`);
  const check = async (condition, message) => {
    const state = await read();
    if (!condition(state)) throw new Error(`${message}: ${JSON.stringify(state)}`);
    return state;
  };
  const wait = async (condition, message) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const state = await read();
      if (condition(state)) return state;
      await sleep(50);
    }
    return check(condition, message);
  };
  const key = async (character) => {
    const code = character === ' ' ? 'Space' : `Key${character.toUpperCase()}`;
    const keyCode = character.toUpperCase().charCodeAt(0);
    const modifiers = /[A-Z]/.test(character) ? 8 : 0;
    await client.call('Input.dispatchKeyEvent', { type: 'keyDown', key: character, code,
      text: character, unmodifiedText: character, windowsVirtualKeyCode: keyCode, modifiers });
    await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: character, code,
      windowsVirtualKeyCode: keyCode, modifiers });
  };
  const enter = async () => {
    await client.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
    await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  };
  const select = (start, end) => evaluate(client, `(() => {
    const input = document.getElementById('resourceSearch'); input.focus();
    ${start === undefined ? 'input.select()' : `input.setSelectionRange(${start}, ${end})`};
  })()`);
  const type = async (value) => { await select(); for (const character of value) await key(character); };

  for (const width of [1440, 390]) {
    await client.call('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await navigate(client, 'about:blank');
    await navigate(client, `${host}/`);
    await evaluate(client, `(() => {
      const input = document.getElementById('resourceSearch');
      window.__rwnEditingEvents = [];
      for (const type of ['input', 'compositionstart', 'compositionend']) input.addEventListener(type, event => {
        __rwnEditingEvents.push({ type, trusted: event.isTrusted, composing: event.isComposing, value: input.value });
      });
    })()`);
    await type('New York');
    await enter();
    await wait(state => state.value === 'New York' && state.committed === 'New York' && state.rows.some(row => row.includes('New York')), `Natural multiword typing failed at ${width}px`);
    await check(state => state.events.some(event => event.value === 'New ') && state.events.every(event => event.trusted), 'Native typing did not preserve the intermediate space');

    await type('London Road'); await enter();
    await wait(state => state.committed === 'London Road' && state.rows.some(row => row.includes('London Road')), 'Native street query failed');
    await select(6, 7); await key(' '); await key(' ');
    await check(state => state.value === 'London  Road' && state.start === 8 && state.end === 8, 'In-place whitespace editing moved the caret');
    await select(8, 12);
    for (const character of 'Colney') await key(character);
    await enter();
    await wait(state => state.value === 'London  Colney' && state.committed === 'London Colney' && state.rows.some(row => row.includes('London Colney')), 'Selected-word replacement changed the editable query');

    await type('  New   York  '); await enter();
    await wait(state => state.value === '  New   York  ' && state.committed === 'New York' && state.rows.some(row => row.includes('New York')), 'Editable whitespace or normalized history was lost');
    await check(state => !new URL(state.href).search && !decodeURIComponent(new URL(state.href).hash).includes('New York'), 'Search text entered the request URL');
    await capture(client, `search-natural-editing-${width}.png`);

    // Chromium's IME API creates trusted composition/input events. Confirm the
    // candidate does not replace settled results before the final text commits.
    await type('London'); await enter();
    const before = await wait(state => state.committed === 'London' && state.rows.length > 0, 'Composition baseline did not settle');
    await select();
    await client.call('Input.imeSetComposition', { text: 'New York', selectionStart: 8, selectionEnd: 8 });
    await sleep(800);
    await check(state => state.value === 'New York' && state.committed === 'London' && JSON.stringify(state.rows) === JSON.stringify(before.rows)
      && state.events.some(event => event.type === 'compositionstart' && event.trusted)
      && state.events.some(event => event.type === 'input' && event.composing && event.trusted), 'IME candidate changed settled search results');
    await client.call('Input.insertText', { text: 'New York' });
    await enter();
    await wait(state => state.value === 'New York' && state.committed === 'New York' && state.rows.some(row => row.includes('New York'))
      && state.events.some(event => event.type === 'compositionend' && event.trusted), 'Final IME text did not become searchable');
    console.log(`Finder editing QA passed at ${width}px: native multiword keys, in-place selection, preserved whitespace, normalized private history, and trusted IME composition.`);
  }
}
