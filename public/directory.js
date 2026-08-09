const root = document.querySelector("[data-directory-search]");

if (root) {
  const input = root.querySelector("[data-directory-query]");
  const clear = root.querySelector("[data-directory-clear]");
  const count = root.querySelector("[data-directory-count]");
  const chips = root.querySelector("[data-directory-categories]");
  const records = [...document.querySelectorAll(".directory-records > .directory-record")];
  const collator = new Intl.Collator(undefined, { sensitivity: "base", usage: "search" });

  const normalize = (value) => String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();

  const index = records.map((record) => ({
    record,
    text: normalize(record.textContent),
    categories: [...record.querySelectorAll(".directory-aid li")].map((item) => normalize(item.textContent))
  }));

  const categoryLabels = [...new Set(records.flatMap((record) => [...record.querySelectorAll(".directory-aid li")].map((item) => item.textContent.trim())).filter(Boolean))]
    .sort((a, b) => collator.compare(a, b));

  let activeCategory = "";

  const renderChips = () => {
    if (!chips) return;
    chips.innerHTML = [
      `<button type="button" data-directory-category="" aria-pressed="${activeCategory === ""}">All help</button>`,
      ...categoryLabels.map((label) => `<button type="button" data-directory-category="${label.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")}" aria-pressed="${normalize(label) === activeCategory}">${label}</button>`)
    ].join("");
  };

  const apply = () => {
    const query = normalize(input?.value);
    let visible = 0;
    for (const item of index) {
      const matchesQuery = !query || item.text.includes(query);
      const matchesCategory = !activeCategory || item.categories.includes(activeCategory);
      const show = matchesQuery && matchesCategory;
      item.record.hidden = !show;
      if (show) visible += 1;
    }

    if (count) {
      count.textContent = `${visible.toLocaleString()} of ${records.length.toLocaleString()} listings shown`;
    }
    if (clear) clear.hidden = !query && !activeCategory;
    root.classList.toggle("has-filter", Boolean(query || activeCategory));
  };

  const reset = () => {
    if (input) input.value = "";
    activeCategory = "";
    renderChips();
    apply();
    input?.focus();
  };

  input?.addEventListener("input", apply);
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
  apply();
}
