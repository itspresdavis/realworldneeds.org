// Two clinic facts reviewed from the official CLUES finder, plus its national
// access information. Never use postal ylat/xlong as clinic coordinates.
const source = 'https://www.imssbienestar.gob.mx/02_ubica_clinica.html';
const registration = 'https://registro.imssbienestar.gob.mx/';
const checkedAt = '2026-11-07T05:50:09Z';
const evidence = (sourceUrl, scope) => ({ sourceUrl, checkedAt, scope, verification: 'source-reviewed' });
const clinics = [
  { id: 'imss-bienestar-tijuana-centro', sourceRecordId: 'BCIMB001731', name: 'IMSS-Bienestar — Tijuana', city: 'Tijuana', lat: 32.527386, lng: -117.03782, address: 'Calle Constitución 1641, entre 8va y 9na, Zona Centro, Tijuana, Baja California, 22000, México', phone: '664 238 1264', publishedHours: '07:00–20:00' },
  { id: 'imss-bienestar-rosarito-urbano', sourceRecordId: 'BCIMB001755', name: 'IMSS-Bienestar — Centro de Salud Urbano Playas de Rosarito', city: 'Playas de Rosarito', lat: 32.39742, lng: -117.060862, address: 'Calle Las Lomas Altas esquina La Bajada, sin número, Colonia Lomas de Rosarito, Playas de Rosarito, Baja California, 22705, México', phone: '661 100 3397', publishedHours: '07:00–14:30' },
];
export const imssBienestarResources = [
  ...clinics.map(({ publishedHours, ...clinic }) => ({
    ...clinic, country: 'Mexico', region: 'North America', kind: 'direct', locationPrecision: 'exact', category: 'health', secondaryCategories: [],
    datasetId: 'imss-bienestar-reviewed-clinics', verificationMethod: 'Reviewed official CLUES clinic facts and IMSS-Bienestar eligibility information', lastChecked: '2026-11-07',
    accessType: 'Clinic assessment; confirm intake and eligibility', costModel: 'free-eligible', costNote: 'Free IMSS-Bienestar health care for people without social security coverage; eligibility applies',
    eligibility: 'For people without social security coverage. Official registration asks for CURP, current address, photo, valid ID and contact details; confirm your eligibility and access with the provider.',
    summary: 'An official IMSS-Bienestar clinic for people without social security coverage. Check intake, service days and the care you need before travel.',
    services: ['Primary medical assessment', 'Referral to appropriate care'],
    hours: `Official clinic finder lists ${publishedHours}; days of operation are not supplied. America/Tijuana local time. Confirm the day and intake before travel.`,
    availabilityNote: 'Published clinic hours do not confirm appointments, medicine stock or immediate treatment. Days of operation and intake requirements for this clinic remain unconfirmed.',
    sourceName: 'IMSS-Bienestar', sourceKind: 'Official Mexican public health service', sourceUrl: source,
    sourceDetail: `Official clinic finder CLUES ${clinic.sourceRecordId}; clinic latitud/longitud, not postal reference coordinates. Eligibility and free-care terms: ${registration}. No operating days inferred.`,
    serviceAccess: [{
      id: 'clinic', label: 'Clinic access', categories: ['health'], mode: 'intake', directions: true, address: clinic.address, sourceUrl: source, reviewedAt: '2026-11-07',
      instructions: 'Use the official clinic finder and call this clinic to confirm service days and intake before travel. The provider describes a medical assessment with referral when needed.',
      eligibility: 'IMSS-Bienestar serves people without social security coverage. Review the official registration requirements; RWN does not collect registration documents.',
      hours: `The finder lists ${publishedHours} but does not publish operating days. Confirm before travel.`,
      contacts: [{ type: 'online', label: 'Official eligibility and registration information', url: registration }],
      fieldEvidence: { address: evidence(source, `CLUES ${clinic.sourceRecordId}: published clinic address and clinic coordinates, separate from postal centroid.`), hours: evidence(source, 'Published time range only; operating days not supplied, so no machine open/closed status.'), eligibility: evidence(registration, 'Free medical care for people without social security coverage; Baja California is listed among participating states.') },
    }],
  })),
  {
    id: 'imss-bienestar-mexico-finder', name: 'IMSS-Bienestar — official clinic finder and registration', country: 'Mexico', city: 'Mexico-wide', region: 'North America',
    kind: 'locator', locationPrecision: 'contact-only', lat: null, lng: null, category: 'referral', secondaryCategories: ['health'],
    accessType: 'Official online information and clinic finder', accessUrl: source, costModel: 'free-navigation', costNote: 'Free official information and clinic finder; medical-care eligibility applies',
    address: 'Online information for participating states in Mexico; no walk-in destination',
    coverageNote: 'Participating states include Baja California. The official finder locates clinics; this national information record is not a local physical service.',
    eligibility: 'For people without social security coverage. Check the official registration requirements and participating states before using the program.',
    summary: 'Find an IMSS-Bienestar clinic and read the official access and registration information for free health care for eligible people without social security coverage.',
    services: ['Official clinic finder', 'Health-care eligibility and registration information'],
    availabilityNote: 'An information page does not confirm appointments, clinic hours, medicine stock or immediate care. Review the selected clinic and contact the provider.',
    sourceName: 'IMSS-Bienestar', sourceKind: 'Official Mexican public health service', sourceUrl: registration,
    sourceDetail: 'The official registration page states the free-care eligibility and lists Baja California. The linked official clinic finder provides site information separately. No headquarters address is used as a care destination.',
    verificationMethod: 'Substantive review of official information and clinic-finder pages', lastChecked: '2026-11-07',
  },
];
