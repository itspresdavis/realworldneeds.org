const pinStyle = document.createElement("style");
pinStyle.textContent = `
  .globe-canvas {
    touch-action: none;
    overscroll-behavior: contain;
  }

  .globe-pin-layer {
    transition: opacity 110ms ease;
  }

  .globe-stage.has-gpu-points.is-globe-moving .globe-pin-layer {
    opacity: 0;
    pointer-events: none;
  }

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
  .globe-cluster > span::after {
    display: none !important;
  }

  .globe-cluster {
    width: 2.1rem;
    height: 2.1rem;
  }

  .globe-stage.has-gpu-points .globe-pin:not(.is-selected):not(.globe-cluster) > span {
    opacity: 0;
    box-shadow: none;
  }

  .globe-stage.has-gpu-points .globe-pin.is-selected > span {
    display: block;
    width: 1.05rem;
    height: 1.05rem;
    border: 1.5px solid color-mix(in srgb, var(--pin), white 28%);
    background: color-mix(in srgb, var(--pin), transparent 86%);
    box-shadow: 0 0 .65rem var(--pin-glow), 0 0 1.45rem color-mix(in srgb, var(--pin), transparent 46%);
  }

  .globe-stage.has-gpu-points .globe-cluster > span {
    display: grid;
    place-items: center;
    width: 1.7rem;
    height: 1.7rem;
    border: 1px solid color-mix(in srgb, var(--pin), white 22%);
    background: rgba(3, 19, 31, .88);
    box-shadow: 0 0 .7rem var(--pin-glow), 0 4px 14px rgba(0, 0, 0, .2);
  }

  .globe-stage.has-gpu-points .globe-cluster > span b {
    display: block !important;
    color: #f4fbf9;
    font-size: .56rem;
    font-weight: 850;
    line-height: 1;
    letter-spacing: -.02em;
  }

  @media (max-width: 600px) {
    .globe-stage.has-gpu-points .globe-cluster > span {
      width: 1.55rem;
      height: 1.55rem;
    }

    .globe-stage.has-gpu-points .globe-pin.is-selected > span {
      width: .94rem;
      height: .94rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .globe-pin-layer { transition: none; }
  }
`;
document.head.append(pinStyle);

await import("./app.js?v=rwn-20260807-3");

const loadExperience = () => import("./experience.js?v=rwn-20260807-3").catch(() => {});

if ("requestIdleCallback" in window) {
  window.requestIdleCallback(loadExperience, { timeout: 1400 });
} else {
  window.setTimeout(loadExperience, 180);
}
