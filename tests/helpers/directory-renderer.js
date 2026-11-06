import vm from 'node:vm';

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
    navigator: { onLine: true }, URL
  });
  vm.runInContext(`${source.replace('export const createResultRow', 'const createResultRow').replaceAll('import.meta.url', '"https://fixture.test/directory.js"')}\nglobalThis.render = createResultRow;`, context);
  return context.render(record, {});
}
