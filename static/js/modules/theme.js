/**
 * static/js/modules/theme.js
 * Theme controller module for the Smart Traffic Monitoring System.
 *
 * Handles:
 *  - Interactive toggle button #theme-toggle-btn
 *  - Setting data-theme on <html>
 *  - Updating aria-pressed and aria-label
 *  - Persisting selection to localStorage
 */

const STORAGE_KEY = "stms-theme";

/**
 * Apply theme to document root and sync button state.
 * @param {"dark" | "light"} theme
 */
export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("theme-toggle-btn");
  if (btn) {
    btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    btn.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
  }
}

/**
 * Toggle between dark and light themes and persist to localStorage.
 * @returns {"dark" | "light"} The newly applied theme.
 */
export function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch (err) {
    // Silently ignore storage quota or permission errors
  }
  return next;
}

/**
 * Initialize theme listener on the toggle button.
 */
export function initThemeToggle() {
  const btn = document.getElementById("theme-toggle-btn");
  if (btn) {
    // Remove existing to avoid duplicate triggers
    btn.removeEventListener("click", toggleTheme);
    btn.addEventListener("click", toggleTheme);
    
    // Sync current state
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(/** @type {"dark"|"light"} */ (current));
  }
}

// Auto-initialize when loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initThemeToggle);
} else {
  initThemeToggle();
}
