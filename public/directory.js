const root = document.querySelector("[data-directory-search]");

if (root) {
  const input = root.querySelector("[data-directory-query]");
  const clear = root.querySelector("[data-directory-clear]");
  const count = root.querySelector("[data-directory-count]");
  const chips = root.querySelector("[data-directory-categories]");
  const shell = root.closest(".directory-shell");
  const pageRecords = [...document.querySelectorAll(".directory-records > .directory-record")];
  const collator = new Intl.Collator(undefined, { sensitivity: "base", usage: "search" });
  const MAX_RESULTS = 60;
  const currentScope = (location.pathname.replace(/\/page\/\d+\/?$/, "").replace(/\/$/, "") || "/directory");
  const releaseVersion = new URL(import.meta.url).searchParams.get("v") || "";
  const searchIndexUrl = `/data/search-index.json${releaseVersion ? `?v=${encodeURIComponent(releaseVersion)}` : ""}`;

  const normalize = (value) => String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();

  const aliases = new Map(Object.entries({
    meals: "food", meal: "food", pantry: "food", pantries: "food", groceries: "food", comida: "food", nourriture: "food",
    drinking: "water", hydration: "water", agua: "water", eau: "water",
    housing: "shelter", homeless: "shelter", bed: "shelter", albergue: "shelter", refugio: "shelter", alojamiento: "shelter", abri: "shelter",
    shower: "hygiene", showers: "hygiene", laundry: "hygiene", toiletries: "hygiene", ducha: "hygiene", duchas: "hygiene", lavanderia: "hygiene", douche: "hygiene",
    clothes: "clothing", shoes: "clothing", blanket: "clothing", ropa: "clothing", roupas: "clothing", vetements: "clothing",
    doctor: "health", clinic: "health", clinics: "health", dental: "health", medical: "health", healthcare: "health", salud: "health", saude: "health", sante: "health", clinica: "health"
  }));
  const noise = new Set(["a", "an", "the", "for", "to", "of", "please", "find", "finding", "need", "needs", "help", "free", "near", "nearby", "me", "my", "local", "around", "ayuda", "gratis", "cerca", "aide", "gratuit", "ajuda", "perto"]);
  const queryTokens = (value) => normalize(value).split(/\s+/).filter((token) => token && !noise.has(token)).map((token) => aliases.get(token) || token);

  let categoryLabels = [...new Set(pageRecords.flatMap((record) => [...record.querySelectorAll(".directory-aid li")].map((item) => item.textContent.trim())).filter(Boolean))]
    .sort((a, b) => collator.compare(a, b));

  const results = document.createElement("section");
  results.className = "directory-global-results";
  results.hidden = true;
  results.setAttribute("aria-label", "Full directory search results");
  results.innerHTML = `<div class="directory-global-results__heading"><strong>Search results</strong><span data-global-summary></span></div><div class="directory-global-results__list" data-global-list></div>`;
  root.insertAdjacentElement("afterend", results);
  const resultList = results.querySelector("[data-global-list]");
  const resultSummary = results.querySelector("[data-global-summary]");

  let activeCategory = "";
  let catalogPromise;
  let generation = 0;

  const scopedRecords = (payload) => {
    if (currentScope === "/directory") return payload.records;
    return (payload.scopes[currentScope] || []).map((index) => payload.records[index]).filter(Boolean);
  };

  const renderChips = () => {
    if (!chips) return;
    const expected = [["All help", ""], ...categoryLabels.map((label) => [label, label])];
    const current = [...chips.querySelectorAll("[data-directory-category]")];
    const matchesExpected = current.length === expected.length
      && current.every((button, index) => button.dataset.directoryCategory === expected[index][1]);

    if (!matchesExpected) {
      const fragment = document.createDocumentFragment();
      for (const [label, value] of expected) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.directoryCategory = value;
        button.textContent = label;
        fragment.append(button);
      }
      chips.replaceChildren(fragment);
    }

    for (const button of chips.querySelectorAll("[data-directory-category]")) {
      button.setAttribute("aria-pressed", String(normalize(button.dataset.directoryCategory) === activeCategory));
    }
  };

  const syncCategoryLabels = (payload) => {
    const fullLabels = [...new Set(scopedRecords(payload).flatMap((record) => record.categoryLabels || []).filter(Boolean))]
      .sort((a, b) => collator.compare(a, b));
    if (fullLabels.length === categoryLabels.length && fullLabels.every((label, index) => label === categoryLabels[index])) return;
    categoryLabels = fullLabels;
    renderChips();
  };

  const loadCatalog = () => {
    catalogPromise ||= fetch(searchIndexUrl, { credentials: "same-origin", cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Search index unavailable (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        if (!Array.isArray(payload.records) || !payload.scopes) throw new Error("Search index is invalid");
        return payload;
      });
    return catalogPromise;
  };

  const clearGlobalResults = () => {
    results.hidden = true;
    resultList.replaceChildren();
    shell?.classList.remove("has-global-search");
    if (count) count.textContent = `${pageRecords.length.toLocaleString()} listings on this page`;
  };

  const scoreRecord = (record, tokens) => {
    const name = normalize(record.name);
    const place = normalize(record.place);
    if (!tokens.every((token) => record.search.includes(token))) return -1;
    return tokens.reduce((score, token) => score + (name === token ? 25 : name.startsWith(token) ? 16 : name.includes(token) ? 10 : place.includes(token) ? 7 : 2), 0);
  };

  const resultRow = (record) => {
    const link = document.createElement("a");
    link.className = "directory-global-result";
    link.href = `/service/${encodeURIComponent(record.id)}`;
    const main = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = record.name;
    const place = document.createElement("span");
    place.textContent = record.place;
    main.append(name, place);
    const meta = document.createElement("small");
    meta.textContent = `${record.categoryLabels.join(" · ")} · checked ${record.checked}`;
    link.append(main, meta);
    return link;
  };

  const apply = async () => {
    const query = input?.value || "";
    const tokens = queryTokens(query);
    const filtering = Boolean(tokens.length || activeCategory);
    const currentGeneration = ++generation;
    if (clear) clear.hidden = !filtering;
    root.classList.toggle("has-filter", filtering);
    if (!filtering) {
      clearGlobalResults();
      return;
    }

    if (count) count.textContent = "Searching this directory…";
    try {
      const payload = await loadCatalog();
      if (currentGeneration !== generation) return;
      syncCategoryLabels(payload);
      const scoped = scopedRecords(payload);
      const matches = scoped
        .filter((record) => !activeCategory || record.categoryLabels.some((label) => normalize(label) === activeCategory))
        .map((record) => ({ record, score: scoreRecord(record, tokens) }))
        .filter(({ score }) => score >= 0)
        .sort((left, right) => right.score - left.score || collator.compare(left.record.name, right.record.name));

      resultList.replaceChildren(...matches.slice(0, MAX_RESULTS).map(({ record }) => resultRow(record)));
      results.hidden = false;
      shell?.classList.add("has-global-search");
      const shown = Math.min(matches.length, MAX_RESULTS);
      resultSummary.textContent = matches.length > shown ? `${matches.length.toLocaleString()} matches · showing the first ${shown}` : `${matches.length.toLocaleString()} matches across ${scoped.length.toLocaleString()} listings in this directory`;
      if (count) count.textContent = matches.length ? `${matches.length.toLocaleString()} matching listings` : "No matching listings";
    } catch {
      if (currentGeneration !== generation) return;
      clearGlobalResults();
      if (count) count.textContent = "Full-directory search is temporarily unavailable. Use the interactive finder or browse this page.";
    }
  };

  const reset = () => {
    generation += 1;
    if (input) input.value = "";
    activeCategory = "";
    renderChips();
    clearGlobalResults();
    root.classList.remove("has-filter");
    if (clear) clear.hidden = true;
    input?.focus();
  };

  let inputTimer;
  input?.addEventListener("focus", () => {
    loadCatalog().then(syncCategoryLabels).catch(() => {});
  }, { once: true });
  input?.addEventListener("input", () => {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(apply, 80);
  });
  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    reset();
  });

  clear?.addEventListener("click", reset);
  chips?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-directory-category]");
    if (!button) return;
    activeCategory = normalize(button.dataset.directoryCategory);
    renderChips();
    apply();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable) return;
    event.preventDefault();
    input?.focus();
  });

  renderChips();
  clearGlobalResults();
}
