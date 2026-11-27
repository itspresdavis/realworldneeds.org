import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
const workspace = await readFile(new URL('../server/workspace.html', import.meta.url), 'utf8');
test.use({serviceWorkers:'block'});

test('Spanish account modes preserve typed credentials and disclose unavailable auth honestly', async ({page}) => {
  await page.route('**/api/account', route=>route.fulfill({status:503,json:{error:'Account services are temporarily unavailable. Please try again. The public directory is still available.'}}));
  await page.goto('/join');
  await page.locator('[data-language-control] select').selectOption('es');
  await expect(page.locator('#accountTitle')).toHaveText('Te damos la bienvenida.');
  await page.locator('[name=email]').fill('test@example.org'); await page.locator('[name=password]').fill('fixture-password-only');
  await page.locator('#signupSwitch').click();
  await expect(page.locator('#accountSubmit')).toHaveText('Crear cuenta');
  await expect(page.locator('[name=email]')).toHaveValue('test@example.org');
  await expect(page.locator('[name=password]')).toHaveValue('fixture-password-only');
  await page.locator('#signupSwitch').click(); await page.locator('#accountSubmit').click();
  await expect(page.locator('#accountStatus')).toContainText('El directorio público sigue disponible.');
  await page.locator('#recoverSwitch').click();
  await expect(page.locator('#accountSubmit')).toHaveText('Enviar enlace de recuperación');
  await expect(page.locator('[name=password]')).toBeDisabled();
  await page.locator('[data-language-control] select').selectOption('en');
  await expect(page.locator('#accountTitle')).toHaveText('Find your way back.');
  await expect(page.locator('[name=email]')).toHaveValue('test@example.org');
});

test('private contributor presentation preserves drafts and original notes when language changes', async ({page},info) => {
  // Isolated UI fixture; hosted authentication/authorization is verified separately.
  let reads=0, writes=0;
  await page.route('**/workspace', route=>route.fulfill({status:200,contentType:'text/html',body:workspace,headers:{'Cache-Control':'private, no-store'}}));
  await page.route('**/api/corrections/review**', route=>route.fulfill({status:403,json:{error:'Reviewer access is required.'}}));
  await page.route('**/api/correction-review**', route=>route.fulfill({status:403,json:{error:'Reviewer access is required.'}}));
  await page.route('**/api/catalog**', route=>{
    if(route.request().method()!=='GET'){writes++;return route.fulfill({status:503,json:{error:'Your note was not saved. Please try again.'}});}
    reads++;return route.fulfill({json:{locations:[{id:'fixture-only',name:'Password updated.',country:'Example Country',kind:'direct',last_checked:'2026-11-07',latitude:null,longitude:null,source_url:'https://example.org/source',published:false}],total:1,reviews:[{location_id:'fixture-only',note:'Save review note',created_at:'2026-11-07T12:00:00Z'}]}});
  });
  await page.setViewportSize({width:390,height:844});await page.goto('/workspace');
  await expect(page.locator('.catalog-card')).toHaveCount(1);
  await page.getByRole('button',{name:'Review this listing',exact:true}).click();
  await page.locator('#reviewNote').fill('Nota privada de prueba, sin datos de personas.');
  const priorReads=reads;
  await page.locator('[data-contributor-language] select').selectOption('es');
  await expect(page.locator('#reviewSubmit')).toHaveText('Guardar nota de revisión');
  await expect(page.locator('#catalogQuery')).toHaveAttribute('placeholder','Nombre, ciudad, país o tipo de ayuda');
  await expect(page.locator('.catalog-card h2')).toHaveText('Password updated.');
  await expect(page.locator('.review-note p')).toHaveText('Save review note');
  await expect(page.locator('#reviewNote')).toHaveValue('Nota privada de prueba, sin datos de personas.');
  expect(reads).toBe(priorReads);expect(writes).toBe(0);
  await page.locator('#reviewSubmit').click();await expect(page.locator('#reviewStatus')).toHaveText('No se guardó tu nota. Inténtalo de nuevo.');
  await expect(page.locator('#reviewNote')).toHaveValue('Nota privada de prueba, sin datos de personas.');
  for(const width of [320,390]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);}
  const scan = await new AxeBuilder({page}).analyze();expect(scan.violations).toEqual([]);
  await info.attach('workspace-language-mobile',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await page.locator('[data-contributor-language] select').selectOption('en');
  await expect(page.locator('#reviewStatus')).toHaveText('Your note was not saved. Please try again.');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
  expect(writes).toBe(1);
});

test('editor language changes preserve field values and surface concurrent edits without submitting twice', async ({page}) => {
  const record={id:'fixture-only',name:'Password updated.',kind:'direct',category:'food',summary:'Original provider details',address:'12 Example Street, Example City',country:'Example Country',city:'Example City',hours:'',phone:'',eligibility:'Original requirements',sourceName:'Example source',sourceUrl:'https://example.org/source',lastChecked:'2026-11-07',lat:30,lng:-90};
  let patches=[];
  await page.route('**/workspace', route=>route.fulfill({status:200,contentType:'text/html',body:workspace,headers:{'Cache-Control':'private, no-store'}}));
  await page.route('**/api/correction-review**', route=>route.fulfill({status:403,json:{error:'Reviewer access is required.'}}));
  await page.route('**/api/catalog**',route=>{
    if(route.request().method()==='PATCH'){patches.push(route.request().postDataJSON());return route.fulfill({status:409,json:{error:'Another editor changed this listing. Reopen it before saving.'}});}
    if(new URL(route.request().url()).searchParams.has('id'))return route.fulfill({json:{location:{id:record.id,record,published:false,updated_at:'2026-11-07T12:00:00Z'},isEditor:true,databaseUrl:'https://example.org/database',history:[{operation:'UPDATE',changed_at:'2026-11-07T12:00:00Z',before_record:{name:'Password updated.'},after_record:{name:'Password updated.'}}]}});
    return route.fulfill({json:{locations:[{id:record.id,name:record.name,kind:'direct',country:record.country,source_url:record.sourceUrl,last_checked:record.lastChecked,published:false,latitude:record.lat,longitude:record.lng}],total:1,reviews:[]}});
  });
  await page.goto('/workspace');await page.getByRole('button',{name:'Inspect database record'}).click();
  const form=page.locator('#editorForm');await expect(form).toBeVisible();
  await form.locator('[name=reason]').fill('Fuente revisada; mantener instrucciones originales.');
  await page.locator('[data-contributor-language] select').selectOption('es');
  await expect(form.getByRole('button',{name:'Guardar revisión en la base de datos'})).toBeVisible();
  await expect(form.locator('[name=name]')).toHaveValue(record.name);
  await expect(form.locator('[name=published]')).toHaveValue('false');
  await expect(page.locator('#recordInspector details time')).toContainText('7 nov 2026');
  await expect(page.locator('#recordInspector pre')).toContainText('Password updated.');
  await form.getByRole('button',{name:'Guardar revisión en la base de datos'}).click();
  await expect(form.getByRole('status')).toHaveText('Otro editor cambió esta ficha. Vuelve a abrirla antes de guardar.');
  await expect(form.locator('[name=reason]')).toHaveValue('Fuente revisada; mantener instrucciones originales.');
  expect(patches).toHaveLength(1);expect(patches[0].updatedAt).toBe('2026-11-07T12:00:00Z');expect(patches[0].changes.name).toBe(record.name);expect(patches[0].published).toBe(false);
});
