/**
 * static/js/modules/connection.js
 * Manages the live connection status pill in the navigation bar.
 *
 * Supported states:
 *  - "live"        : Live video/stream connection active
 *  - "reconnecting": Connection interrupted, attempting reconnect
 *  - "simulation"  : Synthetic demo data running (labelled explicitly)
 *
 * Each state provides an icon + text (never colour alone) to adhere to WCAG 2.1 AA.
 */

/**
 * @typedef {"live" | "reconnecting" | "simulation"} ConnectionStatus
 */

const STATUS_CONFIG = {
  live: {
    className: "status-pill--live",
    label: "Live",
    ariaLabel: "System status: Live connection active",
    icon: `<span class="status-dot status-dot--live" aria-hidden="true"></span>`
  },
  reconnecting: {
    className: "status-pill--reconnecting",
    label: "Reconnecting",
    ariaLabel: "System status: Reconnecting to stream",
    icon: `<span class="status-dot status-dot--reconnecting" aria-hidden="true"></span>`
  },
  simulation: {
    className: "status-pill--simulation",
    label: "Simulation",
    ariaLabel: "System status: Running simulated traffic data",
    icon: `<span class="status-dot status-dot--simulation" aria-hidden="true"></span>`
  }
};

/**
 * Set the connection status across all status pill indicators in the DOM.
 * @param {ConnectionStatus} state
 */
export function setStatus(state) {
  const normalized = (state || "simulation").toLowerCase();
  const config = STATUS_CONFIG[normalized] || STATUS_CONFIG.simulation;
  
  const pills = document.querySelectorAll("[data-connection-status]");
  pills.forEach((pill) => {
    // Clear old state classes
    pill.classList.remove(
      "status-pill--live",
      "status-pill--reconnecting",
      "status-pill--simulation"
    );
    pill.classList.add(config.className);
    pill.setAttribute("aria-label", config.ariaLabel);

    const iconEl = pill.querySelector(".status-pill-icon");
    const labelEl = pill.querySelector(".status-pill-label");

    if (iconEl) iconEl.innerHTML = config.icon;
    if (labelEl) labelEl.textContent = config.label;
  });
}

// Initialize on DOM load
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    // Default to Simulation until a live stream or connection module updates it
    setStatus("simulation");
  });
}
