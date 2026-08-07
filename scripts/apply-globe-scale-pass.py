from pathlib import Path

path = Path("src/app.js")
text = path.read_text()


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one source block, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    'import * as THREE from "/vendor/three.module.js";\n',
    'import * as THREE from "/vendor/three.module.js";\nimport { createGlobePointLayer, replaceGlobePointResources, updateGlobePointLayer } from "./globe-points.js";\nimport { clusterProjectedEntries } from "./utils/globe-clustering.js";\n',
    "imports",
)

replace_once(
    'let globeLastScrollFrame = 0;\n',
    '''let globeLastScrollFrame = 0;\nlet globeServicePoints = null;\nconst globeRaycaster = new THREE.Raycaster();\nconst globePointerNdc = new THREE.Vector2();\nconst globeProjectionVector = new THREE.Vector3();\nconst globeInverseWorldMatrix = new THREE.Matrix4();\nconst globeResourceVectorCache = new WeakMap();\n''',
    "globe globals",
)

lat_lng_block = '''function latLngVector(lat, lng, radius = 1) {\n  const latitude = toRad(lat);\n  const longitude = toRad(lng);\n  const cosLat = Math.cos(latitude);\n  return new THREE.Vector3(\n    radius * cosLat * Math.sin(longitude),\n    radius * Math.sin(latitude),\n    radius * cosLat * Math.cos(longitude)\n  );\n}\n'''
replace_once(
    lat_lng_block,
    lat_lng_block + '''\nfunction cachedResourceVector(resource) {\n  let vector = globeResourceVectorCache.get(resource);\n  if (vector) return vector;\n  vector = latLngVector(resource.lat, resource.lng, 1.035);\n  globeResourceVectorCache.set(resource, vector);\n  return vector;\n}\n\nfunction projectResourceGlobePoint(resource, width, height) {\n  if (!globeWorld || !globeCamera) return projectPoint(resource.lat, resource.lng, width, height);\n  globeProjectionVector.copy(cachedResourceVector(resource)).applyMatrix4(globeWorld.matrixWorld);\n  const scale = globeWorld.scale.x || 1;\n  const depth = globeProjectionVector.z / scale;\n  globeProjectionVector.project(globeCamera);\n  return {\n    x: (globeProjectionVector.x * 0.5 + 0.5) * width,\n    y: (-globeProjectionVector.y * 0.5 + 0.5) * height,\n    z: depth\n  };\n}\n\nfunction syncGlobePointLayer() {\n  if (!globeWorld || !globeRenderer) return;\n  if (!globeServicePoints) {\n    globeServicePoints = createGlobePointLayer(state.filtered, categories, {\n      pixelRatio: globeRenderer.getPixelRatio?.() || 1\n    });\n    globeWorld.add(globeServicePoints);\n    globeStageElement?.classList.add("has-gpu-points");\n    return;\n  }\n  replaceGlobePointResources(globeServicePoints, state.filtered, categories);\n}\n''',
    "resource projection helpers",
)

replace_once(
    '  globeWorld.add(globeSurface);\n  globeGraticule = createGraticule();',
    '  globeWorld.add(globeSurface);\n  syncGlobePointLayer();\n  globeGraticule = createGraticule();',
    "gpu layer initialization",
)

replace_once(
    '  const dpr = Math.min(window.devicePixelRatio || 1, width < 720 ? 1.25 : 1.5);\n  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {',
    '  const dpr = Math.min(window.devicePixelRatio || 1, width < 720 ? 1.25 : 1.5);\n  updateGlobePointLayer(globeServicePoints, { zoom: state.zoom, pixelRatio: dpr, opacity: 0.96 });\n  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {',
    "point uniforms",
)

old_cluster = '''function clusterVisibleResources(width, height) {\n  const selected = selectedResource();\n  const threshold = (width < 600 ? 54 : 44) - (state.zoom - 0.86) * 16;\n  const entries = [];\n  let selectedEntry = null;\n\n  for (const resource of state.filtered) {\n    const point = projectGlobePoint(resource.lat, resource.lng, width, height);\n    if (point.z <= 0.03 || point.x <= 12 || point.x >= width - 12 || point.y <= 12 || point.y >= height - 12) continue;\n    const entry = { resource, point };\n    if (resource.id === selected?.id) selectedEntry = entry;\n    else entries.push(entry);\n  }\n  if (selectedEntry) entries.unshift(selectedEntry);\n\n  const clusters = [];\n  for (const entry of entries) {\n    const keepSeparate = entry.resource.id === selected?.id;\n    const target = keepSeparate ? null : clusters.find((cluster) =>\n      !cluster.selected && Math.hypot(cluster.x - entry.point.x, cluster.y - entry.point.y) < threshold\n    );\n    if (target) {\n      target.members.push(entry.resource);\n      target.sumX += entry.point.x;\n      target.sumY += entry.point.y;\n      target.x = target.sumX / target.members.length;\n      target.y = target.sumY / target.members.length;\n      target.z = Math.max(target.z, entry.point.z);\n    } else {\n      clusters.push({\n        members: [entry.resource],\n        x: entry.point.x,\n        y: entry.point.y,\n        z: entry.point.z,\n        sumX: entry.point.x,\n        sumY: entry.point.y,\n        selected: keepSeparate\n      });\n    }\n  }\n  return clusters;\n}\n'''
new_cluster = '''function clusterVisibleResources(width, height) {\n  const selected = selectedResource();\n  const threshold = Math.max(22, (width < 600 ? 54 : 44) - (state.zoom - 0.86) * 16);\n  const entries = [];\n  let selectedEntry = null;\n\n  for (const resource of state.filtered) {\n    const point = projectResourceGlobePoint(resource, width, height);\n    if (point.z <= 0.03 || point.x <= 12 || point.x >= width - 12 || point.y <= 12 || point.y >= height - 12) continue;\n    const entry = { resource, point };\n    if (resource.id === selected?.id) selectedEntry = entry;\n    else entries.push(entry);\n  }\n  if (selectedEntry) entries.unshift(selectedEntry);\n  return clusterProjectedEntries(entries, threshold, selected?.id || null);\n}\n'''
replace_once(old_cluster, new_cluster, "spatial clustering")

