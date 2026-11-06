// QA-only, serialized into the browser. Keep the expected catalog independent
// of the renderer's coordinate-filtering implementation.
export function globeCoordinateSnapshot(resources, createPoints, updatePoints) {
  const points = createPoints(resources, {});
  try {
    return {
      catalog: resources.map(({ id, lat, lng, locationPrecision }) => ({ id, lat, lng, locationPrecision })),
      retainedIds: points.userData.allResources.map(resource => resource.id),
      frames: [1, 3, 8, 12].map(zoom => {
        updatePoints(points, { zoom });
        const positions = points.geometry.attributes.position;
        return {
          zoom, count: positions.count,
          ids: points.userData.resources.map(resource => resource.id),
          positions: Array.from({ length: positions.count }, (_, i) => [
            positions.getX(i), positions.getY(i), positions.getZ(i)
          ])
        };
      })
    };
  } finally {
    points.geometry.dispose();
    points.material.dispose();
  }
}

export function assertGlobeCoordinateFidelity(snapshot) {
  const fail = message => { throw new Error("Catalog coordinate fidelity: " + message); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const { catalog, frames, retainedIds, contactOnlySearchIds } = snapshot;
  const ids = catalog.map(record => record.id);
  if (new Set(ids).size !== ids.length) fail("duplicate catalog IDs");
  if (!same(retainedIds, ids)) fail("point layer did not retain the complete source catalog");
  const mapped = catalog.filter(record => record.locationPrecision !== "contact-only");
  const contactOnly = catalog.filter(record => record.locationPrecision === "contact-only");
  for (const record of mapped) {
    if (!Number.isFinite(record.lat) || Math.abs(record.lat) > 90
      || !Number.isFinite(record.lng) || Math.abs(record.lng) > 180)
      fail("invalid mapped catalog coordinates for " + record.id);
  }
  for (const record of contactOnly) {
    if (record.lat != null || record.lng != null) fail("contact-only coordinates were fabricated for " + record.id);
  }
  if (!same(contactOnlySearchIds, contactOnly.map(record => record.id)))
    fail("contact-only listing is missing from text search");
  if (!same(frames.map(frame => frame.zoom), [1, 3, 8, 12])) fail("required zoom coverage changed");
  let maximumError = 0;
  for (const frame of frames) {
    if (frame.count !== mapped.length || frame.positions.length !== mapped.length)
      fail("missing or extra mapped points at zoom " + frame.zoom);
    if (!same(frame.ids, mapped.map(record => record.id)))
      fail("mapped point ID order changed or contact-only point leaked at zoom " + frame.zoom);
    for (let i = 0; i < mapped.length; i++) {
      const vector = frame.positions[i];
      if (vector.length !== 3 || !vector.every(Number.isFinite) || Math.hypot(...vector) === 0)
        fail("non-finite or zero point for " + mapped[i].id);
      const [x, y, z] = vector;
      const lat = Math.atan2(y, Math.hypot(x, z)) * 180 / Math.PI;
      const lng = Math.atan2(x, z) * 180 / Math.PI;
      const error = Math.max(Math.abs(lat - mapped[i].lat), Math.abs(lng - mapped[i].lng));
      maximumError = Math.max(maximumError, error);
      if (error > 0.00001) fail(mapped[i].id + " moved " + error + " degrees at zoom " + frame.zoom);
    }
  }
  return { catalog: catalog.length, mapped: mapped.length, contactOnly: contactOnly.length,
    counts: frames.map(frame => frame.count), maximumError, contactOnlySearchIds };
}

export async function contactOnlyFinderSearch(resources) {
  const input = document.getElementById("resourceSearch");
  if (!input) throw new Error("Finder search control is missing");
  const before = input.value;
  const found = [];
  try {
    for (const record of resources.filter(resource => resource.locationPrecision === "contact-only")) {
      input.value = record.name;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const card = [...document.querySelectorAll(".resource-card")]
          .find(node => node.dataset.resultResourceId === record.id);
        if (card?.querySelector(".result-row-link") && card.getBoundingClientRect().height > 0) {
          found.push(record.id);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    }
    return found;
  } finally {
    input.value = before;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

export async function verifyGlobeCoordinates({ client, evaluate }) {
  const snapshot = await evaluate(client, `(async () => {
    const version = new URL(document.querySelector('script[src*="bootstrap"]').src).search;
    const { resources } = await import('/src/data/resources.js' + version);
    const { createGlobePointLayer, updateGlobePointLayer } = await import('/src/globe-points.js' + version);
    const snapshot = (${globeCoordinateSnapshot.toString()})(resources, createGlobePointLayer, updateGlobePointLayer);
    snapshot.contactOnlySearchIds = await (${contactOnlyFinderSearch.toString()})(resources);
    return snapshot;
  })()`);
  return assertGlobeCoordinateFidelity(snapshot);
}
