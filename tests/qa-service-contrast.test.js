import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { renderedTextContrast } from "../scripts/qa-finder-presentation.mjs";

const element = (backgroundColor, color = "rgb(0, 0, 0)", parentElement = null) => ({ backgroundColor, color, parentElement });
const contrast = node => vm.runInNewContext(`(${renderedTextContrast.toString()})(node)`, { node, getComputedStyle: element => element });

test("rendered contrast follows a transparent ancestor chain to the actual pale panel", () => {
  const panel = element("rgb(248, 250, 249)");
  const group = element("rgba(0, 0, 0, 0)", undefined, panel);
  const link = element("rgba(0, 0, 0, 0)", "rgb(82, 102, 91)", group);
  const span = element("rgba(0, 0, 0, 0)", "rgb(82, 102, 91)", link);
  const expected = contrast(element("rgb(248, 250, 249)", "rgb(82, 102, 91)"));
  assert.equal(contrast(span), expected);
  assert.ok(expected >= 4.5);
});

test("rendered contrast composites translucent background layers in painted order", () => {
  const white = element("rgb(255, 255, 255)");
  const red = element("rgba(255, 0, 0, 0.5)", undefined, white);
  const blue = element("rgba(0, 0, 255, 0.5)", "rgb(0, 0, 0)", red);
  assert.equal(contrast(blue), contrast(element("rgb(127.5, 63.75, 191.25)")));
  const halfBlack = element("rgba(0, 0, 0, 0.5)", "rgb(0, 0, 0)", white);
  assert.equal(contrast(halfBlack), contrast(element("rgb(127.5, 127.5, 127.5)")));
});

test("rendered contrast also composites translucent text and retains real failures", () => {
  const transparent = element("rgb(255, 255, 255)", "rgba(0, 0, 0, 0)");
  assert.equal(contrast(transparent), 1);
  const faded = element("rgb(255, 255, 255)", "rgba(0, 0, 0, 0.2)");
  assert.ok(contrast(faded) < 4.5);
  assert.ok(contrast(element("rgb(36, 88, 62)", "rgb(222, 235, 241)")) >= 4.5);
  assert.equal(contrast(element("rgb(0, 0, 0)", "rgb(255, 255, 255)")), 21);
});
