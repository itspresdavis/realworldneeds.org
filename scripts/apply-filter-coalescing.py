from pathlib import Path

path = Path("src/app.js")
text = path.read_text()

old = '''  document.getElementById("layerList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-type]");
    if (!button) return;
    const type = button.dataset.type;
    if (state.activeTypes.has(type)) state.activeTypes.delete(type);
    else state.activeTypes.add(type);
    updateFilters();
  });

  document.getElementById("toggleAll").addEventListener("click", () => {
    state.activeTypes = state.activeTypes.size === resourceTypes.length ? new Set() : createInitialTypeSet();
    updateFilters();
  });

  document.querySelector(".access-switch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-access]");
    if (!button) return;
    state.accessMode = button.dataset.access;
    updateFilters();
  });'''

new = '''  let catalogFilterFrame = null;
  const scheduleCatalogFilterUpdate = () => {
    if (catalogFilterFrame !== null) return;
    catalogFilterFrame = requestAnimationFrame(() => {
      catalogFilterFrame = null;
      updateFilters();
    });
  };

  document.getElementById("layerList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-type]");
    if (!button) return;
    const type = button.dataset.type;
    if (state.activeTypes.has(type)) state.activeTypes.delete(type);
    else state.activeTypes.add(type);
    scheduleCatalogFilterUpdate();
  });

  document.getElementById("toggleAll").addEventListener("click", () => {
    state.activeTypes = state.activeTypes.size === resourceTypes.length ? new Set() : createInitialTypeSet();
    scheduleCatalogFilterUpdate();
  });

  document.querySelector(".access-switch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-access]");
    if (!button) return;
    state.accessMode = button.dataset.access;
    scheduleCatalogFilterUpdate();
  });'''

if text.count(old) != 1:
    raise SystemExit(f"Expected one filter-handler block, found {text.count(old)}")

path.write_text(text.replace(old, new, 1))
print("Coalesced rapid filter mutations to one catalog rebuild per animation frame.")
