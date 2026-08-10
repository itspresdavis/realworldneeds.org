const nextSteps = document.querySelector(".service-next-steps");

if (nextSteps && !document.querySelector("[data-service-utility]")) {
  const utility = document.createElement("section");
  utility.className = "service-utility-actions";
  utility.dataset.serviceUtility = "";
  utility.setAttribute("aria-label", "Keep or share this service information");
  utility.innerHTML = `
    <div class="service-utility-actions__intro">
      <span>Keep this handy</span>
      <strong>Share, copy, or print this listing.</strong>
      <small>These actions stay on your device. RWN does not receive who you share with or what you copy.</small>
    </div>
    <div class="service-utility-actions__buttons">
      <button type="button" data-service-share>Share</button>
      <button type="button" data-service-copy>Copy details</button>
      <button type="button" data-service-print>Print</button>
    </div>
    <p class="service-utility-actions__status" data-service-action-status role="status" aria-live="polite"></p>
  `;
  nextSteps.insertAdjacentElement("afterend", utility);

  const status = utility.querySelector("[data-service-action-status]");
  const title = document.querySelector("#service h1")?.textContent?.trim() || document.title;
  const place = document.querySelector("#service .legal-meta span")?.textContent?.trim() || "";
  const officialSource = nextSteps.querySelector("a.is-primary")?.href || "";

  const publicDetails = () => {
    const rows = [...document.querySelectorAll("#service .directory-record dl > div")]
      .map((row) => {
        const label = row.querySelector("dt")?.textContent?.trim();
        const value = row.querySelector("dd")?.textContent?.replace(/\s+/g, " ")?.trim();
        return label && value ? `${label}: ${value}` : "";
      })
      .filter(Boolean);
    return [
      title,
      place,
      ...rows,
      `RWN listing: ${location.href}`,
      officialSource ? `Official source: ${officialSource}` : "",
      "Confirm current details before you go."
    ].filter(Boolean).join("\n");
  };

  const fallbackCopy = (text) => {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("copy unavailable");
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
