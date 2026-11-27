import { correctionTextFor as setText } from './correction-localization.js';

// This surface accepts independently reviewed text. It never preloads a public
// submission into a catalog mutation, changes routes, or publishes a snapshot.
export function appendCorrectionPublication(root, { report, currentCatalog, request, onComplete, onReload, draft }) {
  const doc = root.ownerDocument;
  const node = (tag, key) => { const el = doc.createElement(tag); if (key) { const label = tag === 'label' ? doc.createElement('span') : el; setText(label, key); if (label !== el) el.append(label); } return el; };
  if (report.status === 'ready' && currentCatalog?.record && typeof currentCatalog.updatedAt === 'string') {
    const section = node('section'), heading = node('h4', 'Apply verified catalog changes');
    const explanation = node('p', 'Only independently checked facts belong here. Submissions are never copied into the catalog automatically. Service-specific routes require the full catalog review.');
    const form = node('form'), fields = node('fieldset'); fields.append(node('legend', 'Apply verified catalog changes'));
    const controls = {};
    const field = (name, label, tag = 'input') => {
      const wrap = node('label', label), input = node(tag); input.name = name; wrap.append(input); fields.append(wrap); controls[name] = input; return input;
    };
    const select = field('catalogField', 'Field to correct', 'select');
    const entries = [['summary', 'Summary'], ['hours', 'Hours'], ['phone', 'Phone'], ['eligibility', 'Eligibility']]
      .filter(([key]) => !currentCatalog.record.serviceAccess || !['hours', 'eligibility'].includes(key));
    for (const [value, label] of entries) { const option = node('option', label); option.value = value; select.append(option); }
    select.value = draft?.catalogField && entries.some(([key]) => key === draft.catalogField) ? draft.catalogField : 'summary';
    const current = node('p'); fields.append(node('strong', 'Current catalog value'), current);
    const replacement = field('catalogValue', 'Verified replacement value', 'textarea'); replacement.rows = 4; replacement.required = true;
    const reason = field('catalogReason', 'Reason and source findings', 'textarea'); reason.rows = 3; reason.required = true; reason.minLength = 10; reason.maxLength = 1000;
    const evidence = field('catalogEvidence', 'Evidence URL (HTTPS)'); evidence.type = 'url'; evidence.required = true; evidence.maxLength = 2048;
    const updateField = () => { current.textContent = currentCatalog.record[select.value] || ''; replacement.maxLength = ['summary', 'eligibility'].includes(select.value) ? 2000 : 1000; };
    updateField(); select.addEventListener('change', updateField);
    if (draft) for (const [key, value] of Object.entries(draft)) if (controls[key]) controls[key].value = value;
    const save = node('button', 'Apply to catalog'); save.type = 'submit';
    const result = node('p'); result.setAttribute('role', 'status'); result.setAttribute('aria-live', 'polite');
    const reload = node('button', 'Reload report and keep my draft'); reload.type = 'button'; reload.hidden = true;
    const collect = () => Object.fromEntries(Object.entries(controls).map(([key, el]) => [key, el.value.trim()]));
    reload.addEventListener('click', () => onReload?.(collect()));
    let pending = false, conflict = false;
    form.append(fields, save, result, reload);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (pending || conflict) return;
      const values = collect();
      if (!values.catalogValue || values.catalogValue.length > replacement.maxLength || values.catalogReason.length < 10 || values.catalogReason.length > 1000) { setText(result, 'Write a reason between 10 and {limit} characters.', { limit: 1000 }); reason.focus(); return; }
      let safe = false;
      try { const url = new URL(values.catalogEvidence); safe = url.protocol === 'https:' && !url.username && !url.password && !/[\\\s\u0000-\u001f]/.test(values.catalogEvidence); } catch {}
      if (!safe) { setText(result, 'Use a public HTTPS evidence URL without credentials.'); evidence.focus(); return; }
      pending = true; fields.disabled = true; save.disabled = true; setText(result, 'Applying reviewed catalog change…');
      try {
        const { data } = await request('/api/correction-review', { method: 'POST', privateRequest: true, body: {
          action: 'apply', id: report.id, revision: report.revision, catalogUpdatedAt: currentCatalog.updatedAt,
          changes: { [values.catalogField]: values.catalogValue }, reason: values.catalogReason, evidenceUrl: values.catalogEvidence,
        } });
        if (data.report?.id !== report.id || data.report.status !== 'applied' || data.report.revision !== report.revision + 1) throw new Error('Unconfirmed catalog application');
        setText(result, 'Catalog updated. Export, review and release the snapshot before verifying publication.');
        conflict = true; onComplete?.(data.report);
      } catch (error) {
        conflict = error.status === 409;
        setText(result, conflict ? 'The report or catalog changed. Reopen it and compare your retained values before applying again.' : 'The catalog change could not be confirmed. Keep this draft and retry the same change.');
        reload.hidden = !conflict;
      } finally { pending = false; fields.disabled = conflict; save.disabled = conflict; }
    });
    section.append(heading, explanation, form); root.append(section);
  }
  if (report.status === 'applied') {
    const section = node('section'), button = node('button', 'Verify public release'), result = node('p'); button.type = 'button';
    result.setAttribute('role', 'status'); result.setAttribute('aria-live', 'polite');
    section.append(node('p', 'Catalog updated. Export, review and release the snapshot before verifying publication.'), button, result); root.append(section);
    let pending = false, done = false;
    button.addEventListener('click', async () => {
      if (pending || done) return; pending = true; button.disabled = true; setText(result, 'Verifying the deployed public catalog…');
      try {
        const { data } = await request('/api/correction-review', { method: 'POST', privateRequest: true, body: { action: 'resolve', id: report.id, revision: report.revision } });
        if (data.report?.id !== report.id || data.report.status !== 'resolved' || data.report.revision !== report.revision + 1) throw new Error('Unconfirmed publication');
        done = true; setText(result, 'The public release matches this reviewed change. The report is resolved.'); onComplete?.(data.report);
      } catch (error) { setText(result, error.status === 409 ? 'The public catalog does not yet match. Complete the approved release and retry verification.' : 'Publication could not be verified. The report remains unresolved; retry later.'); }
      finally { pending = false; button.disabled = done; }
    });
  }
}
