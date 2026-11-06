import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { correctionUIFixture } from '../browser-tests/corrections-ui-gate.js';

for (const partialRequest of [false, true]) {
  test(`correction fixture closes an unresolved ${partialRequest ? 'request' : 'browser preconnect'} after the journey`, async () => {
    const fixture = await correctionUIFixture();
    const url = new URL(fixture.url);
    const socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    socket.on('error', () => {});
    const clientClosed = new Promise(resolve => socket.once('close', resolve));
    let closed, timer;
    try {
      await once(socket, 'connect');
      if (partialRequest) socket.write('GET /corrections HTTP/1.1\r\nHost: fixture.test\r\n');
      closed = fixture.close();
      const completed = await Promise.race([
        Promise.all([closed, clientClosed]).then(() => true),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), 250); }),
      ]);
      assert.equal(completed, true, 'owned browser connections must not keep teardown waiting for headers or another client action');
    } finally {
      clearTimeout(timer);
      socket.destroy();
      await (closed || fixture.close());
    }
  });
}
