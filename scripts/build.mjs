import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("index.html", "dist/index.html");
await cp("src", "dist/src", { recursive: true });
await cp("public", "dist", { recursive: true });

await mkdir("dist/vendor", { recursive: true });
await cp("node_modules/three/build/three.module.min.js", "dist/vendor/three.module.js");
await cp("node_modules/three/build/three.core.min.js", "dist/vendor/three.core.min.js");
