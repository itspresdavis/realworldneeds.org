const REVIEW_DATE = "2026-08-05";

const reviewed = (resource) => ({ lastChecked: REVIEW_DATE, ...resource });

const locator = (resource) => reviewed({
  category: "referral",
  secondaryCategories: [],
  kind: "locator",
  locationPrecision: "coverage",
  accessType: "Official online locator",
  costNote: "Free to search; provider rules vary",
  ...resource
});

const direct = (resource) => reviewed({
  kind: "direct",
  locationPrecision: "exact",
  coordinateNote: "Official service address; map point independently checked against OpenStreetMap geocoding on August 5, 2026.",
  ...resource
});

const officialLocatorExpansion = [
  locator({
    id: "unhcr-help-country-directory",
    name: "UNHCR HELP country directory",
    city: "Global",
    country: "Global",
    region: "Global",
    lat: 12,
    lng: 8,
    category: "referral",
    secondaryCategories: ["shelter", "health"],
    accessType: "Official country directory",
    costNote: "Free official information",
    address: "Online directory of UNHCR HELP country pages",
    summary: "UNHCR's official directory of country HELP pages for refugees, asylum-seekers, and stateless people, including rights, contacts, and locally available support.",
    services: ["Country HELP directory", "Asylum and protection guidance", "Local contact options"],
    availabilityNote: "Open the official directory and choose a country. Eligibility and available programs depend on personal circumstances and the current country page.",
    sourceName: "UNHCR HELP",
    sourceKind: "United Nations country help directory",
    sourceUrl: "https://help.unhcr.org/countries/",
    sourceDetail: "UNHCR publishes this directory of HELP pages for more than 130 countries. Checked 20 October 2026. The live country page is the authority for contacts, eligibility, and current services.",
    coverageNote: "Global directory of country guidance. The map marker is not an office or service address.",
    lastChecked: "2026-10-20"
  }),
  locator({
    id: "hrsa-health-center-finder", name: "HRSA Find a Health Center", city: "United States", country: "United States", region: "North America", lat: 39.8283, lng: -98.5795,
    category: "health", secondaryCategories: ["referral"], address: "Nationwide search covering all U.S. states, territories, and the District of Columbia",
    summary: "The U.S. government finder for federally funded community health centers providing medical, dental, behavioral-health, and support services regardless of ability to pay.",
    services: ["Primary medical care", "Dental and behavioral health", "Income-adjusted fees", "Contact information and directions"],
    availabilityNote: "Health centers serve everyone, but charges may use an income-based sliding scale. Search the live tool and contact the selected clinic before visiting.",
    sourceName: "U.S. Health Resources and Services Administration", sourceKind: "Government service locator", sourceUrl: "https://findahealthcenter.hrsa.gov/",
    sourceDetail: "HRSA states that its funded program includes more than 16,200 service sites and that health centers serve people even when they cannot pay.", coverageNote: "More than 16,200 health-center service sites."
  }),
  locator({
    id: "boston-homeless-services", name: "Boston Homeless Services Directory", city: "Boston", country: "United States", region: "North America", lat: 42.3601, lng: -71.0589,
    secondaryCategories: ["shelter", "food", "hygiene", "clothing", "health"], address: "Citywide official directory for Boston, Massachusetts",
    summary: "Boston's official list of emergency shelters, daytime services, meals, showers, laundry, clothing, health care, outreach, and youth and family programs.",
    services: ["Emergency shelter", "Meals and clothing", "Showers and laundry", "Health care and outreach"],
    availabilityNote: "The city page lists access rules, addresses, and phone numbers. Contact the provider directly because capacity and intake conditions change.",
    sourceName: "City of Boston", sourceKind: "Official city service directory", sourceUrl: "https://www.boston.gov/departments/housing/services-those-experiencing-homeless",
    sourceDetail: "Boston publishes provider names, service descriptions, addresses, and phone numbers in one maintained public directory.", coverageNote: "Citywide provider directory; marker represents Boston."
  }),
  locator({
    id: "toronto-homeless-help", name: "Toronto Homeless Help", city: "Toronto", country: "Canada", region: "North America", lat: 43.6532, lng: -79.3832,
    secondaryCategories: ["shelter", "food", "hygiene", "health"], address: "Citywide services and Central Intake for Toronto",
    phone: "416-338-4766", summary: "Toronto's official starting point for shelters, 24-hour respite, drop-ins, public showers, outreach, warming centres, and housing support.",
    services: ["Emergency shelter intake", "Meals and respite", "Drop-ins and public showers", "Street outreach and housing help"],
    availabilityNote: "Call Central Intake for emergency shelter or 311 for outreach. Seasonal services open only when activated.",
    sourceName: "City of Toronto", sourceKind: "Official city service directory", sourceUrl: "https://www.toronto.ca/community-people/housing-shelter/homeless-help/",
    sourceDetail: "The City of Toronto maintains this entry point and publishes current program links and 24-hour contact numbers.", coverageNote: "Citywide directory; marker represents Toronto."
  }),
  locator({
    id: "vancouver-homeless-services", name: "Vancouver Homelessness Services", city: "Vancouver", country: "Canada", region: "North America", lat: 49.2827, lng: -123.1207,
    secondaryCategories: ["shelter", "food", "hygiene", "health"], address: "Citywide homelessness services for Vancouver",
    summary: "Vancouver's official hub for shelters, free or low-cost food, outreach, showers, laundry, community centres, and other homelessness resources.",
    services: ["Shelter information", "Free and low-cost meals", "Showers and laundry", "Community centres and outreach"],
    availabilityNote: "Open each linked city service for its latest address, hours, fees, eligibility, and seasonal status.",
    sourceName: "City of Vancouver", sourceKind: "Official city service directory", sourceUrl: "https://vancouver.ca/people-programs/financial-aid.aspx",
    sourceDetail: "The city describes and links its homelessness resources and social-serving community centres.", coverageNote: "Citywide directory; marker represents Vancouver."
  }),
  locator({
    id: "seattle-cid-resource-guide", name: "Seattle Essential Services Guide", city: "Seattle", country: "United States", region: "North America", lat: 47.6062, lng: -122.3321,
    secondaryCategories: ["food", "shelter", "hygiene", "clothing", "health"], address: "City resource guide for Seattle's Chinatown–International District and nearby services",
    summary: "A City of Seattle guide to day centres, free showers, food banks, clothing, health support, shelter, and public benefits.",
    services: ["Free showers and hygiene", "Food banks and meals", "Clothing and supplies", "Shelter and public benefits"],
    availabilityNote: "Program hours and eligibility vary. Use the city guide to identify a service, then confirm through that provider.",
    sourceName: "City of Seattle", sourceKind: "Official city resource guide", sourceUrl: "https://www.seattle.gov/human-services/reports-and-data/addressing-homelessness/cid-resource-guide",
    sourceDetail: "Seattle Human Services publishes and maintains this multi-category resource guide.", coverageNote: "City resource guide; marker represents Seattle."
  }),
  locator({
    id: "homeless-link-england", name: "Homeless England Service Search", city: "England-wide", country: "United Kingdom", region: "Europe", lat: 52.3555, lng: -1.1743,
    secondaryCategories: ["shelter", "food", "hygiene", "health"], address: "Online directory covering homelessness services in England",
    summary: "Homeless Link's searchable database of accommodation, day centres, advice, health, meals, and specialist homelessness services.",
    services: ["Accommodation search", "Day centres", "Meals and practical support", "Advice and health services"],
    availabilityNote: "Each result has its own eligibility, referral, capacity, and opening requirements; verify the selected listing before travel.",
    sourceName: "Homeless Link", sourceKind: "Official nonprofit service directory", sourceUrl: "https://homeless.org.uk/homeless-england/",
    sourceDetail: "Homeless Link describes Homeless England as its comprehensive database of homelessness services.", coverageNote: "England-wide live directory; marker is geographic context."
  }),
  locator({
    id: "govuk-homeless-council-help", name: "UK Council Homelessness Help", city: "United Kingdom", country: "United Kingdom", region: "Europe", lat: 54.5, lng: -3.4,
    category: "shelter", secondaryCategories: ["referral"], address: "Government guidance and local-council finder",
    summary: "Official guidance for asking a local council for help when homeless or at risk, including emergency accommodation pathways.",
    services: ["Local council finder", "Homelessness application guidance", "Emergency housing information"],
    availabilityNote: "Legal duties and eligibility differ across UK nations and personal circumstances. Follow the country-specific links on GOV.UK.",
    sourceName: "GOV.UK", sourceKind: "Government guidance", sourceUrl: "https://www.gov.uk/homelessness-help-from-council",
    sourceDetail: "GOV.UK explains how to contact the relevant council and what help may be available.", coverageNote: "National guidance; no physical service is located at the marker."
  }),
  locator({
    id: "streetlink-england-wales", name: "StreetLink", city: "England and Wales", country: "United Kingdom", region: "Europe", lat: 52.4, lng: -1.6,
    category: "shelter", secondaryCategories: ["referral"], accessType: "Online rough-sleeping alert", address: "Online platform covering England and Wales",
    summary: "A platform that connects people sleeping rough in England and Wales with outreach support from local authorities and charities.",
    services: ["Rough-sleeping alert", "Local outreach connection", "Follow-up through the platform"],
    availabilityNote: "StreetLink is not emergency dispatch or a shelter booking service. Use emergency services when someone is in immediate danger.",
    sourceName: "StreetLink", sourceKind: "Official outreach platform", sourceUrl: "https://thestreetlink.org.uk/about",
    sourceDetail: "StreetLink's official page explains its connection between rough sleepers and local outreach support.", coverageNote: "England and Wales; marker is geographic context."
  }),
  locator({
    id: "shelter-england-helpline", name: "Shelter England Emergency Helpline", city: "England-wide", country: "United Kingdom", region: "Europe", lat: 52.3555, lng: -1.1743,
    category: "shelter", secondaryCategories: ["referral"], accessType: "Free housing helpline and online guidance", costNote: "Free advice",
    address: "England-wide phone and online service", summary: "Free urgent housing advice for people who are homeless, have nowhere to stay, or are at risk of harm or abuse at home.",
    services: ["Emergency housing advice", "Homelessness rights", "Council-help guidance", "Housing problem support"],
    availabilityNote: "Shelter provides advice rather than guaranteeing a bed. The helpline serves England; use linked services for Scotland, Wales, or Northern Ireland.",
    sourceName: "Shelter England", sourceKind: "Official nonprofit helpline", sourceUrl: "https://england.shelter.org.uk/get_help/helpline",
    sourceDetail: "Shelter's official helpline page describes free urgent advice and current access conditions.", coverageNote: "England-wide helpline; no physical service at the marker."
  }),
  locator({
    id: "tafel-germany-finder", name: "Tafel Germany Finder", city: "Germany-wide", country: "Germany", region: "Europe", lat: 51.1657, lng: 10.4515,
    category: "food", secondaryCategories: ["referral"], address: "Nationwide food-bank finder for Germany",
    summary: "The official search for local Tafel food banks distributing rescued food to people experiencing poverty.",
    services: ["Nearest Tafel search", "Food distribution", "Local eligibility and registration information"],
    availabilityNote: "Local Tafeln set their own proof, registration, schedules, and capacity rules. Search by town or postal code and contact the location first.",
    sourceName: "Tafel Deutschland", sourceKind: "Official nonprofit network", sourceUrl: "https://www.tafel.de/",
    sourceDetail: "Tafel Deutschland reports more than 980 local Tafeln and provides a location search.", coverageNote: "More than 980 food banks across Germany."
  }),
  locator({
    id: "restos-du-coeur-france", name: "Restos du Cœur Local Associations", city: "France-wide", country: "France", region: "Europe", lat: 46.2276, lng: 2.2137,
    category: "food", secondaryCategories: ["referral", "clothing", "health"], address: "Departmental association finder across France",
    summary: "The official Restos du Cœur network routes people to nearby food assistance and broader social support across France.",
    services: ["Food assistance", "Local association finder", "Welcome and social support", "Referrals to other help"],
    availabilityNote: "Registration, documents, distribution dates, and available services vary by local association; contact the selected association.",
    sourceName: "Les Restos du Cœur", sourceKind: "Official nonprofit network", sourceUrl: "https://www.restosducoeur.org/associations-departementales/",
    sourceDetail: "The official network page lists departmental associations throughout France.", coverageNote: "Nationwide association finder; marker is geographic context."
  }),
  locator({
    id: "spain-social-services-map", name: "Spain Social Services Map", city: "Spain-wide", country: "Spain", region: "Europe", lat: 40.4168, lng: -3.7038,
    secondaryCategories: ["food", "shelter", "health", "clothing"], address: "Interactive government map of regional social services",
    summary: "Spain's official national map linking people to regional social-service systems and citizen assistance.",
    services: ["Regional social services", "Local assistance pathways", "Public-service contacts"],
    availabilityNote: "Programs, eligibility, languages, and appointments are managed by each autonomous community.",
    sourceName: "Spain Ministry of Social Rights", sourceKind: "Government service map", sourceUrl: "https://www.dsca.gob.es/es/servicio-a-la-ciudadania/informacion-atencion-al-ciudadano/servicios-sociales-autonomicos",
    sourceDetail: "The ministry publishes an interactive map linking to autonomous-community social services.", coverageNote: "Nationwide regional-service gateway; marker is geographic context."
  }),
  locator({
    id: "food-banks-canada-finder", name: "Food Banks Canada Finder", city: "Canada-wide", country: "Canada", region: "North America", lat: 56.1304, lng: -106.3468,
    category: "food", secondaryCategories: ["referral"], address: "Nationwide food-bank finder for Canada",
    summary: "Food Banks Canada's official finder for nearby food banks, with a reminder to contact the location or call 211 for smaller local services.",
    services: ["Food-bank search", "Local food support", "Directions to provider information"],
    availabilityNote: "Registration and schedules differ by food bank. Confirm eligibility, service area, and current hours directly.",
    sourceName: "Food Banks Canada", sourceKind: "Official nonprofit network", sourceUrl: "https://hungercount.foodbankscanada.ca/find-a-food-bank/",
    sourceDetail: "Food Banks Canada maintains this national finder and directs users to the nearest member or 211.", coverageNote: "Canada-wide finder; marker is geographic context."
  }),
  locator({
    id: "orange-sky-australia", name: "Orange Sky Service Locator", city: "Australia-wide", country: "Australia", region: "Oceania", lat: -25.2744, lng: 133.7751,
    category: "hygiene", secondaryCategories: ["referral"], address: "Mobile laundry and shower services across Australia",
    summary: "A nonprofit network providing free mobile laundry and shower services to people experiencing homelessness or hardship.",
    services: ["Free mobile laundry", "Mobile showers at selected shifts", "Conversation and connection", "Live service-location search"],
    availabilityNote: "Mobile shifts and service capacity change. Use Orange Sky's current location information immediately before travelling.",
    sourceName: "Orange Sky Australia", sourceKind: "Official nonprofit mobile-service network", sourceUrl: "https://orangesky.org.au/",
    sourceDetail: "Orange Sky's official site describes free mobile laundry and shower services across Australia.", coverageNote: "Mobile services across Australia; marker is geographic context."
  }),
  locator({
    id: "nz-family-services-directory", name: "New Zealand Family Services Directory", city: "New Zealand-wide", country: "New Zealand", region: "Oceania", lat: -40.9006, lng: 174.886,
    secondaryCategories: ["food", "shelter", "health", "clothing", "hygiene"], address: "Government directory covering New Zealand",
    summary: "A New Zealand government search for family and community providers, including basic needs, health, housing, food banks, and crisis support.",
    services: ["Basic-needs services", "Family and community support", "Health and housing providers", "Location and access details"],
    availabilityNote: "Each provider controls its services and eligibility. Review the listing's update date and confirm directly before travel.",
    sourceName: "New Zealand Ministry of Social Development", sourceKind: "Government service directory", sourceUrl: "https://www.familyservices.govt.nz/directory/",
    sourceDetail: "The Ministry describes the directory as a public database connecting people to thousands of family and community service providers.", coverageNote: "More than 5,000 local service records, including over 1,300 basic-needs records."
  }),
  locator({
    id: "mymizu-water-refill", name: "mymizu Free Water Refill Map", city: "Worldwide", country: "Global", region: "Global", lat: 35.6762, lng: 139.6503,
    category: "water", secondaryCategories: ["referral"], accessType: "Free web and mobile refill map", costNote: "Free water refills at listed spots",
    address: "Worldwide web and app locator", summary: "A global map of public fountains and participating businesses that provide free drinking-water refills.",
    services: ["Nearest free refill point", "Public drinking fountains", "Participating refill businesses", "Directions"],
    availabilityNote: "Some locations are community-contributed. Check recent details and ask staff before relying on a business refill point.",
    sourceName: "mymizu / Social Innovation Japan", sourceKind: "Official nonprofit refill platform", sourceUrl: "https://www.mymizu.co/home-en/",
    sourceDetail: "mymizu states that its free app maps more than 200,000 refill spots worldwide.", coverageNote: "More than 200,000 refill points worldwide; marker represents the platform's origin."
  }),
  locator({
    id: "refill-return-water", name: "Refill Return", city: "United Kingdom and global network", country: "Global", region: "Global", lat: 51.4545, lng: -2.5879,
    category: "water", secondaryCategories: ["referral"], accessType: "Free refill-location app", costNote: "Free tap-water refills at participating points",
    address: "App-based refill network originating in the United Kingdom", summary: "A free app connecting people with public taps and participating refill locations, including a large UK network.",
    services: ["Free tap-water locations", "Public tap search", "Participating business refills", "Map directions"],
    availabilityNote: "The app may prompt for an account after limited searches. Confirm that a participating location is open before travelling.",
    sourceName: "Refill Return", sourceKind: "Official refill network", sourceUrl: "https://www.refill.org.uk/about",
    sourceDetail: "The official campaign page describes more than 30,000 public taps in its UK network and a broader global refill map.", coverageNote: "More than 30,000 UK public taps plus global refill locations."
  }),
  locator({
    id: "sf-free-water-map", name: "San Francisco Free Water and Restroom Map", city: "San Francisco", country: "United States", region: "North America", lat: 37.7749, lng: -122.4194,
    category: "water", secondaryCategories: ["hygiene", "referral"], address: "Citywide public drinking-water and restroom map",
    summary: "San Francisco's official map of free, tested drinking water and public restroom locations.",
    services: ["Free drinking water", "Public restroom locations", "City map and directions"],
    availabilityNote: "Public facilities may close temporarily for maintenance or operating conditions; check the live map.",
    sourceName: "San Francisco Public Utilities Commission", sourceKind: "Official city map", sourceUrl: "https://www.sfpuc.gov/learning/how-you-can-help/free-drinktap-drinking-water-and-restroom-map",
    sourceDetail: "SFPUC publishes this map and states that listed drinking water is tested, safe, and free.", coverageNote: "Citywide facility map; marker represents San Francisco."
  }),
  locator({
    id: "food-bank-network-nigeria", name: "Food Bank Network Nigeria", city: "Nigeria-wide", country: "Nigeria", region: "Africa", lat: 9.082, lng: 8.6753,
    category: "food", secondaryCategories: ["referral"], accessType: "Partner food-bank network", address: "Coalition of food banks, pantries, and nonprofit partners across Nigeria",
    summary: "A Lagos Food Bank initiative connecting a national coalition of food banks and trusted nonprofits providing food grants and relief packages.",
    services: ["Partner food banks", "Food and relief packages", "Community distributions", "Referral to network organizations"],
    availabilityNote: "This is a partner network, not a guaranteed walk-in pantry. Contact the network for the appropriate local access route.",
    sourceName: "Food Bank Network Nigeria", sourceKind: "Official nonprofit network", sourceUrl: "https://foodbanknetworknigeria.org/",
    sourceDetail: "The network reports more than 150 partner food banks, pantries, and nonprofits across Nigeria.", coverageNote: "More than 150 partner organizations; marker is geographic context."
  }),
  locator({
    id: "food-banking-kenya", name: "Food Banking Kenya", city: "Kenya-wide", country: "Kenya", region: "Africa", lat: -1.2921, lng: 36.8219,
    category: "food", secondaryCategories: ["referral"], accessType: "Community-agency food network", address: "Food recovery and community partner network in Kenya",
    summary: "A certified food-bank network recovering food and distributing it through community service agencies in Kenya.",
    services: ["Food assistance through partners", "Community distributions", "School and nutrition support", "Food recovery"],
    availabilityNote: "The food bank is not presented as a universal walk-in pantry. Contact it for the current partner or program serving your area.",
    sourceName: "Food Banking Kenya", sourceKind: "Official nonprofit network", sourceUrl: "https://foodbankingkenya.org/",
    sourceDetail: "Food Banking Kenya and the Global FoodBanking Network describe its certified partner-based food assistance work.", coverageNote: "Partner network across Kenya; marker represents Nairobi."
  }),
  locator({
    id: "hong-kong-short-term-food", name: "Hong Kong Short-term Food Assistance", city: "Hong Kong", country: "Hong Kong", region: "Asia", lat: 22.3193, lng: 114.1694,
    category: "food", secondaryCategories: ["referral"], accessType: "Regional service-team contacts", costNote: "Free for approved applicants",
    address: "Service teams covering districts across Hong Kong", summary: "Government-funded nonprofit teams provide short-term basic food assistance to people and families facing immediate financial difficulty.",
    services: ["Short-term basic food", "District service-team contacts", "Application and eligibility guidance"],
    availabilityNote: "Applicants must contact the team serving their district and provide the requested identity, address, and financial information.",
    sourceName: "Hong Kong Social Welfare Department", sourceKind: "Government assistance program", sourceUrl: "https://www.swd.gov.hk/en/pubsvc/family/cat_support/foodassist/",
    sourceDetail: "The department publishes program rules, free-cost status, eligibility, and current service-unit contacts.", coverageNote: "District-based service teams across Hong Kong."
  }),
  locator({
    id: "singapore-comcare", name: "Singapore ComCare and Social Service Offices", city: "Singapore", country: "Singapore", region: "Asia", lat: 1.3521, lng: 103.8198,
    secondaryCategories: ["food", "shelter", "health"], accessType: "Government assistance offices", address: "Social Service Offices across Singapore",
    summary: "Singapore's official pathway to ComCare financial and social assistance through local Social Service Offices and complementary community schemes.",
    services: ["ComCare assistance", "Local Social Service Office", "Emergency and household support", "Community referrals"],
    availabilityNote: "Eligibility depends on residency, household circumstances, and program assessment. Use the official page to identify the correct office.",
    sourceName: "Singapore Community Development Councils", sourceKind: "Government assistance gateway", sourceUrl: "https://www.cdc.gov.sg/what-we-do/getting-help/",
    sourceDetail: "The official page explains that ComCare assistance is available through Social Service Offices and links local support schemes.", coverageNote: "Nationwide office network; marker represents Singapore."
  })
];

