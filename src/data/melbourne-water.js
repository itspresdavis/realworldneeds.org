export const MELBOURNE_SOURCE = 'https://data.melbourne.vic.gov.au/explore/dataset/drinking-fountains/';
export const MELBOURNE_DATASET = 'melbourne-drinking-fountains';
export const MELBOURNE_LICENSE = 'https://creativecommons.org/licenses/by/4.0/legalcode';
const LICENSE = MELBOURNE_LICENSE;

// Shared facts are stored once; the generated rows retain every source-specific fact.
export function melbourneWaterRecord([id, place, address, lat, lng, refill, evaluationdate], reviewedAt, processedAt) {
    const sourceUrl = `${MELBOURNE_SOURCE}?refine.assetid=${encodeURIComponent(id)}`;
    return {
      id: `melbourne-water-${id}`, name: `${refill ? 'Water refill' : 'Drinking fountain'} — ${place}`,
      city: 'Melbourne', country: 'Australia', region: 'Oceania', category: 'water', secondaryCategories: [],
      kind: 'direct', locationPrecision: 'exact', lat, lng,
      coordinateNote: 'City of Melbourne asset coordinates; use the written location description to find the fixture.',
      address, accessType: 'Public drinking-water fixture', costModel: 'free', costNote: 'Free public drinking water',
      summary: `${refill ? 'A public bottle-refill tap' : 'A public drinking fountain'} at ${place}. Follow the location description to find it.`,
      services: [refill ? 'Drinking-water bottle refill' : 'Drinking water'],
      eligibility: 'Public drinking-water access; no account or purchase required.',
      hours: 'Opening hours are not supplied in the city dataset. Access may follow park or facility hours.',
      availabilityNote: 'The city inventory identifies this fixture, not live water flow. Maintenance, closures or site access can interrupt service; check the official map and any notices at the location.',
      sourceName: 'City of Melbourne', sourceKind: 'Official municipal open data', sourceUrl,
      sourceDetail: `City asset ${id}, adapted from Drinking fountains under CC BY 4.0 (${LICENSE}). RWN selects human drinking-water assets and writes access summaries. Source processing date ${processedAt} is not an inspection date.${evaluationdate ? ` Asset evaluation date: ${evaluationdate}; this is not a water-quality test.` : ''}`,
      datasetId: MELBOURNE_DATASET, sourceRecordId: id,
      verificationMethod: 'Reviewed city inventory, human-use subtype, ownership, coordinates and location description; no on-site inspection or live availability assertion',
      lastChecked: reviewedAt, sourceUpdatedAt: processedAt,
    };
}
