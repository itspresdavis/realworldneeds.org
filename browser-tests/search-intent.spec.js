import { test, expect } from "@playwright/test";
test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /webgl/i.test(type) ? null : original.call(this, type, ...args);
    };
    window.__locationCalls = 0;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition() {
          window.__locationCalls++;
        },
      },
    });
  });
});
for (const path of ["/", "/directory"]) {
  const home = path === "/";
  const needSelector = home ? "#resourceSearch" : "[data-directory-query]",
    placeSelector = home ? "#resourcePlace" : "[data-directory-place]",
    rows = home
      ? ".resource-card[data-result-resource-id]"
      : "a.directory-global-result";
  const ids = (page) =>
    page
      .locator(rows)
      .evaluateAll(
        (nodes, isHome) =>
          nodes.map((node) =>
            isHome
              ? node.dataset.resultResourceId
              : node.getAttribute("href").split("/").pop(),
          ),
        home,
      );
  const settled = async (page, query) => {
    if (home) await page.locator(needSelector).press("Enter");
    await expect
      .poll(() =>
        page.evaluate(
          (isHome) =>
            history.state?.[isHome ? "rwnFinder" : "rwnDirectory"]?.query,
          home,
        ),
      )
      .toBe(query);
    const selectedPlace = await page.locator(placeSelector).inputValue();
    await expect.poll(() => page.evaluate(isHome =>
      history.state?.[isHome ? "rwnFinder" : "rwnDirectoryIntent"]?.place || "", home))
      .toBe(selectedPlace);
    if (!home) await expect(page.locator("[data-directory-count]")).not.toContainText("Searching");
  };
  test(`${path}: urgent wording preserves useful services and independent manual place`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    const need = page.locator(needSelector),
      place = page.locator(placeSelector);
    await need.fill("shelter");
    await place.fill("Boston MA");
    await settled(page, "shelter");
    await expect(page.locator(rows).first()).toBeVisible();
    const ordinary = await ids(page);
    await need.fill("shelter tonight");
    await settled(page, "shelter tonight");
    expect(await ids(page)).toEqual(ordinary);
    await expect(page.locator("[data-search-intent]")).toContainText(
      "does not confirm availability",
    );
    await expect(place).toHaveValue("Boston MA");
    expect(await page.evaluate(() => window.__locationCalls)).toBe(0);
    await place.fill("Longyearbyen Norway");
    await expect(page.locator(rows)).toHaveCount(0);
    await expect(need).toHaveValue("shelter tonight");
    await expect(place).toHaveValue("Longyearbyen Norway");
    await info.attach("independent-place-empty", {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });
  });
  test(`${path}: postal search requires a deliberate US area choice and preserves zeros`, async ({
    page,
  }, info) => {
    await page.goto(path);
    const need = page.locator(needSelector),
      place = page.locator(placeSelector);
    await need.fill("food");
    await place.fill("02108");
    await settled(page, "food");
    await expect(
      page.getByRole("button", { name: "Use US ZIP 02108", exact: true }),
    ).toBeVisible();
    await expect(page.locator(rows)).toHaveCount(0);
    await page
      .getByRole("button", { name: "Use US ZIP 02108", exact: true })
      .click();
    await expect
      .poll(async () => (await ids(page)).includes("rosies-place-boston"))
      .toBe(true);
    expect(await ids(page)).not.toContain("bowery-mission");
    await expect(page.locator("[data-search-intent]")).toContainText(
      "10 km · US ZIP 02108",
    );
    await expect(place).toHaveValue("02108");
    expect(await page.evaluate(() => window.__locationCalls)).toBe(0);
    await page.reload();
    await expect(place).toHaveValue("02108");
    await expect
      .poll(async () => (await ids(page)).includes("rosies-place-boston"))
      .toBe(true);
    await place.fill("99999");
    await expect(page.locator(rows)).toHaveCount(0);
    await expect(page.locator("[data-search-intent]")).toContainText(
      "not supported",
    );
    await expect(need).toHaveValue("food");
    await info.attach("unsupported-postal-keeps-context", {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });
  });
  test(`${path}: explicit food choices keep location and avoid benefit-only meal results`, async ({
    page,
  }) => {
    await page.goto(path);
    const need = page.locator(needSelector),
      place = page.locator(placeSelector);
    await need.fill("food");
    await place.fill("Boston MA");
    await settled(page, "food");
    await page
      .locator("[data-search-intent]")
      .getByRole("button", { name: "Meals", exact: true })
      .click();
    await settled(page, "meals");
    await expect(place).toHaveValue("Boston MA");
    await expect.poll(async () => (await ids(page)).length).toBeGreaterThan(0);
    expect((await ids(page)).some((id) => id.includes("wic"))).toBe(false);
    await place.fill("Nowhere 99999");
    await place.fill("Boston MA");
    await expect.poll(async () => (await ids(page)).length).toBeGreaterThan(0);
    await expect(place).toHaveValue("Boston MA");
  });
}