const crisisCentres = [
  ["birmingham", "Birmingham", 52.4762435, -1.8822854, "Suite 303, Rhubarb, 25 Heath Mill Lane, Digbeth, Birmingham B9 4AE", "0121 348 7950", "Contact the centre before visiting."],
  ["brent", "Brent", 51.536687, -0.2485829, "1-2 Bank Buildings, High Street, Harlesden, London NW10 4LT", "0208 965 2561", "Monday–Friday 9:00 AM–5:00 PM; visits are generally by appointment between 10:00 AM and 4:00 PM."],
  ["croydon", "Croydon", 51.3726358, -0.1012747, "12 Surrey Street, London CR0 1RG", "0203 848 1700", "Monday–Friday 10:00 AM–4:00 PM."],
  ["edinburgh", "Edinburgh", 55.9507784, -3.1835422, "Cranston House, 271 Canongate, Edinburgh EH8 8BQ", "0131 209 7700", "Monday–Friday 10:00 AM–12:00 PM and 1:00–4:00 PM."],
  ["london", "London", 51.5173413, -0.0732608, "50-52 Commercial Street, London E1 6LT", "0300 636 1967", "Monday–Friday 9:30 AM–4:30 PM."],
  ["merseyside", "Liverpool", 53.400105, -2.979501, "96 Kent Street, Liverpool L1 5BD", "0151 218 7000", "Monday–Friday 8:30 AM–5:00 PM."],
  ["newcastle", "Newcastle upon Tyne", 54.9718861, -1.5941086, "City House, 1-3 City Road, Newcastle upon Tyne NE1 2AF", "0191 222 0622", "Contact the centre before visiting."],
  ["oxford", "Oxford", 51.7537237, -1.2622124, "Old Fire Station, 40 George Street, Oxford OX1 2AQ", "01865 263900", "Contact the centre before visiting."],
  ["south-wales", "Swansea", 51.6156, -3.956, "163 St Helen's Road, Swansea SA1 4DQ", "01792 674900", "Monday–Friday 9:00 AM–4:00 PM, excluding bank holidays."]
].map(([slug, city, lat, lng, address, phone, hours]) => direct({
  id: `crisis-skylight-${slug}`,
  name: `Crisis Skylight ${slug === "south-wales" ? "South Wales" : slug[0].toUpperCase() + slug.slice(1)}`,
  city, country: "United Kingdom", region: "Europe", lat, lng,
  category: "shelter", secondaryCategories: ["health", "referral"], accessType: "Contact centre for assessment", costNote: "Free homelessness support", address, phone, hours,
  summary: "A Crisis Skylight centre offering personalized support with housing, homelessness, health and wellbeing, skills, employment, and referrals.",
  services: ["Housing and homelessness support", "Health and wellbeing support", "Skills and employment", "Personalized referrals"],
  availabilityNote: "Crisis asks people to contact the centre before travelling because appointments, visiting arrangements, and the support available depend on individual circumstances.",
  sourceName: "Crisis UK", sourceKind: "Official provider location", sourceUrl: "https://www.crisis.org.uk/about-us/our-locations/",
  sourceDetail: "Crisis's official locations page lists this Skylight address, phone number, and current visiting information."
}));

