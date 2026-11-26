// Reviewed RWN interface copy only. Provider facts are never machine-translated.
export const LANGUAGE_KEY = 'rwn-language';
export const supportedLocales = Object.freeze(['en', 'es']);
export const messages = Object.freeze({
  beforeYouGo: ['Before you go', 'Antes de ir'],
  sourceChecked: ['Source checked', 'Fuente consultada'],
  hoursUnknown: ['Hours are not confirmed here. Check with the provider.', 'El horario no está confirmado aquí. Consúltalo con el proveedor.'],
  eligibilityUnknown: ['Eligibility is not confirmed here. Check the provider’s requirements.', 'Los requisitos no están confirmados aquí. Consulta al proveedor.'],
  accessUnknown: ['Access instructions are not confirmed here. Check the official source.', 'Las instrucciones de acceso no están confirmadas aquí. Consulta la fuente oficial.'],
  originalProviderText: ['Provider information is shown in its original language.', 'La información del proveedor se muestra en su idioma original.'],
  translationScope: ['RWN’s navigation and main pages are available in Spanish. Information supplied by service providers stays in its original language. This does not confirm that a provider offers services in Spanish.', 'La navegación y las páginas principales de RWN están disponibles en español. La información de las organizaciones se conserva en su idioma original. Esto no confirma que ofrezcan atención en español.'],
  languageClearFailed: ['The language preference could not be cleared from this browser. Check its storage settings.', 'No se pudo borrar la preferencia de idioma de este navegador. Revisa sus ajustes de almacenamiento.'],
  eligibility: ['Eligibility', 'Requisitos'], entrance: ['Entrance', 'Entrada'], hours: ['Hours', 'Horario'],
  intake: ['Intake', 'Admisión'], contact: ['Contact', 'Contacto'], directions: ['Directions', 'Cómo llegar'],
  providerDetails: ['Provider details', 'Información del proveedor'], capacity: ['Capacity', 'Capacidad'],
  source: ['Source', 'Fuente'], reviewed: ['Reviewed', 'Revisado'],
  directionsTo: ['Directions to {service}', 'Cómo llegar a {service}'],
  detailsFor: ['{service} details', 'Detalles de {service}'],
  nextDay: ['next day', 'día siguiente'], timezone: ['Local time zone', 'Zona horaria local'],
  scheduledOpen: ['Scheduled to be open; availability is not confirmed.', 'Horario previsto de apertura; la disponibilidad no está confirmada.'],
  scheduledClosed: ['Outside the published schedule; check with the provider.', 'Fuera del horario publicado; consulta al proveedor.'],
  scheduleUnknown: ['Current schedule is unknown. Confirm before traveling.', 'Se desconoce el horario actual. Confírmalo antes de ir.'],
  appointment: ['Appointment or referral', 'Cita o derivación'], intakeCutoff: ['Intake cutoff', 'Hora límite de admisión'],
  documents: ['Required documents', 'Documentos requeridos'], season: ['Published dates', 'Fechas publicadas'],
  exceptions: ['Schedule exceptions', 'Excepciones de horario'],
  serviceRoutesNotice: ['Choose the service you need and check its access details before traveling.', 'Elige el servicio que necesitas y consulta sus instrucciones de acceso antes de ir.'],
  findHelp: ['Find help', 'Buscar ayuda'], directory: ['Directory', 'Directorio'], saved: ['Saved', 'Guardados'],
  savedServices: ['Saved services', 'Servicios guardados'], menu: ['Menu', 'Menú'], close: ['Close', 'Cerrar'],
  search: ['Search', 'Buscar'], need: ['Need', 'Necesidad'], place: ['Place', 'Lugar'],
  allNeeds: ['All needs', 'Todas las necesidades'], allPlaces: ['All places', 'Todos los lugares'],
  food: ['Food', 'Alimentación'], shelter: ['Shelter', 'Alojamiento'], health: ['Health', 'Salud'],
  hygiene: ['Hygiene', 'Higiene'], clothing: ['Clothing', 'Ropa'], water: ['Water', 'Agua'],
  meals: ['Meals', 'Comidas preparadas'], groceries: ['Groceries and pantries', 'Alimentos y despensas'],
  foodBenefits: ['Food benefits', 'Beneficios de alimentación'], filters: ['Filters', 'Filtros'],
  clearFilters: ['Clear search and filters', 'Borrar búsqueda y filtros'], clear: ['Clear', 'Borrar'],
  useLocation: ['Use my location', 'Usar mi ubicación'], clearLocation: ['Clear location', 'Borrar ubicación'],
  searchPlaceholder: ['Search by service, city, ZIP or postcode', 'Buscar por servicio, ciudad o código postal'],
  chooseNeed: ['Choose a need', 'Elige una necesidad'], choosePlace: ['Choose a place', 'Elige un lugar'],
  timeIntentNotice: ['Showing relevant services. Hours, beds and admission are not confirmed.', 'Se muestran servicios relacionados. No se confirman horarios, camas ni admisión.'],
  unsupportedPlace: ['This place is not supported by the directory. Try a city, region or country.', 'Este lugar no está disponible en el directorio. Prueba una ciudad, región o país.'],
  searching: ['Searching…', 'Buscando…'], loading: ['Loading…', 'Cargando…'], tryAgain: ['Try again', 'Intentar de nuevo'],
  viewDetails: ['View details', 'Ver detalles'], openListing: ['Open listing', 'Abrir ficha'],
  serviceLocation: ['Service location', 'Lugar de atención'], serviceRoutes: ['Service access routes', 'Opciones de acceso al servicio'],
  resourceFinder: ['Resource finder', 'Buscador de recursos'], referral: ['Help finder or referral', 'Buscador de ayuda o derivación'],
  serviceNetwork: ['Service network', 'Red de servicios'], remoteHelp: ['Phone or online help', 'Ayuda telefónica o en línea'],
  checkCoverage: ['Check coverage', 'Consulta la cobertura'], free: ['Free', 'Gratis'], cost: ['Cost', 'Costo'], access: ['Access', 'Acceso'],
  phone: ['Phone', 'Teléfono'], address: ['Address', 'Dirección'], coverage: ['Coverage', 'Cobertura'],
  officialSource: ['Official source', 'Fuente oficial'], save: ['Save', 'Guardar'], remove: ['Remove', 'Quitar'],
  share: ['Share', 'Compartir'], copy: ['Copy', 'Copiar'], print: ['Print', 'Imprimir'],
  reportProblem: ['Report a problem', 'Informar de un problema'], sources: ['Sources', 'Fuentes'],
  privacy: ['Privacy', 'Privacidad'], accessibility: ['Accessibility', 'Accesibilidad'], transparency: ['Transparency', 'Transparencia'],
  aboutRwn: ['About RWN', 'Acerca de RWN'], ourWork: ['Our work', 'Nuestro trabajo'], getInvolved: ['Get involved', 'Participa'],
  contribute: ['Contribute', 'Colaborar'], contributorWorkspace: ['Contributor workspace', 'Espacio de colaboradores'],
  checkListings: ['How listings are checked', 'Cómo se revisan las fichas'],
  cancel: ['Cancel', 'Cancelar'], yesClear: ['Yes, clear saved list', 'Sí, borrar la lista guardada'],
  clearSaved: ['Clear saved list', 'Borrar lista guardada'], browseDirectory: ['Browse directory', 'Explorar el directorio'],
  savedEmpty: ['No saved services yet. Open a listing and choose Save to keep it here.', 'Aún no hay servicios guardados. Abre una ficha y elige Guardar para conservarla aquí.'],
  savedLoading: ['Loading your saved services…', 'Cargando tus servicios guardados…'],
  savedStorageError: ['Saved services are unavailable in this browser. Check your browser’s storage settings.', 'Los servicios guardados no están disponibles en este navegador. Revisa sus ajustes de almacenamiento.'],
  savedChangeError: ['Your saved list could not be changed. Check this browser’s storage settings and try again.', 'No se pudo cambiar tu lista guardada. Revisa los ajustes de almacenamiento de este navegador e inténtalo de nuevo.'],
  savedLoadError: ['Your saved list is still on this device, but listing details could not load. Reconnect and try again.', 'Tu lista guardada sigue en este dispositivo, pero no se pudieron cargar los detalles. Vuelve a conectarte e inténtalo de nuevo.'],
  savedRemoved: ['Listing removed from your saved services.', 'Se quitó la ficha de tus servicios guardados.'],
  savedCleared: ['All saved services removed from this browser.', 'Se quitaron todos los servicios guardados de este navegador.'],
  savedRetired: ['This saved listing is no longer in the current directory.', 'Esta ficha guardada ya no está en el directorio actual.'],
  savedMore: ['Show {count} more saved services', 'Mostrar {count} servicios guardados más'],
  savedCount: ['{count} saved listings. Confirm current details before you go.', '{count} fichas guardadas. Confirma los detalles actuales antes de ir.'],
  savedUnavailableCount: ['{count} saved listings · {unavailable} no longer in the directory. Confirm current details before you go.', '{count} fichas guardadas · {unavailable} ya no están en el directorio. Confirma los detalles actuales antes de ir.'],
  removeNamed: ['Remove {name} from saved services', 'Quitar {name} de los servicios guardados'],
  removeUnavailable: ['Remove unavailable listing from saved services', 'Quitar ficha no disponible de los servicios guardados'],
});

