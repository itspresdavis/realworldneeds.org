const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

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
        <span class="section-kicker">Why Real World Needs</span>
        <h2 id="rwn-story-title">Help exists. Finding it shouldn’t be the hard part.</h2>
        <p>Real World Needs turns scattered public information about essential services into one clear place to start. The goal is simple: less time searching, a clearer next step, and an easier path to the organization providing the help.</p>
        <div class="rwn-story__actions">
          <a class="rwn-story__primary" href="/directory">Browse the full directory</a>
          <a class="rwn-story__secondary" href="#standards">See how listings are checked</a>
        </div>
      </div>
      <div class="rwn-story__proof" aria-label="What RWN is built around">
        <article>
          <span>01</span>
          <div><h3>One clear search</h3><p>Food, shelter, health care, clothing, hygiene support, and other essential services can be explored together.</p></div>
        </article>
        <article>
          <span>02</span>
          <div><h3>Original sources stay close</h3><p>Listings point back to their source so important details can be checked before someone relies on them.</p></div>
        </article>
        <article>
          <span>03</span>
          <div><h3>Built for the next step</h3><p>From a listing, people can move directly to a call, provider website, or map instead of starting another search.</p></div>
        </article>
      </div>
    </div>
  `;
  standards.before(section);
}

function setupRevealMotion() {
  const elements = [
    ...document.querySelectorAll(".about-rwn, .rwn-story, .source-band, .accountability, .site-footer")
  ];

  if (!elements.length) return;
  if (reduceMotion || window.innerWidth <= 760 || !("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("experience-visible"));
    return;
  }

  elements.forEach((element) => element.classList.add("experience-reveal"));
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("experience-visible");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });

  elements.forEach((element) => observer.observe(element));
}

function setupInputModality() {
  if (finePointer) document.documentElement.classList.add("fine-pointer");
  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab") document.documentElement.classList.add("keyboard-nav");
  }, { passive: true });
  document.addEventListener("pointerdown", () => {
    document.documentElement.classList.remove("keyboard-nav");
  }, { passive: true });
}

function initializeExperience() {
  if (document.documentElement.dataset.rwnExperienceReady) return;
  if (!document.querySelector(".globe-stage")) return;

  document.documentElement.dataset.rwnExperienceReady = "true";
  document.documentElement.classList.add("experience-enabled");
  installBrandStory();
  setupRevealMotion();
  setupInputModality();
}

function watchForApp() {
  if (document.querySelector(".globe-stage")) {
    initializeExperience();
    return;
  }

  const observer = new MutationObserver(() => {
    if (!document.querySelector(".globe-stage")) return;
    observer.disconnect();
    initializeExperience();
  });
  observer.observe(document.getElementById("root") || document.documentElement, { childList: true, subtree: true });
}

watchForApp();