const everybodyEatsLocations = [
  ["glen-innes", "Glen Innes", -36.8783376, 174.8564357, "133 Line Road, Glen Innes, Auckland", "Sun, Mon, Wed and Thu, 6:00–8:00 PM", "https://everybodyeats.nz/dine-with-us/glen-innes"],
  ["onehunga", "Onehunga", -36.9191387, 174.7846686, "306 Onehunga Mall, Onehunga, Auckland", "Sun–Thu, 6:00–8:00 PM", "https://everybodyeats.nz/dine-with-us/onehunga"],
  ["wellington", "Wellington", -41.2915383, 174.7762704, "60 Dixon Street, Te Aro, Wellington", "Sun–Wed, 6:00–8:00 PM", "https://everybodyeats.nz/dine-with-us/wellington"]
].map(([slug, city, lat, lng, address, hours, sourceUrl]) => direct({
  id: `everybody-eats-${slug}`, name: `Everybody Eats ${city}`, city, country: "New Zealand", region: "Oceania", lat, lng,
  category: "food", secondaryCategories: ["referral"], accessType: "Walk-in; bookings also available", costNote: "Pay what you can, including nothing", address, hours,
  summary: "A welcoming restaurant serving a set three-course meal from rescued ingredients on a pay-what-you-can basis, with everyone welcome.",
  services: ["Three-course community meal", "Vegetarian option", "Walk-in dining", "Dignified pay-what-you-can access"],
  availabilityNote: "Menus, closures, and service nights can change. Review the live restaurant page on the day you plan to attend.",
  sourceName: "Everybody Eats", sourceKind: "Official provider location", sourceUrl,
  sourceDetail: "The official restaurant page publishes this address, service nights, hours, and walk-in information."
}));

