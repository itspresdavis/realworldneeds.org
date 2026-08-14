import * as THREE from "/vendor/three.module.js";

const RWN_POINT_COLORS = {
  direct: "#45b64a",
  locator: "#0b5f9e",
  network: "#5b8094"
};

const VERTEX_SHADER = `
  attribute vec3 pointColor;
  attribute float pointScale;
  attribute float pointOpacity;
  attribute float pointKind;
  attribute float pointDensity;
  varying vec3 vPointColor;
  varying float vPointOpacity;
  varying float vPointKind;
  varying float vPointDensity;
  uniform float uPointSize;
  uniform float uPixelRatio;
  uniform float uZoom;

  void main() {
    vPointColor = pointColor;
    vPointOpacity = pointOpacity;
    vPointKind = pointKind;
    vPointDensity = pointDensity;

    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;

    float perspective = clamp(2.80 / max(1.08, -viewPosition.z), 0.76, 1.34);
    float closeLift = mix(0.90, 1.12, smoothstep(1.5, 6.5, uZoom));
    float densityLift = 1.0 + min(0.24, log2(max(1.0, pointDensity)) * 0.055);
    gl_PointSize = uPointSize * pointScale * perspective * closeLift * densityLift * uPixelRatio;
  }
`;

const FRAGMENT_SHADER = `
  varying vec3 vPointColor;
  varying float vPointOpacity;
  varying float vPointKind;
  varying float vPointDensity;
  uniform float uOpacity;
  uniform float uZoom;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float radius = length(centered);
    if (radius > 0.5) discard;

    float aa = 1.0 - smoothstep(0.455, 0.50, radius);
    float outer = 1.0 - smoothstep(0.405, 0.48, radius);
    float keyline = smoothstep(0.31, 0.35, radius) * (1.0 - smoothstep(0.395, 0.44, radius));
    float innerDisc = 1.0 - smoothstep(0.0, 0.275, radius);
    float innerRing = smoothstep(0.13, 0.205, radius) * (1.0 - smoothstep(0.285, 0.355, radius));
    float centerDot = 1.0 - smoothstep(0.0, 0.09, radius);

    float isDirect = 1.0 - step(0.5, vPointKind);
    float isLocator = step(0.5, vPointKind) * (1.0 - step(1.5, vPointKind));
    float isNetwork = step(1.5, vPointKind);

    float semanticShape = isDirect * innerDisc
      + isLocator * innerRing
      + isNetwork * max(innerRing * 0.72, centerDot * 0.72);

    float worldCalm = mix(0.74, 1.0, smoothstep(1.3, 4.5, uZoom));
    float densityConfidence = 0.88 + min(0.12, log2(max(1.0, vPointDensity)) * 0.03);
    float alpha = max(semanticShape, keyline * 0.82) * aa * vPointOpacity * uOpacity * worldCalm * densityConfidence;
    if (alpha < 0.025) discard;

    vec3 darkEdge = vec3(0.008, 0.050, 0.070);
    vec3 lightKeyline = vec3(0.94, 0.98, 0.97);
    vec3 color = vPointColor;
    color = mix(color, lightKeyline, keyline * 0.82);
    color = mix(color, darkEdge, (1.0 - outer) * 0.88);

    gl_FragColor = vec4(color, alpha);
  }
`;

function resourceVector(resource, radius = 1.009) {
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
  if (resource.kind === "locator") return 0.92;
  return 0.82;
}

function resourcePointOpacity(resource) {
  if (resource.kind === "direct") return 1;
  if (resource.kind === "locator") return 0.84;
  return 0.66;
}

function resourcePointKind(resource) {
  if (resource.kind === "direct") return 0;
  if (resource.kind === "locator") return 1;
  return 2;
}

function representativePriority(resource) {
  if (resource.kind === "direct") return 3;
  if (resource.kind === "locator") return 2;
  return 1;
}

function densityGridDegrees(zoom) {
  if (zoom >= 7.25) return 0;
  if (zoom >= 5.25) return 0.16;
  if (zoom >= 3.75) return 0.34;
  if (zoom >= 2.55) return 0.72;
  if (zoom >= 1.65) return 1.45;
  return 3.2;
}

