from pathlib import Path


def replace_once(path, old, new, label):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one source block in {path}, found {count}")
    path.write_text(text.replace(old, new, 1))

resources = Path("src/data/resources.js")
replace_once(
    resources,
    'import { newYorkWicResources } from "./generated/new-york-wic.js";\n',
    'import { newYorkWicResources } from "./generated/new-york-wic.js";\nimport { trussellFoodbankResources } from "./generated/trussell-foodbanks.js";\n',
    "Trussell import",
)
replace_once(
    resources,
    '  ...massachusettsWicResources,\n  ...newYorkWicResources\n];',
    '  ...massachusettsWicResources,\n  ...newYorkWicResources,\n  ...trussellFoodbankResources\n];',
    "Trussell resource spread",
)

live_sources = Path("src/data/live-sources.js")
registry_anchor = '''  {\n    id: "new-york-wic-sites",\n    title: "New York State WIC Program Site Information",\n    owner: "New York State Department of Health",\n    sourceUrl: "https://health.data.ny.gov/Health/Women-Infants-and-Children-WIC-Program-Site-Inform/g4i5-r6zx",\n    mode: "reviewed-open-data-snapshot",\n    updateFrequency: "Quarterly",\n    sourceUpdatedAt: "2026-04-30",\n    recordCount: 293,\n    auditedAt: "2026-08-05",\n    fields: ["state-published coordinates", "address", "phone", "permanent or temporary site type", "provider website when supplied"],\n    reuseBasis: "Official public state health open-data endpoint with dataset attribution."\n  }\n];'''
registry_replacement = '''  {\n    id: "new-york-wic-sites",\n    title: "New York State WIC Program Site Information",\n    owner: "New York State Department of Health",\n    sourceUrl: "https://health.data.ny.gov/Health/Women-Infants-and-Children-WIC-Program-Site-Inform/g4i5-r6zx",\n    mode: "reviewed-open-data-snapshot",\n    updateFrequency: "Quarterly",\n    sourceUpdatedAt: "2026-04-30",\n    recordCount: 293,\n    auditedAt: "2026-08-05",\n    fields: ["state-published coordinates", "address", "phone", "permanent or temporary site type", "provider website when supplied"],\n    reuseBasis: "Official public state health open-data endpoint with dataset attribution."\n  },\n  {\n    id: "trussell-food-bank-centres",\n    title: "Trussell food-bank centres",\n    owner: "Trussell",\n    sourceUrl: "https://www.trussell.org.uk/emergency-food/get-a-food-voucher/choose-a-foodbank",\n    mode: "reviewed-official-network-snapshot",\n    updateFrequency: "Refreshable from the current official Trussell finder; RWN's generator fails closed if the source becomes materially incomplete or changes format.",\n    recordCount: 1398,\n    sourceReportedRecordsAtAudit: 1408,\n    sourceParsedRecordsAtAudit: 1406,\n    excludedForPublicationAtAudit: 8,\n    auditedAt: "2026-08-07",\n    fields: ["Trussell-published coordinates", "public address", "town and postcode", "phone and email when supplied", "referral route", "collection or delivery status", "provider page"],\n    reuseBasis: "Official Trussell finder snapshot with record-level UUIDs and attribution. RWN excludes hidden-address records and records that fail exact-location or publication checks."\n  }\n];'''
replace_once(live_sources, registry_anchor, registry_replacement, "source registry")

