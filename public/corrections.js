import { CORRECTION_CATEGORIES, MAX_CORRECTION_NOTE } from "./correction-contract.js";
import { correctionRequest } from "./correction-request.js";

export function initCorrectionForm(root, { location = globalThis.location, crypto = globalThis.crypto, request = correctionRequest } = {}) {
  const find = id => root.querySelector(`#${id}`);
  const form = find("correction-form"), fields = find("correction-fields"), category = find("correction-category"), note = find("correction-note");
  const availability = find("correction-availability"), retry = find("correction-retry"), submit = find("correction-submit"), status = find("correction-status");
  let enabled = false, checking = false, pending = false, submission;
  const resourceId = new URLSearchParams(location.search).get("resourceId") || "";
  const validId = /^[a-z0-9][a-z0-9-]{0,159}$/.test(resourceId);
  const unavailable = "Correction reporting is not available yet. You can still check the provider’s current information from its service listing.";
  for (const choice of CORRECTION_CATEGORIES) {
    const option = root.ownerDocument.createElement("option");
    option.value = choice.value;
    option.textContent = choice.label;
    category.append(option);
  }
  note.maxLength = MAX_CORRECTION_NOTE;
  availability.tabIndex = -1;
  if (validId) {
    find("correction-context").hidden = false;
    find("correction-listing-id").textContent = resourceId;
    find("correction-listing-link").href = `/service/${encodeURIComponent(resourceId)}`;
  }
  const check = async () => {
    if (checking || pending || !validId) return;
    checking = true;
    enabled = false;
    fields.disabled = true;
    form.hidden = true;
    retry.setAttribute("aria-disabled", "true");
    availability.textContent = "Checking whether correction reporting is available…";
    try {
      const { data } = await request("/api/corrections");
      enabled = data.enabled === true;
      if (enabled && typeof crypto?.randomUUID !== "function") throw new Error("Secure submission unavailable");
      form.hidden = !enabled;
      fields.disabled = !enabled;
      const restoreFocus = root.ownerDocument.activeElement === retry;
      retry.hidden = true;
      availability.textContent = enabled ? "You can submit a listing correction for review. No response time is promised." : unavailable;
      if (restoreFocus) (enabled ? category : availability).focus();
    } catch {
      enabled = false;
      availability.textContent = "Reporting availability could not be checked. No report has been sent. Please try again.";
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
    if (!CORRECTION_CATEGORIES.some(choice => choice.value === category.value)) {
      status.textContent = "Choose one issue to report.";
      category.setAttribute("aria-invalid", "true");
      category.focus();
      return;
    }
    if (note.value.length > MAX_CORRECTION_NOTE) {
      status.textContent = `Keep listing details to ${MAX_CORRECTION_NOTE.toLocaleString()} characters or fewer.`;
      note.setAttribute("aria-invalid", "true");
      note.focus();
      return;
    }
    const details = { resourceId, category: category.value, note: note.value.trim() };
    const website = find("correction-website")?.value;
    if (website) details.website = website;
    const fingerprint = JSON.stringify(details);
    try {
      if (!submission || submission.fingerprint !== fingerprint) submission = { fingerprint, body: { ...details, submissionId: crypto.randomUUID() } };
    } catch {
      status.textContent = "Secure submission is unavailable in this browser. No report has been sent.";
      return;
    }
    pending = true;
    fields.disabled = true;
    submit.setAttribute("aria-disabled", "true");
    status.textContent = "Saving your correction report…";
    try {
      const { status: code, data } = await request("/api/corrections", { body: submission.body });
      if (code !== 201 || data.ok !== true) throw new Error("Save was not confirmed");
      enabled = false;
      status.textContent = "Your correction report was saved for review. It has not changed the public listing.";
      note.value = "";
      submit.hidden = true;
      submission = undefined;
      status.focus();
    } catch (error) {
      status.textContent = error.status === 429
        ? `Too many reports were sent recently. ${error.retryAfter ? `Wait at least ${error.retryAfter} seconds, then retry.` : "Please wait before retrying."}`
        : error.status === 400 || error.status === 404
          ? "This report was not accepted. Check the listing and issue, then try again."
          : "We could not confirm your report was saved. Your details are still here; retry safely.";
      submit.textContent = "Retry correction report";
    } finally {
      pending = false;
      fields.disabled = !enabled;
      submit.setAttribute("aria-disabled", "false");
    }
  });
  if (!validId) availability.textContent = "Choose a service listing before reporting a correction. Return to the directory to find it.";
  else check();
}

if (typeof document !== "undefined") {
  const root = document.querySelector("[data-correction-page]");
  if (root) initCorrectionForm(root);
}
