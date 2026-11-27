import { getLocale } from '../src/utils/localization.js';

// Reviewed interface strings only. Submitted/provider text is rendered literally.
const es = {
  'Receipt: {receipt}. There is no public report status lookup.': 'Comprobante: {receipt}. No hay una consulta pública del estado del informe.',
  'Main navigation': 'Navegación principal',
  'Listing corrections | Real World Needs': 'Correcciones de recursos | Real World Needs',
  '{status} · {priority}': '{status} · {priority}',
  '{status} · {date}': '{status} · {date}',
  'The correction queue is unavailable. Use Refresh correction queue to try again.': 'La cola de correcciones no está disponible. Usa Actualizar la cola de correcciones para volver a intentarlo.',
  'JavaScript and a connection are needed to check whether reporting is available. No report has been sent.': 'Se necesitan JavaScript y una conexión para comprobar si los informes están disponibles. No se ha enviado ningún informe.',
  'Leave this field empty': 'Deja este campo vacío',
  'Website accessibility problem': 'Problema de accesibilidad del sitio web',
  'Wrong address': 'Dirección incorrecta', 'Wrong hours': 'Horario incorrecto', 'Closed service': 'Servicio cerrado',
  'Disconnected phone': 'Teléfono desconectado', 'Eligibility change': 'Cambio en los requisitos', 'No longer free': 'Ya no es gratuito',
  'Duplicate listing': 'Recurso duplicado', 'Broken source': 'Fuente no disponible',
  'Skip to content': 'Saltar al contenido', 'Find help': 'Buscar ayuda', 'A clearer path to help.': 'Un camino más claro hacia la ayuda.',
  'Listing accuracy': 'Exactitud de los recursos', 'Listing corrections.': 'Correcciones de recursos.',
  'This channel is for public listing information and website accessibility barriers. It cannot arrange assistance or respond to emergencies.': 'Este canal sirve para corregir información pública y comunicar barreras de accesibilidad del sitio. No puede organizar ayuda ni atender emergencias.',
  'View listing': 'Ver recurso', 'Retry availability check': 'Volver a comprobar la disponibilidad',
  'What needs to be checked?': '¿Qué se debe revisar?', 'Issue': 'Problema', 'Choose one issue': 'Elige un problema',
  'Service (optional)': 'Servicio (opcional)', 'Whole listing or unsure': 'Todo el recurso o no estoy seguro',
  'Listing details to check (optional)': 'Detalles que se deben revisar (opcional)',
  'Describe only public provider facts or the website barrier. Do not include health information, identification, payment details or personal circumstances.': 'Describe solo información pública del proveedor o la barrera del sitio web. No incluyas información médica, documentos de identidad, datos de pago ni circunstancias personales.',
  'Proposed correction (optional)': 'Corrección propuesta (opcional)', 'Official source URL (optional)': 'URL de la fuente oficial (opcional)',
  'Reply email (optional)': 'Correo para recibir una respuesta (opcional)',
  'An email is not required. It stays private with the review team and does not guarantee a reply.': 'No es obligatorio dar un correo. Solo estará disponible para el equipo de revisión y no garantiza una respuesta.',
  'Reporting needs no account. Your report creates a private review candidate; it does not change the public listing.': 'No necesitas una cuenta. Tu informe crea una solicitud privada de revisión; no cambia el recurso publicado.',
  'How correction reports are handled': 'Cómo se gestionan los informes', 'Send correction report': 'Enviar informe',
  'Return to the directory': 'Volver al directorio', 'How listings are corrected': 'Cómo se corrigen los recursos',
  'Correction reporting is not available yet. You can still check the provider’s current information from its service listing.': 'Los informes aún no están disponibles. Puedes consultar la información actual del proveedor desde su recurso.',
  'Accessibility feedback is not available yet because a monitored review channel has not been confirmed. No report has been sent.': 'Los comentarios de accesibilidad aún no están disponibles porque no se ha confirmado un canal de revisión supervisado. No se ha enviado ningún informe.',
  'Checking whether correction reporting is available…': 'Comprobando si los informes están disponibles…',
  'You can submit a listing correction for review. No response time is promised.': 'Puedes enviar una corrección para su revisión. No se promete un plazo de respuesta.',
  'Reporting availability could not be checked. No report has been sent. Please try again.': 'No se pudo comprobar la disponibilidad. No se ha enviado ningún informe. Inténtalo de nuevo.',
  'Choose one issue to report.': 'Elige un problema para informar.',
  'Keep listing details to {limit} characters or fewer.': 'Limita los detalles a {limit} caracteres.',
  'Use an HTTPS source URL without credentials.': 'Usa una URL HTTPS de una fuente sin credenciales.',
  'Use an email address for the optional reply contact.': 'Usa una dirección de correo electrónico para el contacto opcional.',
  'Secure submission is unavailable in this browser. No report has been sent.': 'El envío seguro no está disponible en este navegador. No se ha enviado ningún informe.',
  'Saving your correction report…': 'Guardando el informe…',
  'Your correction report was saved for review. It has not changed the public listing.': 'Tu informe se guardó para su revisión. No ha cambiado el recurso publicado.',
  'Too many reports were sent recently. Please wait before retrying.': 'Se han enviado demasiados informes recientemente. Espera antes de volver a intentarlo.',
  'Wait at least {seconds} seconds, then retry.': 'Espera al menos {seconds} segundos y vuelve a intentarlo.',
  'This report was not accepted. Check the listing and issue, then try again.': 'Este informe no fue aceptado. Comprueba el recurso y el problema, y vuelve a intentarlo.',
  'We could not confirm your report was saved. Your details are still here; retry safely.': 'No pudimos confirmar que el informe se guardara. Tus datos siguen aquí; puedes volver a intentarlo.',
  'Retry correction report': 'Volver a enviar el informe',
  'Choose a service listing before reporting a correction. Return to the directory to find it.': 'Elige un recurso antes de informar de una corrección. Vuelve al directorio para buscarlo.',
  'Listing correction review': 'Revisión de correcciones', 'Report status': 'Estado del informe', 'All reports': 'Todos los informes',
  'Reports are private review candidates. Decisions recorded here do not edit or publish a listing. Do not add personal case information.': 'Los informes son solicitudes privadas de revisión. Registrar una decisión no edita ni publica un recurso. No añadas información de casos personales.',
  'Refresh correction queue': 'Actualizar la cola de correcciones', 'Correction report pages': 'Páginas de informes de correcciones',
  'Previous reports': 'Informes anteriores', 'Next reports': 'Informes siguientes', 'Your session has ended. ': 'Tu sesión ha terminado. ',
  'Sign in to review corrections': 'Iniciar sesión para revisar correcciones', 'Opening correction report…': 'Abriendo el informe…',
  'Retry opening report': 'Volver a abrir el informe', 'This report could not be loaded. Please try again.': 'No se pudo cargar el informe. Inténtalo de nuevo.',
  'Open public listing': 'Abrir el recurso publicado', 'Listing source at submission': 'Fuente del recurso al recibir el informe',
  'Listing ID': 'Identificador del recurso', 'Reported issue': 'Problema informado', 'Unrecognized issue': 'Problema no reconocido',
  'Status': 'Estado', 'Priority': 'Prioridad', 'Assigned reviewer account': 'Cuenta del revisor asignado', 'Unassigned': 'Sin asignar',
  'Submitted': 'Enviado', 'Listing source check at submission': 'Fecha de consulta de la fuente al recibir el informe', 'Not recorded': 'Sin registrar',
  'Submitted listing details': 'Detalles enviados', 'No additional detail supplied.': 'No se proporcionaron detalles adicionales.',
  'Proposed correction': 'Corrección propuesta', 'Submitted source': 'Fuente propuesta', 'Private reply email': 'Correo privado de respuesta',
  'Original provider text is preserved.': 'Se conserva el texto original del proveedor.',
  'Record a review decision': 'Registrar una decisión de revisión', 'Decision status': 'Estado de la decisión', 'Review priority': 'Prioridad de revisión',
  'Urgent': 'Urgente', 'Normal': 'Normal', 'Low': 'Baja', 'Assignment': 'Asignación', 'Keep current assignment': 'Mantener la asignación actual',
  'Assign to me': 'Asignarme', 'Leave unassigned': 'Dejar sin asignar', 'Reason and source findings': 'Motivo y hallazgos de la fuente',
  'Evidence URL (HTTPS)': 'URL de evidencia (HTTPS)', 'Save review decision': 'Guardar decisión',
  'A ready, rejected or duplicate decision needs a source URL. Ready means evidence is sufficient for a separate catalog review; the public listing still needs an approved release.': 'Las decisiones de preparado, rechazado o duplicado requieren una URL de fuente. Preparado significa que hay evidencia suficiente para revisar el catálogo; el recurso aún necesita una publicación aprobada.',
  'Reload report and keep my draft': 'Recargar el informe y conservar mi borrador',
  'Latest report loaded. Your unsaved decision is retained; compare it with the current report before saving.': 'Se cargó el informe más reciente. Tu decisión sin guardar se conserva; compárala con el informe actual antes de guardar.',
  'Write a reason between 10 and {limit} characters.': 'Escribe un motivo de entre 10 y {limit} caracteres.',
  'Use a public HTTPS evidence URL without credentials.': 'Usa una URL pública HTTPS de evidencia sin credenciales.',
  'Saving review decision…': 'Guardando la decisión…', 'Review decision saved. No public listing was changed or published.': 'Decisión guardada. No se cambió ni publicó ningún recurso.',
  'Another reviewer changed this report. Reload the latest report, compare it with your retained draft, and then save.': 'Otro revisor cambió este informe. Recarga la versión más reciente, compárala con tu borrador y guarda después.',
  'The review decision could not be confirmed. Your draft is still here; try again.': 'No se pudo confirmar la decisión. Tu borrador sigue aquí; vuelve a intentarlo.',
  'Review history': 'Historial de revisión', 'No review decisions recorded yet.': 'Todavía no hay decisiones registradas.',
  'Open review evidence': 'Abrir la evidencia', 'Review': 'Revisión', 'Unavailable': 'No disponible',
  'Reviewer account: {account}': 'Cuenta del revisor: {account}', 'Loading correction reports…': 'Cargando informes…',
  'Unknown status': 'Estado desconocido', 'Review correction': 'Revisar corrección', 'Review correction for {listing}': 'Revisar corrección de {listing}',
  '{count} correction reports on this page.': '{count} informes en esta página.', 'No correction reports match this status.': 'No hay informes con este estado.',
  'Page {page}': 'Página {page}', 'The correction review queue is unavailable. Please try again.': 'La cola de correcciones no está disponible. Inténtalo de nuevo.',
  'Open': 'Nuevo', 'In review': 'En revisión', 'Ready for catalog review': 'Preparado para revisar el catálogo',
  'Catalog updated; awaiting release': 'Catálogo actualizado; publicación pendiente', 'Public release verified': 'Publicación pública verificada',
  'No listing change needed': 'No se necesita cambiar el recurso', 'Duplicate report': 'Informe duplicado',
  'Apply verified catalog changes': 'Aplicar cambios verificados al catálogo',
  'Only independently checked facts belong here. Submissions are never copied into the catalog automatically. Service-specific routes require the full catalog review.': 'Incluye solo hechos comprobados de forma independiente. Los informes nunca se copian automáticamente al catálogo. Las rutas de cada servicio requieren una revisión completa del catálogo.',
  'Field to correct': 'Campo que se debe corregir', 'Summary': 'Descripción', 'Hours': 'Horario', 'Phone': 'Teléfono', 'Eligibility': 'Requisitos',
  'Current catalog value': 'Valor actual del catálogo', 'Verified replacement value': 'Valor de reemplazo verificado',
  'Apply to catalog': 'Aplicar al catálogo', 'Applying reviewed catalog change…': 'Aplicando el cambio revisado…',
  'Catalog updated. Export, review and release the snapshot before verifying publication.': 'Catálogo actualizado. Exporta, revisa y publica la copia antes de verificar la publicación.',
  'The report or catalog changed. Reopen it and compare your retained values before applying again.': 'El informe o el catálogo cambió. Ábrelo de nuevo y compara tus valores antes de volver a aplicar el cambio.',
  'The catalog change could not be confirmed. Keep this draft and retry the same change.': 'No se pudo confirmar el cambio. Conserva este borrador y vuelve a intentar el mismo cambio.',
  'Verify public release': 'Verificar la publicación pública', 'Verifying the deployed public catalog…': 'Verificando el catálogo público publicado…',
  'The public release matches this reviewed change. The report is resolved.': 'La publicación pública coincide con este cambio revisado. El informe está resuelto.',
  'The public catalog does not yet match. Complete the approved release and retry verification.': 'El catálogo público todavía no coincide. Completa la publicación aprobada y vuelve a verificar.',
  'Publication could not be verified. The report remains unresolved; retry later.': 'No se pudo verificar la publicación. El informe sigue sin resolverse; inténtalo más tarde.',
  'This report is linked to a catalog change. Review its publication status below.': 'Este informe está vinculado a un cambio del catálogo. Revisa su estado de publicación más abajo.',
};
export function correctionText(key, params = {}, locale = getLocale()) {
  const text = locale === 'es' ? es[key] || key : key;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(locale === 'es' && ['status', 'priority'].includes(name) ? es[params[name]] || params[name] || `{${name}}` : params[name] ?? `{${name}}`));
}
export function correctionTextFor(element, key, params = {}) {
  element.setAttribute('data-correction-message', key);
  element.setAttribute('data-correction-params', JSON.stringify(params));
  element.textContent = correctionText(key, params);
}
export function correctionLabelFor(element, key, params = {}) {
  element.setAttribute('data-correction-aria', key);
  element.setAttribute('data-correction-aria-params', JSON.stringify(params));
  element.setAttribute('aria-label', correctionText(key, params));
}
export function translateCorrections(root) {
  const doc = root.ownerDocument || root;
  if (doc.querySelector?.('[data-correction-page]')) doc.title = correctionText('Listing corrections | Real World Needs');
  for (const element of root.querySelectorAll?.('[data-correction-aria]') || []) {
    let params = {}; try { params = JSON.parse(element.getAttribute('data-correction-aria-params') || '{}'); } catch {}
    element.setAttribute('aria-label', correctionText(element.getAttribute('data-correction-aria'), params));
  }
  for (const element of root.querySelectorAll?.('[data-correction-message]') || []) {
    let params = {};
    try { params = JSON.parse(element.getAttribute('data-correction-params') || '{}'); } catch {}
    element.textContent = correctionText(element.getAttribute('data-correction-message'), params);
  }
}
export function observeCorrectionLanguage(root) {
  translateCorrections(root);
  globalThis.addEventListener?.('rwn:languagechange', () => translateCorrections(root));
}
