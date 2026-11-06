export class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.attributes = {};
    this.events = new Map(); this.value = ""; this.hidden = false; this.disabled = false; this._text = "";
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  replaceChildren(...children) { this._text = ""; this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  querySelector(selector) { return walk(this).find(node => selector.startsWith("#") ? node.id === selector.slice(1) : node.tagName.toLowerCase() === selector) || null; }
  addEventListener(name, handler) { this.events.set(name, handler); }
  dispatch(name) { return this.events.get(name)?.({ preventDefault() {}, currentTarget: this, target: this }); }
  focus() { this.ownerDocument.activeElement = this; }
}
export const walk = node => [node, ...node.children.flatMap(walk)];
export const documentFixture = () => {
  const document = { activeElement: null, createElement(tag) { return new Element(tag, document); } };
  return { document, root: new Element("section", document) };
};
export function publicFixture() {
  const f = documentFixture(), nodes = {};
  for (const [id, tag] of Object.entries({ "correction-form": "form", "correction-fields": "fieldset", "correction-category": "select", "correction-note": "textarea", "correction-availability": "p", "correction-retry": "button", "correction-submit": "button", "correction-status": "p", "correction-context": "p", "correction-listing-id": "strong", "correction-listing-link": "a" })) {
    const node = f.document.createElement(tag); node.id = id; nodes[id] = node; f.root.append(node);
  }
  nodes["correction-form"].hidden = true; nodes["correction-fields"].disabled = true; nodes["correction-retry"].hidden = true;
  return { ...f, nodes, get: id => nodes[`correction-${id}`] };
}
export const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
export const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
