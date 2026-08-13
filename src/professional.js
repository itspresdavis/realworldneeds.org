const setText = (selector, value) => {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
};

const setAllText = (selector, values) => {
  document.querySelectorAll(selector).forEach((node, index) => {
    if (values[index]) node.textContent = values[index];
  });
};

function installBrandMarks() {
  document.querySelectorAll(".brand__mark").forEach((mark, index) => {
    mark.innerHTML = `<img class="rwn-brand-image" src="/brand/rwn-logo-192.png" alt="" width="192" height="192" decoding="async" ${index === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} />`;
    mark.style.background = "transparent";
    mark.style.border = "0";
    mark.style.borderRadius = "50%";
    mark.style.boxShadow = "none";
    mark.style.overflow = "visible";
  });
}

function simplifyStructure() {
  document.querySelector(".directory-strip")?.remove();
  document.getElementById("accountability")?.remove();

  const footerExplore = document.querySelector('.site-footer nav[aria-label="Footer explore"]');
  if (footerExplore) {
    footerExplore.innerHTML = `
      <strong>Find help</strong>
      <a href="#finder">Interactive finder</a>
      <a href="/directory">Text directory</a>
    `;
  }

  const footerAbout = document.querySelector('.site-footer nav[aria-label="Footer standards"]');
  if (footerAbout) {
    footerAbout.innerHTML = `
      <strong>Trust &amp; standards</strong>
      <a href="/editorial-policy">How listings are checked</a>
      <a href="/transparency">Transparency</a>
      <a href="/sources">Source ledger</a>
    `;
  }

  const mapNav = document.querySelector('.site-footer nav[aria-label="Footer map and imagery"]');
  const footerNote = document.querySelector(".site-footer > p");
  if (mapNav && footerNote) {
    const existing = footerNote.textContent.trim();
    footerNote.innerHTML = `
      <span>${existing}</span>
      <span class="footer-attribution">Map data: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a> · Imagery: <a href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/" target="_blank" rel="noopener noreferrer">NASA Blue Marble</a></span>
    `;
    mapNav.remove();
  }
}

function installCopy() {
  document.documentElement.classList.add("rwn-professional");
  document.body.classList.add("rwn-professional");

  installBrandMarks();

  const brand = document.querySelector(".brand .brand__name");
  if (brand) {
    const strong = brand.querySelector("strong");
    const small = brand.querySelector("small");
    if (strong) strong.textContent = "Real World Needs";
    if (small) small.textContent = "Free essential services directory";
  }

  setAllText(".primary-nav a", ["Find help", "How it works", "Review standards", "Transparency"]);
  setAllText(".site-menu nav a", ["Find help", "How it works", "Review standards", "Transparency"]);

  const headerAction = document.querySelector(".header-action");
  if (headerAction) {
    headerAction.textContent = "Browse directory";
    headerAction.href = "/directory";
    headerAction.removeAttribute("data-section-link");
    headerAction.setAttribute("aria-label", "Browse the complete text service directory");
  }

  setText(".finder-intro h1", "Find essential help near you.");
  setText(
    ".finder-intro p",
    "Search food, shelter, health care, hygiene, clothing, drinking water and other essential services. Review the source and practical details, then contact the provider directly."
  );

  setText(".about-rwn__heading h2", "Find it. Check it. Contact the provider.");
  setText(
    ".about-rwn__heading p",
    "Real World Needs organizes public service information into one usable directory. Search for an option, review where the information came from, and contact the organization providing the service."
  );

  setText(".source-band__heading h2", "Every listing stays connected to its source.");
  setText(
    ".source-band__heading p",
    "Listings show where the information came from and when it was reviewed. Hours, eligibility and availability can change, so the provider remains the final authority."
  );

  const footerBrand = document.querySelector(".footer-brand > span:last-child");
  if (footerBrand) {
    const strong = footerBrand.querySelector("strong");
    const small = footerBrand.querySelector("small");
    if (strong) strong.textContent = "Real World Needs";
    if (small) small.textContent = "Free essential services directory";
  }

  simplifyStructure();
}

export function installProfessionalPresentation() {
  if (!document.querySelector(".finder-intro")) return false;
  installCopy();
  return true;
}
