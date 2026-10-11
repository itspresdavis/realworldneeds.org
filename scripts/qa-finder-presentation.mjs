/** Rendered contracts for the complete finder, not only the mobile breakpoint. */
export async function verifyFinderPresentation({ client, host, navigate, evaluate, capture }) {
  const close = (a, b) => Math.abs(a - b) <= 1;
  for (const width of [320, 390, 500, 600, 760, 900, 901, 1024, 1180, 1440]) {
    const height = width <= 600 ? 844 : 1000;
    await client.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
    await navigate(client, `${host}/`);
    const view = await evaluate(client, `(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
      };
      return {
        width: document.documentElement.clientWidth,
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
    if ([320, 390, 901, 1440].includes(width)) {
      await capture(client, `finder-presentation-${width}.png`);
      await evaluate(client, `document.querySelector('.globe-stage').scrollIntoView({block:'center'})`);
      await capture(client, `finder-map-${width}.png`);
      for (const section of ['results', 'about', 'standards']) {
        await evaluate(client, `document.getElementById('${section}').scrollIntoView({block:'start'})`);
        await capture(client, `finder-${section}-${width}.png`);
      }
      for (const [route, label] of [['/directory','directory'], ['/service/bowery-mission','service']]) {
        await navigate(client, `${host}${route}`);
        const geometry = await evaluate(client, `({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})`);
        if (geometry.scroll > geometry.client + 1) throw new Error(`${label} overflows at ${width}px: ${JSON.stringify(geometry)}`);
        await capture(client, `finder-journey-${label}-${width}.png`);
      }
    }
  }
  console.log('Finder presentation QA passed: 10 widths, real globe framing, aligned marker layers, compact controls, and no page overflow.');
}
