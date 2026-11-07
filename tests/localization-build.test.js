import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

test('language layer is self-contained, bounded and adds no alternate indexed claim', async () => {
  const js = await readFile('dist/language.js');
  assert.ok(js.length <= 30_000, `language module is ${js.length} bytes`);
  assert.ok(gzipSync(js).length <= 10_000, `language module gzip is ${gzipSync(js).length} bytes`);
  assert.ok((await stat('dist/task-controls.css')).size <= 3_000);
  assert.doesNotMatch(js.toString(), /\bimport\s+(?:[{*]|['"])/);
  for (const path of ['dist/index.html', 'dist/directory/index.html', 'dist/service/bowery-mission/index.html']) {
    const html = await readFile(path, 'utf8');
    assert.match(html, /src="\/language(?:\.[a-f0-9]{12})?\.js\?v=[a-f0-9]{12}"/);
    assert.match(html, /href="\/task-controls(?:\.[a-f0-9]{12})?\.css\?v=[a-f0-9]{12}"/);
    assert.doesNotMatch(html, /hreflang="es"/); // No separately indexed Spanish provider pages are claimed.
  }
});
