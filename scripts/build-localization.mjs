import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { minify } from 'terser';

// Keep language switching available offline without a new module dependency in
// the budgeted Directory/Saved entries. A failed optional language script leaves
// the complete English finder and existing data/state usable.
const paths = ['src/utils/localization.js', 'src/utils/editorial-copy.js', 'src/utils/interface-copy.js', 'public/language.js'];
const sources = await Promise.all(paths.map(path => readFile(path, 'utf8')));
const source = sources.map(text => text.replace(/^import[^\n]+\n/gm, '').replaceAll('export ', '')).join('\n');
const { code } = await minify(source, { module: true });
const css = await readFile('public/task-controls.css', 'utf8');
const release = createHash('sha256').update(code).update(css).digest('hex').slice(0, 12);
const control = '<div class="rwn-language-bar"><label data-language-control><span class="rwn-visually-hidden">Language / Idioma</span><select aria-label="Language / Idioma" disabled><option value="en" lang="en">English</option><option value="es" lang="es">Español</option></select></label><details class="rwn-language-info"><summary aria-label="About translations"><span aria-hidden="true">i</span></summary><p id="rwn-language-scope" data-language-notice>Provider information stays in its original language. Language selection does not confirm that a provider offers service in Spanish.</p></details></div>';
await writeFile('dist/language.js', `${code}\n`);
await writeFile('dist/task-controls.css', css);
async function inject(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inject(path);
    else if (entry.name.endsWith('.html')) {
      let html = await readFile(path, 'utf8');
      // Authored long-form English content remains correctly identified when
      // navigation changes language; reviewed explicit translations override it.
      html = html.replace(/<(section|article) class="(legal-hero|legal-content)">/g, '<$1 class="$2" lang="en">');
      if (!html.includes('data-language-control')) html = html.includes("<!--rwn-language-control-->") ? html.replace("<!--rwn-language-control-->", control) : html.replace('</header>', `</header>${control}`);
      html = html.replace(/(<head[^>]*>)/i, `$1<script src="/language-preference.js?v=${release}"></script>`);
      if (html.includes('data-rwn-language')) html = html.replace(/\/task-controls(?:\.[a-f0-9]{12})?\.css\?v=[a-f0-9]{12}/g, `/task-controls.css?v=${release}`).replace(/\/language(?:\.[a-f0-9]{12})?\.js\?v=[a-f0-9]{12}/g, `/language.js?v=${release}`);
      else html = html.replace('</head>', `<link rel="stylesheet" href="/task-controls.css?v=${release}" data-rwn-language /><script type="module" src="/language.js?v=${release}"></script>\n</head>`);
      await writeFile(path, html);
    }
  }
}
await inject('dist');
