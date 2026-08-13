import * as THREE from "/vendor/three.module.js";

const VERTEX_SHADER = `
  attribute vec3 pointColor;
  attribute float pointScale;
  attribute float pointOpacity;
  attribute float pointKind;
  varying vec3 vPointColor;
  varying float vPointOpacity;
  varying float vPointKind;
  uniform float uPointSize;
  uniform float uPixelRatio;
  uniform float uZoom;

  void main() {
    vPointColor = pointColor;
    vPointOpacity = pointOpacity;
    vPointKind = pointKind;

    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;

    float perspective = clamp(2.85 / max(1.12, -viewPosition.z), 0.72, 1.35);
    float zoomLift = 1.0 + smoothstep(1.15, 4.5, uZoom) * 0.34;
    float deepViewCalm = 1.0 - smoothstep(5.0, 8.0, uZoom) * 0.10;
    gl_PointSize = uPointSize * pointScale * perspective * zoomLift * deepViewCalm * uPixelRatio;
  }
`;

const FRAGMENT_SHADER = `
  varying vec3 vPointColor;
  varying float vPointOpacity;
  varying float vPointKind;
  uniform float uOpacity;
  uniform float uZoom;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float radius = length(centered);
    if (radius > 0.5) discard;

    float edge = 1.0 - smoothstep(0.44, 0.50, radius);
    float halo = 1.0 - smoothstep(0.22, 0.50, radius);
    float core = 1.0 - smoothstep(0.055, 0.155, radius);
    float ring = smoothstep(0.22, 0.29, radius) * (1.0 - smoothstep(0.37, 0.45, radius));

    float isDirect = 1.0 - step(0.5, vPointKind);
    float isLocator = step(0.5, vPointKind) * (1.0 - step(1.5, vPointKind));
    float isNetwork = step(1.5, vPointKind);

    float shape = isDirect * max(core, ring * 0.82)
      + isLocator * max(ring, core * 0.18)
      + isNetwork * max(ring * 0.72, core * 0.10);

    float closeClarity = mix(0.88, 1.0, smoothstep(1.4, 3.0, uZoom));
    float alpha = min(1.0, shape * closeClarity + halo * 0.08) * edge * uOpacity * vPointOpacity;
    if (alpha < 0.025) discard;

    vec3 color = mix(vPointColor, vec3(1.0), core * isDirect * 0.20 + ring * 0.08);
    gl_FragColor = vec4(color, alpha);
  }
`;

function resourceVector(resource, radius = 1.018) {
  const latitude = THREE.MathUtils.degToRad(Number(resource.lat));
  const longitude = THREE.MathUtils.degToRad(Number(resource.lng));
  const cosLat = Math.cos(latitude);
  return [
    radius * cosLat * Math.sin(longitude),
    radius * Math.sin(latitude),
    radius * cosLat * Math.cos(longitude)
  ];
}

function resourcePointScale(resource) {
  if (resource.kind === "direct") return 1;
  if (resource.kind === "locator") return 0.86;
  return 0.74;
}

function resourcePointOpacity(resource) {
  if (resource.kind === "direct") return 1;
  if (resource.kind === "locator") return 0.82;
  return 0.68;
}

function resourcePointKind(resource) {
  if (resource.kind === "direct") return 0;
  if (resource.kind === "locator") return 1;
  return 2;
}

function buildGeometry(resources, categories) {
  const positions = new Float32Array(resources.length * 3);
  const colors = new Float32Array(resources.length * 3);
  const scales = new Float32Array(resources.length);
  const opacities = new Float32Array(resources.length);
  const kinds = new Float32Array(resources.length);
  const color = new THREE.Color();

  resources.forEach((resource, index) => {
    const position = resourceVector(resource);
    positions.set(position, index * 3);
    color.set(categories[resource.category]?.color || "#75d7a4");
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    scales[index] = resourcePointScale(resource);
    opacities[index] = resourcePointOpacity(resource);
    kinds[index] = resourcePointKind(resource);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("pointColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("pointScale", new THREE.BufferAttribute(scales, 1));
  geometry.setAttribute("pointOpacity", new THREE.BufferAttribute(opacities, 1));
  geometry.setAttribute("pointKind", new THREE.BufferAttribute(kinds, 1));
  if (resources.length) geometry.computeBoundingSphere();
  else geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
  return geometry;
}

export function createGlobePointLayer(resources, categories, { pixelRatio = 1 } = {}) {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uPointSize: { value: window.innerWidth <= 600 ? 5.15 : 4.8 },
      uPixelRatio: { value: Math.min(1.75, Math.max(1, pixelRatio)) },
      uZoom: { value: 1 },
      uOpacity: { value: 0.94 }
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending
  });

  const points = new THREE.Points(buildGeometry(resources, categories), material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  points.userData.resources = [...resources];
  return points;
}

export function replaceGlobePointResources(points, resources, categories) {
  if (!points) return;
  const previousGeometry = points.geometry;
  points.geometry = buildGeometry(resources, categories);
  points.userData.resources = [...resources];
  previousGeometry?.dispose();
}

export function updateGlobePointLayer(points, { zoom = 1, pixelRatio = 1, opacity = 0.94 } = {}) {
  if (!points?.material?.uniforms) return;
  points.material.uniforms.uZoom.value = zoom;
  points.material.uniforms.uPixelRatio.value = Math.min(1.75, Math.max(1, pixelRatio));
  points.material.uniforms.uOpacity.value = opacity;
}