app = Path("src/app.js")
replace_once(
    app,
    '''function bindEvents() {\n  const searchInput = document.getElementById("resourceSearch");\n  searchInput.addEventListener("input", (event) => {\n    state.query = event.target.value;\n    updateFilters();\n  });''',
    '''function bindEvents() {\n  const searchInput = document.getElementById("resourceSearch");\n  let pendingSearchValue = state.query;\n  let searchFilterFrame = null;\n  const flushSearchFilter = () => {\n    searchFilterFrame = null;\n    if (pendingSearchValue === state.query) return;\n    state.query = pendingSearchValue;\n    updateFilters();\n  };\n  const scheduleSearchFilter = (value) => {\n    pendingSearchValue = value;\n    if (searchFilterFrame !== null) return;\n    searchFilterFrame = requestAnimationFrame(flushSearchFilter);\n  };\n  searchInput.addEventListener("input", (event) => {\n    scheduleSearchFilter(event.target.value);\n  });''',
    "coalesced search input",
)
replace_once(
    app,
    '''  searchInput.addEventListener("keydown", (event) => {\n    if (event.key !== "Escape" || !state.query) return;\n    state.query = "";\n    searchInput.value = "";\n    updateFilters();\n  });''',
    '''  searchInput.addEventListener("keydown", (event) => {\n    if (event.key !== "Escape" || (!state.query && !pendingSearchValue)) return;\n    if (searchFilterFrame !== null) cancelAnimationFrame(searchFilterFrame);\n    searchFilterFrame = null;\n    pendingSearchValue = "";\n    state.query = "";\n    searchInput.value = "";\n    updateFilters();\n  });''',
    "search escape",
)
replace_once(
    app,
    '''  document.getElementById("clearSearch").addEventListener("click", () => {\n    state.query = "";\n    searchInput.value = "";\n    searchInput.focus();\n    updateFilters();\n  });''',
    '''  document.getElementById("clearSearch").addEventListener("click", () => {\n    if (searchFilterFrame !== null) cancelAnimationFrame(searchFilterFrame);\n    searchFilterFrame = null;\n    pendingSearchValue = "";\n    state.query = "";\n    searchInput.value = "";\n    searchInput.focus();\n    updateFilters();\n  });''',
    "search clear",
)

globe_test = Path("tests/globe.test.js")
replace_once(
    globe_test,
    '''  assert.equal(resources.length, 586);\n  assert.ok(resources.filter(isExactServiceSite).length >= 442);''',
    '''  assert.ok(resources.length >= 1900);\n  assert.ok(resources.filter(isExactServiceSite).length >= 1800);''',
    "catalog growth assertions",
)
replace_once(
    globe_test,
    '''  assert.equal(resources.filter((resource) => resource.datasetId === "new-york-wic-sites").length, 293);\n  assert.ok(resources.filter((resource) => resource.datasetId === "massachusetts-wic-locations").every((resource) => resource.hours));''',
    '''  assert.equal(resources.filter((resource) => resource.datasetId === "new-york-wic-sites").length, 293);\n  assert.equal(resources.filter((resource) => resource.datasetId === "trussell-food-bank-centres").length, 1398);\n  assert.ok(resources.filter((resource) => resource.datasetId === "massachusetts-wic-locations").every((resource) => resource.hours));''',
    "Trussell catalog assertion",
)

live_test = Path("tests/live-sources.test.js")
replace_once(
    live_test,
    '''  assert.equal(sourceRegistry.length, 3);\n  assert.equal(sourceRegistry.find((source) => source.id === "usda-summer-meals-2026").activeRecordsAtAudit, 17442);''',
    '''  assert.ok(sourceRegistry.length >= 4);\n  assert.equal(sourceRegistry.find((source) => source.id === "usda-summer-meals-2026").activeRecordsAtAudit, 17442);''',
    "registry growth assertion",
)
replace_once(
    live_test,
    '''  assert.equal(sourceRegistry.find((source) => source.id === "new-york-wic-sites").recordCount, 293);\n  assert.ok(sourceRegistry.every((source) => source.sourceUrl.startsWith("https://")));''',
    '''  assert.equal(sourceRegistry.find((source) => source.id === "new-york-wic-sites").recordCount, 293);\n  assert.equal(sourceRegistry.find((source) => source.id === "trussell-food-bank-centres").recordCount, 1398);\n  assert.ok(sourceRegistry.every((source) => source.sourceUrl.startsWith("https://")));''',
    "Trussell registry assertion",
)

print("Integrated Trussell data, coalesced rapid search input, and updated scale invariants.")
