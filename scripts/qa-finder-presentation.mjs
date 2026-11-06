import { writeFile } from "node:fs/promises";

// Serialized into the CI browser and exercised directly with color fixtures.
// Transparent controls inherit their painted background; rgba(0,0,0,0) is not black.
export function renderedTextContrast(element) {
  const parse = color => {
    const values = color.match(/[\d.]+/g)?.map(Number);
    if (!values || values.length < 3) throw new Error(`Unsupported computed color: ${color}`);
    return [...values.slice(0, 3), values[3] ?? 1];
  };
  const composite = (front, back) => front.slice(0, 3).map((value, index) => value * front[3] + back[index] * (1 - front[3]));
  const layers = [];
  for (let current = element; current; current = current.parentElement) {
    layers.unshift(parse(getComputedStyle(current).backgroundColor));
  }
  const background = layers.reduce((under, layer) => composite(layer, under), [255, 255, 255]);
  const foreground = composite(parse(getComputedStyle(element).color), background);
  const luminance = rgb => rgb.map(value => value / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const levels = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (levels[1] + .05) / (levels[0] + .05);
}

/** Rendered contracts for the complete finder, not only the mobile breakpoint. */
export async function verifyFinderPresentation({ client, host, navigate, evaluate, capture }) {
  const close = (a, b) => Math.abs(a - b) <= 1;
  const designEvidence = [];
  for (const width of [320, 390, 500, 600, 760, 768, 900, 901, 1024, 1180, 1440]) {
    const height = width <= 600 ? 844 : 1000;
    await client.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
    await navigate(client, `${host}/`);
    // Earlier recovery tests intentionally leave a no-match query. Set each
    // visual state through the controls rather than silently inheriting it.
    await evaluate(client, `(async () => {
      document.querySelector('#clearSearch').click();
      document.querySelector('.quick-need--all')?.click();
      if (document.querySelector('#toggleSaved')?.getAttribute('aria-pressed') === 'true') document.querySelector('#toggleSaved').click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.scrollTo(0,0);
    })()`);
    const view = await evaluate(client, `(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
      };
      return {
        surface: rect('.finder-surface'),
        search: rect('#resourceSearch'),
        primaryAction: rect('#jumpResults'),
        heading: rect('.finder-intro h1'),
        titleColor: getComputedStyle(document.querySelector('.finder-intro h1')).color,
        surfaceColor: getComputedStyle(document.querySelector('.finder-surface')).backgroundColor,
        needRows: [...document.querySelectorAll('.quick-need')].map(node => ({label:node.textContent.trim(),top:Math.round(node.getBoundingClientRect().top),width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})),
        formOrder: [...document.querySelector('.finder-surface').children].map(node => node.id || node.className),
        width: document.documentElement.clientWidth,
        resultCountHeight: document.querySelector('#matchingResultCount').getBoundingClientRect().height,
        scrollWidth: document.documentElement.scrollWidth,
        stage: rect('.globe-stage'),
        canvas: rect('.globe-canvas'),
        pins: rect('.globe-pin-layer'),
        controls: rect('.globe-controls'),
        webgl: !document.querySelector('.globe-stage').classList.contains('is-globe-unavailable'),
        targets: [...document.querySelectorAll('.globe-controls button')].filter((node) => getComputedStyle(node).display !== 'none').map((node) => ({id:node.id,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})),
        sections: ['.about-rwn', '.source-band', '.mission-steps', '.principle-grid'].map((selector) => ({selector,...rect(selector)}))
      };
    })()`);
    designEvidence.push({width, ...view});
    if (width <= 390 && (view.search.bottom > 380 || view.primaryAction.bottom > 560)) {
      throw new Error(`Phone search or main action is buried below the useful first screen at ${width}px: ${JSON.stringify(view)}`);
    }
    if (view.surfaceColor !== 'rgb(255, 254, 251)' || view.titleColor !== 'rgb(249, 248, 239)' || view.formOrder[0] !== 'finder-search-label' || !view.formOrder.includes('jumpResults')) {
      throw new Error(`Homepage surface or grouping inherited the wrong theme at ${width}px: ${JSON.stringify(view)}`);
    }
    const lastNeedRow = view.needRows.at(-1).top;
    if (view.needRows.filter(need => need.top === lastNeedRow).length < 2 || view.needRows.some(need => need.width < 44 || need.height < 44)) {
      throw new Error(`Need choices are stranded or undersized at ${width}px: ${JSON.stringify(view.needRows)}`);
    }
    if (view.resultCountHeight > 24) throw new Error(`Matching-result count wraps at ${width}px.`);
    if (view.scrollWidth > view.width + 1 || view.sections.some((section) => section.x < -1 || section.right > view.width + 1)) {
      throw new Error(`Finder or explanation section overflows at ${width}px: ${JSON.stringify(view)}`);
    }
    if (!view.webgl) throw new Error(`Real WebGL is required for finder visual QA at ${width}px.`);
    if (!['x', 'y', 'width', 'height'].every((key) => close(view.canvas[key], view.pins[key]))) {
      throw new Error(`Globe canvas and marker coordinate systems differ at ${width}px: ${JSON.stringify(view)}`);
    }
    if (view.stage.height > 625 || view.stage.height < 350 || view.canvas.height < 200 || view.targets.length !== 4 || view.targets.some((button) => !close(button.width, 44) || !close(button.height, 44)) || view.controls.height > 180) {
      throw new Error(`Map framing or controls are not compact at ${width}px: ${JSON.stringify(view)}`);
    }
    if ([320, 390, 768, 901, 1180, 1440].includes(width)) {
      await capture(client, `finder-presentation-${width}.png`);
      await evaluate(client, `document.querySelector('.globe-stage').scrollIntoView({block:'center'})`);
      await capture(client, `finder-map-${width}.png`);
      for (const section of ['results', 'about', 'standards']) {
        await evaluate(client, `document.getElementById('${section}').scrollIntoView({block:'start'})`);
        await capture(client, `finder-${section}-${width}.png`);
      }
      await evaluate(client, `(async () => {
        const input = document.querySelector('#resourceSearch');
        input.value = 'zzzz-finder-visual-no-match';
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.blur();
        await new Promise((resolve) => setTimeout(resolve,500));
        document.querySelector('.globe-stage').scrollIntoView({block:'center'});
      })()`);
      const empty = await evaluate(client, `(() => {
        const element = document.querySelector('#globeEmpty');
        const box = element.getBoundingClientRect();
        const controls = document.querySelector('.globe-controls').getBoundingClientRect();
        const stage = document.querySelector('.globe-stage').getBoundingClientRect();
        const luminance = (color) => color.match(/[\\d.]+/g).slice(0,3).map(Number).map((value) => value/255).map((value) => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4).reduce((sum,value,index) => sum+value*[.2126,.7152,.0722][index],0);
        const background = luminance(getComputedStyle(element).backgroundColor);
        const contrast = [...element.querySelectorAll('strong,p')].map((node) => {
          const foreground = luminance(getComputedStyle(node).color);
          return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);
        });
        return {visible:!element.hidden,contrast,within:box.left>=stage.left&&box.right<=stage.right&&box.top>=stage.top&&box.bottom<=stage.bottom,clearOfControls:box.right<=controls.left||box.bottom<=controls.top||box.top>=controls.bottom};
      })()`);
      await capture(client, `finder-empty-map-${width}.png`);
      if (!empty.visible || !empty.within || !empty.clearOfControls || empty.contrast.length !== 2 || empty.contrast.some((ratio) => !Number.isFinite(ratio) || ratio < 4.5)) {
        throw new Error(`Empty map is unreadable or overlaps controls at ${width}px: ${JSON.stringify(empty)}`);
      }
      await evaluate(client, `document.getElementById('results').scrollIntoView({block:'start'})`);
      await capture(client, `finder-empty-results-${width}.png`);
      for (const [route, label] of [['/directory','directory'], ['/service/bowery-mission','service']]) {
        await navigate(client, `${host}${route}`);
        const geometry = await evaluate(client, `({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})`);
        if (geometry.scroll > geometry.client + 1) throw new Error(`${label} overflows at ${width}px: ${JSON.stringify(geometry)}`);
        if (label === 'service') {
          const service = await evaluate(client, `(() => {
            const button = document.querySelector('[data-service-save]');
            if (!button) throw new Error('Save control did not initialize');
            const luminance = (color) => {
              const rgb = color.match(/[\\d.]+/g).slice(0,3).map(Number).map((value) => value / 255);
              const linear = rgb.map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
              return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
            };
            const state = () => {
              const style = getComputedStyle(button);
              const levels = [luminance(style.color), luminance(style.backgroundColor)].sort((a,b) => a-b);
              return {label:button.textContent.trim(),pressed:button.getAttribute('aria-pressed'),contrast:(levels[1]+.05)/(levels[0]+.05)};
            };
            const before = state();
            button.click();
            const toggled = state();
            button.click();
            const restored = state();
            const note = document.querySelector('.service-next-steps + .policy-note');
            const tools = document.querySelector('[data-service-utility]');
            const contrastFor = ${renderedTextContrast.toString()};
            const nextActions = [...document.querySelectorAll('.service-next-steps a')].map((link) => {
              const text = [link, ...link.querySelectorAll('strong, span')];
              const box = link.getBoundingClientRect();
              return {label:link.firstChild?.textContent?.trim(),href:link.href,top:box.top,bottom:box.bottom,contact:link.parentElement.matches('.service-contact-buttons'),map:!!link.closest('.service-location-actions'),contrast:Math.min(...text.map(contrastFor))};
            });
            return {before,toggled,restored,nextActions,warningBeforeTools:!note || Boolean(note.compareDocumentPosition(tools) & 4)};
          })()`);
          if ([service.before, service.toggled, service.restored].some((state) => !state.label || !Number.isFinite(state.contrast) || state.contrast < 4.5) || service.before.pressed === service.toggled.pressed || service.before.pressed !== service.restored.pressed || !service.warningBeforeTools) {
            throw new Error(`Service action contrast/state/order failed at ${width}px: ${JSON.stringify(service)}`);
          }
          const contacts = service.nextActions.filter(action => action.contact);
          const maps = service.nextActions.filter(action => action.map);
          const contactsAligned = width < 901 || contacts.every(action => close(action.top, contacts[0].top));
          const mapsBelow = maps.every(map => contacts.every(contact => map.top >= contact.bottom));
          // Bowery's reviewed routes use different entrances and intake steps.
          // Preserve geometry/contrast checks while proving the actual next steps.
          const expectedLabels = ['Directions to meal service', 'Shelter intake details', 'Showers and clothing details', 'Mobile medical care details', 'Interactive map'];
          const accessByLabel = new Map(maps.map(action => [action.label, action]));
          const mealHref = accessByLabel.get('Directions to meal service')?.href;
          const mealUrl = mealHref ? new URL(mealHref) : null;
          const correctMeal = mealUrl?.origin === 'https://www.google.com' && mealUrl.pathname === '/maps/dir/' && mealUrl.searchParams.get('destination') === '227 Bowery, New York, NY 10002';
          const correctIntake = expectedLabels.slice(1, 4).every(label => accessByLabel.get(label)?.href === 'https://www.bowery.org/get-help/');
          const correctGlobe = accessByLabel.get('Interactive map')?.href === host + '/#resource=bowery-mission';
          const correctRoutes = maps.length === expectedLabels.length && accessByLabel.size === expectedLabels.length && expectedLabels.every(label => accessByLabel.has(label)) && correctMeal && correctIntake && correctGlobe;
          if (contacts.length !== 2 || !correctRoutes || service.nextActions.some((action) => !Number.isFinite(action.contrast) || action.contrast < 4.5) || !contactsAligned || !mapsBelow) {
            throw new Error(`Service next-step labels or row alignment failed at ${width}px: ${JSON.stringify(service.nextActions)}`);
          }
        }
        await capture(client, `finder-journey-${label}-${width}.png`);
      }
    }
  }
  await writeFile('qa-screenshots/homepage-design-geometry.json', JSON.stringify(designEvidence, null, 2));
  console.log('Finder presentation QA passed: 11 widths, real globe framing, aligned marker layers, compact controls, and no page overflow.');
}
