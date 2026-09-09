const $ = (selector) => document.querySelector(selector);
async function request(path, body, method = "POST") {
  const response = await fetch(path, {
    method: body ? method : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(16000),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && document.body.dataset.page === "workspace")
      location.replace("/join");
    throw new Error(
      data.error || "The request could not finish. Please try again.",
    );
  }
  return data;
}
function message(error) {
  return error.name === "TimeoutError" || error.name === "TypeError"
    ? "Connection interrupted. Please try again."
    : error.message;
}
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function safeLink(label, href) {
  const a = node("a", label);
  try {
    const url = new URL(href, location.origin);
    if (url.protocol !== "https:" && url.origin !== location.origin)
      return node("span", label);
    a.href = url.href;
    a.rel = "noopener noreferrer";
  } catch {
    return node("span", label);
  }
  return a;
}

if (document.body.dataset.page === "join") {
  let mode = "signin";
  const form = $("#accountForm");
  const status = $("#accountStatus");
  function setMode(next) {
    mode = next;
    const signup = mode === "signup",
      recover = mode === "recover";
    $("#accountTitle").textContent = signup
      ? "Make a useful contribution."
      : recover
        ? "Find your way back."
        : "Welcome back.";
    $("#accountIntro").textContent = signup
      ? "Create an account to check listings and leave review notes."
      : recover
        ? "We’ll send a link to reset your password."
        : "Sign in to review the catalog and add a note.";
    $("#accountSubmit").textContent = signup
      ? "Create account"
      : recover
        ? "Send reset link"
        : "Sign in";
    $("#passwordLabel").hidden = recover;
    form.elements.password.disabled = recover;
    form.elements.password.minLength = signup ? 12 : 1;
    form.elements.password.autocomplete = signup
      ? "new-password"
      : "current-password";
    $("#signupSwitch").textContent =
      mode === "signin"
        ? "New here? Create an account"
        : "Already registered? Sign in";
    $("#recoverSwitch").hidden = recover;
    status.textContent = "";
  }
  $("#signupSwitch").addEventListener("click", () =>
    setMode(mode === "signin" ? "signup" : "signin"),
  );
  $("#recoverSwitch").addEventListener("click", () => setMode("recover"));
  if (new URLSearchParams(location.search).has("notice"))
    status.textContent =
      "That link could not be verified. Request a new link and open it in this browser.";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = $("#accountSubmit");
    submit.disabled = true;
    status.textContent = "One moment…";
    try {
      const data = await request("/api/account", {
        action: mode,
        email: form.elements.email.value.trim(),
        password: form.elements.password.value,
      });
      form.elements.password.value = "";
      if (mode === "signin" || data.signedIn) location.assign("/workspace");
      else status.textContent = data.message;
    } catch (error) {
      status.textContent = message(error);
    } finally {
      submit.disabled = false;
    }
  });
}

