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
    <a href="/directory">Find Help</a>
    <a href="/our-story">Why RWN?</a>
    <a href="/get-involved">Get Involved</a>
    <a href="/impact">Impact</a>
    <a href="/donate">Donations</a>
    <a href="/contact">Contact</a>
  `;
  if (desktop) desktop.innerHTML = links;
  if (mobile) mobile.innerHTML = links;

  const menuSummary = document.querySelector(".site-menu > summary");
  if (menuSummary) {
    menuSummary.textContent = "Menu";
    menuSummary.setAttribute("aria-label", "Navigation menu");
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
  setText(".finder-intro h1", "Find essential services near you.");
  setText(
    ".finder-intro p",
    "Look for food, shelter, clothing and other essentials. Contact the provider directly."
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
  if (safety) safety.innerHTML = `<strong>Immediate danger?</strong> Contact local emergency services.`;
}

function rewriteMethodSections() {
  setText(".about-rwn__heading h2", "Before you go");
  setText(
    ".about-rwn__heading p",
    "A quick call can save you a trip. Ask the provider to confirm its hours and whether you’re eligible."
  );

  const heading = document.querySelector(".about-rwn__heading");
  if (heading && !heading.querySelector(".contributor-invitation")) {
    const link = document.createElement("a");
    link.className = "contributor-invitation";
    link.href = "/our-story";
    link.textContent = "Why RWN?";
    heading.append(link);
  }
  document.querySelectorAll(".about-rwn .section-kicker, .source-band .section-kicker, .results-heading .section-kicker").forEach(node => node.remove());

  const stepCopy = [
    ["Search", "Enter a city or choose the kind of help you need."],
    ["Review", "Look for the hours, address and any rules about who can use the service."],
    ["Contact", "Contact the provider to check what’s available."]
  ];
  document.querySelectorAll(".mission-steps article").forEach((article, index) => {
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
      <article><span>01</span><div><h3>Source</h3><p>Open the original page for more details.</p></div></article>
      <article><span>02</span><div><h3>Review date</h3><p>See when we last reviewed the source.</p></div></article>
      <article><span>03</span><div><h3>Changes</h3><p>Hours and availability can change between reviews.</p></div></article>
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
  if (standards) standards.innerHTML = `<strong>About RWN</strong><a href="/our-story">Why RWN?</a><a href="/get-involved">Get Involved</a><a href="/impact">Impact</a><a href="/donate">Donations</a><a href="/contact">Contact</a><a href="/editorial-policy">How listings are checked</a><a href="/sources">Sources</a><a href="/transparency">Transparency</a><a href="/join">Contributor workspace</a>`;

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
  setText(".globe-meta > div:first-child strong", "Service map");
  if (globe && !globe.querySelector('.atlas-key')) {
    const key = document.createElement('div');
    key.className = 'atlas-key';
    key.setAttribute('aria-label', 'Map marker key');
    key.innerHTML = '<span><i class="atlas-key__site"></i>Service location</span><span><i class="atlas-key__area"></i>Regional finder</span>';
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
