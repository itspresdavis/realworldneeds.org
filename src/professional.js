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
    <a href="/editorial-policy">How listings are checked</a>
    <a href="/sources">Sources</a>
    <a href="/join">Contribute</a>
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
    "Practical help, with contact details and sources you can check."
  );

  const status = document.getElementById("locationStatus");
  if (status) status.textContent = "Use location to show nearby services first.";

  const live = document.getElementById("liveSourceStatus");
  if (live) live.textContent = "In the United States, location search can also load current USDA summer meal sites.";

  const privacy = document.querySelector(".location-privacy");
  if (privacy) privacy.innerHTML = `Your browser uses location to sort nearby listings. For U.S. meal searches, the USDA receives only an approximate area. You can search by place instead. <a href="/privacy#location">Read how location works</a>.`;

  const safety = document.querySelector(".finder-safety");
  if (safety) safety.innerHTML = `<strong>Immediate danger?</strong> Contact local emergency services. RWN is a directory, not an emergency service.`;
}

function rewriteMethodSections() {
  document.querySelectorAll(".about-rwn .section-kicker, .source-band .section-kicker").forEach(node => node.remove());
  setText(".about-rwn__heading h2", "Everyone deserves a clear next step.");
  setText(
    ".about-rwn__heading p",
    "Find practical support. Review the details. Reach the people who can help. The provider confirms eligibility and availability."
  );

  const heading = document.querySelector('.about-rwn__heading');
  document.querySelector(".mission-steps")?.remove();
  const source = document.querySelector(".source-band");
  const about = document.querySelector(".about-rwn");
  if (source && about) about.before(source);
  if (heading && !heading.querySelector('.contributor-invitation')) {
    const invitation = document.createElement('a'); invitation.className = 'contributor-invitation'; invitation.href = '/join'; invitation.textContent = 'Help keep the directory useful →'; heading.append(invitation);
  }

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
  if (standards) standards.innerHTML = `<strong>About RWN</strong><a href="/editorial-policy">How listings are checked</a><a href="/sources">Sources</a><a href="/transparency">Transparency</a><a href="/join">Contributor workspace</a>`;

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

let responsiveMapFlow;
function arrangeMobileMap() {
  const finder = document.getElementById('finder');
  const grid = finder?.querySelector('.finder__grid');
  const map = finder?.querySelector('.globe-stage');
  const panel = finder?.querySelector('.resource-panel');
  if (!finder || !grid || !map || !panel) return;
  responsiveMapFlow ??= window.matchMedia('(max-width: 600px)');
  map.id = 'service-map';
  if (!grid.querySelector('.finder-map-link')) {
    const link = document.createElement('a');
    link.className = 'finder-map-link';
    link.href = '#service-map';
    link.textContent = 'Explore the map ↓';
    grid.querySelector('.finder-sidebar')?.append(link);
  }
  const arrange = () => {
    const parent = responsiveMapFlow.matches ? finder : grid;
    if (map.parentElement === parent && panel.parentElement === parent) return;
    const focused = document.activeElement;
    const restore = map.contains(focused) || panel.contains(focused);
    parent.append(map, panel);
    if (restore && focused?.isConnected) {
      focused.focus({ preventScroll: true });
      const box = focused.getBoundingClientRect();
      const clearance = (document.querySelector('.site-header')?.getBoundingClientRect().bottom || 0) + 12;
      if (box.top < clearance || box.bottom > window.innerHeight - 12) {
        window.scrollTo({ top: Math.max(0, window.scrollY + box.top - clearance), behavior: 'instant' });
      }
    }
  };
  if (!finder.dataset.mapFlowInstalled) {
    responsiveMapFlow.addEventListener('change', arrange);
    finder.dataset.mapFlowInstalled = 'true';
  }
  arrange();
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
    key.setAttribute('aria-label', 'Map marker key');
    key.innerHTML = '<span><i class="atlas-key__site"></i>Service location</span><span><i class="atlas-key__area"></i>Area finder / network</span><small>Select a point to check its address and source.</small>';
    globe.append(key);
  }
  const intro = document.querySelector('.finder-intro');
  const grid = document.querySelector('.finder__grid');
  if (intro && grid && intro.parentElement !== grid) grid.prepend(intro);
  if (intro && !intro.querySelector('.finder-intro__reading')) {
    const reading = document.createElement('div');
    reading.className = 'finder-intro__reading';
    const paragraph = intro.querySelector('p');
    if (paragraph) reading.append(paragraph);
    const link = document.createElement('a');
    link.href = '/editorial-policy';
    link.textContent = 'How listings are checked →';
    reading.append(link);
    intro.append(reading);
  }
  installBrandMarks();
  rewriteBrandText();
  rewriteNavigation();
  rewriteFinderCopy();
  rewriteMethodSections();
  simplifyStructure();
  arrangeMobileMap();
  return true;
}
