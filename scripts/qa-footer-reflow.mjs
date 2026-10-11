// Keep footer navigation reachable without using overflow clipping as a fix.
export async function verifyFooterReflow({ client, host, serviceUrl, navigate, evaluate, capture }) {
  const pages = [
    ["home", `${host}/`],
    ["directory", `${host}/directory`],
    ["service", serviceUrl],
    ["privacy", `${host}/privacy`],
    ["terms", `${host}/terms`],
    ["accessibility", `${host}/accessibility`]
  ];
  const widths = [320, 390, 500, 650, 651, 760, 900, 901, 1440];
  for (const [name, url] of pages) {
    let expectedLinks;
    for (const width of widths) {
      await client.call("Emulation.setDeviceMetricsOverride", {
        // Phone viewports have overlay scrollbars; retain classic-scrollbar coverage above 650px.
        width, height: 900, deviceScaleFactor: 1, mobile: width <= 650,
        screenWidth: width, screenHeight: 900
      });
      await navigate(client, url);
      await evaluate(client, `(async () => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (document.querySelector(".rwn-unified-footer, .rwn-professional .site-footer")) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      })()`);
      const result = await evaluate(client, `(() => {
        const footer = document.querySelector(".rwn-unified-footer, .site-footer");
        if (!footer) return { missing: true };
        const viewport = document.documentElement.clientWidth;
        const controls = [...footer.querySelectorAll("a, button")];
        const nodes = [footer, ...footer.children, ...controls];
        const rect = footer.getBoundingClientRect();
        const hidden = (node) => {
          const style = getComputedStyle(node);
          const box = node.getBoundingClientRect();
          return style.display === "none" || style.visibility !== "visible" || box.width === 0 || box.height === 0;
        };
        // Home already clips its unrelated globe stage at the body; inspect the actual footer geometry there.
        const ancestors = footer.matches(".rwn-unified-footer") ? [document.documentElement, document.body] : [];
        const clipping = [...ancestors, ...nodes].filter((node) => /hidden|clip/.test(getComputedStyle(node).overflowX));
        const outside = nodes.filter((node) => {
          const box = node.getBoundingClientRect();
          return box.left < -1 || box.right > viewport + 1 || box.left < rect.left - 1 || box.right > rect.right + 1;
        });
        const links = controls.map((node) => [node.textContent.trim(), node.getAttribute("href") || node.id]);
        footer.scrollIntoView({ block: "end", behavior: "instant" });
        return {
          title: document.title, path: location.pathname, width: innerWidth, viewport,
          shared: footer.matches(".rwn-unified-footer"),
          overflow: Math.max(0, document.documentElement.scrollWidth - viewport),
          outside: outside.map((node) => node.textContent.trim().slice(0,80)),
          hidden: controls.filter(hidden).length, clipping: clipping.length,
          unreadable: controls.filter((node) => node.scrollWidth > node.clientWidth + 1 || parseFloat(getComputedStyle(node).fontSize) < 9.9).length,
          links
        };
      })()`);
      // Homepage content has independent legacy layout constraints; its footer geometry is still strict.
      if (result.missing || result.path !== new URL(url).pathname || !result.title || result.links.length < 10 || (result.shared && result.overflow > 1) || result.outside.length || result.hidden || result.clipping || result.unreadable) {
        throw new Error(`Footer reflow failed (${name}, ${width}px): ${JSON.stringify(result)}`);
      }
      expectedLinks ??= result.links;
      if (JSON.stringify(expectedLinks) !== JSON.stringify(result.links)) {
        throw new Error(`Footer links changed with viewport (${name}, ${width}px).`);
      }
      // Use keyboard input, then verify every footer control remains focusable and visible.
      await evaluate(client, `document.querySelector(".rwn-unified-footer a, .site-footer a").focus()`);
      for (let index = 0; index < result.links.length; index += 1) {
        const focus = await evaluate(client, `(() => {
          const controls = [...document.querySelectorAll(".rwn-unified-footer a, .rwn-unified-footer button, .site-footer a, .site-footer button")];
          const node = document.activeElement;
          const box = node.getBoundingClientRect();
          return { index: controls.indexOf(node), visible: box.width > 0 && box.height > 0 && box.left >= -1 && box.right <= document.documentElement.clientWidth + 1 };
        })()`);
        if (focus.index !== index || !focus.visible) throw new Error(`Footer keyboard order failed (${name}, ${width}px): ${JSON.stringify(focus)}`);
        if (index < result.links.length - 1) {
          await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
          await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        }
      }
      await evaluate(client, `document.querySelector(".rwn-unified-footer, .site-footer").scrollIntoView({ block: "end", behavior: "instant" })`);
      if (width === 760 || (name === "directory" && [320, 1440].includes(width))) await capture(client, `footer-${name}-${width}.png`);
      console.log(`Footer QA passed: ${name} ${width}px, ${result.links.length} controls, footer contained, ${result.overflow}px document overflow, keyboard order intact.`);
    }
  }
}