replace_once(
    '''function renderPins(width, height, now = performance.now()) {\n  const moving = state.dragging || state.pinching || Math.abs(state.velocityLon) > 0.18 || Math.abs(state.velocityLat) > 0.18 || Math.abs(state.targetZoom - state.zoom) > 0.008 || state.targetLon !== null;\n  const minInterval = moving ? 42 : 70;\n  if (now - globeLastPinUpdate < minInterval) return;''',
    '''function renderPins(width, height, now = performance.now()) {\n  const moving = state.dragging || state.pinching || Math.abs(state.velocityLon) > 0.18 || Math.abs(state.velocityLat) > 0.18 || Math.abs(state.targetZoom - state.zoom) > 0.008 || state.targetLon !== null;\n  const gpuPointsActive = Boolean(globeServicePoints);\n  globeStageElement?.classList.toggle("is-globe-moving", gpuPointsActive && moving);\n  if (gpuPointsActive && moving) return;\n  const minInterval = gpuPointsActive ? 90 : moving ? 42 : 70;\n  if (now - globeLastPinUpdate < minInterval) return;''',
    "moving pin DOM suppression",
)

replace_once(
    '''  renderControls();\n  renderResourcePanel();\n  renderResults();\n  renderClusterTray();\n  pinSignature = "";\n}\n\nfunction nearbyExactCount''',
    '''  syncGlobePointLayer();\n  renderControls();\n  renderResourcePanel();\n  renderResults();\n  renderClusterTray();\n  pinSignature = "";\n}\n\nfunction nearbyExactCount''',
    "filter point sync",
)

old_select = '''function selectCountryFromPointer(event) {\n  if (!globeRenderer || !globeCamera || !globeWorld || !globeSurface || !state.countryFeatures.length) return;\n  const rect = globeRenderer.domElement.getBoundingClientRect();\n  const pointer = new THREE.Vector2(\n    ((event.clientX - rect.left) / rect.width) * 2 - 1,\n    -((event.clientY - rect.top) / rect.height) * 2 + 1\n  );\n  globeWorld.updateMatrixWorld(true);\n  globeCamera.updateMatrixWorld(true);\n  const raycaster = new THREE.Raycaster();\n  raycaster.setFromCamera(pointer, globeCamera);\n  const hit = raycaster.intersectObject(globeSurface, false)[0];\n  if (!hit) return;\n\n  const localPoint = hit.point.clone().applyMatrix4(new THREE.Matrix4().copy(globeWorld.matrixWorld).invert()).normalize();\n  const lat = Math.asin(THREE.MathUtils.clamp(localPoint.y, -1, 1)) * 180 / Math.PI;\n  const lng = Math.atan2(localPoint.x, localPoint.z) * 180 / Math.PI;\n  const country = countryAtCoordinate(lat, lng);\n  if (!country) return;\n'''
new_select = '''function selectCountryFromPointer(event) {\n  if (!globeRenderer || !globeCamera || !globeWorld || !globeSurface || !state.countryFeatures.length) return;\n  const rect = globeRenderer.domElement.getBoundingClientRect();\n  globePointerNdc.set(\n    ((event.clientX - rect.left) / rect.width) * 2 - 1,\n    -((event.clientY - rect.top) / rect.height) * 2 + 1\n  );\n  globeWorld.updateMatrixWorld(true);\n  globeCamera.updateMatrixWorld(true);\n  globeRaycaster.params.Points.threshold = event.pointerType === "touch" ? 0.034 : 0.022;\n  globeRaycaster.setFromCamera(globePointerNdc, globeCamera);\n  const surfaceHit = globeRaycaster.intersectObject(globeSurface, false)[0];\n  const pointHit = globeServicePoints ? globeRaycaster.intersectObject(globeServicePoints, false)[0] : null;\n\n  if (pointHit && (!surfaceHit || pointHit.distance <= surfaceHit.distance + 0.06)) {\n    const resource = globeServicePoints.userData.resources?.[pointHit.index];\n    if (resource) {\n      const cluster = clusterVisibleResources(globeViewportWidth, globeViewportHeight)\n        .find((candidate) => candidate.members.some((member) => member.id === resource.id));\n      if (cluster?.members.length > 1) focusCluster(cluster.members.map((member) => member.id));\n      else setSelected(resource.id, true, "panel");\n      return;\n    }\n  }\n\n  if (!surfaceHit) return;\n  globeInverseWorldMatrix.copy(globeWorld.matrixWorld).invert();\n  globeProjectionVector.copy(surfaceHit.point).applyMatrix4(globeInverseWorldMatrix).normalize();\n  const lat = Math.asin(THREE.MathUtils.clamp(globeProjectionVector.y, -1, 1)) * 180 / Math.PI;\n  const lng = Math.atan2(globeProjectionVector.x, globeProjectionVector.z) * 180 / Math.PI;\n  const country = countryAtCoordinate(lat, lng);\n  if (!country) return;\n'''
replace_once(old_select, new_select, "GPU point raycast selection")

path.write_text(text)
print("Applied scalable GPU globe integration.")
