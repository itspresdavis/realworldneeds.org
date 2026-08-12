import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve("dist");
const port = Number(process.argv[2] || 5173);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

function safeRelativePath(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  } catch {
    return null;
  }

  const normalized = normalize(pathname).replace(/^[/\\]+/, "");
  const relative = normalized || "index.html";
  const resolved = resolve(join(root, relative));
  return resolved === root || resolved.startsWith(`${root}${sep}`) ? relative : null;
}

function candidatePaths(requestUrl) {
  const relative = safeRelativePath(requestUrl);
  if (!relative) return [];
  if (extname(relative)) return [resolve(join(root, relative))];
  return [
    resolve(join(root, `${relative}.html`)),
    resolve(join(root, relative, "index.html"))
  ];
}

async function existingFile(candidates) {
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return { candidate, info };
    } catch {
      // Try the next clean-URL candidate.
    }
  }
  return null;
}

const server = createServer(async (request, response) => {
  const candidates = candidatePaths(request.url || "/");
  if (!candidates.length) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  const match = await existingFile(candidates);
  if (match) {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": match.info.size,
      "Content-Type": contentTypes[extname(match.candidate)] || "application/octet-stream"
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(match.candidate).pipe(response);
    return;
  }

  const notFound = join(root, "404.html");
  const info = await stat(notFound);
  response.writeHead(404, {
    "Cache-Control": "no-store",
    "Content-Length": info.size,
    "Content-Type": "text/html; charset=utf-8"
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(notFound).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`RWN preview available at http://127.0.0.1:${port}`);
});
