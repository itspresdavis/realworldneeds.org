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
        <p>Real World Needs organizes scattered information about essential services into one clear place to start. Search what you need, check the original source, and move directly to the organization that can help.</p>
        <div class="rwn-story__actions">
          <a class="rwn-story__primary" href="/directory">Browse the full directory</a>
          <a class="rwn-story__secondary" href="#standards">See how listings are checked</a>
        </div>
      </div>
      <div class="rwn-story__proof" aria-label="What Real World Needs is built around">
        <article>
          <span>01</span>
          <div><h3>Clear from the start</h3><p>Food, shelter, health care, clothing, hygiene support, and other essentials can be searched in one place.</p></div>
        </article>
        <article>
          <span>02</span>
          <div><h3>Sources stay visible</h3><p>Every listing stays connected to the organization or public source behind the information.</p></div>
        </article>
        <article>
          <span>03</span>
          <div><h3>Built for the next step</h3><p>Move from a listing to a call, provider website, or map without starting the search over again.</p></div>
        </article>
      </div>
    </div>
  `;
  standards.before(section);
}

function setupInputModality() {
  if (finePointer) document.documentElement.classList.add("fine-pointer");
}

function initializeExperience() {
  if (document.documentElement.dataset.rwnExperienceReady) return;
  if (!document.querySelector(".globe-stage")) return;
  document.documentElement.dataset.rwnExperienceReady = "true";
  setupInputModality();
  installBrandStory();
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
