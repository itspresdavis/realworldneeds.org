import * as THREE from "/vendor/three.module.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
const saveData = Boolean(connection?.saveData);
const modestDevice = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
const enhancedRenderers = new WeakSet();

function qualityTier() {
  if (saveData || window.innerWidth <= 700 || modestDevice) return "balanced";
  return "high";
}

function makeOuterAtmosphere() {
  const high = qualityTier() === "high";
  const geometry = new THREE.SphereGeometry(1.072, high ? 96 : 64, high ? 64 : 42);
  const material = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vEye;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vEye = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vEye;
      void main() {
        float rim = 1.0 - max(0.0, dot(normalize(vNormal), normalize(vEye)));
        float outerGlow = pow(rim, 3.1);
        float edge = smoothstep(0.2, 1.0, outerGlow);
        vec3 cyan = vec3(0.30, 0.82, 0.83);
        vec3 sky = vec3(0.32, 0.61, 0.78);
        vec3 color = mix(sky, cyan, edge);
        gl_FragColor = vec4(color, edge * 0.105);
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false
  });
  const atmosphere = new THREE.Mesh(geometry, material);
  atmosphere.name = "rwn-outer-atmosphere";
  atmosphere.renderOrder = 8;
  return atmosphere;
}

function makeDeepStarField() {
  const count = qualityTier() === "high" ? 520 : 240;
  const positions = new Float32Array(count * 3);
  let seed = 9173;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let index = 0; index < count; index += 1) {
    const radius = 14 + random() * 34;
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi);
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xd8f3f1,
    size: qualityTier() === "high" ? 0.012 : 0.015,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    toneMapped: false
  });
  const stars = new THREE.Points(geometry, material);
  stars.name = "rwn-deep-stars";
  stars.frustumCulled = false;
  return stars;
}

function enhanceSurfaceMaterial(surface) {
  const material = surface?.material;
  if (!material?.isMeshStandardMaterial || material.userData.rwnSurfacePolish) return;
  material.userData.rwnSurfacePolish = true;
  material.dithering = true;

  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    const marker = "#include <roughnessmap_fragment>";
    if (!shader.fragmentShader.includes(marker)) return;
    shader.fragmentShader = shader.fragmentShader.replace(marker, `${marker}
      float rwnBlueLead = diffuseColor.b - max(diffuseColor.r * 1.03, diffuseColor.g * 0.82);
      float rwnOcean = smoothstep(0.025, 0.19, rwnBlueLead);
      roughnessFactor = mix(roughnessFactor, 0.56, rwnOcean * 0.48);
    `);
  };
  material.customProgramCacheKey = () => "rwn-earth-surface-v2";
  material.needsUpdate = true;
}

function enhanceGlobeScene(renderer, scene) {
  if (enhancedRenderers.has(renderer) || renderer.domElement?.id !== "globeCanvas") return;
  enhancedRenderers.add(renderer);
  renderer.domElement.dataset.globeEnhanced = "true";

  let surface = null;
  scene.traverse((object) => {
    if (surface || !object.isMesh || !object.material?.isMeshStandardMaterial) return;
    const radius = object.geometry?.parameters?.radius;
    if (radius && Math.abs(radius - 1) < 0.01) surface = object;
  });

  if (surface) {
    enhanceSurfaceMaterial(surface);
    const parent = surface.parent || scene;
    if (!parent.getObjectByName("rwn-outer-atmosphere")) parent.add(makeOuterAtmosphere());
  }

  if (!scene.getObjectByName("rwn-deep-stars")) scene.add(makeDeepStarField());
}

function installThreeGlobeEnhancer() {
  const originalRender = THREE.WebGLRenderer.prototype.render;
  if (originalRender.__rwnPolished) return;

  function polishedRender(scene, camera) {
    enhanceGlobeScene(this, scene);
    return originalRender.call(this, scene, camera);
  }
  polishedRender.__rwnPolished = true;
  THREE.WebGLRenderer.prototype.render = polishedRender;
}

function requestIdle(callback) {
  if ("requestIdleCallback" in window) window.requestIdleCallback(callback, { timeout: 1800 });
  else window.setTimeout(callback, 800);
}

let detailPrefetched = false;
function prefetchGlobeDetail() {
  if (detailPrefetched || saveData || window.innerWidth <= 900) return;
  if (["slow-2g", "2g"].includes(connection?.effectiveType)) return;
  detailPrefetched = true;
  requestIdle(() => {
    [
      { href: "/data/countries-detail.geojson", as: "fetch" },
      { href: "/media/earth-blue-marble-detail.jpg", as: "image" }
    ].forEach(({ href, as }) => {
      if (document.head.querySelector(`link[data-rwn-prefetch="${href}"]`)) return;
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = href;
      link.as = as;
      link.dataset.rwnPrefetch = href;
      document.head.append(link);
    });
  });
}