test("postal data stays optional and a real failed fetch can recover on retry", async ({
  page,
}) => {
  let requests = 0,
    unavailable = true;
  await page.route("**/data/postal-areas*.json*", (route) => {
    requests++;
    return unavailable
      ? route.fulfill({ status: 503, body: "Unavailable" })
      : route.continue();
  });
  await page.goto("/");
  await page.locator("#resourceSearch").fill("food");
  await page.locator("#resourcePlace").fill("Boston MA");
  await expect
    .poll(() => page.evaluate(() => history.state?.rwnFinder?.place))
    .toBe("Boston MA");
  expect(requests).toBe(0);
  await page.locator("#resourcePlace").fill("02108");
  await expect(page.locator("[data-search-intent]")).toContainText(
    "Postal lookup is unavailable",
  );
  expect(requests).toBe(1);
  unavailable = false;
  await page
    .getByRole("button", { name: "Retry postal lookup", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Use US ZIP 02108", exact: true }),
  ).toBeVisible();
  expect(requests).toBe(2);
  await expect(page.locator("#resourceSearch")).toHaveValue("food");
  await expect(page.locator("#resourcePlace")).toHaveValue("02108");
});

test("a manual place supersedes a pending device-location result", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (success, failure) => {
      window.__locationCalls++;
      window.__pendingLocation = { success, failure };
    };
  });
  await page.locator("#locateMe").click();
  await expect(page.locator("#locateMe")).toHaveClass(/is-loading/);
  await page.locator("#resourceSearch").fill("shelter");
  await page.locator("#resourcePlace").fill("Boston MA");
  await expect.poll(() => page.evaluate(() => history.state?.rwnFinder?.place)).toBe("Boston MA");
  await expect(page.locator("#locateMe")).not.toHaveClass(/is-loading/);
  const before = await page.locator(".resource-card[data-result-resource-id]").evaluateAll(nodes => nodes.map(node => node.dataset.resultResourceId));
  expect(before.length).toBeGreaterThan(0);
  await page.evaluate(async () => {
    await window.__pendingLocation.success({ coords: { latitude: 47.6062, longitude: -122.3321, accuracy: 100 } });
    window.__pendingLocation.failure({ code: 1 });
  });
  await expect(page.locator("#resourcePlace")).toHaveValue("Boston MA");
  await expect(page.locator("#clearLocation")).toBeHidden();
  await expect(page.locator("#locationRecovery")).toBeHidden();
  expect(await page.locator(".resource-card[data-result-resource-id]").evaluateAll(nodes => nodes.map(node => node.dataset.resultResourceId))).toEqual(before);
  expect(await page.evaluate(() => window.__locationCalls)).toBe(1);
});

