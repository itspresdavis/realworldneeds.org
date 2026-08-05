import test from "node:test";
import assert from "node:assert/strict";
import { clearResourceFromUrl, privateResourceUrl, resourceIdFromUrl } from "../src/utils/privacy.js";

test("resource links keep service context in the URL fragment", () => {
  const url = privateResourceUrl("https://www.realworldneeds.org/?campaign=public", "whitechapel-mission");
  assert.equal(url.searchParams.get("resource"), null);
  assert.equal(url.searchParams.get("campaign"), "public");
  assert.equal(url.hash, "#resource=whitechapel-mission");
});

test("legacy resource query links remain readable", () => {
  assert.equal(
    resourceIdFromUrl("https://www.realworldneeds.org/?resource=whitechapel-mission"),
    "whitechapel-mission"
  );
});

test("clearing a resource preserves ordinary section anchors", () => {
  assert.equal(clearResourceFromUrl("https://www.realworldneeds.org/#finder").toString(), "https://www.realworldneeds.org/#finder");
  assert.equal(clearResourceFromUrl("https://www.realworldneeds.org/#resource=whitechapel-mission").toString(), "https://www.realworldneeds.org/");
});
