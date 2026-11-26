const rowClass = "directory-global-result";
const element = (tag, text) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
};
const encode = encodeURIComponent;

export const createResultRow = (record, connectivityNotice) => {
  const { serviceActions: routes, sourceStatus, phoneLinks, phone, phoneAccess,
    serviceAccessSummary, name: resourceName, kind: resourceKind, accessUrl,
    eligibility, lat, lng } = record;
  const contactOnly = record.locationPrecision === "contact-only";
  const wrap = element("div");
  wrap.className = rowClass + "-wrap";
  const link = element("a");
  link.className = rowClass;
  link.href = `/service/${encode(record.id)}`;
  const main = element("span");
  main.append(element("strong", resourceName), element("span", record.place));
  const kind = routes ? "Service access routes" : !contactOnly && resourceKind === "direct"
    ? "Service location" : `${contactOnly ? "Phone or online help" : resourceKind === "locator" ? "Help finder or referral" : "Service network"} · check coverage`;
  link.append(main, element("small", `${record.categoryLabels.join(" · ")} · ${kind}`));
  if (record.costLabel) link.append(element("small", [record.costLabel, record.costNote].filter(Boolean).join(" — ")));
  link.append(element("small", `Source checked ${record.checked}${navigator.onLine ? "" : " · reconnect for full details"}`));

  const actions = element("nav");
  actions.className = rowClass + "-actions";
  actions.setAttribute("aria-label", `Actions for ${resourceName}`);
  const more = element("details");
  more.className = "result-more";
  more.append(element("summary", "Directions and access details"));
  const routeActions = element("nav");
  routeActions.className = rowClass + "-actions";
  routeActions.setAttribute("aria-label", `Access options for ${resourceName}`);
  let extraActions = 0;
  const add = (label, href, className, target = actions) => {
    const action = element("a", label);
    action.href = href;
    action.className = className;
    action.setAttribute("aria-label", `${label} for ${resourceName}`);
    action.rel = "noopener noreferrer";
    target.append(action);
    if (target === routeActions) extraActions++;
  };
  for (const { label, href } of phoneLinks || []) add(`Call ${label}`, href, "is-call");
  const coordinate = encode(`${lat},${lng}`);
  const steps = Object.hasOwn(record, "serviceActions") ? (Array.isArray(routes) ? routes : [])
    : !contactOnly && resourceKind === "direct" && Number.isFinite(lat) && Number.isFinite(lng)
      ? [{ label: "Apple Maps", href: `https://maps.apple.com/?daddr=${coordinate}` },
        { label: "Google Maps", href: `https://www.google.com/maps/dir/?api=1&destination=${coordinate}` }] : [];
  for (const { label, href, kind } of steps) {
    try {
      const url = new URL(href);
      if (url.href !== href || url.username || url.password || !(url.protocol === "https:" || kind === "contact" && /^(?:mailto:[a-zA-Z0-9.!#$'*+\/=_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}|sms:(?:\+[1-9]\d{6,14}|\d{3,6}))$/.test(href))) continue;
      add(label, url.href, kind === "contact" ? "is-contact" : kind === "details" ? "is-access" : "is-map", routeActions);
    } catch { /* Ignore an invalid provider URL rather than making a new one. */ }
  }
  if (contactOnly && accessUrl?.startsWith("https://")) add("Contact website", accessUrl, "is-contact");
  add("View details", link.href, "is-details");
  wrap.append(link);
  if (sourceStatus) {
    const notice = element("aside");
    notice.className = "source-status-notice";
    notice.setAttribute("aria-label", "Source-reported availability");
    notice.append(element("strong", sourceStatus.title), element("p", sourceStatus.detail));
    wrap.classList.add("has-source-status");
    wrap.append(notice);
  }
  if (phone && (phoneLinks?.length !== 1 || phoneLinks[0].label !== phone)) link.append(element("small", `Phone: ${phone}`));
  if (contactOnly) {
    link.append(element("small", [record.coverageNote, eligibility ? `Eligibility: ${eligibility}` : "",
      accessUrl ? `Website (connection required): ${accessUrl}` : "", phoneAccess ? `Dialing scope: ${phoneAccess}` : ""].filter(Boolean).join(" ")));
  }
  wrap.append(actions);
  if (serviceAccessSummary) {
    for (const route of serviceAccessSummary.split(" | ")) more.append(element("p", route));
  }
  if (extraActions) more.append(routeActions);
  if (serviceAccessSummary || extraActions) wrap.append(more);
  if (!navigator.onLine) {
    link.setAttribute("aria-describedby", connectivityNotice.id);
    link.addEventListener("click", event => {
      event.preventDefault();
      connectivityNotice.hidden = false;
      connectivityNotice.focus({ preventScroll: true });
      connectivityNotice.scrollIntoView({ block: "center", behavior: "auto" });
    });
  }
  return wrap;
};
