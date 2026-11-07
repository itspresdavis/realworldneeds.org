import { beforeYouGoFacts } from '../src/utils/service-access.js';
import { messages } from '../src/utils/localization.js';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');

export function serviceBeforeYouGoMarkup(resource) {
  const routes=beforeYouGoFacts(resource);
  if(!routes.length)return '';
  const title=resource.kind==='direct'?['Before you go','Antes de ir']:['Before you contact','Antes de contactar'];
  const valueAttributes=value=>{
    const unknown=['hoursUnknown','accessUnknown','eligibilityUnknown'].find(key=>messages[key]?.[0]===value);
    return unknown?`data-i18n="${unknown}"`:'data-provider-text lang="en"';
  };
  return `<section class="service-before-you-go" data-service-before-you-go aria-labelledby="before-you-go-title">
    <h2 id="before-you-go-title" data-i18n-en="${title[0]}" data-i18n-es="${title[1]}">${title[0]}</h2>
    <p data-i18n-en="Published schedules and intake instructions do not confirm space, stock or admission. Check current details with the provider." data-i18n-es="Los horarios y las instrucciones publicados no confirman plazas, existencias ni admisión. Confirma los detalles actuales con el proveedor.">Published schedules and intake instructions do not confirm space, stock or admission. Check current details with the provider.</p>
    ${routes.map(route=>`<article data-service-route="${escape(route.routeId)}">
      <h3 data-provider-text lang="en">${escape(route.label)}</h3>
      <dl>
        ${route.address?`<div><dt>${escape(route.addressLabel||'Access location')}</dt><dd data-provider-text lang="en">${escape(route.address)}</dd></div>`:''}
        ${route.instructions?`<div><dt>Instructions</dt><dd data-provider-text lang="en">${escape(route.instructions)}</dd></div>`:''}
        ${route.facts.map(fact=>`<div><dt data-i18n="${escape(fact.key)}">${escape(fact.label)}</dt><dd ${valueAttributes(fact.value)}>${escape(fact.value)}</dd></div>`).join('')}
        <div data-service-route-source><dt>Route source and review</dt><dd><a href="${escape(route.sourceUrl)}" rel="noopener noreferrer">${escape(route.sourceUrl)}</a> · <time datetime="${escape(route.reviewedAt)}">${escape(route.reviewedAt)}</time></dd></div>
      </dl>
      ${Object.entries(route.fieldEvidence||{}).length?`<details><summary data-i18n-en="Sources for these details" data-i18n-es="Fuentes de estos detalles">Sources for these details</summary><ul>${Object.entries(route.fieldEvidence).map(([field,evidence])=>`<li><a href="${escape(evidence.sourceUrl)}" rel="noopener noreferrer">${escape(field)}</a> · <time datetime="${escape(evidence.checkedAt)}">${escape(evidence.checkedAt.slice(0,10))}</time><span data-provider-text lang="en"> — ${escape(evidence.scope)}</span></li>`).join('')}</ul></details>`:''}
    </article>`).join('')}
  </section>`;
}
