import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SAVED_RESOURCES_KEY } from "../src/utils/privacy.js";
import { createContactFixtureApp } from "./qa-contact-fixture-app.mjs";
import { assertContactRows, contactRowsSnapshot, contactFailureSnapshot } from "./qa-contact-only.mjs";

const check = (condition, message, detail) => {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`);
};
const searchSelector = ".directory-global-results .directory-global-result-wrap";
const savedSelector = "[data-saved-list] .saved-service-row";

// Serialized into the established CI browser client. These observations do not
// replace fetch, dispatch connectivity events, or change the application's UI.
export function connectivityRecoveryContext(savedKey) {
  const visible = node => {
    const rect = node?.getBoundingClientRect();
    return Boolean(node?.isConnected && rect?.width && rect?.height && getComputedStyle(node).visibility !== "hidden" && getComputedStyle(node).display !== "none");
  };
  const notice = document.getElementById("offlineDirectoryNotice");
  const retry = notice?.querySelector("[data-directory-reconnect]");
  const status = notice?.querySelector("[data-directory-connection-status]");
  const focus = document.activeElement;
  return {
    href: location.href, timeOrigin: performance.timeOrigin, historyLength: history.length,
    navigatorOnline: navigator.onLine, query: document.querySelector("[data-directory-query]")?.value,
    countryControlPresent: Boolean(document.querySelector("[data-directory-country]")),
    country: document.querySelector("[data-directory-country]")?.value ?? null,
    help: document.querySelector("[data-directory-need]")?.value,
    activeHelp: document.querySelector('[data-directory-category][aria-pressed="true"]')?.dataset.directoryCategory,
    savedStorage: localStorage.getItem(savedKey), networkState: notice?.dataset.networkState,
    noticeVisible: visible(notice), status: status?.textContent.trim() || "",
    retry: { tag: retry?.tagName, type: retry?.type, text: retry?.textContent.trim(), visible: visible(retry), ariaDisabled: retry?.getAttribute("aria-disabled"), disabled: retry?.disabled },
    focus: { connected: Boolean(focus?.isConnected), visible: visible(focus), inNotice: Boolean(notice?.contains(focus)), retry: focus === retry, body: focus === document.body },
    events: globalThis.__rwnConnectivityRecoveryQA ? {
      online: globalThis.__rwnConnectivityRecoveryQA.online,
      clicks: [...globalThis.__rwnConnectivityRecoveryQA.clicks],
      checking: [...globalThis.__rwnConnectivityRecoveryQA.checking],
      keyboard: [...(globalThis.__rwnConnectivityRecoveryQA.keyboard || [])]
    } : null
  };
}

export function assertConnectivityFailure(state, resources) {
  assertContactRows(state, resources, true);
  check(state.navigatorOnline === true && state.networkState === "offline" && state.noticeVisible, "Failed probe was not presented while the browser remained online", state);
  check(state.retry.tag === "BUTTON" && state.retry.type === "button" && state.retry.text && state.retry.visible && !state.retry.disabled && state.retry.ariaDisabled !== "true", "Recovery button is unavailable after the failed probe", state);
  check(state.status && state.focus.connected && state.focus.visible && state.focus.inNotice && !state.focus.body, "Blocked details did not retain visible focus in the connection notice", state);
  check(state.events?.online === 0 && state.events.clicks.length === 0, "Recovery baseline already received a connectivity event or retry", state);
}

export function assertConnectivityRetained(before, after) {
  const fields = ["href", "timeOrigin", "historyLength", "query", "countryControlPresent", "country", "help", "activeHelp", "savedStorage"];
  check(fields.every(field => after[field] === before[field]), "Retry navigated, reloaded, or changed the search/Saved state", { before, after });
  check(JSON.stringify(after.rows.map(row => row.id)) === JSON.stringify(before.rows.map(row => row.id)), "Retry changed result order or membership", { before: before.rows, after: after.rows });
  const actions = rows => rows.map(row => [row.id, row.actions.map(action => [action.href, action.text])]);
  check(JSON.stringify(actions(after.rows)) === JSON.stringify(actions(before.rows)), "Retry changed a listing action destination or label", { before: before.rows, after: after.rows });
  check(JSON.stringify(after.rows.map(row => [row.id, row.warning, row.warningVisible])) === JSON.stringify(before.rows.map(row => [row.id, row.warning, row.warningVisible])), "Retry changed a source-reported availability warning", { before: before.rows, after: after.rows });
}

export function assertConnectivityRecovered(before, after, resources) {
  assertContactRows(after, resources);
  assertConnectivityRetained(before, after);
  check(after.navigatorOnline === true && after.networkState === "online" && after.events?.online === 0, "Recovery depended on an online event or changed the browser network state", after);
  check(after.events.clicks.length === 1 && after.events.clicks[0].trusted, "Retry did not receive exactly one trusted activation", after.events);
  check(after.events.checking.some(state => state.ariaDisabled === "true" || state.oldAriaDisabled === "true"), "Retry never exposed its checking state", after.events);
  check(after.status.includes("Connection restored") && after.retry.ariaDisabled !== "true" && !after.retry.disabled, "Recovery did not announce completion and restore the button", after);
  check(after.noticeVisible && after.retry.visible && after.focus.retry && after.focus.connected && after.focus.visible && !after.focus.body, "Successful retry hid or discarded keyboard focus", after);
}

export function assertConnectivityFocusReleased(before, after) {
  assertConnectivityRetained(before, after);
  check(after.networkState === "online" && !after.noticeVisible && !after.focus.inNotice && after.focus.connected && after.focus.visible && !after.focus.body, "Recovered notice did not hide safely after native Tab moved focus away", after);
  check(after.events?.online === 0, "An online event occurred during the recovery journey", after.events);
}

export async function pressConnectivityRecoveryKey(client, name, code) {
  // Match qa-search-relevance and qa-page-menu-reflow: native button Enter
  // activation needs the character-bearing phase, not just raw keydown/keyup.
  const text = name === "Enter" ? "\r" : "";
  await client.call("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, ...(text ? { text, unmodifiedText: text } : {}) });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
}

// One local synthetic build serves all four additive cases. Optional fixtureApp
// permits reuse without transferring fixture cleanup ownership to this verifier.
export async function verifyConnectivityRecovery({ client, navigate, evaluate, capture, qaDir = "qa-screenshots", fixtureApp }) {
  const app = fixtureApp || await createContactFixtureApp();
  const evidence = [];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  let fixtureDocument = false, currentCase;
  const wait = async (expression, message) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await evaluate(client, expression)) return;
      await pause(75);
    }
    throw new Error(message);
  };
  const key = (name, code) => pressConnectivityRecoveryKey(client, name, code);
  const click = async selector => {
    const point = await evaluate(client, `(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) throw new Error('Fixture click target is missing');
      target.scrollIntoView({block:'center',behavior:'instant'});
      const rect = target.getBoundingClientRect();
      const x = (Math.max(0,rect.left)+Math.min(innerWidth,rect.right))/2;
      const y = (Math.max(0,rect.top)+Math.min(innerHeight,rect.bottom))/2;
      if (!rect.width || !rect.height || !target.contains(document.elementFromPoint(x,y))) throw new Error('Fixture click target is obscured');
      return {x,y};
    })()`);
    await client.call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  const snapshot = selector => evaluate(client, `({...(${contactRowsSnapshot})(${JSON.stringify(selector)}), ...(${connectivityRecoveryContext})(${JSON.stringify(SAVED_RESOURCES_KEY)})})`);
  const auditResources = async () => {
    const state = await evaluate(client, "({origin:location.origin,path:location.pathname,external:performance.getEntriesByType('resource').map(entry=>entry.name).filter(url=>/^https?:/.test(url)&&new URL(url).origin!==location.origin)})");
    check(state.origin === app.host && !state.external.length, "Connectivity fixture left its local origin or requested an external resource", state);
    evidence.push({ label: "document-resource-audit", ...state });
  };
  try {
    await client.call("Network.enable");
    await client.call("Network.setBypassServiceWorker", { bypass: true });
    for (const width of [1440, 390]) {
      await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
      for (const view of ["search", "saved"]) {
        const label = `${view}-${width}`;
        const selector = view === "saved" ? savedSelector : searchSelector;
        currentCase = { label, selector };
        if (fixtureDocument) await auditResources();
        // Only release.json fails. The document, catalog and saved IDs stay
        // usable, and navigator.onLine remains true throughout the journey.
        await client.call("Network.setBlockedURLs", { urls: [`${app.host}/data/release.json*`] });
        await navigate(client, `${app.host}/directory`);
        fixtureDocument = true;
        await wait("document.querySelector('[data-directory-need]')?.disabled === false && document.getElementById('offlineDirectoryNotice')?.dataset.networkState === 'offline' && Boolean(document.querySelector('[data-directory-reconnect]'))", "Initial fixture release probe did not fail closed with a retry button");
        const ids = app.resources.map(resource => resource.id).reverse();
        // Seed only this ephemeral fixture origin, in intentionally non-search
        // order. No real Saved data or production origin is read or changed.
        await evaluate(client, `(() => {
          localStorage.setItem(${JSON.stringify(SAVED_RESOURCES_KEY)}, ${JSON.stringify(JSON.stringify(ids))});
          const input = document.querySelector('[data-directory-query]'); input.value='Synthetic QA'; input.dispatchEvent(new Event('input',{bubbles:true}));
          const country = document.querySelector('[data-directory-country]'); if(country){country.value='United States'; country.dispatchEvent(new Event('change',{bubbles:true}));}
          const need = document.querySelector('[data-directory-need]'); need.value='Food'; need.dispatchEvent(new Event('change',{bubbles:true}));
        })()`);
        await wait(`document.querySelectorAll(${JSON.stringify(searchSelector)}).length === ${app.resources.length}`, "Filtered fixture results did not settle");
        if (view === "saved") {
          await evaluate(client, "location.hash='saved'");
          await wait(`document.querySelectorAll(${JSON.stringify(savedSelector)}).length === ${app.resources.length}`, "Saved fixture results did not settle");
        }
        await evaluate(client, `(() => {
          const notice=document.getElementById('offlineDirectoryNotice'), retry=notice.querySelector('[data-directory-reconnect]');
          const qa=globalThis.__rwnConnectivityRecoveryQA={online:0,clicks:[],checking:[],keyboard:[]};
          window.addEventListener('online',()=>qa.online++);
          retry.addEventListener('click',event=>qa.clicks.push({trusted:event.isTrusted,detail:event.detail}),true);
          for(const type of ['keydown','keypress','keyup']) retry.addEventListener(type,event=>qa.keyboard.push({type:event.type,key:event.key,trusted:event.isTrusted,defaultPrevented:event.defaultPrevented}));
          new MutationObserver(records=>{
            for(const record of records) if(record.target===retry && record.attributeName==='aria-disabled') qa.checking.push({ariaDisabled:retry.getAttribute('aria-disabled'),oldAriaDisabled:record.oldValue,status:notice.querySelector('[data-directory-connection-status]')?.textContent});
          }).observe(notice,{attributes:true,attributeOldValue:true,subtree:true,attributeFilter:['aria-disabled']});
        })()`);
        const beforeLink = await snapshot(selector);
        // The shared six-record fixture has one country, so the real generator
        // deliberately omits its country selector. Record that limitation rather
        // than inventing a control or claiming a rendered country-selection case.
        const countryExpected = new Set(app.resources.map(resource => resource.country)).size > 1;
        check(beforeLink.query === "Synthetic QA" && beforeLink.countryControlPresent === countryExpected && beforeLink.country === (countryExpected ? "United States" : null) && beforeLink.help === "Food" && beforeLink.activeHelp === "Food", "Recovery fixture filters were not established", beforeLink);
        check(beforeLink.savedStorage === JSON.stringify(ids), "Recovery fixture Saved IDs were not established", beforeLink);
        if (view === "saved") check(JSON.stringify(beforeLink.rows.map(row => row.id)) === JSON.stringify(ids), "Saved fixture did not retain seeded ID order", beforeLink);
        // Failed-probe details must remain on this page and focus the notice.
        await click(`${selector} .directory-global-result`);
        await wait("document.getElementById('offlineDirectoryNotice')?.contains(document.activeElement)", "Blocked details did not focus their connection notice");
        const before = await snapshot(selector);
        assertConnectivityRetained(beforeLink, before);
        assertConnectivityFailure(before, app.resources);
        evidence.push({ label: `${label}-failed`, ...before });
        await capture(client, `connectivity-recovery-${label}-failed.png`);

        await client.call("Network.setBlockedURLs", { urls: [] });
        // Do not dispatch an online event: that is the original recovery gap.
        if (width < 600) {
          await key("Tab", 9);
          check(await evaluate(client, "document.activeElement?.matches('[data-directory-reconnect]')"), "Native Tab could not reach the recovery button", label);
          await key("Enter", 13);
        } else await click("[data-directory-reconnect]");
        await wait("document.getElementById('offlineDirectoryNotice')?.dataset.networkState === 'online' && document.querySelector('[data-directory-reconnect]')?.getAttribute('aria-disabled') !== 'true'", "Trusted Retry did not restore connectivity without an online event");
        const recovered = await snapshot(selector);
        assertConnectivityRecovered(before, recovered, app.resources);
        check(recovered.events.clicks[0].detail === (width < 600 ? 0 : 1), "Retry activation was not the expected keyboard/mouse route", recovered.events);
        evidence.push({ label: `${label}-recovered`, ...recovered });
        await capture(client, `connectivity-recovery-${label}-recovered.png`);
        await key("Tab", 9);
        await wait("document.getElementById('offlineDirectoryNotice')?.hidden === true", "Recovered notice remained after focus left it");
        const released = await snapshot(selector);
        assertConnectivityFocusReleased(before, released);
        assertContactRows(released, app.resources);
        evidence.push({ label: `${label}-focus-released`, ...released });

        // Only an explicitly clicked, same-origin fictional details route may
        // navigate. This also proves the offline interception was removed.
        await auditResources();
        const id = recovered.rows[0].id;
        await click(`${selector} .is-details`);
        await wait(`location.href === ${JSON.stringify(`${app.host}/service/${encodeURIComponent(id)}`)} && document.querySelector('#service')?.dataset.serviceId === ${JSON.stringify(id)}`, "Recovered details action remained intercepted or navigated unexpectedly");
        evidence.push({ label: `${label}-details-restored`, id, href: `${app.host}/service/${encodeURIComponent(id)}` });
      }
    }
    await auditResources();
    console.log("Connectivity recovery QA passed: search/Saved at 1440px and 390px; trusted mouse/keyboard Retry without online events, retained state and focus, local fixture only (one country, no country selector).");
  } catch (error) {
    const context = await evaluate(client, `(${contactFailureSnapshot})(${JSON.stringify(app.host)})`).catch(failure => ({ unavailable: failure.message }));
    const recovery = context.fixture && currentCase ? await snapshot(currentCase.selector).catch(failure => ({ unavailable: failure.message })) : null;
    evidence.push({ error: error.message, label: currentCase?.label, context, recovery });
    await capture(client, "connectivity-recovery-failure.png").catch(() => {});
    throw error;
  } finally {
    await client.call("Network.setBlockedURLs", { urls: [] }).catch(() => {});
    await client.call("Network.setBypassServiceWorker", { bypass: false }).catch(() => {});
    try {
      await mkdir(qaDir, { recursive: true });
      await writeFile(join(qaDir, "connectivity-recovery.json"), JSON.stringify(evidence, null, 2));
    } finally { if (!fixtureApp) await app.cleanup(); }
  }
}