for (const path of ["/", "/directory"]) {
  test(`${path}: changing food need preserves the explicitly selected postal area`, async ({ page }) => {
    const home = path === "/";
    const need = page.locator(home ? "#resourceSearch" : "[data-directory-query]");
    const place = page.locator(home ? "#resourcePlace" : "[data-directory-place]");
    await page.goto(path);
    await need.fill("food");
    await place.fill("02108");
    await page.getByRole("button", { name: "Use US ZIP 02108", exact: true }).click();
    await expect(page.locator("[data-search-intent]")).toContainText("10 km · US ZIP 02108");
    await page.locator("[data-search-intent]").getByRole("button", { name: "Meals", exact: true }).click();
    await expect(need).toHaveValue("meals");
    await expect(place).toHaveValue("02108");
    await expect(page.locator("[data-search-intent]")).toContainText("10 km · US ZIP 02108");
    await expect(page.locator(home ? '.resource-card[data-result-resource-id="rosies-place-boston"]' : '.directory-global-result[href="/service/rosies-place-boston"]')).toBeVisible();
    expect(await page.evaluate(() => window.__locationCalls)).toBe(0);
  });
}

for (const path of ["/", "/directory"]) {
  test(`${path}: a postal area alone filters services without inventing a need`, async ({ page }) => {
    const home = path === "/";
    await page.goto(path);
    const need = page.locator(home ? "#resourceSearch" : "[data-directory-query]");
    await page.locator(home ? "#resourcePlace" : "[data-directory-place]").fill("02108");
    await page.getByRole("button", { name: "Use US ZIP 02108", exact: true }).click();
    await expect(need).toHaveValue("");
    // Both surfaces paginate (8 finder rows / 60 directory rows). Check the
    // complete bounded result set, not an arbitrary provider's initial rank.
    await expect(page.locator("[data-search-intent]")).toContainText("10 km · US ZIP 02108");
    const more = page.locator(home ? "#showMoreResults" : "[data-directory-more]");
    const rows = page.locator(home ? ".resource-card[data-result-resource-id]" : ".directory-global-result");
    await expect(rows.first()).toBeVisible();
    for (let batch = 0; batch < 100 && await more.isVisible(); batch++) {
      const before = await rows.count();
      await more.click();
      await expect.poll(() => rows.count()).toBeGreaterThan(before);
    }
    await expect(more).toBeHidden();
    await expect(page.locator(home ? '.resource-card[data-result-resource-id="rosies-place-boston"]' : '.directory-global-result[href="/service/rosies-place-boston"]')).toBeVisible();
    await expect(page.locator(home ? '.resource-card[data-result-resource-id="bowery-mission"]' : '.directory-global-result[href="/service/bowery-mission"]')).toHaveCount(0);
    await expect(page.locator("[data-search-intent]")).toContainText("10 km · US ZIP 02108");
    expect(await page.evaluate(() => window.__locationCalls)).toBe(0);
  });
}

test("directory resolves one bounded intent per search pass while keeping the latest place", async ({ page }) => {
  let instrumented = false;
  await page.route("**/src/utils/search-intent*.js*", async route => {
    const response = await route.fetch();
    let body = await response.text();
    const declaration = 'export function resolveSearchIntent(query, place = "", selection = null) {';
    if (body.includes(declaration)) {
      instrumented = true;
      body = body.replace(declaration, declaration + '\nwindow.__intentResolutions = (window.__intentResolutions || 0) + 1;');
    }
    await route.fulfill({ response, body });
  });
  await page.goto("/directory");
  await page.locator("[data-directory-query]").fill("shelter");
  await page.locator("[data-directory-place]").fill("Boston MA");
  await expect(page.locator('a.directory-global-result[href="/service/pine-street-mens-inn"]')).toBeVisible();
  await page.locator("[data-directory-place]").fill("Longyearbyen Norway");
  await expect(page.locator("a.directory-global-result")).toHaveCount(0);
  await page.locator("[data-directory-place]").fill("Boston MA");
  await expect(page.locator('a.directory-global-result[href="/service/pine-street-mens-inn"]')).toBeVisible();
  expect(instrumented).toBe(true);
  const resolutions = await page.evaluate(() => window.__intentResolutions);
  expect(resolutions).toBeGreaterThan(0);
  // A search pass uses the complete catalog, but intent parsing is independent
  // of its size. This guards the previous ~2,000 parses per keystroke.
  expect(resolutions).toBeLessThan(30);
});

