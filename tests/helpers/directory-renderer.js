import vm from 'node:vm';

export function exposeDirectoryRenderer(source) {
  // Capture the real renderer at its declaration, including inside the compiler's
  // lexical wrapper. No production behavior is substituted by this test hook.
  const script = source.replace('export const createResultRow', 'const createResultRow').replaceAll('import.meta.url', '"https://fixture.test/directory.js"');
  const exposed = script.replace(/\bcreateResultRow\s*=/, 'createResultRow = globalThis.rwnTestRenderer =');
  if (exposed === script) throw new Error('Compiled directory renderer was not found.');
  return exposed;
}

// Executes either authored renderer or self-contained production entry, without
// depending on minifier variable names or a particular string concatenation.
export function renderDirectoryRow(source, record) {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.classList = { add() {} }; }
    append(...nodes) { this.children.push(...nodes); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener() {}
  }
  const context = vm.createContext({
    document: { createElement: tag => new Element(tag), querySelector: () => null },
    navigator: { onLine: true }, window: {}, history: {}, URL
  });
  vm.runInContext(exposeDirectoryRenderer(source), context);
  return context.rwnTestRenderer(record, {});
}