function densityBucketKey(zoom) {
  const grid = densityGridDegrees(zoom);
  return grid === 0 ? "all" : String(grid);
}

function consolidateResources(resources, zoom) {
  const grid = densityGridDegrees(zoom);
  if (!grid) return resources.map((resource) => ({ resource, density: 1 }));

  const cells = new Map();
  for (const resource of resources) {
    const lat = Number(resource.lat);
    const lng = Number(resource.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const latitudeScale = Math.max(0.38, Math.cos(THREE.MathUtils.degToRad(lat)));
    const lngGrid = Math.min(9, grid / latitudeScale);
    const key = `${Math.round(lat / grid)}:${Math.round(lng / lngGrid)}`;
    const current = cells.get(key);
    if (!current) {
      cells.set(key, { resource, density: 1 });
      continue;
    }
    current.density += 1;
    const currentPriority = representativePriority(current.resource);
    const candidatePriority = representativePriority(resource);
    if (candidatePriority > currentPriority || (candidatePriority === currentPriority && resource.id < current.resource.id)) {
      current.resource = resource;
    }
  }
  return [...cells.values()];
}

function buildGeometry(entries) {
  const positions = new Float32Array(entries.length * 3);
  const colors = new Float32Array(entries.length * 3);
  const scales = new Float32Array(entries.length);
  const opacities = new Float32Array(entries.length);
  const kinds = new Float32Array(entries.length);
  const densities = new Float32Array(entries.length);
  const color = new THREE.Color();

  entries.forEach(({ resource, density }, index) => {
    positions.set(resourceVector(resource), index * 3);
    color.set(RWN_POINT_COLORS[resource.kind] || RWN_POINT_COLORS.network);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    scales[index] = resourcePointScale(resource);
    opacities[index] = resourcePointOpacity(resource);
    kinds[index] = resourcePointKind(resource);
    densities[index] = density;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("pointColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("pointScale", new THREE.BufferAttribute(scales, 1));
  geometry.setAttribute("pointOpacity", new THREE.BufferAttribute(opacities, 1));
  geometry.setAttribute("pointKind", new THREE.BufferAttribute(kinds, 1));
  geometry.setAttribute("pointDensity", new THREE.BufferAttribute(densities, 1));
  if (entries.length) geometry.computeBoundingSphere();
  else geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
  return geometry;
}

function rebuildForZoom(points, zoom) {
  if (!points) return;
  const allResources = points.userData.allResources || [];
  const entries = consolidateResources(allResources, zoom);
  const previousGeometry = points.geometry;
  points.geometry = buildGeometry(entries);
  points.userData.resources = entries.map(({ resource }) => resource);
  points.userData.densityBucket = densityBucketKey(zoom);
  previousGeometry?.dispose();
}

export function createGlobePointLayer(resources, _categories, { pixelRatio = 1 } = {}) {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uPointSize: { value: window.innerWidth <= 600 ? 6.2 : 5.7 },
      uPixelRatio: { value: Math.min(2, Math.max(1, pixelRatio)) },
      uZoom: { value: 1 },
      uOpacity: { value: 0.94 }
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending
  });

  const entries = consolidateResources(resources, 1);
  const points = new THREE.Points(buildGeometry(entries), material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  points.userData.allResources = [...resources];
  points.userData.resources = entries.map(({ resource }) => resource);
  points.userData.densityBucket = densityBucketKey(1);
  return points;
}

export function replaceGlobePointResources(points, resources, _categories) {
  if (!points) return;
  points.userData.allResources = [...resources];
  const zoom = points.material?.uniforms?.uZoom?.value || 1;
  rebuildForZoom(points, zoom);
}

export function updateGlobePointLayer(points, { zoom = 1, pixelRatio = 1, opacity = 0.94 } = {}) {
  if (!points?.material?.uniforms) return;
  const nextBucket = densityBucketKey(zoom);
  if (points.userData.densityBucket !== nextBucket) rebuildForZoom(points, zoom);
  points.material.uniforms.uZoom.value = zoom;
  points.material.uniforms.uPixelRatio.value = Math.min(2, Math.max(1, pixelRatio));
  points.material.uniforms.uOpacity.value = opacity;
}
