// One server-rendered header for the map, directory and authored pages.
// It stays outside the map application's replaceable root.
const label = (en, es) => `<span data-rwn-label><span lang="en">${en}</span><span lang="es">${es}</span></span>`;
export function siteHeader(path) {
  const links = [
    ['/', 'Home', 'Inicio'],
    ['/impact', 'Impact', 'Nuestro impacto'],
    ['/our-story', 'Why RWN?', '¿Por qué RWN?'],
    ['/get-involved', 'Get Involved', 'Participa'],
    ['/contact', 'Contact', 'Contacto'],
  ].map(([href, en, es]) => {
    const current = path === href;
    return `<a href="${href}"${current ? ' aria-current="page"' : ''}>${label(en, es)}</a>`;
  }).join('');
  return `${path === "/" ? '<span id="top" class="page-start" tabindex="-1"></span>' : ""}<header class="rwn-site-header"><div class="rwn-site-header__inner">
    <a class="rwn-site-brand" href="/"><img src="/brand/rwn-logo-192.png" alt="" width="44" height="44" /><span><strong>Real World Needs</strong><small>${label('Essential services directory', 'Directorio de servicios esenciales')}</small></span></a>
    <nav class="rwn-site-nav" aria-label="Primary navigation">${links}</nav>
    <div class="rwn-site-tools"><!--rwn-language-control--><details class="rwn-page-menu"><summary aria-label="Navigation menu">${label('Menu', 'Menú')}</summary><nav aria-label="Mobile navigation">${links}</nav></details></div>
  </div></header>`;
}
