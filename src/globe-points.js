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

    float perspective = clamp(2.85 / max(1.10, -viewPosition.z), 0.70, 1.42);
    float zoomLift = 1.0 + smoothstep(1.1, 4.2, uZoom) * 0.28;
    float deepViewCalm = 1.0 - smoothstep(4.8, 10.0, uZoom) * 0.24;
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

    float antialias = 1.0 - smoothstep(0.455, 0.50, radius);
    float outerRing = smoothstep(0.355, 0.385, radius) * (1.0 - smoothstep(0.455, 0.49, radius));
    float halo = 1.0 - smoothstep(0.25, 0.50, radius);
    float core = 1.0 - smoothstep(0.065, 0.165, radius);
    float ring = smoothstep(0.205, 0.27, radius) * (1.0 - smoothstep(0.355, 0.425, radius));

    float isDirect = 1.0 - step(0.5, vPointKind);
    float isLocator = step(0.5, vPointKind) * (1.0 - step(1.5, vPointKind));
    float isNetwork = step(1.5, vPointKind);

    float shape = isDirect * max(core, ring * 0.88)
      + isLocator * max(ring, core * 0.16)
      + isNetwork * max(ring * 0.74, core * 0.08);

    float closeClarity = mix(0.90, 1.0, smoothstep(1.4, 4.0, uZoom));
    float shapeAlpha = shape * closeClarity;
    float outlineAlpha = outerRing * (0.72 + isDirect * 0.16);
    float alpha = min(1.0, max(shapeAlpha, outlineAlpha) + halo * 0.055) * antialias * uOpacity * vPointOpacity;
    if (alpha < 0.025) discard;

    vec3 outlineColor = vec3(0.012, 0.055, 0.075);
    vec3 pointColor = mix(vPointColor, vec3(1.0), core * isDirect * 0.18 + ring * 0.06);
    vec3 color = mix(pointColor, outlineColor, outerRing * 0.88);
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
  if (resource.kind === "locator") return 0.82;
  return 0.68;
}

function resourcePointOpacity(resource) {
  if (resource.kind === "direct") return 1;
  if (resource.kind === "locator") return 0.80;
  return 0.62;
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
      uPointSize: { value: window.innerWidth <= 600 ? 5.5 : 5.0 },
      uPixelRatio: { value: Math.min(2, Math.max(1, pixelRatio)) },
      uZoom: { value: 1 },
      uOpacity: { value: 0.95 }
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

export function updateGlobePointLayer(points, { zoom = 1, pixelRatio = 1, opacity = 0.95 } = {}) {
  if (!points?.material?.uniforms) return;
  points.material.uniforms.uZoom.value = zoom;
  points.material.uniforms.uPixelRatio.value = Math.min(2, Math.max(1, pixelRatio));
  points.material.uniforms.uOpacity.value = opacity;
}
