const pinStyle = document.createElement("style");
pinStyle.textContent = `
  .globe-pin > span,
  .globe-pin.is-discovery > span,
  .globe-cluster > span {
    display: block;
    width: .58rem;
    height: .58rem;
    border: 1.5px solid rgba(255, 255, 255, .9);
    border-radius: 50%;
    background: var(--pin);
    box-shadow: 0 0 .5rem var(--pin-glow), 0 0 1rem color-mix(in srgb, var(--pin), transparent 58%);
  }

  .globe-pin > span::before,
  .globe-pin > span::after,
  .globe-pin.is-discovery > span::before,
  .globe-cluster > span::before,
  .globe-cluster > span::after,
  .globe-cluster > span b {
    display: none !important;
  }

  .globe-cluster {
    width: 2.1rem;
    height: 2.1rem;
  }

  .globe-pin.is-selected > span {
    width: .68rem;
    height: .68rem;
    box-shadow: 0 0 .65rem var(--pin-glow), 0 0 1.35rem color-mix(in srgb, var(--pin), transparent 45%);
  }

  @media (max-width: 600px) {
    .globe-pin > span,
    .globe-pin.is-discovery > span,
    .globe-cluster > span {
      width: .52rem;
      height: .52rem;
    }
  }
`;
document.head.append(pinStyle);

await import("./app.js?v=rwn-20260807-1");

const loadExperience = () => import("./experience.js?v=rwn-20260807-1").catch(() => {});

if ("requestIdleCallback" in window) {
  window.requestIdleCallback(loadExperience, { timeout: 1400 });
} else {
  window.setTimeout(loadExperience, 180);
}
