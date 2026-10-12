import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { phoneLinks } from "../src/utils/phone.js";
import { createContactFixtureApp } from "./qa-contact-fixture-app.mjs";

const check = (condition, message, detail) => {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`);
};

// Serialized into the established CI browser client; no second browser process.
export function contactHomepageSnapshot() {
  const visible = node => {
    const rect = node?.getBoundingClientRect();
    return Boolean(rect?.width && rect?.height && getComputedStyle(node).visibility !== "hidden" && getComputedStyle(node).display !== "none");
  };
  const input = document.querySelector("#resourceSearch");
  const banner = document.querySelector("[data-qa-fixture-banner]");
  return {
    presented: document.documentElement.classList.contains("rwn-professional") && document.documentElement.classList.contains("rwn-result-actions"),
    inputReady: visible(input) && !input.disabled,
    banner: visible(banner), bannerText: banner?.textContent.trim() || "",
    rows: [...document.querySelectorAll("#resourceGrid .resource-card")].map(row => {
      const link = row.querySelector(".result-row-link");
      return {
        id: row.dataset.resultResourceId, enhanced: row.dataset.resultEnhanced === "true",
        href: link?.getAttribute("href"), text: link?.textContent.trim() || "", visible: visible(row) && visible(link)
      };
    })
  };
}

export function isContactHomepageReady(state, expected) {
  // Professional presentation replaces the initial trust copy. Real rendered
  // fixture identities are the readiness contract, not that intermediate text.
  return state.presented && state.inputReady && state.banner && state.bannerText.includes("SYNTHETIC LOCAL QA")
    && state.rows.length === expected.length
    && expected.every(resource => state.rows.some(row => row.id === resource.id && row.enhanced && row.visible && row.href === `/service/${encodeURIComponent(resource.id)}` && row.text.includes(resource.name)));
}

export function contactFailureSnapshot(expectedOrigin) {
  const fixture = location.origin === expectedOrigin;
  return {
    fixture, url: fixture ? location.href : null, title: fixture ? document.title : null,
    readyState: document.readyState, width: innerWidth, height: innerHeight,
    serviceId: fixture ? document.querySelector("#service")?.dataset.serviceId || null : null,
    searchRows: fixture ? document.querySelectorAll(".directory-global-results .directory-global-result-wrap").length : null,
    savedRows: fixture ? document.querySelectorAll("[data-saved-list] .saved-service-row").length : null,
    bodyText: fixture ? (document.body?.innerText || "").slice(0, 4000) : null
  };
}

export function contactServiceSnapshot() {
  const visible = node => {
    const rect = node?.getBoundingClientRect();
    return Boolean(rect?.width && rect?.height && getComputedStyle(node).visibility !== "hidden" && getComputedStyle(node).display !== "none");
  };
  const service = document.querySelector("#service");
  const facts = service?.querySelector(".service-facts");
  const next = service?.querySelector(".service-next-steps");
  const warning = service?.querySelector(".directory-shell > .source-status-notice");
  const allLinks = [...(service?.querySelectorAll("a[href]") || [])];
  return {
    id: service?.dataset.serviceId, title: service?.querySelector("h1")?.textContent.trim(),
    banner: visible(document.querySelector("[data-qa-fixture-banner]")),
    rows: [...(facts?.querySelectorAll(":scope > div") || [])].map(row => ({
      label: row.querySelector("dt")?.textContent.trim(), value: row.querySelector("dd")?.textContent.trim(),
      visible: visible(row) && visible(row.querySelector("dt")) && visible(row.querySelector("dd")),
      fontSize: parseFloat(getComputedStyle(row.querySelector("dd")).fontSize)
    })),
    next: visible(next), source: next?.querySelector("a.is-primary")?.href,
    calls: [...(next?.querySelectorAll('a[href^="tel:"]') || [])].map(link => link.getAttribute("href")),
    actions: [...(next?.querySelectorAll("a") || [])].map(link => ({ href: link.getAttribute("href"), visible: visible(link), height: link.getBoundingClientRect().height })),
    geoLinks: allLinks.filter(link => /maps\.apple\.com|google\.com\/maps|\/#resource=/.test(link.href)).map(link => link.getAttribute("href")),
    text: service?.innerText, warning: warning?.textContent.trim(), warningVisible: visible(warning),
    warningBeforeActions: Boolean(warning && next && (warning.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING)),
    tools: visible(service?.querySelector("[data-service-utility]")),
    overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
  };
}

export function contactRowsSnapshot(selector) {
  const visible = node => {
    const rect = node?.getBoundingClientRect();
    return Boolean(rect?.width && rect?.height && getComputedStyle(node).visibility !== "hidden" && getComputedStyle(node).display !== "none");
  };
  return {
    offline: document.getElementById("offlineDirectoryNotice")?.dataset.networkState === "offline",
    href: location.href, overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    rows: [...document.querySelectorAll(selector)].map(row => {
      const link = row.querySelector(".directory-global-result");
      const small = [...(link?.querySelectorAll("small") || [])];
      const actions = [...row.querySelectorAll(".directory-global-result-actions a")];
      return {
        id: decodeURIComponent(new URL(link.href).pathname.split("/").filter(Boolean).at(-1)),
        text: link.textContent, visible: visible(row) && visible(link),
        facts: small.map(node => ({ text: node.textContent, visible: visible(node), fontSize: parseFloat(getComputedStyle(node).fontSize) })),
        clipped: link.scrollWidth > link.clientWidth + 1,
        actions: actions.map(action => ({ href: action.getAttribute("href"), text: action.textContent.trim(), visible: visible(action), height: action.getBoundingClientRect().height })),
        warning: row.querySelector(".source-status-notice")?.textContent.trim(),
        warningVisible: visible(row.querySelector(".source-status-notice"))
      };
    })
  };
}

export function assertContactService(state, resource, mode = "screen") {
  const contact = resource.locationPrecision === "contact-only";
  const expected = new Map([
    [contact ? "Coverage" : "Address", resource.address], ["Eligibility", resource.eligibility], ["Access", resource.accessType]
  ]);
  if (contact) expected.set("Coverage details", resource.coverageNote);
  if (resource.phone) expected.set("Phone", resource.phone);
  if (resource.hours) expected.set("Hours", resource.hours);
  if (contact && resource.phone) expected.set("Phone dialing scope", resource.phoneAccess);
  for (const [label, value] of expected) check(state.rows.some(row => row.label === label && row.value === value && row.visible), `Unreadable or changed ${label} for ${resource.id}`, state);
  check(state.id === resource.id && state.title === resource.name && state.overflow <= 1, `Service layout changed for ${resource.id}`, state);
  check(state.rows.every(row => row.visible && (mode === "print" || row.fontSize >= 15)), `Service facts were hidden or too small for ${resource.id}`, state);
  if (mode !== "print") {
    check(state.banner && state.next && state.source === resource.sourceUrl, "Fixture/source/next steps missing", state);
    check(JSON.stringify(state.calls) === JSON.stringify(phoneLinks(resource.phone).map(link => link.href)), "Domestic phone number changed", state);
    check(state.actions.every(action => action.visible && action.height >= 44), "Contact action is hidden or too small", state);
    if (resource.accessUrl) check(state.actions.some(action => action.href === resource.accessUrl), "Online access action missing", state);
  }
  if (contact) {
    check(state.geoLinks.length === 0 && !/\b\d+(?:\.\d+)?\s*(?:km|mi|miles)\s+away\b|before (?:you )?(?:go|travel)/i.test(state.text), "Contact channel gained a map, distance or travel instruction", state);
    check(state.text.includes("No walk-in location is listed"), "Contact-only boundary is missing", state);
  } else {
    check(state.geoLinks.some(href => href.startsWith("/#resource=")) && state.geoLinks.some(href => /maps\.apple|google\.com\/maps/.test(href)), "Physical listing lost its map actions", state);
  }
  if (resource.collectionStatus) check(state.warningVisible && state.warning.includes(resource.collectionStatus) && state.warning.includes(resource.collectionStatusCheckedOn) && state.warning.includes("Current availability is unverified") && (mode === "print" || state.warningBeforeActions), "Dated closure notice is missing or misplaced", state);
}

export function assertContactRows(state, resources, offline = false) {
  check(state.offline === offline && state.overflow <= 1, "Contact results connectivity or reflow failed", state);
  check(JSON.stringify(state.rows.map(row => row.id).sort()) === JSON.stringify(resources.map(resource => resource.id).sort()), "Fixture search/Saved membership changed", state);
  for (const resource of resources) {
    const row = state.rows.find(item => item.id === resource.id);
    const contact = resource.locationPrecision === "contact-only";
    check(row.visible && !row.clipped && row.facts.every(fact => fact.visible && fact.fontSize >= 13), "Result facts are clipped, hidden or too small", row);
    if (contact) {
      for (const fact of [resource.coverageNote, resource.eligibility, resource.phoneAccess, resource.accessUrl].filter(Boolean)) check(row.facts.some(item => item.visible && item.text.includes(fact)), "Coverage, eligibility, dialing scope or URL lost from result", { id: resource.id, fact, row });
      check(row.text.includes("Phone or online help") && !row.actions.some(action => /maps\.apple\.com|google\.com\/maps|\/#resource=/.test(action.href)) && !/\b\d+(?:\.\d+)?\s*(?:km|mi|miles)\s+away\b/.test(row.text), "Contact result gained a geographic action or distance", row);
      if (resource.accessUrl) check(row.actions.some(action => action.href === resource.accessUrl && action.visible === !offline && action.text === "Contact website"), "Contact website action missing or incorrectly available", row);
    } else {
      check(row.actions.filter(action => /maps\.apple\.com|google\.com\/maps/.test(action.href) && action.visible === !offline).length === 2, "Physical result lost appropriate map actions", row);
    }
    const calls = row.actions.filter(action => action.href.startsWith("tel:"));
    check(JSON.stringify(calls.map(action => action.href)) === JSON.stringify(phoneLinks(resource.phone).map(link => link.href)) && calls.every(action => action.visible), "Result changed or hid its phone action", row);
    check(row.actions.some(action => action.text === "View details" && action.visible === !offline), "Details action has wrong connectivity state", row);
    check(row.actions.filter(action => action.visible).every(action => action.height >= 44), "Result action touch target shrank", row);
    if (resource.collectionStatus) check(row.warningVisible && row.warning.includes(resource.collectionStatusCheckedOn) && row.warning.includes(resource.collectionStatus), "Result lost dated closure notice", row);
  }
}

export async function verifyContactOnly({ client, navigate, evaluate, capture, qaDir = "qa-screenshots" }) {
  const app = await createContactFixtureApp();
  const evidence = [];
  const contacts = app.resources.filter(resource => resource.locationPrecision === "contact-only");
  const physical = app.resources.find(resource => resource.kind === "direct");
  let fixtureDocument = false;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (expression, message) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate(client, expression)) return;
      await pause(60);
    }
    throw new Error(message);
  };
  const auditResources = async () => {
    const state = await evaluate(client, "({path:location.pathname, external:performance.getEntriesByType('resource').map(entry=>entry.name).filter(url=>/^https?:/.test(url) && new URL(url).origin !== location.origin)})");
    check(state.external.length === 0, "Fixture document recorded an external resource request", state);
    evidence.push({ label: "document-resource-audit", ...state });
  };
  const open = async path => {
    // Resource timing is document-scoped. Inspect every document before leaving
    // it, rather than treating the last page as evidence about earlier pages.
    if (fixtureDocument) await auditResources();
    await navigate(client, app.host + path);
    fixtureDocument = true;
  };
  const rows = selector => evaluate(client, `(${contactRowsSnapshot})(${JSON.stringify(selector)})`);
  const searchSelector = ".directory-global-results .directory-global-result-wrap";
  const savedSelector = "[data-saved-list] .saved-service-row";
  const inspectRows = async (selector, label, offline = false) => {
    const state = await rows(selector);
    assertContactRows(state, app.resources, offline);
    evidence.push({ label, ...state });
    await evaluate(client, `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'start',behavior:'instant'})`);
    await capture(client, `contact-only-${label}.png`);
  };
  const probeFailure = async (selector, label) => {
    // Only the temporary origin's same-origin connectivity probe is blocked.
    // No production request, offline cache mutation, or provider call occurs.
    await client.call("Network.setBlockedURLs", { urls: [`${app.host}/data/release.json*`] });
    await evaluate(client, "window.dispatchEvent(new Event('online'))");
    await wait("document.getElementById('offlineDirectoryNotice')?.dataset.networkState === 'offline'", "Fixture probe did not fail closed");
    await inspectRows(selector, `${label}-probe-failure`, true);
    await client.call("Network.setBlockedURLs", { urls: [] });
    await evaluate(client, "window.dispatchEvent(new Event('online'))");
    await wait("document.getElementById('offlineDirectoryNotice')?.dataset.networkState === 'online'", "Fixture did not recover after probe failure");
    await inspectRows(selector, `${label}-recovered`);
  };
  try {
    await client.call("Network.enable");
    await client.call("Network.setBypassServiceWorker", { bypass: true });
    await client.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await open("/");
    const expectedHomepage = app.resources.map(({ id, name }) => ({ id, name }));
    await wait(`(${isContactHomepageReady})((${contactHomepageSnapshot})(), ${JSON.stringify(expectedHomepage)})`, "Synthetic homepage did not initialize its rendered fixture results");
    await capture(client, "contact-only-homepage.png");
    evidence.push({ label: "homepage", ...await evaluate(client, `(${contactHomepageSnapshot})()`) });

    for (const width of [1440, 390, 320]) {
      await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
      for (const resource of [...contacts, physical]) {
        await open(`/service/${resource.id}`);
        await wait("Boolean(document.querySelector('[data-service-save]'))", "Fixture service tools did not initialize");
        const state = await evaluate(client, `(${contactServiceSnapshot})()`);
        assertContactService(state, resource);
        // Capture, rather than transmit, clipboard text. No OS clipboard or share sheet.
        const copied = await evaluate(client, `(async () => {
          const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
          let text = '';
          Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async value=>{text=value;}}});
          try {
            document.querySelector('[data-service-copy]').click();
            for(let attempt=0; attempt<30 && !text; attempt++) await new Promise(resolve=>setTimeout(resolve,10));
            return text;
          } finally {
            if(descriptor) Object.defineProperty(navigator,'clipboard',descriptor); else delete navigator.clipboard;
          }
        })()`);
        for (const fact of [resource.name, resource.address, resource.eligibility, resource.coverageNote, resource.phoneAccess, resource.accessUrl].filter(Boolean)) check(copied.includes(fact), "Copied contact details lost a usable fact", { id: resource.id, fact, copied });
        if (resource.locationPrecision === "contact-only") check(!/before (?:you )?(?:go|travel)/i.test(copied), "Copied contact details advise travel", copied);
        if (resource.collectionStatus) check(copied.includes(resource.collectionStatus) && copied.includes(resource.collectionStatusCheckedOn), "Copied details lost dated closure warning", copied);
        if (width === 1440) {
          await evaluate(client, "document.querySelector('[data-service-save]').click()");
          await wait("document.querySelector('[data-service-save]')?.getAttribute('aria-pressed') === 'true'", "Fixture saving did not finish");
        }
        evidence.push({ label: `service-${resource.id}-${width}`, copied, ...state });
        await evaluate(client, "document.querySelector('.service-facts').scrollIntoView({block:'start',behavior:'instant'})");
        await capture(client, `contact-only-service-${resource.id}-${width}.png`);
      }
      // Save the remaining physical fixtures through the same public UI.
      if (width === 1440) for (const resource of app.resources.filter(item => item.kind === "direct" && item.id !== physical.id)) {
        await open(`/service/${resource.id}`);
        await wait("Boolean(document.querySelector('[data-service-save]'))", "Physical fixture save button missing");
        await evaluate(client, "document.querySelector('[data-service-save]').click()");
      }
      await open("/directory");
      await wait("document.querySelector('[data-directory-need]')?.disabled === false", "Fixture directory did not initialize");
      await evaluate(client, "(() => {const input=document.querySelector('[data-directory-query]');input.value='Synthetic QA';input.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await wait(`document.querySelectorAll(${JSON.stringify(searchSelector)}).length === ${app.resources.length} && document.getElementById('offlineDirectoryNotice')?.dataset.networkState === 'online'`, "Fixture search results did not settle");
      await inspectRows(searchSelector, `search-${width}`);
      if (width === 390) await probeFailure(searchSelector, `search-${width}`);
      await evaluate(client, "location.hash='saved'");
      await wait(`document.querySelectorAll(${JSON.stringify(savedSelector)}).length === ${app.resources.length}`, "Saved fixture membership did not settle");
      await inspectRows(savedSelector, `saved-${width}`);
      if (width === 390) await probeFailure(savedSelector, `saved-${width}`);
    }

    // Readable contact facts must not depend on optional JavaScript tools.
    await client.call("Emulation.setScriptExecutionDisabled", { value: true });
    for (const resource of contacts) {
      await open(`/service/${resource.id}`);
      const state = await evaluate(client, `(${contactServiceSnapshot})()`);
      assertContactService(state, resource, "no-javascript");
      check(!state.tools, "No-JavaScript page showed unusable tools", state);
      evidence.push({ label: `no-javascript-${resource.id}`, ...state });
    }
    await client.call("Emulation.setScriptExecutionDisabled", { value: false });
    await auditResources();
    console.log(`Contact-only rendered QA passed: ${evidence.length} cases, synthetic local app only; service facts/copy, shortcodes, search, Saved, failed-probe recovery, physical directions and 320px URL wrapping.`);
  } catch (error) {
    const context = await evaluate(client, `(${contactFailureSnapshot})(${JSON.stringify(app.host)})`).catch(failure => ({ unavailable: failure.message }));
    evidence.push({ error: error.message, context });
    await capture(client, "contact-only-failure.png").catch(() => {});
    throw error;
  } finally {
    await client.call("Emulation.setScriptExecutionDisabled", { value: false }).catch(() => {});
    await client.call("Network.setBlockedURLs", { urls: [] }).catch(() => {});
    await client.call("Network.setBypassServiceWorker", { bypass: false }).catch(() => {});
    try {
      await mkdir(qaDir, { recursive: true });
      await writeFile(join(qaDir, "contact-only.json"), JSON.stringify(evidence, null, 2));
    } finally { await app.cleanup(); }
  }
}
