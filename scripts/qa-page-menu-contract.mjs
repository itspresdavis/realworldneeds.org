// Independently reviewed generated-page navigation contract. Keep it separate
// from production rendering so QA cannot silently adopt an unintended link.
export const PAGE_MENU_LINKS = Object.freeze([
  ['/', 'Find help'], ['/directory', 'Directory'], ['/directory#saved', 'Saved'],
  ['/about', 'About RWN'], ['/editorial-policy', 'How listings are checked'],
  ['/sources', 'Sources'], ['/transparency', 'Transparency']
].map(link => Object.freeze(link)));
export const PAGE_MENU_HREFS = Object.freeze(PAGE_MENU_LINKS.map(([href]) => href));
