const setText = (selector, value) => {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
};

const setAllText = (selector, values) => {
  document.querySelectorAll(selector).forEach((node, index) => {
    if (values[index]) node.textContent = values[index];
  });
};

function simplifyStructure() {
  document.querySelector(".directory-strip")?.remove();
  document.getElementById("accountability")?.remove();

  const footerExplore = document.querySelector('.site-footer nav[aria-label="Footer explore"]');
  if (footerExplore) {
    footerExplore.innerHTML = `
      <strong>Explore</strong>
      <a href="#finder">Find help</a>
      <a href="/directory">Text directory</a>
    `;
  }

  const footerAbout = document.querySelector('.site-footer nav[aria-label="Footer standards"]');
  if (footerAbout) {
    footerAbout.innerHTML = `
      <strong>About RWN</strong>
      <a href="#about">How it works</a>
      <a href="/editorial-policy">Review policy</a>
      <a href="/transparency">Transparency</a>
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

  const brand = document.querySelector(".brand .brand__name");
  if (brand) {
    const strong = brand.querySelector("strong");
    const small = brand.querySelector("small");
    if (strong) strong.textContent = "Real World Needs";
    if (small) small.textContent = "Essential services directory";
  }

  setAllText(".primary-nav a", ["Find help", "About", "Sources", "Transparency"]);
  setAllText(".site-menu nav a", ["Find help", "About", "Sources", "Transparency"]);

  const headerAction = document.querySelector(".header-action");
  if (headerAction) {
    headerAction.textContent = "Text directory";
    headerAction.href = "/directory";
    headerAction.removeAttribute("data-section-link");
    headerAction.setAttribute("aria-label", "Open the text service directory");
  }

  setText(".finder-intro h1", "Find essential services near you.");
  setText(
    ".finder-intro p",
    "Search food, shelter, health care, hygiene, clothing, drinking water and other essential services. Check the details, then contact the provider directly."
  );

  setText(".about-rwn__heading h2", "Find. Check. Contact.");
  setText(
    ".about-rwn__heading p",
    "Real World Needs organizes public service information in one directory. Search for an option, review the source and practical details, then contact the organization providing the service."
  );

  setText(".source-band__heading h2", "Sources and review standards.");
  setText(
    ".source-band__heading p",
    "Each listing keeps its original source and review date. Hours, eligibility and availability can change, so the provider remains the final authority."
  );

  const footerBrand = document.querySelector(".footer-brand > span:last-child");
  if (footerBrand) {
    const strong = footerBrand.querySelector("strong");
    const small = footerBrand.querySelector("small");
    if (strong) strong.textContent = "Real World Needs";
    if (small) small.textContent = "Essential services directory";
  }

  simplifyStructure();
}

export function installProfessionalPresentation() {
  if (!document.querySelector(".finder-intro")) return false;
  installCopy();
  return true;
}
