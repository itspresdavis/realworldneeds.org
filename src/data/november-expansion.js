// Bounded official-source review, 2026-11-25. No geocoded guesses or bed claims.
// Review scope, conflicting older addresses and reuse basis are in the review log.
const checked = '2026-11-25';
const dycd = 'https://www.nyc.gov/site/dycd/services/runaway-homeless-youth/borough-based-drop-in-centers.page';
const tb = 'https://www.nyc.gov/site/doh/services/tuberculosis-chest-centers.page';
const physical = ({ accessMode, routeLabel, ...record }) => ({
  country: 'United States', region: 'North America', kind: 'direct',
  lat: null, lng: null, locationPrecision: 'address', secondaryCategories: [],
  sourceKind: 'Official provider or public agency', lastChecked: checked,
  verificationMethod: 'Substantive official-page review of free access, eligibility, destination and intake; no on-site inspection',
  ...record,
  serviceAccess: [{
    id: 'access', label: routeLabel || record.name, categories: [record.category, ...(record.secondaryCategories || [])],
    mode: accessMode || 'intake', address: record.address,
    instructions: record.availabilityNote, eligibility: record.eligibility, hours: record.hours,
    sourceUrl: record.sourceUrl, reviewedAt: checked,
  }],
});

const youthCenters = [
  ['ali-forney-midtown', 'Ali Forney Center — Midtown drop-in', 'New York', '307 West 38th Street, New York, NY 10018', '212-206-0574', 'Open 24 hours daily.'],
  ['door-manhattan', 'The Door — Manhattan drop-in', 'New York', '555 Broome Street, New York, NY 10013', '646-690-8986', 'Monday–Friday 9 a.m.–6 p.m.; Saturday 10 a.m.–6 p.m.'],
  ['streetwork-harlem', 'Safe Horizon Streetwork — Harlem drop-in', 'New York', '209 West 125th Street, New York, NY 10027', '212-695-2220', 'Monday, Tuesday, Thursday–Sunday 10 a.m.–6 p.m.'],
  ['door-bronx', 'The Door — Bronx drop-in', 'Bronx', '2999 Third Avenue, Bronx, NY 10455', '646-230-1037', 'Open 24 hours daily.'],
  ['sco-brooklyn', 'SCO — Brooklyn youth drop-in', 'Brooklyn', '774 Rockaway Avenue, Brooklyn, NY', '718-685-3850', 'Open 24 hours daily.'],
  ['rising-ground-jamaica', 'Rising Ground — Jamaica drop-in', 'Jamaica', '165-13 Jamaica Avenue, 2nd floor, Jamaica, NY 11432', '718-526-2400 ext. 2080', 'Open 24 hours daily.'],
  ['rising-ground-far-rockaway', 'Rising Ground — Far Rockaway drop-in', 'Far Rockaway', '1600 Central Avenue, Far Rockaway, NY 11691', '646-518-1202', 'Monday–Thursday noon–8 p.m.; Friday 11 a.m.–7 p.m.; Saturday noon–8 p.m.'],
  ['project-hospitality-staten-island', 'Project Hospitality — youth drop-in', 'Staten Island', '27 Port Richmond Avenue, Staten Island, NY 10302', '718-876-4752', 'Open 24 hours daily.'],
].map(([id, name, city, address, phone, hours]) => physical({
  id: `nyc-youth-${id}`, name, city, address, phone, hours: `${hours} America/New_York local time; call to confirm.`,
  category: 'clothing', secondaryCategories: ['food', 'hygiene', 'referral'],
  accessMode: 'walk-in', routeLabel: 'Youth drop-in services', accessType: 'Youth drop-in center; call to confirm intake',
  costModel: 'free-eligible', costNote: 'Free services for young people ages 14–24',
  summary: 'A youth drop-in center for everyday essentials and help arranging further support.',
  services: ['Clothing', 'Food', 'Showers and laundry', 'Case management and crisis-service referrals'],
  eligibility: 'Young people ages 14–24. Call the center about intake and the support you need.',
  availabilityNote: 'Call to confirm opening hours and intake. This is a drop-in service, not a promise of an overnight bed; staff can help with crisis-service referrals.',
  sourceName: 'NYC Department of Youth and Community Development', sourceUrl: dycd,
  sourceDetail: 'Current DYCD runaway/homeless-youth location list; free access confirmed by NYC311: https://portal.311.nyc.gov/article/?kanumber=KA-01619 . Older family-directory addresses are not used. Brooklyn ZIP omitted because the city list appears inconsistent. No coordinates inferred.',
}));

