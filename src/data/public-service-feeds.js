export const TITLE_X_DATASET = 'hhs-title-x-clinics';
export const PHILLY_FOOD_DATASET = 'philadelphia-free-food';
export const TITLE_X_POLICY = 'https://opa.hhs.gov/sites/default/files/2025-08/title-x-family-planning-program-2025.pdf';
export const PHILLY_SOURCE = 'https://opendataphilly.org/datasets/free-food-and-meal-sites/';

// Store shared program facts once. Coordinates and contact details remain
// publisher facts, while summaries describe only the supported free service.
export function titleXRecord([id, name, street, city, state, zip, lat, lng, phone], reviewedAt) {
  return {
    id: `title-x-${id}`, name: `${name} — Title X`, city, administrativeArea: state,
    country: state === 'PR' ? 'Puerto Rico' : state === 'VI' ? 'U.S. Virgin Islands' : 'United States',
    region: 'North America', category: 'health', secondaryCategories: [],
    kind: 'direct', locationPrecision: 'exact', lat, lng,
    coordinateNote: 'Physical clinic coordinates from the HHS public finder; confirm the entrance when arranging care.',
    address: `${street}, ${city}, ${state} ${zip}`,
    ...(phone ? { phone } : {}),
    accessType: 'Call about Title X eligibility and an appointment',
    costModel: 'free-eligible', costNote: 'Free Title X services for clients with family income at or below 100% of the federal poverty level.',
    summary: 'Family-planning care through the federal Title X program. Ask this clinic about the care you need and eligibility for no-cost services.',
    services: ['Title X family-planning services'],
    eligibility: 'The no-cost route covers Title X services for clients with family income at or below 100% of the federal poverty level. Ask the clinic about income assessment, age requirements and available services. Other clinic care is outside this listing.',
    hours: 'Hours are not included in this imported finder index. Open the official clinic page or call before travelling.',
    availabilityNote: 'Arrange care with the clinic before travelling. Ask specifically for Title X services and confirm no-cost eligibility. The program does not make every service at this facility free; other care and outside referrals may involve costs. This directory does not confirm appointment availability.',
    sourceName: 'HHS Office of Population Affairs', sourceKind: 'Official federal clinic finder',
    sourceUrl: `https://reproductivehealthservices.gov/search-results/${id}`,
    sourceDetail: `Factual physical-site and contact data from the HHS public Title X finder; original RWN summary. Federal program cost policy: ${TITLE_X_POLICY}. No logos, photographs or provider descriptions copied. Finder membership was reviewed on ${reviewedAt}; the index does not supply a per-clinic update date, hours or a complete eligibility assessment.`,
    datasetId: TITLE_X_DATASET, sourceRecordId: id, lastChecked: reviewedAt,
    verificationMethod: 'Reviewed current public federal finder membership, physical address, source coordinates and program no-cost policy; duplicate candidates held; no phone or on-site verification',
  };
}

export function phillyFoodRecord([id, name, address, zip, lat, lng, phone, type, hours, eligibility], reviewedAt, sourceUpdatedAt) {
  return {
    id: `philly-food-${id}`, name, city: 'Philadelphia', administrativeArea: 'PA', country: 'United States', region: 'North America',
    category: 'food', secondaryCategories: [], kind: 'direct', locationPrecision: 'exact', lat, lng,
    coordinateNote: 'City of Philadelphia source coordinates; confirm the entrance and distribution point with the provider.',
    address: `${address}, Philadelphia, PA ${zip}`, ...(phone ? { phone } : {}),
    accessType: 'Check the distribution schedule and intake before visiting',
    costModel: 'free-eligible', costNote: 'Free food through the city-listed program; site eligibility and distribution rules may apply.',
    summary: type === 'General Meal Site' ? 'A free meal site listed by the City of Philadelphia.' : 'A free food distribution site listed by the City of Philadelphia.',
    services: [type === 'General Meal Site' ? 'Free meals' : 'Free food'], hours, eligibility,
    availabilityNote: 'Confirm the schedule, intake requirements and supplies before travelling. Listed times are local Philadelphia time, not a promise the site is open now. Follow any day-of-month exceptions. No live food-stock information is available.',
    sourceName: 'City of Philadelphia', sourceKind: 'Official municipal open data', sourceUrl: 'https://www.phila.gov/food/',
    sourceDetail: `City of Philadelphia Free Food and Meal Sites, source object ${id}: ${PHILLY_SOURCE}. City open-data terms apply; supplied as is without warranty. RWN selects active, nonseasonal food and general-meal sites, preserves schedule exceptions and writes original summaries. The dataset edit date is not an individual provider verification date.`,
    datasetId: PHILLY_FOOD_DATASET, sourceRecordId: String(id), lastChecked: reviewedAt, sourceUpdatedAt,
    verificationMethod: 'Reviewed city open-data status, closure flags, service type, address, coordinates and distribution schedule; no phone or on-site verification',
  };
}
