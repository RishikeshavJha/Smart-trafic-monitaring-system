/**
 * static/js/modules/toast.js
 * Accessible, lightweight toast notification system for Smart Traffic Monitoring System.
 *
 * Features:
 *  - Success, Info, Warning, Error types
 *  - Auto-dismiss with configurable duration (default: 4000ms)
 *  - Pause auto-dismiss timer on mouse hover or focus
 *  - Accessible with role="status" / role="alert" and close button
 *  - Exposed globally on window.toast for easy debugging and console usage
 */

const TOAST_CONTAINER_ID = "toast-container";

/**
 * Ensure the toast container element exists in the DOM.
 * @returns {HTMLElement}
 */
function getOrCreateContainer() {
  let container = document.getElementById(TOAST_CONTAINER_ID);
  if (!container) {
    container = document.createElement("div");
    container.id = TOAST_CONTAINER_ID;
    container.className = "toast-container";
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-atomic", "false");
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Icons mapped to toast types as safe SVG strings.
 */
const ICONS = {
  success: `<svg class="toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
  info: `<svg class="toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
  warning: `<svg class="toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  error: `<svg class="toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`
};

/**
 * Display a toast notification.
 *
 * @param {string} message - Notification text.
 * @param {"success" | "info" | "warning" | "error"} [type="info"] - Toast type.
 * @param {number} [duration=4000] - Time in milliseconds before dismissal (0 for persistent).
 * @returns {HTMLElement} The created toast element.
 */
export function showToast(message, type = "info", duration = 4000) {
  const container = getOrCreateContainer();
  const toast = document.createElement("div");

  toast.className = `toast toast--${type}`;
  toast.setAttribute("role", type === "error" || type === "warning" ? "alert" : "status");

  const iconHtml = ICONS[type] || ICONS.info;
  toast.innerHTML = `
    <div class="toast-content">
      ${iconHtml}
      <span class="toast-message">${escapeHtml(message)}</span>
    </div>
    <button type="button" class="toast-close" aria-label="Close notification">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  `;

  let timer = null;
  let remaining = duration;
  let startTime = Date.now();

  function dismiss() {
    if (toast.classList.contains("toast--dismissing")) return;
    toast.classList.add("toast--dismissing");
    toast.addEventListener("animationend", () => {
      toast.remove();
    }, { once: true });
    // Fallback if animations are disabled
    setTimeout(() => toast.remove(), 250);
  }

  function startTimer() {
    if (duration > 0) {
      startTime = Date.now();
      timer = setTimeout(dismiss, remaining);
    }
  }

  function pauseTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      remaining -= Date.now() - startTime;
    }
  }

  // Close button handler
  const closeBtn = toast.querySelector(".toast-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dismiss();
    });
  }

  // Hover and focus pause/resume
  toast.addEventListener("mouseenter", pauseTimer);
  toast.addEventListener("mouseleave", startTimer);
  toast.addEventListener("focusin", pauseTimer);
  toast.addEventListener("focusout", startTimer);

  container.appendChild(toast);
  startTimer();

  return toast;
}

/**
 * Helper shortcuts
 */
export const toast = {
  show: showToast,
  success: (msg, dur) => showToast(msg, "success", dur),
  info: (msg, dur) => showToast(msg, "info", dur),
  warning: (msg, dur) => showToast(msg, "warning", dur),
  error: (msg, dur) => showToast(msg, "error", dur),
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Expose to window for testing/debugging in console
if (typeof window !== "undefined") {
  window.toast = toast;
}
