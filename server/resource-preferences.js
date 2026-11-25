export const personalAccountsEnabled = () => process.env.RWN_PERSONAL_ACCOUNTS_ENABLED === 'true';
const topics = ['food', 'water', 'clothing', 'shelter', 'health', 'hygiene', 'referral'];

// Only broad needs and a coarse place. No diagnoses, documents, biographies,
// exact coordinates, inferred traits, or automatic copying from guest storage.
export function validatePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['topics', 'area', 'consent'].includes(key))
    || value.consent !== true || !Array.isArray(value.topics)
    || value.topics.length > topics.length || new Set(value.topics).size !== value.topics.length
    || value.topics.some(topic => !topics.includes(topic))) return null;
  if (typeof value.area !== 'string' || value.area.length > 80) return null;
  const area = value.area.trim().normalize('NFC');
  if (area && !/^\d{5}$/.test(area)
    && !/^[\p{L}\p{M}][\p{L}\p{M}\s.\-'’()]*(?:,\s*[\p{L}\p{M}][\p{L}\p{M}\s.\-'’()]*)?$/u.test(area)) return null;
  if (/[\u0000-\u001f\u007f]/.test(area)) return null;
  return { topics: topics.filter(topic => value.topics.includes(topic)), area, consent_version: 1 };
}
