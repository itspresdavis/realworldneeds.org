import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function filesUnder(root, extensions) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(path, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) output.push(path);
  }
  return output;
}

async function joined(paths) {
  return (await Promise.all(paths.map((path) => readFile(path, "utf8")))).join("\n");
}

test("privacy notice explicitly distinguishes collection, local processing, recipients, and deletion", async () => {
  const privacy = await readFile("public/privacy.html", "utf8");
  assert.match(privacy, /Information RWN collects or receives/);
  assert.match(privacy, /Information RWN does not collect from the finder/);
  assert.match(privacy, /Third-party services and data recipients/);
  assert.match(privacy, /Retention and deletion/);
  assert.match(privacy, /Security controls/);
  assert.match(privacy, /Global Privacy Control and Do Not Track/);
  assert.match(privacy, /Vercel/);
  assert.match(privacy, /USDA \/ Esri ArcGIS/);
  assert.match(privacy, /Apple Maps \/ Google Maps/);
  assert.match(privacy, /does not sell personal information/);
  assert.match(privacy, /does not ask you to upload documents or photos/);
  assert.match(privacy, /no user-upload storage bucket/);
  assert.match(privacy, /does not provide an AI chatbot or personalized generative-AI answer system/);
});

test("terms make current billing, testimonial, AI, and emergency boundaries explicit", async () => {
  const terms = await readFile("public/terms.html", "utf8");
  assert.match(terms, /public website is free/i);
  assert.match(terms, /no checkout, paid membership, subscription, free trial that converts to payment, auto-renewal, recurring billing/);
  assert.match(terms, /does not currently provide a generative-AI chatbot/);
  assert.match(terms, /does not publish fabricated testimonials/);
  assert.match(terms, /no emergency monitoring, dispatch function, crisis counselor, or AI crisis-response system/);
});

test("editorial policy rejects AI-only evidence and fabricated endorsements", async () => {
  const editorial = await readFile("public/editorial-policy.html", "utf8");
  assert.match(editorial, /AI-generated text by itself is never treated as verification/);
  assert.match(editorial, /does not fabricate testimonials, invent user stories, create fake ratings/);
  assert.match(editorial, /material relationship/);
  assert.match(editorial, /privacy, safety, crisis-response, and source-integrity review before launch/);
});

test("current runtime has no hidden upload, payment, subscription, or generative-AI integration", async () => {
  const runtimeFiles = [
    ...(await filesUnder("src", [".js", ".mjs"])),
    ...(await filesUnder("api", [".js", ".mjs"])),
    ...(await filesUnder("public", [".js", ".mjs"])),
    "package.json"
  ];
  const runtime = await joined(runtimeFiles);
  assert.doesNotMatch(runtime, /\b(openai|anthropic|gemini|langchain)\b|@ai-sdk\//i);
  assert.doesNotMatch(runtime, /\b(stripe|braintree|paddle|lemonsqueezy|paypal)\b/i);
  assert.doesNotMatch(runtime, /\b(multer|uploadthing)\b|supabase\s*\.\s*storage|storage\s*\.\s*from\s*\(/i);

  const htmlFiles = ["index.html", ...(await filesUnder("public", [".html"]))];
  const html = await joined(htmlFiles);
  assert.doesNotMatch(html, /<input\b[^>]*\btype\s*=\s*["']?file\b/i);
});
