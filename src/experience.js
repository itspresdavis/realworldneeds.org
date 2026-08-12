const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function installBrandStory() {
  if (document.querySelector(".rwn-story")) return;
  const standards = document.getElementById("standards");
  if (!standards) return;

  const section = document.createElement("section");
  section.className = "rwn-story";
  section.setAttribute("aria-labelledby", "rwn-story-title");
  section.innerHTML = `
    <div class="rwn-story__inner">
      <div class="rwn-story__lead">
        <span class="section-kicker">A better starting point</span>
        <h2 id="rwn-story-title">The help should be easier to reach than the crisis.</h2>
        <p>Essential services are scattered across thousands of organizations, public agencies, local programs, and community networks. Real World Needs is built to make that first step simpler: see what exists, understand the details, and move directly to the source.</p>
        <div class="rwn-story__trust" aria-label="Real World Needs access principles">
          <span>No account required</span>
          <span>No paywall</span>
          <span>Original sources stay visible</span>
        </div>
        <div class="rwn-story__actions">
          <a class="rwn-story__primary" href="#finder">Find help on the globe</a>
          <a class="rwn-story__secondary" href="/directory">Browse the text directory</a>
        </div>
      </div>
      <div class="rwn-story__proof" aria-label="How Real World Needs helps people move forward">
        <article><span>01</span><div><h3>Start with what you need</h3><p>Search a service, a place, or an organization instead of learning a new system before you can ask for help.</p></div></article>
        <article><span>02</span><div><h3>See the source behind it</h3><p>Listings stay connected to the organization or public source so hours, eligibility, and availability can be checked.</p></div></article>
        <article><span>03</span><div><h3>Take the next step</h3><p>Move from a point on the globe to a phone call, provider website, or directions without starting over.</p></div></article>
      </div>
    </div>
  `;
  standards.before(section);
}

function installReturnToFinder() {
  const heading = document.querySelector(".accountability__heading");
  if (!heading || heading.querySelector(".return-to-finder")) return;
  const link = document.createElement("a");
  link.className = "return-to-finder";
  link.href = "#finder";
  link.textContent = "Back to the help finder";
  heading.append(link);
}

function installScrollRhythm() {
  const targets = [
    ".about-rwn__heading",
    ".about-rwn__visual",
    ".mission-steps",
    ".ways-to-help__heading",
    ".ways-to-help__list",
    ".source-band__heading",
    ".principle-grid"
  ].flatMap((selector) => [...document.querySelectorAll(selector)]);

  if (!targets.length) return;
  targets.forEach((target) => target.classList.add("rwn-reveal"));

  if (reduceMotion || !("IntersectionObserver" in window)) {
    targets.forEach((target) => target.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, {
    rootMargin: "0px 0px -9% 0px",
    threshold: 0.08
  });

  targets.forEach((target) => observer.observe(target));
}

if (finePointer) document.documentElement.classList.add("fine-pointer");
installScrollRhythm();
