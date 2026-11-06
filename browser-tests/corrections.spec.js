import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { correctionUIFixture } from './corrections-ui-gate.js';

let fixture;
test.beforeEach(async({page})=>{
  fixture=await correctionUIFixture();
  page.__errors=[];page.on('pageerror',error=>page.__errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===fixture.url?route.continue():route.abort());
});
test.afterEach(async({page})=>{await fixture.close();expect(page.__errors).toEqual([]);});
const capture = async (page,name) => {
  const path=test.info().outputPath(`${name}.png`);
  await page.screenshot({path});
  await test.info().attach(name,{path,contentType:'image/png'});
};
const overflow = async page => expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

test('disabled public corrections collect nothing and remain accessible without JavaScript',async({page,browser})=>{
  await page.goto(fixture.url+'/corrections?resourceId=bowery-mission');
  await expect(page.locator('#correction-availability')).toContainText('not available yet');
  await expect(page.locator('#correction-form')).toBeHidden();
  expect(fixture.state.submissions).toHaveLength(0);
  await page.setViewportSize({width:320,height:720});await overflow(page);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await capture(page,'corrections-disabled-mobile');
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:320,height:720}}),plain=await context.newPage();
  try{await plain.goto(fixture.url+'/corrections?resourceId=bowery-mission');await expect(plain.locator('#correction-form')).toBeHidden();await expect(plain.locator('noscript p')).toContainText('No report has been sent');}finally{await context.close();}
});

test('enabled correction UI keeps a failed draft and retries the same submission without claiming publication',async({page})=>{
  fixture.state.enabled=true;fixture.state.failSubmission=true;
  await page.goto(fixture.url+'/corrections?resourceId=bowery-mission&note=must-not-prefill&query=private');
  await expect(page.locator('#correction-form')).toBeVisible();
  await expect(page.getByLabel('Listing details to check (optional)')).toHaveValue('');
  await expect(page.locator('#correction-category option')).toHaveCount(9);
  await page.getByLabel('Issue',{exact:true}).selectOption('wrong-address');
  await page.getByLabel('Listing details to check (optional)').fill('Check the current public intake entrance.');
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await overflow(page);}
  await page.setViewportSize({width:390,height:844});
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  const button=page.getByRole('button',{name:'Send correction report'});expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await button.focus();await page.keyboard.press('Enter');
  await expect(page.locator('#correction-status')).toContainText('could not confirm');
  await expect(page.getByLabel('Listing details to check (optional)')).toHaveValue('Check the current public intake entrance.');
  await page.getByRole('button',{name:'Retry correction report'}).click();
  await expect(page.locator('#correction-status')).toContainText('saved for review');
  await expect(page.locator('#correction-status')).toContainText('not changed the public listing');
  await expect(page.locator('#correction-status')).toBeFocused();
  expect(fixture.state.submissions).toHaveLength(2);expect(fixture.state.submissions[0]).toEqual(fixture.state.submissions[1]);
  expect(Object.keys(fixture.state.submissions[0]).sort()).toEqual(['category','note','resourceId','submissionId']);
  await capture(page,'correction-confirmed-mobile');
});

test('private review renders reports safely, reconciles conflict and requires a separate save',async({page})=>{
  await page.goto(fixture.url+'/review-fixture');
  await page.getByRole('button',{name:'Review correction for The Bowery Mission'}).click();
  await expect(page.locator('.correction-review__note').first()).toContainText('<img src=x');
  await expect(page.locator('.correction-review img')).toHaveCount(0);
  await page.getByRole('combobox',{name:'Decision status',exact:true}).selectOption('ready');
  await page.getByLabel('Reason and source findings',{exact:true}).fill('Reviewed the official provider intake details.');
  await page.getByLabel('Evidence URL (HTTPS)',{exact:true}).fill('https://www.bowery.org/get-help/');
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await overflow(page);}
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  fixture.state.conflict=true;
  await page.getByRole('button',{name:'Save review decision',exact:true}).click();
  await expect(page.locator('.correction-review__detail')).toContainText('Another reviewer changed');
  await page.getByRole('button',{name:'Reload report and keep my draft'}).click();
  await expect(page.getByLabel('Reason and source findings',{exact:true})).toHaveValue('Reviewed the official provider intake details.');
  expect(fixture.state.decisions).toHaveLength(1);
  await page.getByRole('button',{name:'Save review decision',exact:true}).click();
  await expect(page.locator('.correction-review__detail')).toContainText('No public listing was changed or published');
  expect(fixture.state.decisions[1].revision).toBe(2);
  await page.setViewportSize({width:390,height:844});
  await capture(page,'correction-review-mobile');
  fixture.state.denied=true;await page.getByRole('button',{name:'Refresh correction queue'}).click();
  await expect(page.locator('[data-correction-review]')).toBeHidden();
  await expect(page.locator('[data-correction-review]')).not.toContainText('The Bowery Mission');
});