if (document.body.dataset.page === "workspace") {
  let page = 0,
    query = "",
    sequence = 0;
  const grid = $("#catalogResults"),
    status = $("#catalogStatus");
  let inspectSequence = 0;
  $("#signout").addEventListener("click", async () => {
    try {
      await request("/api/account", { action: "signout" });
      location.replace("/join");
    } catch (error) {
      status.textContent = message(error);
    }
  });
  // Revalidate when returning through browser history; private pages are never offline-cached.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
  async function inspect(id) {
    const currentInspection = ++inspectSequence;
    const panel = $("#recordInspector");
    panel.hidden = false;
    panel.replaceChildren(node("p", "Opening listing…"));
    panel.scrollIntoView({ behavior: "auto", block: "start" });
    try {
      const data = await request(`/api/catalog?id=${encodeURIComponent(id)}`);
      if (currentInspection !== inspectSequence) return;
      let selectedRecord = data.location;
      const r = data.location.record;
      panel.replaceChildren(
        node("p", "Database record", "eyebrow"),
        node("h2", r.name),
      );
      const links = node("div", null, "card-links");
      links.append(safeLink("Original source ↗", r.sourceUrl));
      if (data.location.published)
        links.append(
          safeLink("Public listing ↗", `/service/${encodeURIComponent(r.id)}`),
        );
      else panel.append(node("p", "Withheld from the next public release."));
      if (data.isEditor)
        links.append(safeLink("Open Supabase table ↗", data.databaseUrl));
      panel.append(links, node("p", `Record ID: ${r.id}`, "record-id"));
      const facts = node("dl", null, "record-facts");
      for (const [key, value] of Object.entries(r)) {
        facts.append(
          node("dt", key),
          node(
            "dd",
            typeof value === "object"
              ? JSON.stringify(value, null, 2)
              : String(value),
          ),
        );
      }
      const details = node("details");
      details.append(node("summary", "All database fields"), facts);
      panel.append(details);
      if (data.isEditor) {
        const form = node("form");
        form.id = "editorForm";
        for (const [key, label] of Object.entries({
          name: "Listing name",
          summary: "Summary",
          address: "Address or coverage",
          hours: "Hours",
          phone: "Phone",
          eligibility: "Eligibility",
          sourceName: "Source name",
          sourceUrl: "Original source URL",
          lastChecked: "Source review date",
          lat: "Latitude",
          lng: "Longitude",
        })) {
          const field = node("label", label),
            input = node(
              key === "summary" || key === "eligibility" ? "textarea" : "input",
            );
          input.name = key;
          input.value = r[key] ?? "";
          input.maxLength =
            key === "summary" || key === "eligibility" ? 2000 : 1000;
          if (key === "lastChecked") input.type = "date";
          if (key === "sourceUrl") input.type = "url";
          if (key === "lat" || key === "lng") {
            input.type = "number";
            input.step = "any";
            input.min = key === "lat" ? "-90" : "-180";
            input.max = key === "lat" ? "90" : "180";
          }
          if (
            [
              "name",
              "summary",
              "address",
              "sourceName",
              "sourceUrl",
              "lastChecked",
              "lat",
              "lng",
            ].includes(key)
          )
            input.required = true;
          field.append(input);
          form.append(field);
        }
        const publicationLabel = node("label", "Publication status"),
          select = node("select");
        select.name = "published";
        for (const [value, label] of [
          ["true", "Published"],
          ["false", "Withheld from the next release"],
        ]) {
          const option = node("option", label);
          option.value = value;
          select.append(option);
        }
        select.value = String(data.location.published);
        publicationLabel.append(select);
        form.append(publicationLabel);
        const why = node("label", "Reason for this change"),
          input = node("textarea");
        input.name = "reason";
        input.required = true;
        input.minLength = 10;
        input.maxLength = 1000;
        why.append(input);
        form.append(why);
        const save = node("button", "Save database review", "primary-button");
        save.type = "submit";
        const result = node("p");
        result.setAttribute("role", "status");
        form.append(save, result);
        panel.append(
          node("h3", "Edit this listing"),
          node(
            "p",
            "Database changes are recorded immediately. The public globe and directory update together after an approved catalog release.",
          ),
          form,
        );
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          save.disabled = true;
          result.textContent = "Saving…";
          const values = Object.fromEntries(new FormData(form));
          const { reason, published, ...changes } = values;
          changes.lat = Number(changes.lat);
          changes.lng = Number(changes.lng);
          try {
            const saved = await request(
              "/api/catalog",
              {
                id: r.id,
                updatedAt: selectedRecord.updated_at,
                changes,
                reason,
                published: published === "true",
              },
              "PATCH",
            );
            selectedRecord = saved.location;
            result.textContent =
              "Saved with change history. The public site will update in the next catalog release.";
            input.value = "";
          } catch (error) {
            result.textContent = message(error);
          } finally {
            save.disabled = false;
          }
        });
        panel.append(node("h3", "Change history"));
        for (const change of data.history) {
          const entry = node("details");
          entry.append(
            node(
              "summary",
              `${change.operation} · ${new Date(change.changed_at).toLocaleString()}`,
            ),
            node(
              "pre",
              JSON.stringify(
                { before: change.before_record, after: change.after_record },
                null,
                2,
              ),
            ),
          );
          panel.append(entry);
        }
      }
    } catch (error) {
      if (currentInspection !== inspectSequence) return;
      panel.replaceChildren(node("p", message(error)));
    }
  }
  async function load() {
    const current = ++sequence;
    grid.setAttribute("aria-busy", "true");
    status.textContent = "Loading the catalog…";
    $("#previousPage").disabled = true;
    $("#nextPage").disabled = true;
    try {
      const data = await request(
        `/api/catalog?page=${page}&q=${encodeURIComponent(query)}`,
      );
      if (current !== sequence) return;
      grid.replaceChildren();
      for (const r of data.locations) {
        const card = node("article", null, "catalog-card");
        card.append(
          node(
            "span",
            r.kind === "direct"
              ? "Service location"
              : "Coverage / resource finder",
            "kind",
          ),
          node("h2", r.name),
          node("p", r.country),
        );
        const facts = node("dl");
        facts.append(
          node("dt", "Source checked"),
          node("dd", r.last_checked),
          node(
            "dt",
            r.kind === "direct"
              ? "Location coordinates"
              : "Coverage reference coordinates",
          ),
          node("dd", `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`),
        );
        card.append(facts);
        const links = node("div", null, "card-links");
        links.append(
          safeLink("Source ↗", r.source_url),
          r.published
            ? safeLink(
                "On the globe ↗",
                `/#resource=${encodeURIComponent(r.id)}`,
              )
            : node("span", "Withheld"),
        );
        card.append(links);
        const open = node("button", "Inspect database record");
        open.type = "button";
        open.addEventListener("click", () => inspect(r.id));
        card.append(open);
        const review = node("button", "Review this listing");
        review.type = "button";
        review.addEventListener("click", () => {
          $("#reviewForm").elements.locationId.value = r.id;
          $("#reviewSelection").textContent = r.name;
          $("#reviewNote").disabled = false;
          $("#reviewSubmit").disabled = false;
          $("#reviewStatus").textContent = "";
          $("#reviewNote").focus();
        });
        card.append(review);
        grid.append(card);
      }
      if (!data.locations.length)
        grid.append(
          node(
            "p",
            "No listings match. Try a shorter name, a city, or a country.",
            "empty-state",
          ),
        );
      status.textContent = `${data.total.toLocaleString()} ${data.total === 1 ? "listing" : "listings"}${query ? " matching your search" : " in the database"}.`;
      $("#pageLabel").textContent =
        `Page ${page + 1} of ${Math.max(1, Math.ceil(data.total / 40))}`;
      $("#previousPage").disabled = page === 0;
      $("#nextPage").disabled = (page + 1) * 40 >= data.total;
      const history = $("#reviewHistory");
      history.replaceChildren();
      for (const review of data.reviews) {
        const row = node("article", null, "review-note");
        const date = node("time", new Date(review.created_at).toLocaleString());
        date.dateTime = review.created_at;
        row.append(
          node("strong", review.location_id),
          node("p", review.note),
          date,
        );
        history.append(row);
      }
      if (!data.reviews.length)
        history.append(node("p", "Your saved review notes will appear here."));
    } catch (error) {
      if (current === sequence) {
        grid.replaceChildren();
        status.textContent = message(error);
        const retry = node("button", "Try again");
        retry.addEventListener("click", load);
        grid.append(retry);
      }
    } finally {
      if (current === sequence) grid.setAttribute("aria-busy", "false");
    }
  }
  $("#catalogSearch").addEventListener("submit", (event) => {
    event.preventDefault();
    query = $("#catalogQuery").value.trim();
    page = 0;
    load();
  });
  $("#previousPage").addEventListener("click", () => {
    page = Math.max(0, page - 1);
    load();
  });
  $("#nextPage").addEventListener("click", () => {
    page++;
    load();
  });
  $("#reviewForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    $("#reviewSubmit").disabled = true;
    try {
      await request("/api/catalog", {
        locationId: form.elements.locationId.value,
        note: form.elements.note.value,
      });
      $("#reviewStatus").textContent =
        "Saved. Thank you for checking the details.";
      form.elements.note.value = "";
      await load();
    } catch (error) {
      $("#reviewStatus").textContent = message(error);
    } finally {
      $("#reviewSubmit").disabled = false;
    }
  });
  $("#passwordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await request("/api/account", {
        action: "password",
        password: form.elements.password.value,
      });
      $("#passwordStatus").textContent = "Password updated.";
      form.reset();
    } catch (error) {
      $("#passwordStatus").textContent = message(error);
    } finally {
      button.disabled = false;
    }
  });
  const settings = $(".account-settings");
  settings.append(
    safeLink("Download my contributor data", "/api/account?action=export"),
  );
  const deletion = node("button", "Request account deletion");
  deletion.type = "button";
  const deletionStatus = node("p");
  deletionStatus.setAttribute("role", "status");
  deletion.addEventListener("click", async () => {
    deletion.disabled = true;
    try {
      const data = await request("/api/account", { action: "delete-request" });
      deletionStatus.textContent = data.message;
    } catch (error) {
      deletionStatus.textContent = message(error);
      deletion.disabled = false;
    }
  });
  settings.append(
    node(
      "p",
      "Deletion requests are reviewed by the project administrator. Editorial change history stays with the catalog.",
    ),
    deletion,
    deletionStatus,
  );
  const inspector = node("section");
  inspector.id = "recordInspector";
  inspector.className = "record-inspector";
  inspector.hidden = true;
  $(".review-panel").before(inspector);
  load();
}