const northAmericanDirectSites = [
  direct({
    id: "evelyne-saller-centre", name: "Evelyne Saller Centre", city: "Vancouver", country: "Canada", region: "North America", lat: 49.2838452, lng: -123.0948183,
    category: "hygiene", secondaryCategories: ["food", "health", "referral"], accessType: "Community centre access", costNote: "Showers and laundry free; meals low-cost or voucher-supported",
    address: "404 Alexander Street, Vancouver, BC V6A 1C5", phone: "604-665-3075",
    summary: "A City of Vancouver centre for low-income and at-risk adults, with free showers and laundry, low-cost meals, Wi-Fi, health support, and community programs.",
    services: ["Free showers", "Free laundry", "Low-cost or voucher-supported meals", "Health and community support"],
    availabilityNote: "Hours differ by service. Review the official hours page or call before travelling.",
    sourceName: "City of Vancouver", sourceKind: "Official city service site", sourceUrl: "https://vancouver.ca/parks-recreation-culture/evelyne-saller-centre.aspx",
    sourceDetail: "The city page lists the address, phone, free hygiene services, cafeteria information, and health support."
  }),
  direct({
    id: "compass-hygiene-center", name: "Compass Center Hygiene Center", city: "Seattle", country: "United States", region: "North America", lat: 47.6013327, lng: -122.3360788,
    category: "hygiene", secondaryCategories: ["referral"], accessType: "Drop-in", costNote: "Free hygiene services", address: "210 Alaskan Way S, Basement Level, Seattle, WA 98104", phone: "206-474-1680",
    hours: "Mon–Fri 7:00 AM–4:00 PM; Sat 8:00 AM–12:00 PM; closed holidays",
    summary: "A drop-in hygiene centre where people experiencing homelessness can use restrooms, take a hot shower, and do laundry.",
    services: ["Hot showers", "Laundry", "Restrooms", "Drop-in hygiene access"],
    availabilityNote: "Capacity and holiday closures can affect access. Review the official page before travel.",
    sourceName: "Compass Housing Alliance", sourceKind: "Official provider location", sourceUrl: "https://www.compasshousingalliance.org/emergency-programs/hygiene-center/",
    sourceDetail: "The official program page lists the address, phone, hours, drop-in access, showers, restrooms, and laundry."
  }),
  ...[
    ["downtown", "Downtown Urban Rest Stop", 47.6157827, -122.334906, "1925 9th Avenue, Seattle, WA 98101", "206-332-0110", "Mon–Fri 6:30 AM–4:00 PM; showers and laundry generally end at 2:30 PM"],
    ["ballard", "Ballard Urban Rest Stop", 47.6701938, -122.396032, "2014B NW 57th Street, Seattle, WA 98107", "206-258-3626", "Mon–Fri 6:30 AM–1:30 PM; closed 10:00–11:30 AM; shower and laundry windows are shorter"]
  ].map(([slug, name, lat, lng, address, phone, hours]) => direct({
    id: `urban-rest-stop-${slug}`, name, city: "Seattle", country: "United States", region: "North America", lat, lng,
    category: "hygiene", secondaryCategories: ["referral"], accessType: "Same-day in-person access; laundry may be scheduled", costNote: "All services free", address, phone, hours,
    summary: "A no-cost hygiene facility for unsheltered people and families, providing restrooms, showers, laundry, toiletries, and resource referrals.",
    services: ["Showers", "Laundry", "Restrooms", "Toiletries and referrals"],
    availabilityNote: "Same-day capacity is limited. Shower sign-up is in person; laundry may be arranged by phone or at the door. Confirm the day's schedule.",
    sourceName: "Low Income Housing Institute", sourceKind: "Official provider location", sourceUrl: "https://www.lihihousing.org/urbanreststops",
    sourceDetail: "The official Urban Rest Stops page lists this location, hours, contact number, no-cost policy, and appointment rules."
  })),
  direct({
    id: "breakthrough-daytime-support", name: "Breakthrough Daytime Support Center", city: "Chicago", country: "United States", region: "North America", lat: 41.8871403, lng: -87.7072571,
    category: "hygiene", secondaryCategories: ["food", "clothing", "referral"], accessType: "Daytime support centre", costNote: "Free essential support", address: "3219 W Carroll Avenue, Chicago, IL 60624",
    summary: "A daytime support centre offering food, showers, laundry, clean clothing, computers, a safe space, and practical services.",
    services: ["Food", "Showers and laundry", "Clean clothing", "Computers and practical support"],
    availabilityNote: "Program hours and intake may change; review the official centre page before travel.",
    sourceName: "Breakthrough", sourceKind: "Official provider location", sourceUrl: "https://breakthrough.org/programs/daytime-support-center/",
    sourceDetail: "Breakthrough's official program page describes the daytime center and its essential-resource services."
  })
];

