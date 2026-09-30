/**
 * static/js/theme-init.js
 * Immediate, non-deferred theme initialization executed in <head>.
 *
 * Runs before DOM content is rendered to set [data-theme] on <html>
 * from localStorage or system prefers-color-scheme, preventing any FOUC (flash of wrong theme).
 */
(function () {
  try {
    var stored = localStorage.getItem("stms-theme");
    if (stored === "dark" || stored === "light") {
      document.documentElement.setAttribute("data-theme", stored);
      return;
    }
  } catch (e) {
    // localStorage may be inaccessible in private modes or restricted contexts
  }

  try {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      document.documentElement.setAttribute("data-theme", "light");
      return;
    }
  } catch (e) {}

  document.documentElement.setAttribute("data-theme", "dark");
})();
