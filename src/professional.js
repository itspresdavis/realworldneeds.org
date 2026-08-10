const setText = (selector, value) => {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
};

const setAllText = (selector, values) => {
  document.querySelectorAll(selector).forEach((node, index) => {
    if (values[index]) node.textContent = values[index];
  });
};

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

  setAllText(".primary-nav a", ["Find help", "About", "Sources & standards", "Transparency"]);
  setAllText(".site-menu nav a", ["Find help", "About", "Sources & standards", "Transparency"]);
  setText(".header-action", "Search services");

  setText(".finder-intro h1", "Find free essential services near you.");
  setText(
    ".finder-intro p",
    "Search food assistance, shelter, health care, hygiene, clothing, drinking water, and other essential services. Each listing links to the organization or public source behind it."
  );

  setText(".about-rwn__heading h2", "A public directory built around the next step.");
  setText(
    ".about-rwn__heading p",
    "RWN organizes public information about essential services so you can find an option, review the practical details, and contact the provider directly."
  );

  setText(".source-band__heading h2", "Know where every listing came from.");
  setText(
    ".source-band__heading p",
    "Listings keep their original source, review date, access details, and eligibility information where available. You can inspect the source before deciding what to do next."
  );

  setText(".accountability__heading h2", "Useful information, without getting between you and the provider.");
  setText(
    ".accountability__heading p",
    "RWN helps people discover and verify public service information. The organization providing the service remains the authority on hours, availability, eligibility, and access."
  );

  const footerBrand = document.querySelector(".footer-brand > span:last-child");
  if (footerBrand) {
    const strong = footerBrand.querySelector("strong");
    const small = footerBrand.querySelector("small");
    if (strong) strong.textContent = "Real World Needs";
    if (small) small.textContent = "Essential services directory";
  }
}

export function installProfessionalPresentation() {
  if (document.querySelector(".finder-intro")) {
    installCopy();
    return;
  }

  let frames = 0;
  const waitForShell = () => {
    if (document.querySelector(".finder-intro")) {
      installCopy();
      return;
    }
    frames += 1;
    if (frames < 240) requestAnimationFrame(waitForShell);
  };
  waitForShell();
}

installProfessionalPresentation();
