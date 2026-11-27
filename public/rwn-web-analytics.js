(() => {
  "use strict";
  const hosts = new Set(["realworldneeds.org", "www.realworldneeds.org"]);
  const paths = new Set(["/", "/directory", "/directory/"]);
  const allowed = (url) =>
    url.protocol === "https:" && hosts.has(url.hostname) && !url.port &&
    !url.username && !url.password && paths.has(url.pathname) && !url.search && !url.hash;
  const canMeasure = () =>
    navigator.globalPrivacyControl !== true && navigator.doNotTrack !== "1" &&
    window.doNotTrack !== "1" && !document.referrer && allowed(new URL(location.href));

  if (!canMeasure() || window.va) return;
  window.va = (...args) => (window.vaq ??= []).push(args);
  window.va("beforeSend", (event) => {
    try {
      if (event.type !== "pageview" || !canMeasure()) return null;
      const url = new URL(event.url, location.origin);
      if (!allowed(url) || url.origin !== location.origin) return null;
      return { type: "pageview", url: url.origin + (url.pathname === "/" ? "/" : "/directory") };
    } catch {
      return null;
    }
  });
  const script = document.createElement("script");
  script.src = "/_vercel/insights/script.js";
  script.defer = true;
  script.referrerPolicy = "no-referrer";
  document.head.appendChild(script);
})();
