import { beforeYouGoFacts, isSafeServiceAction, serviceActions } from '../src/utils/service-access.js';
import { messages } from '../src/utils/localization.js';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');

export function serviceBeforeYouGoMarkup(resource) {
  const routes=beforeYouGoFacts(resource);
  if(!routes.length)return '';
  const actions=serviceActions(resource), spanishActions=serviceActions(resource,{locale:'es'});
  const routeActions=route=>{
    const links=actions.flatMap((action,index)=>action.routeId===route.routeId&&isSafeServiceAction(action)
      ?[`<a class="is-access-${escape(action.kind)}" href="${escape(action.href)}" rel="noopener noreferrer" data-i18n-en="${escape(action.label)}" data-i18n-es="${escape(spanishActions[index]?.label||action.label)}">${escape(action.label)}</a>`]:[]);
    return links.length?`<div class="directory-links" data-service-route-actions>${links.join('')}</div>`:'';
  };
  const title=resource.kind==='direct'?['Before you go','Antes de ir']:['Before you contact','Antes de contactar'];
  const valueAttributes=value=>{
    const unknown=['hoursUnknown','accessUnknown','eligibilityUnknown'].find(key=>messages[key]?.[0]===value);
    return unknown?`data-i18n="${unknown}"`:'data-provider-text lang="en"';
  };
  return `<section class="service-before-you-go" data-service-before-you-go aria-labelledby="before-you-go-title">
    <h2 id="before-you-go-title" tabindex="-1" data-i18n-en="${title[0]}" data-i18n-es="${title[1]}">${title[0]}</h2>
    <p data-i18n-en="Published schedules and intake instructions do not confirm space, stock or admission. Check current details with the provider." data-i18n-es="Los horarios y las instrucciones publicados no confirman plazas, existencias ni admisión. Confirma los detalles actuales con el proveedor.">Published schedules and intake instructions do not confirm space, stock or admission. Check current details with the provider.</p>
    ${routes.map(route=>`<article data-service-route="${escape(route.routeId)}">
      <h3 data-provider-text lang="en">${escape(route.label)}</h3>
      <dl>
        ${route.address?`<div><dt ${route.addressLabel?`data-i18n="${resource.kind==='direct'?'address':'coverage'}"`:'data-i18n-en="Access location" data-i18n-es="Lugar de acceso"'}>${escape(route.addressLabel||'Access location')}</dt><dd data-provider-text lang="en">${escape(route.address)}</dd></div>`:''}
        ${route.instructions?`<div><dt data-i18n-en="Instructions" data-i18n-es="Instrucciones">Instructions</dt><dd data-provider-text lang="en">${escape(route.instructions)}</dd></div>`:''}
        ${route.facts.map(fact=>`<div><dt data-i18n="${escape(fact.key)}">${escape(fact.label)}</dt><dd ${valueAttributes(fact.value)}>${escape(fact.value)}</dd></div>`).join('')}
        <div data-service-route-source><dt data-i18n-en="Route source and review" data-i18n-es="Fuente y revisión del acceso">Route source and review</dt><dd><a href="${escape(route.sourceUrl)}" rel="noopener noreferrer">${escape(route.sourceUrl)}</a> · <time datetime="${escape(route.reviewedAt)}">${escape(route.reviewedAt)}</time></dd></div>
      </dl>
      ${routeActions(route)}
      ${Object.entries(route.fieldEvidence||{}).length?`<details><summary data-i18n-en="Sources for these details" data-i18n-es="Fuentes de estos detalles">Sources for these details</summary><ul>${Object.entries(route.fieldEvidence).map(([field,evidence])=>`<li><a href="${escape(evidence.sourceUrl)}" rel="noopener noreferrer">${escape(field)}</a> · <time datetime="${escape(evidence.checkedAt)}">${escape(evidence.checkedAt.slice(0,10))}</time><span data-provider-text lang="en"> — ${escape(evidence.scope)}</span></li>`).join('')}</ul></details>`:''}
    </article>`).join('')}
  </section>`;
}