let selectedLocale;
export function getLocale() {
  if (typeof document !== 'undefined' && supportedLocales.includes(document.documentElement.lang)) return document.documentElement.lang;
  if (selectedLocale) return selectedLocale;
  return 'en';
}
export function t(key, parameters = {}, locale = getLocale()) {
  const template = messages[key]?.[locale === 'es' ? 1 : 0] ?? messages[key]?.[0] ?? key;
  return template.replace(/\{([a-zA-Z]+)\}/g, (match, name) => Object.hasOwn(parameters, name) ? String(parameters[name]) : match);
}
export function setLocale(locale, { persist = true } = {}) {
  if (!supportedLocales.includes(locale)) return false;
  selectedLocale = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  if (persist) try { globalThis.localStorage?.setItem(LANGUAGE_KEY, locale); } catch { /* The language still works in memory when storage is blocked. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('rwn:languagechange', { detail: { locale } }));
  return true;
}
export function clearLanguagePreference() {
  setLocale('en', { persist: false });
  try { globalThis.localStorage?.removeItem(LANGUAGE_KEY); return true; } catch { return false; }
}
export function readLanguagePreference() {
  try { const value = globalThis.localStorage?.getItem(LANGUAGE_KEY); return supportedLocales.includes(value) ? value : 'en'; } catch { return 'en'; }
}
export function formatDate(value, locale = getLocale()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return String(value || '');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return value;
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-419' : 'en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}