for (const clearDraft of [false, true]) {
  test(`delayed directory enhancement preserves an early ${clearDraft ? "cleared" : "typed"} place`, async ({ page }) => {
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    await page.route("**/src/utils/search-intent-entry*.js*", async route => {
      await ready;
      await route.continue();
    });
    if (clearDraft) await page.addInitScript(() => {
      history.replaceState({ rwnDirectoryIntent: { path: "/directory", place: "Boston MA", postalArea: null } }, "");
    });
    await page.goto("/directory", { waitUntil: "commit" });
    const need = page.locator("[data-directory-query]");
    const place = page.locator("[data-directory-place]");
    await need.fill("shelter");
    await place.fill("Boston MA");
    if (clearDraft) await place.fill("");
    release();
    await expect.poll(() => page.evaluate(() => Boolean(document.querySelector("[data-directory-search]").rwnIntent))).toBe(true);
    await expect(place).toHaveValue(clearDraft ? "" : "Boston MA");
    await expect.poll(() => page.evaluate(() => history.state?.rwnDirectoryIntent?.place)).toBe(clearDraft ? "" : "Boston MA");
    await expect(page.locator(clearDraft
      ? 'a.directory-global-result[href="/service/bowery-mission"]'
      : 'a.directory-global-result[href="/service/pine-street-mens-inn"]')).toBeVisible();
    if (!clearDraft) await expect(page.locator('a.directory-global-result[href="/service/bowery-mission"]')).toHaveCount(0);
    await expect(need).toHaveValue("shelter");
    expect(await page.evaluate(() => window.__locationCalls)).toBe(0);
  });
}

for (const width of [1440, 390]) {
  test(`directory Back and reload preserve the focused listing after a second batch at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.goto("/directory");
    await page.locator("[data-directory-country]").selectOption("United States");
    await page.locator("[data-directory-query]").fill("WIC");
    await expect(page.locator("a.directory-global-result")).toHaveCount(60);
    if (width < 900) await page.locator("[data-directory-need]").selectOption("Food");
    else await page.locator('[data-directory-category="Food"]').click();
    await expect(page.locator("[data-directory-count]")).not.toContainText("Searching");
    await page.locator("[data-directory-more]").click();
    await expect(page.locator("a.directory-global-result")).toHaveCount(120);
    const target = page.locator("a.directory-global-result").nth(60);
    await expect(target).toBeFocused();
    const href = await target.getAttribute("href");
    await target.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await page.goBack();
    const returned = page.locator(`a.directory-global-result[href="${href}"]`);
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      await expect(page.locator("[data-directory-query]")).toHaveValue("WIC");
      await expect(page.locator("[data-directory-country]")).toHaveValue("United States");
      await expect(page.locator("a.directory-global-result")).toHaveCount(120);
      await expect(returned).toBeFocused();
      expect(await returned.evaluate(node => {
        const box = node.getBoundingClientRect();
        return box.top >= document.querySelector(".legal-header").getBoundingClientRect().bottom + 6 && box.bottom <= innerHeight - 6;
      })).toBe(true);
      expect(await page.evaluate(() => location.search || location.hash)).toBe("");
    }
    const savedScroll = await page.evaluate(() => scrollY);
    // Header controls are already visible. Use their actual pointer locations
    // so test-driver auto-scroll does not change the return position first.
    if (width < 900) {
      const menu = await page.locator(".rwn-page-menu > summary").boundingBox();
      await page.mouse.click(menu.x + menu.width / 2, menu.y + menu.height / 2);
    }
    const savedLink = await page.locator('.legal-header a[href="/directory#saved"]:visible').boundingBox();
    await page.mouse.click(savedLink.x + savedLink.width / 2, savedLink.y + savedLink.height / 2);
    await expect(page.locator("#saved-services-heading")).toBeFocused();
    await page.goBack();
    await expect(page.locator("a.directory-global-result")).toHaveCount(120);
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.matches("a.directory-global-result")))).toBe(true);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(savedScroll, 0);
  });
}
