from pathlib import Path

path = Path("scripts/refresh-trussell-foodbanks.mjs")
text = path.read_text()
old = '''const output = `${header}export const trussellFoodbankMetadata = ${JSON.stringify(metadata, null, 2)};\\n\\nexport const trussellFoodbankResources = ${JSON.stringify(resources, null, 2)};\\n`;'''
new = '''const compactRows = resources.map((resource) => {
  const source = rawByUuid.get(resource.sourceRecordId);
  const record = source?.record || {};
  return [
    resource.sourceRecordId,
    resource.name,
    resource.city,
    resource.lat,
    resource.lng,
    resource.address,
    resource.phone || null,
    resource.email || null,
    resource.providerUrl,
    normalizeText(record.dcsStatusLabel),
    normalizeText(record.referralType),
    source?.page || 1
  ];
});
const runtime = `const FINDER_BASE = ${JSON.stringify(FINDER_BASE)};
const CHECKED_ON = ${JSON.stringify(checkedOn)};
const rows = ${JSON.stringify(compactRows)};

function fromRow(row) {
  const [uuid, name, city, lat, lng, address, phone, email, providerUrl, collectionStatus, referralType, sourcePage] = row;
  const referralInstruction = referralType === "telephone"
    ? "Call the food bank or an approved referral partner to arrange a voucher before collection."
    : "Use the provider page or an approved referral partner to arrange a voucher before collection.";
  return {
    id: \`trussell-\${uuid}\`,
    name,
    city,
    country: "United Kingdom",
    region: "Europe",
    lat,
    lng,
    category: "food",
    secondaryCategories: ["referral"],
    kind: "direct",
    locationPrecision: "exact",
    accessType: "Free emergency food parcel; Trussell voucher/referral required",
    costModel: "free-eligible",
    costNote: "Free emergency food parcel after an approved Trussell voucher/referral",
    address,
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    providerUrl,
    summary: "An official Trussell food-bank centre where people with an approved food-bank voucher can access a free emergency food parcel.",
    services: ["Free emergency food parcel with voucher/referral", "Food-bank referral guidance"],
    eligibility: "A food-bank voucher/referral is required. A local referral partner assesses need and issues a voucher before emergency food is collected.",
    availabilityNote: \`\${collectionStatus ? \`\${collectionStatus}. \` : ""}\${referralInstruction} Check the provider page or call before travel because collection times and local arrangements can change.\`,
    sourceName: "Trussell",
    sourceKind: "Official Trussell food-bank finder record",
    sourceUrl: \`\${FINDER_BASE}?lat=&lng=&page=\${sourcePage}\`,
    sourceDetail: "Trussell's official finder publishes the centre UUID, address, contact details, referral route, collection status, and map coordinates used for this listing.",
    datasetId: "trussell-food-bank-centres",
    sourceRecordId: uuid,
    verificationMethod: "official-network-snapshot",
    coordinateNote: "Coordinates are published for this centre in Trussell's official food-bank finder payload.",
    lastChecked: CHECKED_ON
  };
}

export const trussellFoodbankResources = rows.map(fromRow);`;
const output = `${header}export const trussellFoodbankMetadata = ${JSON.stringify(metadata, null, 2)};\\n\\n${runtime}\\n`;'''
if text.count(old) != 1:
    raise SystemExit(f"Expected one generator output block, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
print("Compacted Trussell generator output format.")
