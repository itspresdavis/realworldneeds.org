export function clusterProjectedEntries(entries, threshold, selectedId = null) {
  const distanceThreshold = Math.max(8, Number(threshold) || 8);
  const cellSize = distanceThreshold;
  const buckets = new Map();
  const clusters = [];

  const cellKey = (x, y) => `${x}:${y}`;
  const addToBucket = (cluster, cellX, cellY) => {
    const key = cellKey(cellX, cellY);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(cluster);
    else buckets.set(key, [cluster]);
  };

  for (const entry of entries) {
    const resource = entry.resource;
    const point = entry.point;
    const keepSeparate = resource.id === selectedId;

    if (keepSeparate) {
      clusters.push({
        members: [resource],
        x: point.x,
        y: point.y,
        z: point.z,
        sumX: point.x,
        sumY: point.y,
        selected: true
      });
      continue;
    }

    const cellX = Math.floor(point.x / cellSize);
    const cellY = Math.floor(point.y / cellSize);
    let target = null;
    let targetDistance = distanceThreshold;

    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        const bucket = buckets.get(cellKey(cellX + xOffset, cellY + yOffset));
        if (!bucket) continue;
        for (const cluster of bucket) {
          if (cluster.selected) continue;
          const distance = Math.hypot(cluster.x - point.x, cluster.y - point.y);
          if (distance < targetDistance) {
            target = cluster;
            targetDistance = distance;
          }
        }
      }
    }

    if (target) {
      target.members.push(resource);
      target.sumX += point.x;
      target.sumY += point.y;
      target.x = target.sumX / target.members.length;
      target.y = target.sumY / target.members.length;
      target.z = Math.max(target.z, point.z);
      continue;
    }

    const cluster = {
      members: [resource],
      x: point.x,
      y: point.y,
      z: point.z,
      sumX: point.x,
      sumY: point.y,
      selected: false
    };
    clusters.push(cluster);
    addToBucket(cluster, cellX, cellY);
  }

  return clusters;
}
