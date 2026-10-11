import { writeFile } from "node:fs/promises";

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
            const nextActions = [...document.querySelectorAll('.service-next-steps a')].map((link) => {
              const subtitle = link.querySelector('span');
              const foreground = getComputedStyle(subtitle || link).color;
              const background = getComputedStyle(link).backgroundColor;
              const levels = [luminance(foreground),luminance(background)].sort((a,b) => a-b);
              return {top:link.getBoundingClientRect().top,contrast:(levels[1]+.05)/(levels[0]+.05)};
            });
            return {before,toggled,restored,nextActions,warningBeforeTools:!note || Boolean(note.compareDocumentPosition(tools) & 4)};
          })()`);
          if ([service.before, service.toggled, service.restored].some((state) => !state.label || !Number.isFinite(state.contrast) || state.contrast < 4.5) || service.before.pressed === service.toggled.pressed || service.before.pressed !== service.restored.pressed || !service.warningBeforeTools) {
            throw new Error(`Service action contrast/state/order failed at ${width}px: ${JSON.stringify(service)}`);
          }
          if (service.nextActions.some((action) => !Number.isFinite(action.contrast) || action.contrast < 4.5) || (width >= 901 && service.nextActions.length === 4 && service.nextActions.some((action) => !close(action.top,service.nextActions[0].top)))) {
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
