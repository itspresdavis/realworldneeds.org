await import("./app.js");

const loadExperience = () => import("./experience.js").catch(() => {});

if ("requestIdleCallback" in window) {
  window.requestIdleCallback(loadExperience, { timeout: 1400 });
} else {
  window.setTimeout(loadExperience, 180);
}
