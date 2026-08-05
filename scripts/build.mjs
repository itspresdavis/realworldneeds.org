import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const NASA_BLUE_MARBLE =
  "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/august/world.200408.3x5400x2700.jpg";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("index.html", "dist/index.html");
await cp("src", "dist/src", { recursive: true });
await cp("public", "dist", { recursive: true });

// Prefer NASA's 5,400 px Blue Marble source in production while retaining the
// checked-in image as a reliable offline/build fallback.
try {
  const response = await fetch(NASA_BLUE_MARBLE, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`NASA imagery returned ${response.status}`);

  const imagery = Buffer.from(await response.arrayBuffer());
  if (imagery.byteLength < 500_000) {
    throw new Error("NASA imagery download was unexpectedly small");
  }

  await writeFile("dist/media/earth-blue-marble.jpg", imagery);
  console.log(`Using NASA Blue Marble imagery (${imagery.byteLength.toLocaleString()} bytes).`);
} catch (error) {
  console.warn(`Using bundled earth imagery fallback: ${error.message}`);
}

await mkdir("dist/vendor", { recursive: true });
await cp("node_modules/three/build/three.module.min.js", "dist/vendor/three.module.js");
await cp("node_modules/three/build/three.core.min.js", "dist/vendor/three.core.min.js");
