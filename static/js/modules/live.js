/**
 * static/js/modules/live.js
 * Frontend live connection manager for the Smart Traffic Monitoring System (ES Module).
 *
 * Features:
 *  - Primary: Connects via EventSource (SSE) to /api/stream.
 *  - Exposes onSnapshot(callback) for real-time dashboard listeners.
 *  - Updates the sticky navbar status pill (Live / Simulation / Reconnecting / Polling).
 *  - Fallback: After 3 consecutive EventSource failures, automatically switches to
 *    polling /api/stats every 2 seconds with exponential backoff for reconnect attempts.
 */

import { fetchApi } from "./api.js";

class LiveConnectionManager {
  constructor() {
    this.callbacks = new Set();
    this.eventSource = null;
    this.pollingInterval = null;
    this.failCount = 0;
    this.maxFailures = 3;
    this.isPolling = false;
    this.reconnectTimeout = null;
    this.reconnectDelay = 1000; // ms
    this.latestSnapshot = null;

    this.init();
  }

  init() {
    this.connectEventSource();
  }

  /**
   * Register a subscriber callback function that receives every live traffic snapshot.
   * @param {Function} callback - (snapshot) => void
   * @returns {Function} - Unsubscribe function
   */
  onSnapshot(callback) {
    this.callbacks.add(callback);
    // If we already have a cached snapshot, emit it immediately to new listener
    if (this.latestSnapshot) {
      try {
        callback(this.latestSnapshot);
      } catch (err) {
        console.error("Error in onSnapshot listener:", err);
      }
    }
    return () => {
      this.callbacks.delete(callback);
    };
  }

  connectEventSource() {
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch (e) {}
      this.eventSource = null;
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    this.updateStatusPill("connecting");

    try {
      this.eventSource = new EventSource("/api/stream");

      this.eventSource.addEventListener("snapshot", (event) => {
        try {
          const snapshot = JSON.parse(event.data);
          this.handleSnapshot(snapshot);
          this.failCount = 0;
          this.reconnectDelay = 1000;
        } catch (parseErr) {
          console.error("Failed to parse SSE snapshot JSON:", parseErr);
        }
      });

      this.eventSource.onopen = () => {
        this.failCount = 0;
      };

      this.eventSource.onerror = (err) => {
        this.failCount += 1;
        this.updateStatusPill("reconnecting");

        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }

        if (this.failCount >= this.maxFailures) {
          console.warn(`EventSource failed ${this.failCount} times. Switching to HTTP polling fallback.`);
          this.startPollingFallback();
        } else {
          // Exponential backoff reconnect
          const delay = Math.min(this.reconnectDelay, 10000);
          this.reconnectDelay *= 1.5;
          this.reconnectTimeout = setTimeout(() => {
            this.connectEventSource();
          }, delay);
        }
      };
    } catch (e) {
      this.startPollingFallback();
    }
  }

  startPollingFallback() {
    this.isPolling = true;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    const poll = async () => {
      try {
        const res = await fetchApi("/api/stats");
        if (res.ok && res.data && res.data.snapshot) {
          this.handleSnapshot(res.data.snapshot);
        } else {
          this.updateStatusPill("reconnecting");
        }
      } catch (err) {
        this.updateStatusPill("reconnecting");
      }
    };

    poll();
    this.pollingInterval = setInterval(poll, 2000);

    // Periodically attempt to restore EventSource every 30 seconds
    setTimeout(() => {
      if (this.isPolling) {
        console.log("Attempting to restore EventSource stream connection...");
        this.connectEventSource();
      }
    }, 30000);
  }

  handleSnapshot(snapshot) {
    this.latestSnapshot = snapshot;

    // Update status pill based on source mode
    if (snapshot.is_simulated) {
      this.updateStatusPill("simulation");
    } else {
      this.updateStatusPill("live");
    }

    // Notify all listeners
    this.callbacks.forEach((cb) => {
      try {
        cb(snapshot);
      } catch (err) {
        console.error("Error in snapshot callback:", err);
      }
    });
  }

  updateStatusPill(state) {
    const pill = document.querySelector("[data-connection-status]");
    if (!pill) return;

    const dot = pill.querySelector(".status-dot");
    const label = pill.querySelector(".status-pill-label");

    pill.className = "status-pill";
    if (dot) dot.className = "status-dot";

    switch (state) {
      case "live":
        pill.classList.add("status-pill--live");
        if (dot) dot.classList.add("status-dot--live");
        if (label) label.textContent = "Live Stream";
        pill.setAttribute("aria-label", "System status: Live video detection active");
        break;
      case "simulation":
        pill.classList.add("status-pill--simulation");
        if (dot) dot.classList.add("status-dot--simulation");
        if (label) label.textContent = "Simulation";
        pill.setAttribute("aria-label", "System status: Running simulated traffic model");
        break;
      case "connecting":
      case "reconnecting":
        pill.classList.add("status-pill--reconnecting");
        if (dot) dot.classList.add("status-dot--reconnecting");
        if (label) label.textContent = "Reconnecting";
        pill.setAttribute("aria-label", "System status: Reconnecting to traffic stream");
        break;
      default:
        pill.classList.add("status-pill--simulation");
        if (dot) dot.classList.add("status-dot--simulation");
        if (label) label.textContent = "Simulation";
        break;
    }
  }
}

// Global shared instance
export const liveManager = new LiveConnectionManager();

/**
 * Public helper function for easy subscription from any template or component.
 * @param {Function} callback - (snapshot) => void
 * @returns {Function} - Unsubscribe function
 */
export function onSnapshot(callback) {
  return liveManager.onSnapshot(callback);
}
