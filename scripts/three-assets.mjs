import { createHash } from "node:crypto";

// Treat the renderer and its core as one cache generation. Either file changing
// must change both URLs, including the dependency imported by the renderer.
export function createThreeAssets(moduleBytes, coreBytes) {
  const moduleSource = String(moduleBytes);
  const coreSource = String(coreBytes);
  const release = createHash("sha256")
    .update("three.module\0").update(moduleSource)
    .update("\0three.core\0").update(coreSource)
    .digest("hex").slice(0, 12);
  const moduleName = `three.module.${release}.js`;
  const coreName = `three.core.${release}.js`;
  const rewritten = moduleSource.replace(/(["'])\.\/three\.core\.min\.js\1/g,
    (_match, quote) => `${quote}./${coreName}${quote}`);
  if (rewritten === moduleSource) throw new Error("Three renderer did not reference its expected core module.");
  return { release, moduleName, coreName, moduleSource: rewritten, coreSource };
}

export function versionThreeReferences(source, assets) {
  return source.replace(/(["'])\/vendor\/three\.module\.js\1/g,
    (_match, quote) => `${quote}/vendor/${assets.moduleName}${quote}`);
}
