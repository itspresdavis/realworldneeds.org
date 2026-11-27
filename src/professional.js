const setText = (selector, value) => {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
};

function installBrandMarks() {
  document.querySelectorAll(".brand__mark").forEach((mark, index) => {
    mark.innerHTML = `<img class="rwn-brand-image" src="/brand/rwn-logo-192.png" alt="" width="192" height="192" decoding="async" ${index === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} />`;
    mark.removeAttribute("style");
  });
}

function rewriteBrandText() {
  for (const container of document.querySelectorAll(".brand__name, .footer-brand > span:last-child")) {
    const strong = container.querySelector("strong");
    const small = container.querySelector("small");
    if (strong) strong.textContent = "Real World Needs";
    if (small) small.textContent = "Essential services directory";
  }
}

function rewriteFinderCopy() {
  setText(".finder-intro h1", "Find help");
  setText(
    ".finder-intro p",
    "Free food, water, clothing, shelter and healthcare. Search by need or place to find a service and how to reach it."
  );
  const intro = document.querySelector(".finder-intro");
  if (intro && !intro.querySelector(".finder-directory-entry")) {
    const link = document.createElement("a");
    link.className = "finder-directory-entry";
    link.href = "/directory";
    link.textContent = "Browse the directory";
    intro.append(link);
  }

  const status = document.getElementById("locationStatus");
  if (status) status.textContent = "See nearby services first.";

  const live = document.getElementById("liveSourceStatus");
  if (live) live.textContent = "In the United States, location search can also load current USDA summer meal sites.";

  const privacy = document.querySelector(".location-privacy");
  if (privacy) privacy.innerHTML = `Your browser uses location to sort nearby listings. For U.S. meal searches, the USDA receives only an approximate area. You can search by place instead. <a href="/privacy#location">Location privacy</a>.`;

  const safety = document.querySelector(".finder-safety");
  if (safety) safety.innerHTML = `<strong>Immediate danger?</strong> Contact local emergency services. This directory is not an emergency service.`;
}

function rewriteMethodSections() {
  // These authored explanations remain English until a reviewed translation is
  // supplied. Translated navigation and labels declare their own language.
  document.querySelectorAll('.about-rwn, .source-band').forEach(section => { section.lang = 'en'; });
  setText(".about-rwn__heading h2", "About Real World Needs");
  setText(
    ".about-rwn__heading p",
    "We are building a directory of free essential resources so more people can find the help already available in their communities. You can search without an account."
  );

  const heading = document.querySelector(".about-rwn__heading");
  if (heading && !heading.querySelector(".contributor-invitation")) {
    const link = document.createElement("a");
    link.className = "contributor-invitation";
    link.href = "/our-story";
    link.textContent = "Why we started RWN";
    heading.append(link);
  }
  document.querySelectorAll(".about-rwn .section-kicker, .source-band .section-kicker, .results-heading .section-kicker").forEach(node => node.remove());

  const stepCopy = [
    ["Search", "Enter a city or choose the kind of help you need."],
    ["Review", "Look for the hours, address and any rules about who can use the service."],
    ["Contact", "Contact the provider to check what’s available."]
  ];
  document.querySelectorAll(".mission-steps article").forEach((article, index) => {
    article.querySelector(":scope > span")?.remove();
    const copy = stepCopy[index];
    if (!copy) return;
    const heading = article.querySelector("h3");
    const paragraph = article.querySelector("p");
    if (heading) heading.textContent = copy[0];
    if (paragraph) paragraph.textContent = copy[1];
  });

  setText(".source-band__heading h2", "Where the listings come from");
  setText(
    ".source-band__heading p",
    "We use public information from providers and official networks. You can follow the source link on each listing."
  );

  const principles = document.getElementById("principleGrid");
  if (principles) {
    principles.innerHTML = `
      <article><div><h3>Source</h3><p>Open the original page for more details.</p></div></article>
      <article><div><h3>Review date</h3><p>See when we last reviewed the source.</p></div></article>
      <article><div><h3>Changes</h3><p>Hours and availability can change between reviews.</p></div></article>
    `;
  }
}

function simplifyStructure() {
  document.querySelector(".directory-strip")?.remove();
  document.getElementById("accountability")?.remove();
}

export function installProfessionalPresentation() {
  if (!document.querySelector(".finder-intro")) return false;
  document.documentElement.classList.add("rwn-professional");
  document.body.classList.add("rwn-professional", "rwn-atlas");
  const globe = document.querySelector('.globe-stage');
  setText(".globe-meta > div:first-child strong", "Service map");
  if (globe && !globe.querySelector('.atlas-key')) {
    const key = document.createElement('div');
    key.className = 'atlas-key';
    key.setAttribute('role', 'group');
    key.setAttribute('aria-label', 'Map marker key');
    key.innerHTML = '<span><i class="atlas-key__site"></i>Service location</span><span><i class="atlas-key__area"></i>Regional finder</span>';
    globe.append(key);
  }
  installBrandMarks();
  rewriteBrandText();
  rewriteFinderCopy();
  rewriteMethodSections();
  simplifyStructure();
  return true;
}
