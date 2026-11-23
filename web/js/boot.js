// Classic (non-module) script in <head>: applies the cached theme/density before first paint (no flash).
// shell.js keeps this cache in sync with the server-side settings.
(function () {
  var root = document.documentElement;
  var theme = "system", density = "normal", rail = "";
  try {
    theme = localStorage.getItem("mi.theme") || theme;
    density = localStorage.getItem("mi.density") || density;
    rail = localStorage.getItem("mi.rail") || "";
  } catch (e) { /* storage blocked: defaults */ }
  var dark = !window.matchMedia || !matchMedia("(prefers-color-scheme: light)").matches;
  root.dataset.mode = theme === "system" ? (dark ? "dark" : "light") : theme;
  root.dataset.density = density;
  if (rail === "off") root.dataset.rail = "off";
})();
