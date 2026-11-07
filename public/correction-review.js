import { correctionText, correctionTextFor as setText, correctionLabelFor as setLabel, observeCorrectionLanguage } from "./correction-localization.js";
import { appendCorrectionPublication } from "./correction-publication.js";
import { CORRECTION_CATEGORIES, CORRECTION_STATUSES, MAX_CORRECTION_REASON } from "./correction-contract.js";
import { correctionRequest } from "./correction-request.js";

const statusLabels = { open: "Open", "in-review": "In review", ready: "Ready for catalog review", applied: "Catalog updated; awaiting release", resolved: "Public release verified", rejected: "No listing change needed", duplicate: "Duplicate report" };
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
  const uiNode = (tag, key, className, params = {}) => { const element = node(tag, null, className); const label = tag === "label" ? node("span") : element; setText(label, key, params); if (label !== element) element.append(label); return element; };
  observeCorrectionLanguage(root);
  const link = (label, href) => {
    const element = uiNode("a", label);
    element.href = href;
    element.rel = "noopener noreferrer";
    return element;
  };
  const api = (path, options = {}) => request(path, { ...options, privateRequest: true });
  const heading = uiNode("h2", "Listing correction review");
  const explanation = uiNode("p", "Reports are private review candidates. Decisions recorded here do not edit or publish a listing. Do not add personal case information.");
  const tools = node("div", null, "correction-review__tools");
  const filterLabel = uiNode("label", "Report status"), filter = node("select");
  setLabel(filter, "Report status");
  for (const value of [...CORRECTION_STATUSES, "all"]) {
    const option = uiNode("option", statusLabels[value] || "All reports");
    option.value = value;
    filter.append(option);
  }
  filter.value = "open";
  filterLabel.append(filter);
  const refresh = uiNode("button", "Refresh correction queue");
  refresh.type = "button";
  tools.append(filterLabel, refresh);
  const status = node("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const list = node("div", null, "correction-review__list");
  const pages = node("nav", null, "correction-review__pages");
  setLabel(pages, "Correction report pages");
  const previous = uiNode("button", "Previous reports"), next = uiNode("button", "Next reports"), pageLabel = node("span");
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
      status.replaceChildren(uiNode("span", "Your session has ended. "), link("Sign in to review corrections", "/join"));
    }
    return true;
  };
  const inspect = async (id, { preserveDraft, preserveCatalogDraft, focus = true } = {}) => {
    const current = ++detailSequence;
    selectedId = id;
    detail.hidden = false;
    detail.replaceChildren(uiNode("p", "Opening correction report…"));
    try {
      const { data } = await api(`/api/correction-review?id=${encodeURIComponent(id)}`);
      if (current !== detailSequence) return;
      if (!data.report || !Array.isArray(data.events)) throw new Error("Invalid report");
      renderReport(data.report, data.events, preserveDraft, focus, data.currentCatalog, preserveCatalogDraft);
    } catch (error) {
      if (current !== detailSequence || denied(error)) return;
      const retry = uiNode("button", "Retry opening report");
      retry.type = "button";
      retry.addEventListener("click", () => inspect(id, { preserveDraft, preserveCatalogDraft }));
      detail.replaceChildren(uiNode("p", "This report could not be loaded. Please try again."), retry);
    }
  };
  function renderReport(report, events, draft, focus, currentCatalog, catalogDraft) {
    const renderedSequence = detailSequence;
    detail.replaceChildren();
    const title = node("h3", report.listingName || report.resourceId);
    title.tabIndex = -1;
    title.id = "correction-detail-title";
    detail.setAttribute("aria-labelledby", title.id);
    detail.append(title);
    if (validId(report.resourceId)) detail.append(link("Open public listing", report.resourceId === "rwn-website" ? "/accessibility" : `/service/${encodeURIComponent(report.resourceId)}`));
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
      if (["Status", "Reported issue"].includes(label)) setText(field, value);
      if (label === "Priority") setText(field, ({ urgent: "Urgent", normal: "Normal", low: "Low" })[value] || "Unknown status");
      if (value === "Unassigned" || value === "Not recorded") setText(field, value);
      facts.append(uiNode("dt", label), field);
    }
    detail.append(facts, uiNode("h4", "Submitted listing details"), node("p", report.note || "No additional detail supplied.", "correction-review__note"));
    for (const [label, value] of [["Proposed correction", report.proposedCorrection], ["Private reply email", report.replyContact]]) if (value) detail.append(uiNode("h4", label), node("p", value, "correction-review__note"));
    const proposedSource = secureUrl(report.proposedSourceUrl);
    if (proposedSource) detail.append(link("Submitted source", proposedSource));
    detail.append(uiNode("p", "Original provider text is preserved."));
    const form = node("form"), fields = node("fieldset"), legend = uiNode("legend", "Record a review decision");
    fields.append(legend);
    const controls = {};
    const select = (name, label, values, value) => {
      const field = uiNode("label", label), input = node("select");
      input.name = name;
      for (const [key, text] of values) {
        const option = uiNode("option", text); option.value = key; input.append(option);
      }
      input.value = value;
      field.append(input); fields.append(field); controls[name] = input;
    };
    select("status", "Decision status", CORRECTION_STATUSES.filter(value => !["applied", "resolved"].includes(value)).map(value => [value, statusLabels[value]]), report.status);
    select("priority", "Review priority", [["urgent", "Urgent"], ["normal", "Normal"], ["low", "Low"]], report.priority);
    select("assignment", "Assignment", [["keep", "Keep current assignment"], ["self", "Assign to me"], ["unassigned", "Leave unassigned"]], "keep");
    for (const [name, label, type, maxLength] of [["reason", "Reason and source findings", "textarea", MAX_CORRECTION_REASON], ["evidenceUrl", "Evidence URL (HTTPS)", "input", 2000]]) {
      const field = uiNode("label", label), input = node(type);
      input.name = name; input.maxLength = maxLength;
      if (name === "reason") { input.required = true; input.minLength = 10; input.rows = 4; }
      else input.type = "url";
      field.append(input); fields.append(field); controls[name] = input;
    }
    const guidance = uiNode("p", "A ready, rejected or duplicate decision needs a source URL. Ready means evidence is sufficient for a separate catalog review; the public listing still needs an approved release.");
    guidance.id = "correction-decision-guidance";
    controls.evidenceUrl.setAttribute("aria-describedby", guidance.id);
    fields.append(guidance);
    if (draft) for (const [key, value] of Object.entries(draft)) if (controls[key]) controls[key].value = value;
    const save = uiNode("button", "Save review decision", "primary-button"); save.type = "submit";
    const result = node("p"); result.setAttribute("role", "status"); result.setAttribute("aria-live", "polite");
    const reload = uiNode("button", "Reload report and keep my draft"); reload.type = "button"; reload.hidden = true;
    let pending = false, conflict = false;
    if (draft) setText(result, "Latest report loaded. Your unsaved decision is retained; compare it with the current report before saving.");
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
        setText(result, "Write a reason between 10 and {limit} characters.", { limit: MAX_CORRECTION_REASON.toLocaleString() });
        controls.reason.focus(); return;
      }
      if ((needsEvidence && !values.evidenceUrl) || (values.evidenceUrl && !secureUrl(values.evidenceUrl))) {
        setText(result, "Use a public HTTPS evidence URL without credentials.");
        controls.evidenceUrl.focus(); return;
      }
      pending = true; fields.disabled = true; save.setAttribute("aria-disabled", "true"); setText(result, "Saving review decision…");
      const current = detailSequence;
      try {
        const { data } = await api("/api/correction-review", { method: "PATCH", body: { id: report.id, revision: report.revision, ...values } });
        if (current !== detailSequence) return;
        if (!data.report || data.report.id !== report.id || !Number.isInteger(data.report.revision) || data.report.revision <= report.revision) throw new Error("Save not confirmed");
        report = data.report;
        setText(factValues.Status, statusLabels[report.status] || "Unknown status");
        setText(factValues.Priority, ({ urgent: "Urgent", normal: "Normal", low: "Low" })[report.priority] || "Unknown status");
        if (report.assignedTo) { factValues["Assigned reviewer account"].removeAttribute("data-correction-message"); factValues["Assigned reviewer account"].textContent = report.assignedTo; }
        else setText(factValues["Assigned reviewer account"], "Unassigned");
        controls.assignment.value = "keep";
        controls.reason.value = "";
        setText(result, "Review decision saved. No public listing was changed or published.");
        renderPublication();
      } catch (error) {
        if (current !== detailSequence || denied(error)) return;
        conflict = error.status === 409;
        setText(result, conflict ? "Another reviewer changed this report. Reload the latest report, compare it with your retained draft, and then save." : "The review decision could not be confirmed. Your draft is still here; try again.");
        reload.hidden = !conflict;
      } finally {
        pending = false; fields.disabled = false; save.setAttribute("aria-disabled", String(conflict));
      }
    });
    if (!["applied", "resolved"].includes(report.status)) detail.append(form);
    else detail.append(uiNode("p", "This report is linked to a catalog change. Review its publication status below."));
    const publication = node("section");
    const renderPublication = () => {
      publication.replaceChildren();
      appendCorrectionPublication(publication, { report, currentCatalog, request: async (...args) => {
        try {
          const response = await api(...args);
          if (renderedSequence !== detailSequence || selectedId !== report.id) throw new Error("Superseded review action");
          return response;
        } catch (error) { denied(error); throw error; }
      }, draft: catalogDraft,
        onComplete: () => { if (renderedSequence === detailSequence && selectedId === report.id) inspect(report.id, { focus: false }); },
        onReload: nextDraft => inspect(report.id, { preserveCatalogDraft: nextDraft }),
      });
    };
    renderPublication(); detail.append(publication);
    detail.append(uiNode("h4", "Review history"));
    if (!events.length) detail.append(uiNode("p", "No review decisions recorded yet."));
    for (const event of events) {
      const entry = node("article", null, "correction-review__card");
      entry.append(uiNode("strong", "{status} · {date}", undefined, { status: statusLabels[event.status] || "Review", date: event.createdAt }), node("p", event.reason, "correction-review__note"), uiNode("p", "Reviewer account: {account}", undefined, { account: event.actorId || correctionText("Unavailable") }));
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
    setText(status, "Loading correction reports…");
    try {
      const { data } = await api(`/api/correction-review?page=${page}&status=${encodeURIComponent(filter.value)}`);
      if (current !== sequence) return;
      if (!Array.isArray(data.reports) || typeof data.hasMore !== "boolean") throw new Error("Invalid queue");
      root.hidden = false; tools.hidden = pages.hidden = false;
      list.replaceChildren();
      for (const report of data.reports) {
        const card = node("article", null, "correction-review__card");
        card.append(node("h3", report.listingName || report.resourceId), uiNode("p", CORRECTION_CATEGORIES.find(item => item.value === report.category)?.label || "Unrecognized issue"), uiNode("p", "{status} · {priority}", undefined, { status: statusLabels[report.status] || "Unknown status", priority: ({ urgent: "Urgent", normal: "Normal", low: "Low" })[report.priority] || "Unknown status" }));
        const open = uiNode("button", "Review correction"); open.type = "button";
        setLabel(open, "Review correction for {listing}", { listing: report.listingName || report.resourceId });
        open.addEventListener("click", () => inspect(report.id)); card.append(open); list.append(card);
      }
      setText(status, data.reports.length ? "{count} correction reports on this page." : "No correction reports match this status.", { count: data.reports.length });
      setText(pageLabel, "Page {page}", { page: page + 1 });
      previous.disabled = page === 0; next.disabled = !data.hasMore;
    } catch (error) {
      if (current !== sequence || denied(error)) return;
      root.hidden = false; list.replaceChildren();
      setText(status, "The correction queue is unavailable. Use Refresh correction queue to try again.");
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
