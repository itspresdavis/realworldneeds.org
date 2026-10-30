import assert from "node:assert/strict";
import test from "node:test";
import { selectAll } from "../scripts/qa-keyboard.mjs";

for (const [platform, modifiers] of [["darwin", 4], ["linux", 2], ["win32", 2]]) {
  test(`native Select All uses the ${platform} editing modifier and releases the key`, async () => {
    const calls = [];
    await selectAll({ async call(method, params) { calls.push({ method, params }); } }, platform);
    assert.deepEqual(calls, ["rawKeyDown", "keyUp"].map(type => ({ method: "Input.dispatchKeyEvent", params: {
      type, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers,
      ...(platform === "darwin" && type === "rawKeyDown" ? { commands: ["selectAll"] } : {}),
    } })));
  });
}

test("Select All defaults to the native runner platform", async () => {
  const calls = [];
  await selectAll({ async call(method, params) { calls.push(params); } });
  assert.ok(calls.every(params => params.modifiers === (process.platform === "darwin" ? 4 : 2)));
});

test("failed native selection propagates instead of continuing with replacement text", async () => {
  const error = new Error("Native input failed");
  let calls = 0;
  await assert.rejects(selectAll({ async call() { calls++; throw error; } }), failure => failure === error);
  assert.equal(calls, 1);
});
