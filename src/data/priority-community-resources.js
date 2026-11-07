// Bounded, reviewed factual additions. Never refreshed during a production build.
// Evidence, exclusions and reuse scope: docs/catalog-reviews/2026-11-07-priority-access.json.
const evidence = (sourceUrl, checkedAt, scope) => ({ sourceUrl, checkedAt, scope, verification: 'source-reviewed' });
const amosSource = 'https://amoshouse.com/what-we-do/food';
const tactSource = 'https://www.tactmealcenter.org/visit-us.html';

export const priorityCommunityResources = [
  {
    id: 'amos-house-providence-meals', name: 'Amos House Soup Kitchen', city: 'Providence', country: 'United States', region: 'North America',
    lat: null, lng: null, locationPrecision: 'address', kind: 'direct', category: 'food', secondaryCategories: [],
    accessType: 'Walk-in meals; no ID or proof of need', costModel: 'free', costNote: 'Free meals; no identification or proof of need required',
    address: '460 Pine Street, Providence, RI 02907', phone: '401-272-0220',
    summary: 'Free breakfast and lunch in the Amos House dining hall, with a to-go option. Saturday lunch has a monthly closure.',
    services: ['Free breakfast', 'Free lunch', 'To-go meals'],
    eligibility: 'People in need of a meal; no identification or proof of need required.',
    hours: 'Monday–Friday: breakfast 7–8 a.m., lunch 11 a.m.–12:30 p.m. Saturday: lunch 11 a.m.–noon, except the first Saturday of each month, when closed. America/New_York local time.',
    availabilityNote: 'Closed the first Saturday of each month. Published meal times do not guarantee current food availability; check the official source for changes.',
    sourceName: 'Amos House', sourceKind: 'Official provider', sourceUrl: amosSource,
    sourceDetail: 'The official Food page states that meals are free, gives service hours and the first-Saturday closure, and requires no ID or proof of need. The published street address is used without invented coordinates.',
    verificationMethod: 'Substantive official-page review of cost, destination, meal times and eligibility', lastChecked: '2026-11-07',
    serviceAccess: [
      {
        id: 'meals', label: 'Meal service', categories: ['food'], mode: 'walk-in', address: '460 Pine Street, Providence, RI 02907', sourceUrl: amosSource, reviewedAt: '2026-11-07',
        instructions: 'Meals can be eaten in the dining hall or taken to go. Saturday lunch is closed on the first Saturday of every month.',
        eligibility: 'No identification or proof of need required.',
        schedule: { timeZone: 'America/New_York', complete: false, weekly: [{ days: [1, 2, 3, 4, 5], opens: '07:00', closes: '08:00' }, { days: [1, 2, 3, 4, 5], opens: '11:00', closes: '12:30' }], text: 'Monday–Friday: breakfast 7–8 a.m.; lunch 11 a.m.–12:30 p.m. Saturday lunch 11 a.m.–noon except the first Saturday of each month. Saturday status requires checking this monthly exception.' },
        fieldEvidence: {
          schedule: evidence(amosSource, '2026-11-07T05:39:17Z', 'Published weekday intervals and Saturday monthly exception. Machine intervals cover weekdays only.'),
          address: evidence(amosSource, '2026-11-07T05:39:17Z', '460 Pine Street physical meal-service address; coordinates not verified.'),
          eligibility: evidence(amosSource, '2026-11-07T05:39:17Z', 'Free meals without identification or proof of need.'),
        },
      },
    ],
  },
  {
    id: 'taunton-community-table-meals', name: 'Taunton Area Community Table', city: 'Taunton', country: 'United States', region: 'North America',
    lat: null, lng: null, locationPrecision: 'address', kind: 'direct', category: 'food', secondaryCategories: [],
    accessType: 'Walk-in meals; no paperwork or ID', costModel: 'free', costNote: 'All meals are free; no paperwork or ID required',
    address: '378 Bay Street, Taunton, MA 02780', phone: '508-386-3807',
    summary: 'A community meal center with weekday lunches and a family dinner on the last Thursday of each month. All are welcome.',
    services: ['Free sit-down lunch', 'To-go lunch', 'Monthly family dinner'],
    eligibility: 'All are welcome; no paperwork or ID required.',
    hours: 'Monday–Thursday: sit-down lunch 11:15 a.m.–12:30 p.m.; to-go meals 12:15–12:30 p.m. Last Thursday of each month: dinner 5–6 p.m., doors open 4:30 p.m. America/New_York local time.',
    availabilityNote: 'Use the meal-center address, not the mailing PO Box. The evening family dinner is monthly, not every Thursday. Check the official Visit Us page before travel.',
    sourceName: 'Taunton Area Community Table', sourceKind: 'Official provider', sourceUrl: tactSource,
    sourceDetail: 'The official Visit Us page labels meal times updated July 2026, gives the meal-center address and church-annex entrance, and explicitly states free meals with no paperwork or ID. No coordinates or additional dates are inferred.',
    verificationMethod: 'Substantive official-page review of cost, destination, meal times and eligibility', lastChecked: '2026-11-07',
    serviceAccess: [
      {
        id: 'weekday-lunch', label: 'Weekday lunch', categories: ['food'], mode: 'walk-in', address: '378 Bay Street, Taunton, MA 02780', sourceUrl: tactSource, reviewedAt: '2026-11-07',
        instructions: 'Sit-down lunch Monday–Thursday, 11:15 a.m.–12:30 p.m. To-go meals are served 12:15–12:30 p.m.',
        entrance: "Meal center in the annex of the former St John's Parish Church. Do not use the mailing PO Box as a destination.",
        eligibility: 'All are welcome; no paperwork or ID required.',
        schedule: { timeZone: 'America/New_York', complete: true, weekly: [{ days: [1, 2, 3, 4], opens: '11:15', closes: '12:30' }], text: 'Monday–Thursday, 11:15 a.m.–12:30 p.m.; to-go pickup 12:15–12:30 p.m.' },
        fieldEvidence: {
          schedule: evidence(tactSource, '2026-11-07T05:42:59Z', 'Weekday lunch and separate to-go interval; page labels the schedule updated July 2026.'),
          entrance: evidence(tactSource, '2026-11-07T05:42:59Z', 'Meal-center street address and former church annex, distinguished from mailing address.'),
          eligibility: evidence(tactSource, '2026-11-07T05:42:59Z', 'All meals free; all welcome; no paperwork or identification.'),
        },
      },
      {
        id: 'monthly-dinner', label: 'Monthly family dinner', categories: ['food'], mode: 'intake', address: '378 Bay Street, Taunton, MA 02780', sourceUrl: tactSource, reviewedAt: '2026-11-07',
        instructions: 'Last Thursday of each month only. Check the official source for the next date.', hours: 'Last Thursday of each month: doors open 4:30 p.m.; dinner 5–6 p.m.',
        eligibility: 'All are welcome; families are especially encouraged. No paperwork or ID required.',
        fieldEvidence: { instructions: evidence(tactSource, '2026-11-07T05:42:59Z', 'Recurring monthly dinner description; no exact date or exception inferred.') },
      },
    ],
  },
];
