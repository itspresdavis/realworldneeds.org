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

function rewriteNavigation() {
  const desktop = document.querySelector(".primary-nav");
  const mobile = document.querySelector(".site-menu nav");
  const links = `
    <a href="#finder" data-section-link="finder" aria-current="location">Find help</a>
    <a href="/directory">Directory</a>
    <a href="/about">About RWN</a>
    <a href="/sources">Sources</a>
    <a href="/get-involved">Get involved</a>
  `;
  if (desktop) desktop.innerHTML = links;
  if (mobile) mobile.innerHTML = links;

  const menuSummary = document.querySelector(".site-menu > summary");
  if (menuSummary) {
    menuSummary.textContent = "Menu";
    menuSummary.setAttribute("aria-label", "Open navigation menu");
    menuSummary.setAttribute("title", "Menu");
  }

  const action = document.querySelector(".header-action");
  if (action) {
    action.textContent = "Saved";
    action.href = "/directory#saved";
    action.removeAttribute("data-section-link");
    action.setAttribute("aria-label", "Open saved services");
  }
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
    "Free help. Clear next steps."
  );

  const status = document.getElementById("locationStatus");
  if (status) status.textContent = "Nearby service locations appear first when you choose to share your location.";

  const live = document.getElementById("liveSourceStatus");
  if (live) live.textContent = "In the United States, location search can also load current USDA summer meal sites.";

  const privacy = document.querySelector(".location-privacy");
  if (privacy) privacy.innerHTML = `Your browser uses location to sort nearby listings. For U.S. meal searches, the USDA receives only an approximate area. You can search by place instead. <a href="/privacy#location">Read how location works</a>.`;

  const safety = document.querySelector(".finder-safety");
  if (safety) safety.innerHTML = `<strong>Immediate danger?</strong> Contact local emergency services. This directory is not an emergency service.`;
}

function rewriteMethodSections() {
  // These authored explanations remain English until a reviewed translation is
  // supplied. Translated navigation and labels declare their own language.
  document.querySelectorAll('.about-rwn, .source-band').forEach(section => { section.lang = 'en'; });
  setText(".about-rwn__heading h2", "Everyone deserves a clear next step.");
  setText(
    ".about-rwn__heading p",
    "Find practical support. Review the details. Reach the people who can help. The provider confirms eligibility and availability."
  );

  const heading = document.querySelector('.about-rwn__heading');
  if (heading && !heading.querySelector('.mission-drawing')) {
    const drawing = document.createElement('img');
    drawing.className = 'mission-drawing'; drawing.src = '/care-drawing.svg'; drawing.alt = ''; drawing.width = 420; drawing.height = 150; drawing.loading = 'lazy';
    heading.append(drawing);
    const invitation = document.createElement('a'); invitation.className = 'contributor-invitation'; invitation.href = '/join'; invitation.textContent = 'Help keep the directory useful →'; heading.append(invitation);
  }

  const stepCopy = [
    ["Search", "Look by need or place. Use location only if you want nearby services sorted first."],
    ["Review", "Check the source, review date, hours, eligibility and contact information we have."],
    ["Contact", "Call the provider, open its official site, or get directions before you travel."]
  ];
  document.querySelectorAll(".mission-steps article").forEach((article, index) => {
    const copy = stepCopy[index];
    if (!copy) return;
    const heading = article.querySelector("h3");
    const paragraph = article.querySelector("p");
    if (heading) heading.textContent = copy[0];
    if (paragraph) paragraph.textContent = copy[1];
  });

  setText(".source-band__heading h2", "Check the source before you go.");
  setText(
    ".source-band__heading p",
    "Listings include the source and the date we reviewed it. Hours, capacity and eligibility can change, so the provider remains the final authority."
  );

  const principles = document.getElementById("principleGrid");
  if (principles) {
    principles.innerHTML = `
      <article><span>01</span><div><h3>Source</h3><p>We name and link the public source used for the listing.</p></div></article>
      <article><span>02</span><div><h3>Review date</h3><p>We show when the source was last checked by RWN.</p></div></article>
      <article><span>03</span><div><h3>Provider authority</h3><p>The provider is responsible for current hours, eligibility, capacity and service decisions.</p></div></article>
    `;
  }
}

function simplifyStructure() {
  document.querySelector(".directory-strip")?.remove();
  document.getElementById("accountability")?.remove();

  const footer = document.querySelector(".site-footer");
  if (!footer) return;

  const explore = footer.querySelector('nav[aria-label="Footer explore"]');
  if (explore) explore.innerHTML = `<strong>Find help</strong><a href="#finder">Interactive map</a><a href="/directory">Directory</a><a href="/directory#saved">Saved services</a>`;

  const standards = footer.querySelector('nav[aria-label="Footer standards"]');
  if (standards) standards.innerHTML = `<strong>About RWN</strong><a href="/about">About RWN</a><a href="/our-work">Our work</a><a href="/get-involved">Get involved</a><a href="/contact">Contact</a><a href="/editorial-policy">How listings are checked</a><a href="/transparency">Transparency</a><a href="/join">Contributor workspace</a>`;

  const legal = footer.querySelector('nav[aria-label="Footer legal"]');
  if (legal) {
    const clearButton = legal.querySelector("#clearBrowserData");
    legal.innerHTML = `<strong>Policies</strong><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/accessibility">Accessibility</a>`;
    if (clearButton) {
      clearButton.className = "footer-data-button";
      clearButton.textContent = "Clear browser data";
      legal.append(clearButton);
    }
  }

  const map = footer.querySelector('nav[aria-label="Footer map and imagery"]');
  const note = footer.querySelector(":scope > p");
  if (map) map.remove();
  if (note) {
    note.innerHTML = `<span>Map boundaries: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a> · Earth imagery: <a href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/" target="_blank" rel="noopener noreferrer">NASA Blue Marble</a></span>`;
  }
}

export function installProfessionalPresentation() {
  if (!document.querySelector(".finder-intro")) return false;
  document.documentElement.classList.add("rwn-professional");
  document.body.classList.add("rwn-professional", "rwn-atlas");
  const globe = document.querySelector('.globe-stage');
  setText(".globe-meta > div:first-child strong", "Explore the map");
  if (globe && !globe.querySelector('.atlas-key')) {
    const key = document.createElement('div');
    key.className = 'atlas-key';
    key.setAttribute('role', 'group');
    key.setAttribute('aria-label', 'Map marker key');
    key.innerHTML = '<span><i class="atlas-key__site"></i>Service location</span><span><i class="atlas-key__area"></i>Area finder / network</span><small>Select a point to check its address and source.</small>';
    globe.append(key);
  }
  installBrandMarks();
  rewriteBrandText();
  rewriteNavigation();
  rewriteFinderCopy();
  rewriteMethodSections();
  simplifyStructure();
  return true;
}
