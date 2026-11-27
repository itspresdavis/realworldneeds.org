// Shared by the map application and generated public pages.
export function siteFooter({ clearBrowserData = false } = {}) {
  return `<footer class="rwn-site-footer"><div class="rwn-site-footer__inner">
    <div class="rwn-site-footer__brand"><a href="/"><strong>Real World Needs</strong></a><p>Essential services directory</p></div>
    <nav aria-label="Footer find help"><strong>Find help</strong><a href="/directory">Directory</a><a href="/directory#saved">Saved services</a><a href="/account">Your resources</a></nav>
    <nav aria-label="Footer about RWN"><strong>About RWN</strong><a href="/our-story">Why RWN &amp; transparency</a><a href="/get-involved">Get involved</a><a href="/donate">Donations</a><a href="/contact">Contact</a></nav>
    <nav aria-label="Footer policies"><strong>Policies</strong><a href="/editorial-policy">How listings are checked</a><a href="/sources">Sources</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/accessibility">Accessibility</a>${clearBrowserData ? '<button id="clearBrowserData" type="button">Clear browser data</button>' : ''}</nav>
  </div></footer>`;
}
