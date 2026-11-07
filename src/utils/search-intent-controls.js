import {
  resolveSearchIntent,
  replaceFoodIntent,
  loadPostalAreas,
} from "./search-intent.js";
const messages = {
  en: {
    time: "Schedules and intake can change. Today or tonight does not confirm availability.",
    choose: "Choose the kind of food help:",
    meals: "Meals",
    groceries: "Groceries / pantries",
    benefits: "Food benefits",
    postal: "Choose an approximate search area:",
    radius: "Search radius",
    use: "Use US ZIP",
    clear: "Clear postal area",
    loading: "Checking the local postal reference…",
    unavailable:
      "Postal lookup is unavailable. Retry or enter a city, region and country.",
    retry: "Retry postal lookup",
    unsupported:
      "This postal area is not supported. Enter a city, region and country.",
    disclaimer:
      "Approximate postal area, not a service address. Coverage and eligibility still apply.",
  },
  es: {
    time: "Los horarios y la admisión pueden cambiar. Hoy o esta noche no confirma disponibilidad.",
    choose: "Elige el tipo de ayuda alimentaria:",
    meals: "Comidas",
    groceries: "Alimentos / despensas",
    benefits: "Beneficios alimentarios",
    postal: "Elige una zona de búsqueda aproximada:",
    radius: "Radio de búsqueda",
    use: "Usar código postal de EE. UU.",
    clear: "Borrar zona postal",
    loading: "Consultando la referencia postal local…",
    unavailable:
      "La búsqueda postal no está disponible. Reintenta o escribe ciudad, región y país.",
    retry: "Reintentar búsqueda postal",
    unsupported:
      "Esta zona postal no está disponible. Escribe ciudad, región y país.",
    disclaimer:
      "Zona postal aproximada, no dirección de un servicio. Se aplican la cobertura y los requisitos de acceso.",
  },
};
export function mountSearchIntentControls({
  container,
  queryInput,
  placeInput,
  onChange,
}) {
  const node = document.createElement("div");
  node.className = "search-intent-guidance";
  node.setAttribute("data-search-intent", "");
  node.setAttribute("data-language-owned", "");
  container.append(node);
  let selection = null,
    last = "",
    pendingPostal = false;
  const text = (key) =>
    messages[document.documentElement.lang === "es" ? "es" : "en"][key];
  const plan = () =>
    resolveSearchIntent(queryInput.value, placeInput?.value, selection);
  const render = () => {
    const value = plan(),
      signature = JSON.stringify([
        value.time,
        value.postal,
        value.postalSupported,
        value.postalStatus,
        value.area,
        value.foodChoice,
        document.documentElement.lang,
      ]);
    if (signature === last) return value;
    last = signature;
    node.replaceChildren();
    const p = (content) => {
      const item = document.createElement("p");
      item.textContent = content;
      node.append(item);
      return item;
    };
    const button = (label, callback) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.onclick = callback;
      node.append(b);
      return b;
    };
    if (value.time) {
      const status = p(text("time"));
      status.setAttribute("role", "status");
    }
    if (value.foodChoice) {
      p(text("choose"));
      for (const [key, intent] of [
        ["meals", "meals"],
        ["groceries", "groceries"],
        ["benefits", "food benefits"],
      ])
        button(text(key), () => {
          queryInput.value = replaceFoodIntent(queryInput.value, intent);
          selection = null;
          onChange();
          queryInput.focus();
        });
    }
    if (value.postal) {
      const load = () => {
        if (pendingPostal) return;
        pendingPostal = true;
        loadPostalAreas()
          .then(() => {
            last = "";
            onChange();
          })
          .catch(() => {
            last = "";
            render();
          })
          .finally(() => {
            pendingPostal = false;
          });
      };
      if (value.postalStatus === "idle" || value.postalStatus === "loading") {
        p(text("loading"));
        load();
      } else if (value.postalStatus === "error") {
        p(text("unavailable"));
        button(text("retry"), load);
      } else if (value.area) {
        p(
          `${value.area.radius} km · US ZIP ${value.postal}. ${text("disclaimer")}`,
        );
        button(text("clear"), () => {
          selection = null;
          onChange();
          queryInput.focus();
        });
      } else if (value.postalSupported) {
        p(text("postal"));
        const select = document.createElement("select");
        select.setAttribute("aria-label", text("radius"));
        for (const radius of [10, 25, 50]) {
          const option = document.createElement("option");
          option.value = String(radius);
          option.textContent = `${radius} km`;
          select.append(option);
        }
        node.append(select);
        button(`${text("use")} ${value.postal}`, () => {
          selection = { postal: value.postal, radius: Number(select.value) };
          onChange();
          queryInput.focus();
        });
        p(text("disclaimer"));
      } else p(text("unsupported"));
    }
    return value;
  };
  const restore = (value) => {
    selection =
      value?.postal && [10, 25, 50].includes(value.radius)
        ? { postal: String(value.postal), radius: value.radius }
        : null;
    last = "";
  };
  window.addEventListener("rwn:languagechange", () => {
    last = "";
    render();
  });
  return { plan, render, snapshot: () => selection, restore };
}

// A separate enhancement keeps the complete basic directory usable if this
// optional postal/choice module fails. Its queries never leave the browser.
export async function enhanceDirectoryIntent() {
  const root = document.querySelector("[data-directory-search]");
  const queryInput = root?.querySelector("[data-directory-query]"),
    placeInput = root?.querySelector("[data-directory-place]");
  if (!queryInput || !placeInput) return;
  const controls = mountSearchIntentControls({
    container: root,
    queryInput,
    placeInput,
    onChange: () =>
      queryInput.dispatchEvent(new Event("input", { bubbles: true })),
  });
  const { resourceMatchesIntent } = await import("./search-intent.js");
  const restore = () => {
    const stored = history.state?.rwnDirectoryIntent;
    if (stored?.path === location.pathname) {
      placeInput.value = String(stored.place || "").slice(0, 180);
      controls.restore(stored.postalArea);
    } else {
      placeInput.value = "";
      controls.restore(null);
    }
  };
  const render = () => {
    const plan = controls.render();
    try {
      history.replaceState(
        {
          ...history.state,
          rwnDirectoryIntent: {
            path: location.pathname,
            place: placeInput.value,
            postalArea: controls.snapshot(),
          },
        },
        "",
      );
    } catch {}
    return plan;
  };
  root.rwnIntent = {
    ...controls,
    render,
    matches: (record) => resourceMatchesIntent(record, controls.plan()),
  };
  restore();
  render();
  window.addEventListener("popstate", () => {
    restore();
    queryInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  queryInput.dispatchEvent(new Event("input", { bubbles: true }));
}
