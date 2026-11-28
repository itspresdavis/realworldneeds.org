// Shared by the map application and generated public pages.
export function siteFooter({ clearBrowserData = false, currentPath = "" } = {}) {
  const current = href => currentPath === href ? ' aria-current="page"' : "";
  return `<footer class="rwn-site-footer"><div class="rwn-site-footer__inner">
    <div class="rwn-site-footer__brand"><a href="/"><strong>Real World Needs</strong></a><p>Essential services directory</p></div>
    <nav aria-label="Footer find help"><strong>Find help</strong><a href="/directory"${current("/directory")}>Directory</a><a href="/directory#saved">Saved services</a><a href="/account"${current("/account")}>Your resources</a></nav>
    <nav aria-label="Footer about RWN"><strong>About RWN</strong><a href="/our-story"${current("/our-story")}>Why RWN &amp; transparency</a><a href="/get-involved"${current("/get-involved")}>Get involved</a><a href="/donate"${current("/donate")}>Donations</a><a href="/contact"${current("/contact")}>Contact</a></nav>
    <nav aria-label="Footer policies"><strong>Policies</strong><a href="/editorial-policy"${current("/editorial-policy")}>How listings are checked</a><a href="/sources"${current("/sources")}>Sources</a><a href="/privacy"${current("/privacy")}>Privacy</a><a href="/terms"${current("/terms")}>Terms</a><a href="/accessibility"${current("/accessibility")}>Accessibility</a>${clearBrowserData ? '<button id="clearBrowserData" type="button">Clear browser data</button>' : ''}</nav>
  </div></footer>`;
}
