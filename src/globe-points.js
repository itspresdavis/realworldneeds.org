import * as THREE from "/vendor/three.module.js";

const VERTEX_SHADER = `
  attribute vec3 pointColor;
  attribute float pointScale;
  varying vec3 vPointColor;
  uniform float uPointSize;
  uniform float uPixelRatio;
  uniform float uZoom;

  void main() {
    vPointColor = pointColor;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    float perspective = clamp(2.8 / max(1.45, -viewPosition.z), 0.72, 1.3);
    float zoomBoost = clamp(0.82 + max(0.0, uZoom - 1.0) * 0.16, 0.82, 1.18);
    gl_PointSize = uPointSize * pointScale * perspective * zoomBoost * uPixelRatio;
  }
`;

const FRAGMENT_SHADER = `
  varying vec3 vPointColor;
  uniform float uOpacity;

  void main() {
    float distanceFromCenter = distance(gl_PointCoord, vec2(0.5));
    if (distanceFromCenter > 0.5) discard;

    float halo = 1.0 - smoothstep(0.16, 0.5, distanceFromCenter);
    float core = 1.0 - smoothstep(0.03, 0.2, distanceFromCenter);
    float alpha = min(1.0, halo * 0.34 + core * 0.82) * uOpacity;
    vec3 color = mix(vPointColor, vec3(1.0), core * 0.24);
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
  if (resource.kind === "locator") return 0.78;
  return 0.68;
}

function buildGeometry(resources, categories) {
  const positions = new Float32Array(resources.length * 3);
  const colors = new Float32Array(resources.length * 3);
  const scales = new Float32Array(resources.length);
  const color = new THREE.Color();

  resources.forEach((resource, index) => {
    const position = resourceVector(resource);
    positions.set(position, index * 3);
    color.set(categories[resource.category]?.color || "#8fe8bd");
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    scales[index] = resourcePointScale(resource);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("pointColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("pointScale", new THREE.BufferAttribute(scales, 1));
  if (resources.length) geometry.computeBoundingSphere();
  else geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
  return geometry;
}

export function createGlobePointLayer(resources, categories, { pixelRatio = 1 } = {}) {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uPointSize: { value: window.innerWidth <= 600 ? 5.8 : 5.3 },
      uPixelRatio: { value: Math.min(1.5, Math.max(1, pixelRatio)) },
      uZoom: { value: 1 },
      uOpacity: { value: 0.96 }
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

export function updateGlobePointLayer(points, { zoom = 1, pixelRatio = 1, opacity = 0.96 } = {}) {
  if (!points?.material?.uniforms) return;
  points.material.uniforms.uZoom.value = zoom;
  points.material.uniforms.uPixelRatio.value = Math.min(1.5, Math.max(1, pixelRatio));
  points.material.uniforms.uOpacity.value = opacity;
}
