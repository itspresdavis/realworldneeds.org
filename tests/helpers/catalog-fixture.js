import { SEARCH_CATALOG_SCHEMA } from "../../public/catalog-request.js";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

export const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
export const payload = { schemaVersion: SEARCH_CATALOG_SCHEMA, records: [{ id: "current" }], scopes: {} };
export const response = (value = payload) => ({ ok: true, json: async () => value });
const root = process.env.RWN_CATALOG_SOURCE_ROOT || new URL("../../", import.meta.url);
const read = path => readFile(new URL(path, typeof root === "string" ? `file://${root}/` : root), "utf8");
export const directory = await read("public/directory.js");
export const saved = await read("public/saved-services.js");
const helper = await read("public/catalog-request.js").catch(() => "");
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

// Exercise each entry's real loader construction. The alternate source root is
// only for proving these behavioral tests fail against an immutable baseline.
export function catalogFixture(kind, fetch) {
  const timers = new Map(), calls = [];
  let clock = 0, nextTimer = 0;
  const context = vm.createContext({
    AbortController, URL, catalogPromise: undefined, freshCatalog: false,
    searchIndexUrl: "/data/search-index.json?v=old", release: "old",
    fetch(...args) { calls.push(args); return fetch(...args); },
    setTimeout(callback, delay) { timers.set(++nextTimer, { at: clock + delay, callback }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); }
  });
  const loader = kind === "directory"
    ? between(directory, "const loadCatalog=", "const clearGlobalResults=")
    : between(saved, helper ? "  const loadCatalog =" : "  let catalogPromise;", "  const panel =");
  vm.runInContext(`${helper.replaceAll("export ", "")}\n${loader}\nglobalThis.load = loadCatalog;`, context);
  return {
    load: context.load, calls, timers,
    advance(ms) { clock += ms; for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.callback(); } },
    reset() { if (context.load.reset) context.load.reset(); else { context.catalogPromise = undefined; context.freshCatalog = true; } },
    retry() { context.load.retry?.(); }
  };
}