const chestCenters = [
  ['morrisania', 'Morrisania', 'Bronx', '1309 Fulton Avenue, First Floor, Bronx, NY 10456', '718-838-6876'],
  ['fort-greene', 'Fort Greene', 'Brooklyn', '295 Flatbush Avenue Extension, Fourth Floor, Brooklyn, NY 11201', '718-249-1468'],
  ['corona', 'Corona', 'Queens', '34-33 Junction Boulevard, Queens, NY 11372', '718-396-5134'],
].map(([id, place, city, address, phone]) => physical({
  id: `nyc-tb-${id}`, name: `${place} Chest Center`, city, address, phone,
  category: 'health', costModel: 'free-eligible', costNote: 'Free TB care for eligible patients; no patient payments or copays',
  accessType: 'Call for a required appointment', routeLabel: 'TB clinic appointment',
  summary: 'Public tuberculosis evaluation and treatment by appointment.',
  services: ['TB evaluation', 'TB testing and treatment'],
  eligibility: 'TB risk or exposure; excludes routine work/school screening. Insurance is not required.',
  hours: 'Weekdays 8:30 a.m.–4:30 p.m., with monthly exceptions and closure dates on the source page.',
  availabilityNote: 'Arrange an appointment before travelling; check the dated closure list. Third Tuesdays open at 10 a.m.; last Thursdays normally close at noon. Insurance may be billed, but patients are not charged.',
  sourceName: 'NYC Health', sourceUrl: tb,
  sourceDetail: 'Clinic locations, eligibility and billing FAQ reviewed. The closed Washington Heights clinic is excluded. No coordinates inferred.',
}));

export const novemberExpansionResources = [
  ...youthCenters, ...chestCenters,
  physical({
    id: 'weill-cornell-community-clinic', name: 'Weill Cornell Community Clinic — primary care', city: 'New York',
    address: '505 East 70th Street, Helmsley Tower, 4th Floor, New York, NY 10065', phone: '646-962-9222',
    category: 'health', costModel: 'free-eligible', costNote: 'Free primary care for eligible uninsured New York City residents',
    accessType: 'Request an appointment online; no walk-ins', routeLabel: 'Primary care appointment',
    summary: 'Free primary-care appointments at a student-run clinic. New-patient appointments can take eight weeks or longer.',
    services: ['Primary care', 'Health education', 'Insurance eligibility screening'],
    eligibility: 'Uninsured New York City residents over 19, with household income below 400% of the federal poverty level. Confirm eligibility with the clinic.',
    hours: 'Monday evenings 5–8 p.m., by appointment only. America/New_York local time.',
    availabilityNote: 'Request an appointment before travelling. Enter through 505 East 70th Street and take the elevator to the fourth floor. This listing covers free primary care; prescriptions and outside specialist or imaging referrals can involve costs.',
    sourceName: 'Weill Cornell Community Clinic', sourceUrl: 'https://wccc.weillcornell.org/patients',
    sourceDetail: 'Eligibility and free-service scope reviewed on the patient page. Entrance, appointment hours and wait reviewed at https://wccc.weillcornell.org/about-us/contact-us . The mailing address is not the clinic entrance. No coordinates inferred.',
  }),
  physical({
    id: 'breaktime-boston-resource-hub', name: 'Breaktime Resource Hub', city: 'Boston',
    address: '63 Franklin Street, Boston, MA', category: 'clothing', secondaryCategories: ['hygiene'],
    costModel: 'free-eligible', costNote: 'Free drop-in essentials for young adults',
    accessType: 'Drop in; no appointment', accessMode: 'walk-in',
    summary: 'A place for young adults to wash clothes, take a shower and find professional clothing.',
    services: ['Professional clothing', 'Showers', 'Laundry', 'Hygiene supplies'],
    eligibility: 'Young adults; ask staff about access to individual services.',
    hours: 'Tuesday–Thursday 9 a.m.–4 p.m.; closed Friday–Monday. America/New_York local time.',
    availabilityNote: 'Check in with staff when you arrive. The wider building is opening in phases; this listing covers the Resource Hub only.',
    sourceName: 'Breaktime', sourceUrl: 'https://www.breaktime.org/resource-hub',
    sourceDetail: 'Provider confirms free drop-in access, current hours, street address and essentials. Future shelter/health services are not listed as available.',
  }),
  physical({
    id: 'rhode-island-free-clinic', name: 'Rhode Island Free Clinic', city: 'Providence',
    address: '655 Broad Street, Providence, RI 02907', phone: '401-274-6347 ext. 311',
    category: 'health', costModel: 'free-eligible', costNote: 'Free healthcare for eligible uninsured Rhode Island adults',
    accessType: 'Enrollment application and appointment; currently a waitlist',
    summary: 'Ongoing healthcare for adults who qualify. New patients join an enrollment waitlist.',
    services: ['Primary care', 'Specialty care', 'Medications', 'Dental and behavioral healthcare'],
    eligibility: 'Rhode Island residents 18 or older, uninsured, income below 250% of the federal poverty level. Bring photo ID, address evidence and income or unemployment documents; check the application requirements.',
    hours: 'Monday/Wednesday 8 a.m.–5 p.m.; Tuesday/Thursday 8 a.m.–8 p.m.; Friday 8 a.m.–noon. Extended hours on the fourth Monday and second Wednesday. Appointment required.',
    availabilityNote: 'Apply through the provider website first. No walk-ins; the current waitlist means care is not immediately available. Call for appointment arrangements.',
    sourceName: 'Rhode Island Free Clinic', sourceUrl: 'https://rifreeclinic.org/patients/become-a-patient/',
    sourceDetail: 'Provider enrollment page and its address footer reviewed for eligibility, free care, waitlist and hours. No referral-provider costs or coordinates inferred.',
  }),
];
