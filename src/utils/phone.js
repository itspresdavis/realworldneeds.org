// Contact fields are human-written text, not dial strings. Only link complete,
// explicit numbers; never fold hours, menu options or alternatives into them.
export function phoneLinks(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  const links = [];
  for (const part of value.split(/\s*\/\s*|\s+or\s+/i)) {
    const match = part.trim().match(/^(\+?[\d(][\d()\s.\-\u2010-\u2015]*\d)(.*)$/s);
    if (!match) return [];
    const number = match[1];
    // A spaced dash or two independently complete groups may separate numbers
    // or numeric hours. Do not silently join them into a longer dial target.
    if (/\s[-\u2010-\u2015]\s/.test(number)) return [];
    const groups = number.trim().split(/\s+/);
    for (let split = 1; split < groups.length; split += 1) {
      if (groups.slice(0, split).join("").replace(/\D/g, "").length >= 7
        && groups.slice(split).join("").replace(/\D/g, "").length >= 7) return [];
    }
    let suffix = match[2];
    let label = number;
    let extension = "";
    const ext = suffix.match(/^\s*(?:ext(?:ension)?\.?\s*:?\s*|x\s*)(\d{1,6})(?=\s|$)/i);
    if (ext) {
      extension = `;ext=${ext[1]}`;
      label += ext[0];
      suffix = suffix.slice(ext[0].length);
    }
    if (/(?:^|\s)\d{1,2}(?:\.\d{2})?\s*[-\u2010-\u2015]\s*\d{1,2}(?:\.\d{2})?$/.test(number)) return [];
    if (/^\s*[-\u2010-\u2015]?\s*hours?\b/i.test(suffix)) return [];
    if (suffix.trim() && /(?:^|\s)\d{1,2}(?:\.\d{2})?$/.test(number)) return [];
    // Recognize contact annotations, but leave their text outside the link.
    // Unknown prose, abbreviated alternatives and malformed extensions stay text.
    if (suffix.trim() && !/^\s*(?:[-\u2010-\u2015]\s*)?(?:\([a-z]|hours?\b|open\b|our phone[- ]line\b|manned\b|telephone answered\b|WIC\s*-\s*option\b|Mon(?:day)?\b|Tue(?:sday)?\b|Wed(?:nesday)?\b|Thu(?:rsday)?\b|Fri(?:day)?\b|Sat(?:urday)?\b|Sun(?:day)?\b)/i.test(suffix)) return [];
    if (/[()]/.test(number.replace(/\(\d+\)/g, ""))) return [];
    // An optional international trunk prefix is ambiguous; do not guess whether
    // it belongs in the number. Preserve it for the reader instead.
    if (number.startsWith("+") && /\(0\)/.test(number)) return [];
    const digits = number.replace(/\D/g, "");
    const standaloneShortCode = /^\d{3,6}$/.test(value.trim());
    if ((digits.length < 7 && !standaloneShortCode) || digits.length > 15) return [];
    links.push({ label, href: `tel:${number.startsWith("+") ? "+" : ""}${digits}${extension}` });
  }
  return links;
}

const escapePhoneHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

// Preserve every character of the source contact field, including annotations
// and separators. Ambiguous fields remain readable without a call action.
export function phoneMarkup(value) {
  const text = String(value ?? "");
  let end = 0;
  let html = "";
  for (const { label, href } of phoneLinks(value)) {
    const start = text.indexOf(label, end);
    html += `${escapePhoneHtml(text.slice(end, start))}<a href="${href}">${escapePhoneHtml(label)}</a>`;
    end = start + label.length;
  }
  return html + escapePhoneHtml(text.slice(end));
}
