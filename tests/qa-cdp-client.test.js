import test from "node:test";
import assert from "node:assert/strict";
import { CdpClient } from "../scripts/qa-cdp-client.mjs";

class Socket extends EventTarget {
  static instances = [];
  readyState = 0;
  sent = [];
  constructor() { super(); Socket.instances.push(this); }
  send(message) { this.sent.push(JSON.parse(message)); }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  reply(message) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) })); }
}

async function connected(options = {}) {
  const client = new CdpClient("ws://localhost/fixture", { WebSocketImpl: Socket, ...options });
  const ready = client.connect();
  const socket = Socket.instances.at(-1);
  socket.open();
  await ready;
  return { client, socket };
}

test("CDP resolves out-of-order replies and retains browser error detail", async () => {
  const { client, socket } = await connected();
  const first = client.call("Page.enable");
  const second = client.call("Runtime.evaluate", { expression: "2 + 2" });
  socket.reply({ id: 2, result: { value: 4 } });
  socket.reply({ id: 1, result: {} });
  assert.deepEqual(await second, { value: 4 });
  assert.deepEqual(await first, {});
  const failed = client.call("Page.captureScreenshot");
  socket.reply({ id: 3, error: { message: "Target closed" } });
  await assert.rejects(failed, /Page.captureScreenshot: Target closed/);
  assert.equal(client.pending.size, 0);
  client.close();
});

test("a stalled renderer rejects every command and cleanup calls immediately", async () => {
  const { client, socket } = await connected({ timeoutMs: 10 });
  const first = assert.rejects(client.call("Runtime.evaluate"), /Runtime.evaluate:.*exceeded 10 ms/);
  const second = assert.rejects(client.call("Page.navigate"), /Runtime.evaluate:.*exceeded 10 ms/);
  await Promise.all([first, second]);
  await assert.rejects(client.call("Page.removeScriptToEvaluateOnNewDocument"), /exceeded 10 ms/);
  assert.equal(client.pending.size, 0);
  assert.equal(socket.readyState, 3);
});

test("disconnect rejects commands instead of hanging", async () => {
  const { client, socket } = await connected();
  const result = assert.rejects(client.call("Runtime.evaluate"), /connection closed/);
  socket.close();
  await result;
  assert.equal(client.pending.size, 0);
});

test("connection establishment is bounded", async () => {
  const client = new CdpClient("ws://localhost/fixture", { WebSocketImpl: Socket, connectTimeoutMs: 10 });
  await assert.rejects(client.connect(), /connection exceeded 10 ms/);
  assert.equal(Socket.instances.at(-1).readyState, 3);
});

test("events and explicit close keep failure cleanup deterministic", async () => {
  const { client, socket } = await connected();
  const events = [];
  client.on("Runtime.exceptionThrown", value => events.push(value));
  socket.reply({ method: "Runtime.exceptionThrown", params: { text: "Fixture error" } });
  assert.deepEqual(events, [{ text: "Fixture error" }]);
  const pending = assert.rejects(client.call("Page.navigate"), /client closed/);
  client.close();
  await pending;
});

test("send failure and invalid deadlines fail closed", async () => {
  const { client, socket } = await connected();
  socket.send = () => { throw new Error("fixture transport failure"); };
  await assert.rejects(client.call("Page.enable"), /send failed/);
  assert.equal(client.pending.size, 0);
  for (const timeoutMs of [0, -1, Infinity, NaN]) assert.throws(() => new CdpClient("fixture", { timeoutMs }), /positive finite/);
});
