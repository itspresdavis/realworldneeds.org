import { CORRECTION_CATEGORIES, CORRECTION_STATUSES, MAX_CORRECTION_REASON } from "./correction-contract.js";
import { correctionRequest } from "./correction-request.js";

const statusLabels = { open: "Open", "in-review": "In review", ready: "Ready for catalog review", rejected: "No listing change needed", duplicate: "Duplicate report" };
const validId = value => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,159}$/.test(value);
const secureUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !/[\s\u0000-\u001f]/.test(value) ? url.href : null;
  } catch { return null; }
};

export function initCorrectionReview(root, { request = correctionRequest } = {}) {
  const doc = root.ownerDocument;
  const node = (tag, text, className) => {
    const element = doc.createElement(tag);
    if (text != null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  };
  const link = (label, href) => {
    const element = node("a", label);
    element.href = href;
    element.rel = "noopener noreferrer";
    return element;
  };
  const api = (path, options = {}) => request(path, { ...options, privateRequest: true });
  const heading = node("h2", "Listing correction review");
  const explanation = node("p", "Reports are private review candidates. Decisions recorded here do not edit or publish a listing. Do not add personal case information.");
  const tools = node("div", null, "correction-review__tools");
  const filterLabel = node("label", "Report status"), filter = node("select");
  filter.setAttribute("aria-label", "Report status");
  for (const value of [...CORRECTION_STATUSES, "all"]) {
    const option = node("option", statusLabels[value] || "All reports");
    option.value = value;
    filter.append(option);
  }
  filter.value = "open";
  filterLabel.append(filter);
  const refresh = node("button", "Refresh correction queue");
  refresh.type = "button";
  tools.append(filterLabel, refresh);
  const status = node("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const list = node("div", null, "correction-review__list");
  const pages = node("nav", null, "correction-review__pages");
  pages.setAttribute("aria-label", "Correction report pages");
  const previous = node("button", "Previous reports"), next = node("button", "Next reports"), pageLabel = node("span");
  previous.type = next.type = "button";
  pages.append(previous, pageLabel, next);
  const detail = node("section", null, "correction-review__detail");
  detail.hidden = true;
  root.replaceChildren(heading, explanation, tools, status, list, pages, detail);
  let page = 0, sequence = 0, detailSequence = 0, loading = false, selectedId;

  const clearPrivate = () => {
    sequence += 1;
    detailSequence += 1;
    selectedId = undefined;
    list.replaceChildren();
    detail.replaceChildren();
    detail.hidden = true;
  };
  const denied = error => {
    if (![401, 403].includes(error.status)) return false;
    clearPrivate();
    if (error.status === 403) root.hidden = true;
    else {
      root.hidden = false;
      tools.hidden = pages.hidden = true;
      status.replaceChildren(node("span", "Your session has ended. "), link("Sign in to review corrections", "/join"));
    }
    return true;
  };
  const inspect = async (id, { preserveDraft, focus = true } = {}) => {
    const current = ++detailSequence;
    selectedId = id;
    detail.hidden = false;
    detail.replaceChildren(node("p", "Opening correction report…"));
    try {
      const { data } = await api(`/api/correction-review?id=${encodeURIComponent(id)}`);
      if (current !== detailSequence) return;
      if (!data.report || !Array.isArray(data.events)) throw new Error("Invalid report");
      renderReport(data.report, data.events, preserveDraft, focus);
    } catch (error) {
      if (current !== detailSequence || denied(error)) return;
      const retry = node("button", "Retry opening report");
      retry.type = "button";
      retry.addEventListener("click", () => inspect(id, { preserveDraft }));
      detail.replaceChildren(node("p", "This report could not be loaded. Please try again."), retry);
    }
  };
  function renderReport(report, events, draft, focus) {
    detail.replaceChildren();
    const title = node("h3", report.listingName || report.resourceId);
    title.tabIndex = -1;
    title.id = "correction-detail-title";
    detail.setAttribute("aria-labelledby", title.id);
    detail.append(title);
    if (validId(report.resourceId)) detail.append(link("Open public listing", `/service/${encodeURIComponent(report.resourceId)}`));
    const source = secureUrl(report.sourceUrl);
    if (source) {
      const sourceLine = node("p"); sourceLine.append(link("Listing source at submission", source)); detail.append(sourceLine);
    }
    const facts = node("dl"), factValues = {};
    for (const [label, value] of [
      ["Listing ID", report.resourceId], ["Reported issue", CORRECTION_CATEGORIES.find(item => item.value === report.category)?.label || "Unrecognized issue"],
      ["Status", statusLabels[report.status] || "Unknown"], ["Priority", report.priority],
      ["Assigned reviewer account", report.assignedTo || "Unassigned"], ["Submitted", report.createdAt],
      ["Listing source check at submission", report.lastChecked || "Not recorded"],
    ]) {
      const field = node("dd", value); factValues[label] = field;
      facts.append(node("dt", label), field);
    }
    detail.append(facts, node("h4", "Submitted listing details"), node("p", report.note || "No additional detail supplied.", "correction-review__note"));
    const form = node("form"), fields = node("fieldset"), legend = node("legend", "Record a review decision");
    fields.append(legend);
    const controls = {};
    const select = (name, label, values, value) => {
      const field = node("label", label), input = node("select");
      input.name = name;
      for (const [key, text] of values) {
        const option = node("option", text); option.value = key; input.append(option);
      }
      input.value = value;
      field.append(input); fields.append(field); controls[name] = input;
    };
    select("status", "Decision status", CORRECTION_STATUSES.map(value => [value, statusLabels[value]]), report.status);
    select("priority", "Review priority", [["urgent", "Urgent"], ["normal", "Normal"], ["low", "Low"]], report.priority);
    select("assignment", "Assignment", [["keep", "Keep current assignment"], ["self", "Assign to me"], ["unassigned", "Leave unassigned"]], "keep");
    for (const [name, label, type, maxLength] of [["reason", "Reason and source findings", "textarea", MAX_CORRECTION_REASON], ["evidenceUrl", "Evidence URL (HTTPS)", "input", 2000]]) {
      const field = node("label", label), input = node(type);
      input.name = name; input.maxLength = maxLength;
      if (name === "reason") { input.required = true; input.minLength = 10; input.rows = 4; }
      else input.type = "url";
      field.append(input); fields.append(field); controls[name] = input;
    }
    const guidance = node("p", "A ready, rejected or duplicate decision needs a source URL. Ready means evidence is sufficient for a separate catalog review; the public listing still needs an approved release.");
    guidance.id = "correction-decision-guidance";
    controls.evidenceUrl.setAttribute("aria-describedby", guidance.id);
    fields.append(guidance);
    if (draft) for (const [key, value] of Object.entries(draft)) if (controls[key]) controls[key].value = value;
    const save = node("button", "Save review decision", "primary-button"); save.type = "submit";
    const result = node("p"); result.setAttribute("role", "status"); result.setAttribute("aria-live", "polite");
    const reload = node("button", "Reload report and keep my draft"); reload.type = "button"; reload.hidden = true;
    let pending = false, conflict = false;
    if (draft) result.textContent = "Latest report loaded. Your unsaved decision is retained; compare it with the current report before saving.";
    // Reloading retains the draft; saving again is a separate deliberate action.
    const collect = () => Object.fromEntries(Object.entries(controls).map(([key, element]) => [key, element.value.trim()]));
    reload.addEventListener("click", () => inspect(report.id, { preserveDraft: collect() }));
    form.append(fields, save, result, reload);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (pending || conflict || selectedId !== report.id) return;
      const values = collect();
      const needsEvidence = ["ready", "rejected", "duplicate"].includes(values.status);
      if (values.reason.length < 10 || values.reason.length > MAX_CORRECTION_REASON) {
        result.textContent = `Write a reason between 10 and ${MAX_CORRECTION_REASON.toLocaleString()} characters.`;
        controls.reason.focus(); return;
      }
      if ((needsEvidence && !values.evidenceUrl) || (values.evidenceUrl && !secureUrl(values.evidenceUrl))) {
        result.textContent = "Use a public HTTPS evidence URL without credentials.";
        controls.evidenceUrl.focus(); return;
      }
      pending = true; fields.disabled = true; save.setAttribute("aria-disabled", "true"); result.textContent = "Saving review decision…";
      const current = detailSequence;
      try {
        const { data } = await api("/api/correction-review", { method: "PATCH", body: { id: report.id, revision: report.revision, ...values } });
        if (current !== detailSequence) return;
        if (!data.report || data.report.id !== report.id || !Number.isInteger(data.report.revision) || data.report.revision <= report.revision) throw new Error("Save not confirmed");
        report = data.report;
        factValues.Status.textContent = statusLabels[report.status] || "Unknown";
        factValues.Priority.textContent = report.priority;
        factValues["Assigned reviewer account"].textContent = report.assignedTo || "Unassigned";
        controls.assignment.value = "keep";
        controls.reason.value = "";
        result.textContent = "Review decision saved. No public listing was changed or published.";
      } catch (error) {
        if (current !== detailSequence || denied(error)) return;
        conflict = error.status === 409;
        result.textContent = conflict ? "Another reviewer changed this report. Reload the latest report, compare it with your retained draft, and then save." : "The review decision could not be confirmed. Your draft is still here; try again.";
        reload.hidden = !conflict;
      } finally {
        pending = false; fields.disabled = false; save.setAttribute("aria-disabled", String(conflict));
      }
    });
    detail.append(form, node("h4", "Review history"));
    if (!events.length) detail.append(node("p", "No review decisions recorded yet."));
    for (const event of events) {
      const entry = node("article", null, "correction-review__card");
      entry.append(node("strong", `${statusLabels[event.status] || "Review"} · ${event.createdAt}`), node("p", event.reason, "correction-review__note"), node("p", `Reviewer account: ${event.actorId || "Unavailable"}`));
      const url = secureUrl(event.evidenceUrl);
      if (url) entry.append(link("Open review evidence", url));
      detail.append(entry);
    }
    if (focus) title.focus();
  }
  const load = async () => {
    if (loading) return;
    loading = true;
    const current = ++sequence, selectedFilter = filter.value;
    refresh.setAttribute("aria-disabled", "true"); previous.disabled = next.disabled = true;
    status.textContent = "Loading correction reports…";
    try {
      const { data } = await api(`/api/correction-review?page=${page}&status=${encodeURIComponent(filter.value)}`);
      if (current !== sequence) return;
      if (!Array.isArray(data.reports) || typeof data.hasMore !== "boolean") throw new Error("Invalid queue");
      root.hidden = false; tools.hidden = pages.hidden = false;
      list.replaceChildren();
      for (const report of data.reports) {
        const card = node("article", null, "correction-review__card");
        card.append(node("h3", report.listingName || report.resourceId), node("p", CORRECTION_CATEGORIES.find(item => item.value === report.category)?.label || "Unrecognized issue"), node("p", `${statusLabels[report.status] || "Unknown status"} · ${report.priority} priority`));
        const open = node("button", "Review correction"); open.type = "button";
        open.setAttribute("aria-label", `Review correction for ${report.listingName || report.resourceId}`);
        open.addEventListener("click", () => inspect(report.id)); card.append(open); list.append(card);
      }
      status.textContent = data.reports.length ? `${data.reports.length} correction reports on this page.` : "No correction reports match this status.";
      pageLabel.textContent = `Page ${page + 1}`;
      previous.disabled = page === 0; next.disabled = !data.hasMore;
    } catch (error) {
      if (current !== sequence || denied(error)) return;
      root.hidden = false; list.replaceChildren();
      status.textContent = "The correction queue is unavailable. Use Refresh correction queue to try again.";
    } finally {
      loading = false; refresh.setAttribute("aria-disabled", "false");
      if (current === sequence && filter.value !== selectedFilter) { page = 0; load(); }
    }
  };
  refresh.addEventListener("click", load);
  filter.addEventListener("change", () => { if (!loading) { page = 0; load(); } });
  previous.addEventListener("click", () => { if (!loading && page > 0) { page -= 1; load(); } });
  next.addEventListener("click", () => { if (!loading && !next.disabled) { page += 1; load(); } });
  load();
}

if (typeof document !== "undefined") {
  const root = document.querySelector("[data-correction-review]");
  if (root) initCorrectionReview(root);
}
