import { SAVED_RESOURCES_KEY, readSavedResources, setResourceSaved } from "../src/utils/privacy.js";

const nextSteps = document.querySelector(".service-next-steps");

if (nextSteps && !document.querySelector("[data-service-utility]")) {
  const utility = document.createElement("section");
  utility.className = "service-utility-actions";
  utility.id = "service-listing-tools";
  utility.tabIndex = -1;
  utility.dataset.serviceUtility = "";
  utility.setAttribute("aria-label", "Save, share, copy, or print this service listing");
  utility.innerHTML = `
    <div class="service-utility-actions__intro">
      <span>Listing tools</span>
      <strong>Keep this listing handy.</strong>
      <small>These actions happen on your device. RWN does not receive who you share with or the text you copy.</small>
    </div>
    <div class="service-save-actions">
      <button type="button" data-service-save aria-pressed="false" aria-describedby="service-save-privacy">Save</button>
      <a href="/directory#saved">View saved services</a>
      <small id="service-save-privacy">Saved only in this browser on this device. Anyone using this browser can see your list. You can remove it anytime.</small>
    </div>
    <div class="service-utility-actions__buttons">
      <button type="button" data-service-share>Share</button>
      <button type="button" data-service-copy>Copy details</button>
      <button type="button" data-service-print>Print</button>
    </div>
    <p class="service-utility-actions__status" data-service-action-status role="status" aria-live="polite"></p>
  `;
  // Provider facts and requirements come before optional browser-only tools.
  const details = document.querySelector("#service .directory-record");
  if (details) {
    details.insertAdjacentElement("afterend", utility);
    const jump = document.createElement("a");
    jump.className = "service-tools-jump";
    jump.href = "#service-listing-tools";
    jump.textContent = "Save, share or print";
    details.querySelector("header")?.insertAdjacentElement("afterend", jump);
  } else {
    const providerNote = nextSteps.nextElementSibling;
    const utilityAnchor = providerNote?.matches(".policy-note") ? providerNote : nextSteps;
    utilityAnchor.insertAdjacentElement("afterend", utility);
  }

  const status = utility.querySelector("[data-service-action-status]");
  const title = document.querySelector("#service h1")?.textContent?.trim() || document.title;
  const place = document.querySelector("#service .legal-meta span")?.textContent?.trim() || "";
  const officialSource = nextSteps.querySelector("a.is-primary")?.href || "";

  const saveButton = utility.querySelector("[data-service-save]");
  const serviceId = document.querySelector("#service")?.dataset.serviceId;
  const syncSaved = () => {
    try {
      const saved = readSavedResources().has(serviceId);
      saveButton.setAttribute("aria-pressed", String(saved));
      saveButton.textContent = saved ? "Remove from saved" : "Save";
      saveButton.disabled = !serviceId;
      if (!serviceId) status.textContent = "Saving is unavailable for this listing. You can still copy or print it.";
    } catch {
      saveButton.disabled = true;
      status.textContent = "Saving is unavailable in this browser. You can still copy or print this listing.";
    }
  };
  saveButton.addEventListener("click", () => {
    try {
      const saved = readSavedResources().has(serviceId);
      setResourceSaved(serviceId, !saved);
      syncSaved();
      status.textContent = saved ? "Removed from your saved services." : "Saved only in this browser. Use View saved services to return to your list.";
    } catch {
      status.textContent = "Your saved list could not be changed. Check this browser’s storage settings and try again.";
    }
  });
  window.addEventListener("pageshow", syncSaved);
  window.addEventListener("storage", (event) => {
    if (event.key === SAVED_RESOURCES_KEY || event.key === null) syncSaved();
  });
  syncSaved();

  const publicDetails = () => {
    const rows = [...document.querySelectorAll("#service .directory-record dl > div")]
      .map((row) => {
        const label = row.querySelector("dt")?.textContent?.trim();
        const value = row.querySelector("dd")?.textContent?.replace(/\s+/g, " ")?.trim();
        return label && value ? `${label}: ${value}` : "";
      })
      .filter(Boolean);
    const sourceStatus = document.querySelector("#service > .directory-shell > .source-status-notice");
    const statusLines = sourceStatus ? [...sourceStatus.querySelectorAll("strong, p")].map((node) => node.textContent.trim()) : [];
    return [
      title,
      place,
      ...statusLines,
      ...rows,
      `RWN listing: ${location.href}`,
      officialSource ? `Official source: ${officialSource}` : "",
      "Confirm current details before you go."
    ].filter(Boolean).join("\n");
  };

  const fallbackCopy = (text) => {
    const focused = document.activeElement;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    try {
      area.select();
      if (!document.execCommand("copy")) throw new Error("copy unavailable");
    } finally {
      const restoreFocus = document.activeElement === area;
      area.remove();
      if (restoreFocus && focused?.isConnected) focused.focus({ preventScroll: true });
    }
  };

  const copyText = async (text) => {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    fallbackCopy(text);
  };

  utility.querySelector("[data-service-share]")?.addEventListener("click", async () => {
    const shareData = {
      title,
      text: place ? `${title} — ${place}` : title,
      url: location.href
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        status.textContent = "Share sheet opened.";
      } else {
        await copyText(location.href);
        status.textContent = "Link copied. You can paste it into a message.";
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      status.textContent = "Sharing is unavailable in this browser. Use Copy details instead.";
    }
  });

  utility.querySelector("[data-service-copy]")?.addEventListener("click", async () => {
    try {
      await copyText(publicDetails());
      status.textContent = "Service details copied.";
    } catch {
      status.textContent = "Copy is unavailable in this browser. Select the service details on the page instead.";
    }
  });

  utility.querySelector("[data-service-print]")?.addEventListener("click", () => {
    status.textContent = "Opening the print dialog.";
    window.print();
  });
}