function setupGlobeStage(stage) {
  let pointerFrame = null;
  let pointerX = 0.5;
  let pointerY = 0.45;

  const commitPointer = () => {
    pointerFrame = null;
    stage.style.setProperty("--globe-pointer-x", `${(pointerX * 100).toFixed(2)}%`);
    stage.style.setProperty("--globe-pointer-y", `${(pointerY * 100).toFixed(2)}%`);
  };

  if (finePointer && !reduceMotion) {
    stage.addEventListener("pointermove", (event) => {
      const bounds = stage.getBoundingClientRect();
      pointerX = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      pointerY = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      if (!pointerFrame) pointerFrame = requestAnimationFrame(commitPointer);
    }, { passive: true });
    stage.addEventListener("pointerleave", () => {
      pointerX = 0.5;
      pointerY = 0.45;
      if (!pointerFrame) pointerFrame = requestAnimationFrame(commitPointer);
    });
  }

  const signalDetailIntent = () => prefetchGlobeDetail();
  stage.addEventListener("pointerdown", signalDetailIntent, { passive: true, once: true });
  stage.addEventListener("wheel", signalDetailIntent, { passive: true, once: true });
  stage.addEventListener("focusin", signalDetailIntent, { passive: true, once: true });
}

function setupScrollExperience() {
  const header = document.querySelector(".site-header");
  const progress = document.createElement("div");
  progress.className = "experience-progress";
  progress.setAttribute("aria-hidden", "true");
  document.body.append(progress);

  let scrollFrame = null;
  const update = () => {
    scrollFrame = null;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const ratio = Math.max(0, Math.min(1, window.scrollY / maxScroll));
    progress.style.transform = `scaleX(${ratio})`;
    header?.classList.toggle("is-scrolled", window.scrollY > 14);
  };
  window.addEventListener("scroll", () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(update);
  }, { passive: true });
  window.addEventListener("resize", () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(update);
  }, { passive: true });
  update();
}

function setupRevealMotion() {
  const candidates = [
    ".finder-intro",
    ".finder-search",
    ".location-actions",
    ".filter-disclosure",
    ".directory-strip",
    ".results-heading",
    ".resource-list-head",
    ".about-rwn__heading",
    ".mission-steps > article",
    ".source-band__heading",
    ".principle-grid > article",
    ".accountability__heading",
    ".accountability-status > article",
    ".site-footer > *"
  ];
  const elements = [...document.querySelectorAll(candidates.join(","))];
  elements.forEach((element, index) => {
    element.classList.add("experience-reveal");
    element.style.setProperty("--reveal-order", String(index % 4));
  });

  if (reduceMotion || !("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  elements.forEach((element) => observer.observe(element));
}

function setupDynamicTransitions() {
  const panel = document.getElementById("resourcePanel");
  const grid = document.getElementById("resourceGrid");
  const tray = document.getElementById("globeClusterTray");

  const animateSwap = (element, className) => {
    if (!element || reduceMotion) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.target === panel) animateSwap(panel, "experience-panel-swap");
      if (record.target === grid) animateSwap(grid, "experience-results-swap");
      if (record.target === tray && !tray.hidden) animateSwap(tray, "experience-tray-swap");
    }
  });
  [panel, grid, tray].filter(Boolean).forEach((element) => observer.observe(element, { childList: true }));
}

function setupInputModality() {
  document.addEventListener("pointerdown", () => document.documentElement.classList.add("using-pointer"), { passive: true });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab") document.documentElement.classList.remove("using-pointer");
  });
}

function initializeExperience() {
  if (document.documentElement.dataset.rwnExperienceReady) return;
  const stage = document.querySelector(".globe-stage");
  if (!stage) return;
  document.documentElement.dataset.rwnExperienceReady = "true";
  document.documentElement.classList.add("experience-enabled");
  if (finePointer) document.documentElement.classList.add("fine-pointer");
  setupGlobeStage(stage);
  setupScrollExperience();
  setupRevealMotion();
  setupDynamicTransitions();
  setupInputModality();
  requestAnimationFrame(() => document.documentElement.classList.add("experience-entered"));
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

installThreeGlobeEnhancer();
watchForApp();
