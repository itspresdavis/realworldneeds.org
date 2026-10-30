// Select All follows the operating system hosting this native CDP runner.
// Physical Control-key tests should continue to send Control explicitly.
export async function selectAll(client, platform = process.platform) {
  const modifiers = platform === "darwin" ? 4 : 2;
  for (const type of ["rawKeyDown", "keyUp"]) {
    await client.call("Input.dispatchKeyEvent", {
      type, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers,
      ...(platform === "darwin" && type === "rawKeyDown" ? { commands: ["selectAll"] } : {}),
    });
  }
}
