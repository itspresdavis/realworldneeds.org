import { correctionTextFor as setText, observeCorrectionLanguage } from "./correction-localization.js";
import { CORRECTION_CATEGORIES, MAX_CORRECTION_NOTE } from "./correction-contract.js";
import { correctionRequest } from "./correction-request.js";

export function initCorrectionForm(root, { location = globalThis.location, crypto = globalThis.crypto, request = correctionRequest } = {}) {
  const find = id => root.querySelector(`#${id}`);
  const form = find("correction-form"), fields = find("correction-fields"), category = find("correction-category"), note = find("correction-note");
  const availability = find("correction-availability"), retry = find("correction-retry"), submit = find("correction-submit"), status = find("correction-status");
  observeCorrectionLanguage(root.ownerDocument);
  const optional = Object.fromEntries([["serviceId", "service"], ["proposedCorrection", "proposal"], ["sourceUrl", "source"], ["replyContact", "reply"]].map(([name, id]) => [name, find(`correction-${id}`)]));
  let enabled = false, checking = false, pending = false, submission;
  const resourceId = new URLSearchParams(location.search).get("resourceId") || "";
  const validId = /^[a-z0-9][a-z0-9-]{0,159}$/.test(resourceId);
  const websiteContext = resourceId === "rwn-website";
  const unavailable = websiteContext ? "Accessibility feedback is not available yet because a monitored review channel has not been confirmed. No report has been sent." : "Correction reporting is not available yet. You can still check the provider’s current information from its service listing.";
  const categories = CORRECTION_CATEGORIES.filter(choice => (choice.value === "accessibility") === websiteContext);
  for (const choice of categories) {
    const option = root.ownerDocument.createElement("option");
    option.value = choice.value;
    setText(option, choice.label);
    category.append(option);
  }
  note.maxLength = MAX_CORRECTION_NOTE;
  availability.tabIndex = -1;
  if (validId) {
    find("correction-context").hidden = false;
    find("correction-listing-id").textContent = resourceId;
    find("correction-listing-link").href = websiteContext ? "/accessibility" : `/service/${encodeURIComponent(resourceId)}`;
  }
  const check = async () => {
    if (checking || pending || !validId) return;
    checking = true;
    enabled = false;
    fields.disabled = true;
    form.hidden = true;
    retry.setAttribute("aria-disabled", "true");
    setText(availability, "Checking whether correction reporting is available…");
    try {
      const { data } = await request(`/api/corrections?resourceId=${encodeURIComponent(resourceId)}`);
      if (data.context?.name) find("correction-listing-id").textContent = data.context.name;
      if (optional.serviceId && Array.isArray(data.context?.services)) {
        const selected = optional.serviceId.value || new URLSearchParams(location.search).get("serviceId") || "";
        optional.serviceId.replaceChildren();
        for (const route of [{ id: "", label: "Whole listing or unsure" }, ...data.context.services]) {
          const option = root.ownerDocument.createElement("option"); option.value = route.id;
          if (!route.id) setText(option, route.label); else option.textContent = route.label;
          optional.serviceId.append(option);
        }
        optional.serviceId.value = data.context.services.some(route => route.id === selected) ? selected : "";
        find("correction-service-field").hidden = !data.context.services.length;
      }
      enabled = data.enabled === true;
      if (enabled && typeof crypto?.randomUUID !== "function") throw new Error("Secure submission unavailable");
      form.hidden = !enabled;
      fields.disabled = !enabled;
      const restoreFocus = root.ownerDocument.activeElement === retry;
      retry.hidden = true;
      setText(availability, enabled ? "You can submit a listing correction for review. No response time is promised." : unavailable);
      if (restoreFocus) (enabled ? category : availability).focus();
    } catch {
      enabled = false;
      setText(availability, "Reporting availability could not be checked. No report has been sent. Please try again.");
      retry.hidden = false;
    } finally {
      checking = false;
      retry.setAttribute("aria-disabled", "false");
    }
  };
  retry.addEventListener("click", check);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!enabled || pending) return;
    category.removeAttribute("aria-invalid");
    note.removeAttribute("aria-invalid");
    if (!categories.some(choice => choice.value === category.value)) {
      setText(status, "Choose one issue to report.");
      category.setAttribute("aria-invalid", "true");
      category.focus();
      return;
    }
    if (note.value.length > MAX_CORRECTION_NOTE) {
      setText(status, "Keep listing details to {limit} characters or fewer.", { limit: MAX_CORRECTION_NOTE.toLocaleString() });
      note.setAttribute("aria-invalid", "true");
      note.focus();
      return;
    }
    const details = { resourceId, category: category.value, note: note.value.trim() };
    for (const [key, input] of Object.entries(optional)) if (input?.value.trim()) details[key] = input.value.trim();
    if (details.proposedCorrection?.length > MAX_CORRECTION_NOTE) {
      setText(status, "Keep listing details to {limit} characters or fewer.", { limit: MAX_CORRECTION_NOTE.toLocaleString() }); optional.proposedCorrection.focus(); return;
    }
    if (details.sourceUrl) {
      let valid = false;
      try { const url = new URL(details.sourceUrl); valid = url.protocol === "https:" && !url.username && !url.password && !/[\\\s\u0000-\u001f]/.test(details.sourceUrl); } catch {}
      if (!valid) { setText(status, "Use an HTTPS source URL without credentials."); optional.sourceUrl.focus(); return; }
    }
    if (details.replyContact && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(details.replyContact)) {
      setText(status, "Use an email address for the optional reply contact."); optional.replyContact.focus(); return;
    }
    const website = find("correction-website")?.value;
    if (website) details.website = website;
    const fingerprint = JSON.stringify(details);
    try {
      if (!submission || submission.fingerprint !== fingerprint) submission = { fingerprint, body: { ...details, submissionId: crypto.randomUUID() } };
    } catch {
      setText(status, "Secure submission is unavailable in this browser. No report has been sent.");
      return;
    }
    pending = true;
    fields.disabled = true;
    submit.setAttribute("aria-disabled", "true");
    setText(status, "Saving your correction report…");
    try {
      const { status: code, data } = await request("/api/corrections", { body: submission.body });
      if (code !== 201 || data.ok !== true) throw new Error("Save was not confirmed");
      enabled = false;
      const receipt = find("correction-receipt");
      if (receipt && data.receipt === submission.body.submissionId) { receipt.hidden = false; setText(receipt, "Receipt: {receipt}. There is no public report status lookup.", { receipt: data.receipt }); }
      setText(status, "Your correction report was saved for review. It has not changed the public listing.");
      note.value = "";
      for (const input of Object.values(optional)) if (input) input.value = "";
      submit.hidden = true;
      submission = undefined;
      status.focus();
    } catch (error) {
      setText(status, error.status === 429
        ? (error.retryAfter ? "Wait at least {seconds} seconds, then retry." : "Too many reports were sent recently. Please wait before retrying.")
        : error.status === 400 || error.status === 404
          ? "This report was not accepted. Check the listing and issue, then try again."
          : "We could not confirm your report was saved. Your details are still here; retry safely.", { seconds: error.retryAfter });
      setText(submit, "Retry correction report");
    } finally {
      pending = false;
      fields.disabled = !enabled;
      submit.setAttribute("aria-disabled", "false");
    }
  });
  if (!validId) setText(availability, "Choose a service listing before reporting a correction. Return to the directory to find it.");
  else check();
}

if (typeof document !== "undefined") {
  const root = document.querySelector("[data-correction-page]");
  if (root) initCorrectionForm(root);
}