const bostonDirectSites = [
  ["southampton-shelter", "Southampton Street Shelter", 42.3324262, -71.0691465, "112 Southampton Street, Boston, MA 02118", "617-534-4440", "shelter", ["food", "hygiene", "referral"], "Overnight emergency shelter for men", ["Overnight shelter", "Meals", "Hygiene and referrals"]],
  ["woods-mullen-shelter", "Woods Mullen Shelter", 42.3334796, -71.0722987, "794 Massachusetts Avenue, Boston, MA 02118", "617-534-7100", "shelter", ["food", "hygiene", "referral"], "Overnight emergency shelter for women", ["Overnight shelter", "Meals", "Hygiene and referrals"]],
  ["pine-street-mens-inn", "Pine Street Inn Men's Inn", 42.3432437, -71.0644988, "444 Harrison Avenue, Boston, MA 02118", "617-892-9207", "shelter", ["food", "hygiene", "referral"], "Overnight emergency shelter for men", ["Overnight shelter", "Meals", "Housing and support referrals"]],
  ["pine-street-yawkey", "Pine Street Inn Yawkey House", 42.342456, -71.062887, "363 Albany Street, Boston, MA 02118", "617-892-9321", "shelter", ["food", "hygiene", "referral"], "Overnight emergency shelter for women", ["Overnight shelter", "Meals", "Housing and support referrals"]],
  ["boston-night-center", "Boston Night Center", 42.3623499, -71.060639, "31 Bowker Street, Boston, MA 02114", "857-296-0332", "shelter", ["hygiene", "referral"], "Overnight drop-in shelter for adults", ["Overnight indoor space", "Restrooms", "Referrals"]],
  ["st-francis-house-boston", "St. Francis House", 42.3524207, -71.0635269, "39 Boylston Street, Boston, MA 02116", "617-542-4211", "food", ["clothing", "hygiene", "referral"], "Daytime walk-in services", ["Meals", "Daytime shelter", "Clothing", "Showers and toiletries"]],
  ["rosies-place-boston", "Rosie's Place", 42.3340958, -71.076904, "889 Harrison Avenue, Boston, MA 02118", "617-442-9322", "food", ["shelter", "hygiene", "health", "referral"], "Services for women", ["Meals and food pantry", "Showers and laundry", "Day and overnight shelter", "Wellness and advocacy"]],
  ["womens-lunch-place", "Women's Lunch Place", 42.3521713, -71.0739726, "67 Newbury Street, Boston, MA 02116", "617-267-0200", "food", ["clothing", "hygiene", "referral"], "Day centre for women", ["Meals", "Toiletries", "Showers and laundry", "Clothing"]],
  ["bridge-over-troubled-waters", "Bridge Over Troubled Waters", 42.3550595, -71.0628025, "47 West Street, Boston, MA 02111", "617-423-9575", "shelter", ["food", "hygiene", "health", "referral"], "Drop-in and shelter services for ages 14–24", ["Meals", "Showers and laundry", "Lockers", "Case management and shelter"]],
  ["whittier-day-engagement", "Day Engagement Center at Whittier", 42.3314628, -71.0942003, "1290 Tremont Street, Boston, MA 02120", "617-858-2460", "referral", ["food", "hygiene", "health"], "Day centre", ["Daytime indoor space", "Meals and basic needs", "Health and service referrals"]],
  ["cardinal-medeiros-day", "Cardinal Medeiros Day Program", 42.3339182, -71.0798228, "1960 Washington Street, Boston, MA 02118", "617-619-6960", "food", ["shelter", "referral"], "Daily day shelter", ["Day shelter", "Meals", "Practical support"]],
  ["boston-health-homeless", "Boston Health Care for the Homeless", 42.3336453, -71.0727911, "780 Albany Street, Boston, MA 02118", "857-654-1600", "health", ["referral"], "Specialist health centre", ["Medical services", "Homeless-focused health care", "Care coordination"]]
].map(([slug, name, lat, lng, address, phone, category, secondaryCategories, accessType, services]) => direct({
  id: slug, name, city: "Boston", country: "United States", region: "North America", lat, lng, category, secondaryCategories, accessType,
  costNote: "Free core homelessness services; confirm any health-care charges", address, phone,
  summary: `${name} is listed by the City of Boston as a current provider of ${services.join(", ").toLowerCase()} for people experiencing homelessness or housing instability.`,
  services,
  availabilityNote: "Capacity, eligibility, schedules, and intake can change. Call the provider or review the City of Boston directory before travelling.",
  sourceName: name, sourceKind: "Provider listed by the City of Boston", sourceUrl: "https://www.boston.gov/departments/housing/services-those-experiencing-homeless",
  sourceDetail: "The official City of Boston directory publishes this provider's service description, street address, and phone number."
}));

export const expansionResources = [
  ...officialLocatorExpansion,
  ...crisisCentres,
  ...everybodyEatsLocations,
  ...northAmericanDirectSites,
  ...bostonDirectSites
];
