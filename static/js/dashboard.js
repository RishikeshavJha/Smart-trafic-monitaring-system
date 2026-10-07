/**
 * static/js/dashboard.js
 * Live dashboard controller for the Smart Traffic Monitoring System (ES Module).
 *
 * Responsibilities:
 *  - Subscribes to live traffic stream events via live.js (onSnapshot).
 *  - Renders only changed state, throttles DOM updates, respects reduced motion.
 *  - Initializes and dynamically manages two Chart.js charts:
 *      1. 5-minute rolling zone occupancy line chart (N, S, E, W) using chart.update("none") to eliminate flicker.
 *      2. Vehicle classification doughnut chart with synced legend values.
 *  - Manages the animated TrafficLightWidget for suggested green phase vs baseline.
 *  - Updates 4 approach zone cards (N/S/E/W) with linear density gauges, chips, and "Driving signal" tags.
 *  - Handles animated monospace number counters for KPIs.
 *  - Handles start/stop engine buttons via api.js (/api/start, /api/stop).
 *  - Handles segmented source selector (Simulation / Sample / Upload / Webcam).
 *  - Displays top dismissible congestion alert banner and toasts on new alerts.
 *  - Renders alerts feed (newest first, severity icon + text + zone + time).
 *  - Responsive theme switching: recalculates chart grid/text colors on data-theme change.
 *  - Cleans up listeners on page unload.
 */

import { fetchApi } from "./modules/api.js";
import { onSnapshot } from "./modules/live.js";
import { showToast } from "./modules/toast.js";
import { TrafficLightWidget } from "./modules/trafficlight.js";
import { suggestGreen, estimateDelay, cycleLength } from "./modules/signal-logic.js";

// ============================================================================
// State & Configuration
// ============================================================================

const STATE = {
  isRunning: false,
  isSimulated: true,
  currentSource: "simulation",
  baselineGreen: 30,
  suggestedGreen: 30,
  maxPoints: 300,
  seenAlertIds: new Set(),
  lastSnapshot: null,
  unsubscribeLive: null,
  prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};

// Zone color palette
const ZONE_COLORS = {
  N: { stroke: "#3B82F6", fill: "rgba(59, 130, 246, 0.1)" },
  S: { stroke: "#10B981", fill: "rgba(16, 185, 129, 0.1)" },
  E: { stroke: "#F59E0B", fill: "rgba(245, 158, 11, 0.1)" },
  W: { stroke: "#EC4899", fill: "rgba(236, 72, 153, 0.1)" },
};

// Chart instances
let lineChart = null;
let doughnutChart = null;
let trafficLightWidget = null;

// ============================================================================
// Helper Utilities
// ============================================================================

function getThemeColors() {
  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  return {
    textColor: isDark ? "#9FB0C8" : "#475569",
    gridColor: isDark ? "rgba(232, 238, 247, 0.08)" : "rgba(15, 23, 42, 0.08)",
    headingColor: isDark ? "#E8EEF7" : "#0F172A",
  };
}

/**
 * Animate a numeric counter element smoothly (or snap directly if reduced motion).
 */
function animateCounter(element, targetValue, duration = 400, suffix = "") {
  if (!element) return;
  const target = Number(targetValue) || 0;
  if (STATE.prefersReducedMotion) {
    element.textContent = `${target}${suffix}`;
    return;
  }

  const currentText = element.textContent.replace(/[^\d.-]/g, "");
  const start = Number(currentText) || 0;
  if (start === target) return;

  const startTime = performance.now();
  const step = (now) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out quad
    const ease = 1 - (1 - progress) * (1 - progress);
    const val = Math.round(start + (target - start) * ease);
    element.textContent = `${val}${suffix}`;

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      element.textContent = `${target}${suffix}`;
    }
  };
  requestAnimationFrame(step);
}

function formatTime(isoOrDate) {
  if (!isoOrDate) return "--:--:--";
  const d = new Date(isoOrDate);
  if (isNaN(d.getTime())) return String(isoOrDate);
  return d.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ============================================================================
// Chart Initialization & Updates
// ============================================================================

function initLineChart() {
  const canvas = document.getElementById("traffic-line-chart");
  if (!canvas || typeof Chart === "undefined") return;

  const { textColor, gridColor } = getThemeColors();

  const ctx = canvas.getContext("2d");
  lineChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "North (N)",
          data: [],
          borderColor: ZONE_COLORS.N.stroke,
          backgroundColor: ZONE_COLORS.N.fill,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: true,
        },
        {
          label: "South (S)",
          data: [],
          borderColor: ZONE_COLORS.S.stroke,
          backgroundColor: ZONE_COLORS.S.fill,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: true,
        },
        {
          label: "East (E)",
          data: [],
          borderColor: ZONE_COLORS.E.stroke,
          backgroundColor: ZONE_COLORS.E.fill,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: true,
        },
        {
          label: "West (W)",
          data: [],
          borderColor: ZONE_COLORS.W.stroke,
          backgroundColor: ZONE_COLORS.W.fill,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: "top",
          align: "end",
          labels: {
            color: textColor,
            font: { family: "Space Grotesk, sans-serif", size: 11, weight: "600" },
            boxWidth: 12,
            boxHeight: 12,
            usePointStyle: true,
          },
        },
        tooltip: {
          backgroundColor: "#121C30",
          titleColor: "#E8EEF7",
          bodyColor: "#9FB0C8",
          borderColor: "rgba(232, 238, 247, 0.14)",
          borderWidth: 1,
          padding: 8,
          titleFont: { family: "JetBrains Mono, monospace", size: 12 },
          bodyFont: { family: "JetBrains Mono, monospace", size: 12 },
        },
      },
      scales: {
        x: {
          grid: { color: gridColor, drawBorder: false },
          ticks: {
            color: textColor,
            font: { family: "JetBrains Mono, monospace", size: 10 },
            maxTicksLimit: 6,
            maxRotation: 0,
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: gridColor, drawBorder: false },
          ticks: {
            color: textColor,
            font: { family: "JetBrains Mono, monospace", size: 10 },
            stepSize: 5,
            precision: 0,
          },
          title: {
            display: false,
            text: "Queue Count",
            color: textColor,
          },
        },
      },
    },
  });
}

function initDoughnutChart() {
  const canvas = document.getElementById("vehicle-doughnut-chart");
  if (!canvas || typeof Chart === "undefined") return;

  const ctx = canvas.getContext("2d");
  doughnutChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Cars", "Motorcycles", "Buses", "Trucks"],
      datasets: [
        {
          data: [0, 0, 0, 0],
          backgroundColor: ["#3B82F6", "#EF4444", "#0EA5E9", "#D4A017"],
          borderColor: "transparent",
          borderWidth: 2,
          hoverOffset: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      cutout: "72%",
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#121C30",
          titleColor: "#E8EEF7",
          bodyColor: "#9FB0C8",
          borderColor: "rgba(232, 238, 247, 0.14)",
          borderWidth: 1,
          callbacks: {
            label(context) {
              const val = context.parsed || 0;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? Math.round((val / total) * 100) : 0;
              return ` ${context.label}: ${val} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

function updateChartTheme() {
  const { textColor, gridColor } = getThemeColors();
  if (lineChart) {
    lineChart.options.scales.x.grid.color = gridColor;
    lineChart.options.scales.x.ticks.color = textColor;
    lineChart.options.scales.y.grid.color = gridColor;
    lineChart.options.scales.y.ticks.color = textColor;
    lineChart.options.plugins.legend.labels.color = textColor;
    lineChart.update("none");
  }
}

/**
 * Load initial 5-minute history data via GET /api/history
 */
async function loadInitialHistory() {
  try {
    const res = await fetchApi("/api/history?minutes=5");
    if (!res.ok || !res.data) return;

    const { traffic, flow, alerts } = res.data;

    if (traffic && traffic.length > 0 && lineChart) {
      // Group by timestamp
      const timeMap = new Map();
      traffic.forEach((row) => {
        const t = formatTime(row.ts);
        if (!timeMap.has(t)) {
          timeMap.set(t, { N: 0, S: 0, E: 0, W: 0 });
        }
        timeMap.get(t)[row.zone] = row.occupancy_avg;
      });

      const labels = Array.from(timeMap.keys());
      const dataN = labels.map((l) => timeMap.get(l).N);
      const dataS = labels.map((l) => timeMap.get(l).S);
      const dataE = labels.map((l) => timeMap.get(l).E);
      const dataW = labels.map((l) => timeMap.get(l).W);

      lineChart.data.labels = labels.slice(-STATE.maxPoints);
      lineChart.data.datasets[0].data = dataN.slice(-STATE.maxPoints);
      lineChart.data.datasets[1].data = dataS.slice(-STATE.maxPoints);
      lineChart.data.datasets[2].data = dataE.slice(-STATE.maxPoints);
      lineChart.data.datasets[3].data = dataW.slice(-STATE.maxPoints);
      lineChart.update("none");

      updateLineChartScreenReaderTable();
    }

    if (alerts && alerts.length > 0) {
      renderAlertsList(alerts);
    }
  } catch (err) {
    console.error("Failed to load initial history:", err);
  }
}

/**
 * Append latest live data point to line chart without flicker.
 */
function appendLineChartPoint(snapshot) {
  if (!lineChart || !snapshot || !snapshot.zones) return;

  const timeLabel = formatTime(snapshot.ts);
  const z = snapshot.zones;

  lineChart.data.labels.push(timeLabel);
  lineChart.data.datasets[0].data.push(z.N?.count ?? 0);
  lineChart.data.datasets[1].data.push(z.S?.count ?? 0);
  lineChart.data.datasets[2].data.push(z.E?.count ?? 0);
  lineChart.data.datasets[3].data.push(z.W?.count ?? 0);

  // Keep at most maxPoints
  if (lineChart.data.labels.length > STATE.maxPoints) {
    lineChart.data.labels.shift();
    lineChart.data.datasets.forEach((ds) => ds.data.shift());
  }

  // Update without animation to eliminate flicker
  lineChart.update("none");

  // Keep screen-reader table in sync occasionally (throttled)
  if (Math.random() < 0.2) {
    updateLineChartScreenReaderTable();
  }
}

function updateLineChartScreenReaderTable() {
  const tbody = document.getElementById("line-chart-sr-body");
  if (!tbody || !lineChart) return;

  const labels = lineChart.data.labels.slice(-10);
  const d0 = lineChart.data.datasets[0].data.slice(-10);
  const d1 = lineChart.data.datasets[1].data.slice(-10);
  const d2 = lineChart.data.datasets[2].data.slice(-10);
  const d3 = lineChart.data.datasets[3].data.slice(-10);

  let html = "";
  for (let i = 0; i < labels.length; i++) {
    html += `<tr>
      <td>${labels[i]}</td>
      <td>${d0[i] ?? 0}</td>
      <td>${d1[i] ?? 0}</td>
      <td>${d2[i] ?? 0}</td>
      <td>${d3[i] ?? 0}</td>
    </tr>`;
  }
  tbody.innerHTML = html;
}

function updateDoughnutData(classCounts) {
  if (!doughnutChart || !classCounts) return;
  const car = classCounts.car || 0;
  const moto = classCounts.motorcycle || 0;
  const bus = classCounts.bus || 0;
  const truck = classCounts.truck || 0;

  doughnutChart.data.datasets[0].data = [car, moto, bus, truck];
  doughnutChart.update("none");

  // Update DOM legend numbers
  animateCounter(document.getElementById("count-car"), car);
  animateCounter(document.getElementById("count-moto"), moto);
  animateCounter(document.getElementById("count-bus"), bus);
  animateCounter(document.getElementById("count-truck"), truck);
}

// ============================================================================
// UI Component Updates (KPIs, Zones, Signal, Alerts)
// ============================================================================

function updateKPIs(snapshot) {
  if (!snapshot) return;

  // 1. Total vehicles crossed
  const crossedEl = document.getElementById("kpi-val-crossed");
  if (crossedEl) {
    animateCounter(crossedEl, snapshot.total_crossed || 0);
  }

  // 2. Active alerts count & badge
  const alertsCount = snapshot.active_alerts_count ?? (snapshot.alerts ? snapshot.alerts.filter((a) => !a.resolved).length : 0);
  const alertsEl = document.getElementById("kpi-val-alerts");
  const alertBadge = document.getElementById("kpi-alert-status-badge");
  if (alertsEl) {
    animateCounter(alertsEl, alertsCount);
  }
  if (alertBadge) {
    if (alertsCount > 0) {
      alertBadge.style.background = "var(--signal-red-bg)";
      alertBadge.style.color = "var(--signal-red)";
      alertBadge.style.borderColor = "var(--signal-red)";
      alertBadge.textContent = "Congested";
    } else {
      alertBadge.style.background = "var(--signal-green-bg)";
      alertBadge.style.color = "var(--signal-green)";
      alertBadge.style.borderColor = "var(--signal-green)";
      alertBadge.textContent = "Normal";
    }
  }

  // 3. Suggested green time
  const sg = snapshot.suggested_green_seconds || 30;
  STATE.suggestedGreen = sg;
  const greenEl = document.getElementById("kpi-val-green");
  const driverEl = document.getElementById("kpi-val-driver");
  if (greenEl) {
    greenEl.textContent = `${sg}s`;
  }
  if (driverEl && snapshot.driving_zone) {
    driverEl.textContent = snapshot.driving_zone;
  }

  // 4. Overall average density
  const densityEl = document.getElementById("kpi-val-density");
  const densityChip = document.getElementById("kpi-density-chip");
  if (densityEl && snapshot.density_level) {
    densityEl.textContent = snapshot.density_level;
  }
  if (densityChip && snapshot.density_level) {
    const level = snapshot.density_level.toLowerCase();
    densityChip.textContent = level.toUpperCase();
    if (level === "high") {
      densityChip.style.borderColor = "var(--signal-red)";
      densityChip.style.color = "var(--signal-red)";
    } else if (level === "medium") {
      densityChip.style.borderColor = "var(--signal-amber)";
      densityChip.style.color = "var(--signal-amber)";
    } else {
      densityChip.style.borderColor = "var(--signal-green)";
      densityChip.style.color = "var(--signal-green)";
    }
  }
}

function updateZoneCards(zones, drivingZone) {
  if (!zones) return;

  ["N", "S", "E", "W"].forEach((zoneKey) => {
    const zData = zones[zoneKey] || { count: 0, level: "Low" };
    const countVal = zData.count || 0;
    const level = (zData.level || "Low").toLowerCase();

    // Count
    const countEl = document.getElementById(`zone-count-${zoneKey}`);
    if (countEl) {
      countEl.textContent = countVal;
    }

    // Driver badge
    const badgeEl = document.getElementById(`driver-badge-${zoneKey}`);
    if (badgeEl) {
      badgeEl.style.display = zoneKey === drivingZone ? "inline-block" : "none";
    }

    // Density chip
    const chipEl = document.getElementById(`zone-chip-${zoneKey}`);
    if (chipEl) {
      chipEl.className = `density-chip density-chip--${level}`;
      const chipText = chipEl.querySelector(".density-chip-text");
      if (chipText) {
        chipText.textContent = zData.level || "Low";
      }
    }

    // Gauge bar (0 to 20 max scale)
    const gaugeEl = document.getElementById(`zone-gauge-${zoneKey}`);
    if (gaugeEl) {
      const pct = Math.min(Math.round((countVal / 20) * 100), 100);
      gaugeEl.style.width = `${pct}%`;
      gaugeEl.className = `zone-gauge-fill zone-gauge-fill--${level}`;
    }
  });
}

function updateSignalAdvisor(suggestedGreenSec) {
  const baseSec = STATE.baselineGreen || 30;
  const sugSec = suggestedGreenSec || 30;

  const baseEl = document.getElementById("timing-baseline-green");
  const sugEl = document.getElementById("timing-suggested-green");
  if (baseEl) baseEl.textContent = `${baseSec}s`;
  if (sugEl) sugEl.textContent = `${sugSec}s`;

  // Webster delay calculation
  const baseCycle = cycleLength(baseSec, 30);
  const sugCycle = cycleLength(sugSec, 30);
  const baseDelay = estimateDelay(baseCycle, baseSec);
  const sugDelay = estimateDelay(sugCycle, sugSec);

  const delayFixedEl = document.getElementById("timing-delay-fixed");
  const delaySugEl = document.getElementById("timing-delay-suggested");
  const delayDeltaEl = document.getElementById("timing-delay-delta");

  if (delayFixedEl) delayFixedEl.textContent = `${baseDelay.toFixed(1)}s`;
  if (delaySugEl) delaySugEl.textContent = `${sugDelay.toFixed(1)}s`;

  if (delayDeltaEl) {
    const diff = sugDelay - baseDelay;
    if (diff < -0.1) {
      delayDeltaEl.className = "delta-badge delta-badge--pos";
      delayDeltaEl.textContent = `${Math.abs(diff).toFixed(1)}s saved`;
    } else if (diff > 0.1) {
      delayDeltaEl.className = "delta-badge delta-badge--neg";
      delayDeltaEl.textContent = `+${diff.toFixed(1)}s delay`;
    } else {
      delayDeltaEl.className = "delta-badge delta-badge--neutral";
      delayDeltaEl.textContent = "0.0s delay";
    }
  }

  // Update animated traffic light widget
  if (trafficLightWidget) {
    trafficLightWidget.runCycle(sugSec, 3, baseSec);
  }
}

function updateStreamHUD(snapshot) {
  const isSim = snapshot.is_simulated ?? true;
  const isRunning = snapshot.is_running ?? true;

  STATE.isSimulated = isSim;
  STATE.isRunning = isRunning;

  // Header Mode badge
  const simBadge = document.getElementById("dash-sim-badge");
  const modeTag = document.getElementById("dash-engine-mode");
  if (simBadge) {
    simBadge.style.display = isSim ? "inline-block" : "none";
  }
  if (modeTag) {
    modeTag.textContent = `MODE: ${isSim ? "SIMULATION" : "LIVE DETECTION"}`;
  }

  // Video HUD viewport display
  const placeholder = document.getElementById("video-sim-placeholder");
  const videoFeed = document.getElementById("video-feed-img");
  const skeleton = document.getElementById("video-skeleton");

  if (skeleton) skeleton.style.display = "none";

  if (isSim || !isRunning) {
    if (placeholder) placeholder.style.display = "flex";
    if (videoFeed) {
      videoFeed.style.display = "none";
      videoFeed.src = "";
    }
  } else {
    // Real video source running
    if (placeholder) placeholder.style.display = "none";
    if (videoFeed) {
      videoFeed.style.display = "block";
      if (!videoFeed.src.includes("/video_feed")) {
        videoFeed.src = "/video_feed";
      }
    }
  }
}

// ============================================================================
// Alerts Management & Notifications
// ============================================================================

function handleNewAlerts(alerts) {
  if (!alerts || !Array.isArray(alerts)) return;

  const newAlerts = alerts.filter((a) => !STATE.seenAlertIds.has(a.id));
  newAlerts.forEach((a) => {
    STATE.seenAlertIds.add(a.id);

    // Show top congestion banner if active
    if (!a.resolved) {
      showCongestionBanner(a.zone, a.msg || "Sustained High density detected");
      showToast(`Congestion Alert: Zone ${a.zone} experiencing heavy traffic queue`, "warning", 6000);
    }
  });

  renderAlertsList(alerts);
}

function showCongestionBanner(zone, msg) {
  const banner = document.getElementById("congestion-banner");
  const title = document.getElementById("congestion-banner-title");
  const msgEl = document.getElementById("congestion-banner-msg");
  if (!banner) return;

  if (title) title.textContent = `Congestion Warning (${zone} Approach):`;
  if (msgEl) msgEl.textContent = msg;
  banner.style.display = "flex";
}

function renderAlertsList(alerts) {
  const listEl = document.getElementById("alerts-feed-list");
  const emptyEl = document.getElementById("alerts-empty-placeholder");
  const countTag = document.getElementById("alerts-count-tag");
  if (!listEl) return;

  if (countTag) {
    countTag.textContent = `${alerts.length} Total`;
  }

  if (alerts.length === 0) {
    if (emptyEl) emptyEl.style.display = "block";
    return;
  }

  if (emptyEl) emptyEl.style.display = "none";

  // Sort newest first
  const sorted = [...alerts].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 15);

  let html = "";
  sorted.forEach((item) => {
    const isResolved = item.resolved;
    const severity = isResolved ? "resolved" : "high";
    const statusText = isResolved ? "Resolved" : "Active Congestion";
    const timeStr = formatTime(item.ts);

    html += `
      <li class="alert-item alert-item--${severity}" role="listitem">
        <div class="alert-item-icon" aria-hidden="true">
          ${
            isResolved
              ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`
              : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`
          }
        </div>
        <div class="alert-item-content">
          <div class="cluster cluster-between">
            <strong class="alert-item-title">${statusText} &bull; Zone ${item.zone}</strong>
            <span class="alert-item-time">${timeStr}</span>
          </div>
          <p class="alert-item-msg">${item.msg || "Sustained queue exceeds threshold"}</p>
        </div>
      </li>
    `;
  });

  listEl.innerHTML = html;
}

// ============================================================================
// Event Handlers & Control Toolbar
// ============================================================================

function wireToolbar() {
  // Start Stream Button
  const btnStart = document.getElementById("btn-start-stream");
  if (btnStart) {
    btnStart.addEventListener("click", async () => {
      try {
        btnStart.disabled = true;
        let payload = { source: STATE.currentSource || "simulation" };
        if (STATE.currentSource === "webcam") {
          payload.camera_index = 0;
        }
        const res = await fetchApi("/api/start", {
          method: "POST",
          body: payload,
        });
        if (res.ok) {
          showToast(res.data?.message || "Engine started", "success");
          STATE.isRunning = true;
        } else {
          showToast(res.error?.message || "Failed to start engine", "error");
        }
      } catch (err) {
        showToast("Error communicating with engine API", "error");
      } finally {
        btnStart.disabled = false;
      }
    });
  }

  // Stop Stream Button
  const btnStop = document.getElementById("btn-stop-stream");
  if (btnStop) {
    btnStop.addEventListener("click", async () => {
      try {
        btnStop.disabled = true;
        const res = await fetchApi("/api/stop", { method: "POST" });
        if (res.ok) {
          showToast(res.data?.message || "Engine stopped", "info");
          STATE.isRunning = false;
        } else {
          showToast(res.error?.message || "Failed to stop engine", "error");
        }
      } catch (err) {
        showToast("Error communicating with engine API", "error");
      } finally {
        btnStop.disabled = false;
      }
    });
  }

  // Segmented Source Selection
  const sourceRadios = document.querySelectorAll('input[name="source-select"]');
  sourceRadios.forEach((radio) => {
    radio.addEventListener("change", async (e) => {
      const selectedSource = e.target.value;
      STATE.currentSource = selectedSource;

      // Handle dynamic source switching
      try {
        let startPayload = { source: selectedSource };
        if (selectedSource === "webcam") {
          startPayload.camera_index = 0;
        }

        const res = await fetchApi("/api/start", {
          method: "POST",
          body: startPayload,
        });

        if (res.ok) {
          showToast(`Switched input source to ${selectedSource}`, "success");
          STATE.isRunning = true;
        } else {
          showToast(res.error?.message || `Failed to switch to ${selectedSource}`, "error");
        }
      } catch (err) {
        console.error("Failed to switch source:", err);
        showToast("Error switching input source", "error");
      }
    });
  });

  // Congestion Banner Dismiss
  const btnDismissBanner = document.getElementById("congestion-banner-dismiss");
  if (btnDismissBanner) {
    btnDismissBanner.addEventListener("click", () => {
      const banner = document.getElementById("congestion-banner");
      if (banner) banner.style.display = "none";
    });
  }

  // Refresh Alerts Feed Button
  const btnRefreshAlerts = document.getElementById("btn-refresh-alerts");
  if (btnRefreshAlerts) {
    btnRefreshAlerts.addEventListener("click", async () => {
      try {
        const res = await fetchApi("/api/history?minutes=10");
        if (res.ok && res.data && res.data.alerts) {
          renderAlertsList(res.data.alerts);
          showToast("Alerts refreshed", "info", 2000);
        }
      } catch (e) {
        showToast("Could not refresh alerts", "error");
      }
    });
  }
}

// ============================================================================
// Main Initialization & Subscription
// ============================================================================

function initDashboard() {
  // 1. Initialize Chart.js instances
  initLineChart();
  initDoughnutChart();

  // 2. Initialize TrafficLightWidget in #dash-traffic-light
  const tlContainer = document.getElementById("dash-traffic-light");
  if (tlContainer) {
    trafficLightWidget = new TrafficLightWidget(tlContainer, {
      initialState: "green",
      showLabel: true,
      id: "dash-traffic-signal-light",
    });
    trafficLightWidget.runCycle(30, 3, 30);
  }

  // 3. Listen for data-theme changes to re-color Chart.js axes
  const themeObserver = new MutationObserver(() => {
    updateChartTheme();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // 4. Load initial historical data
  loadInitialHistory();

  // 5. Wire control buttons & form inputs
  wireToolbar();

  // 6. Subscribe to live SSE snapshot stream
  STATE.unsubscribeLive = onSnapshot((snapshot) => {
    STATE.lastSnapshot = snapshot;

    // Update Stream HUD & simulated indicators
    updateStreamHUD(snapshot);

    // Update KPI counters
    updateKPIs(snapshot);

    // Update Zone approach cards & gauges
    updateZoneCards(snapshot.zones, snapshot.driving_zone);

    // Update Signal Advisor timing & delay comparisons
    updateSignalAdvisor(snapshot.suggested_green_seconds);

    // Append to 5-minute rolling chart (no flicker)
    appendLineChartPoint(snapshot);

    // Update vehicle classification doughnut
    if (snapshot.classes) {
      updateDoughnutData(snapshot.classes);
    }

    // Process and display any new alerts
    if (snapshot.alerts) {
      handleNewAlerts(snapshot.alerts);
    }
  });

  // 7. Cleanup listeners when leaving the page or visibility change
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (trafficLightWidget && typeof trafficLightWidget.pause === "function") {
        trafficLightWidget.pause();
      }
    } else {
      if (trafficLightWidget && typeof trafficLightWidget.resume === "function") {
        trafficLightWidget.resume();
      }
    }
  });

  const cleanup = () => {
    if (typeof STATE.unsubscribeLive === "function") {
      STATE.unsubscribeLive();
      STATE.unsubscribeLive = null;
    }
    if (trafficLightWidget) {
      trafficLightWidget.destroy();
      trafficLightWidget = null;
    }
    if (lineChart) {
      lineChart.destroy();
      lineChart = null;
    }
    if (doughnutChart) {
      doughnutChart.destroy();
      doughnutChart = null;
    }
    if (themeObserver) {
      themeObserver.disconnect();
    }
  };

  window.addEventListener("pagehide", cleanup);
  window.addEventListener("beforeunload", cleanup);
}

// Initialize when DOM content is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDashboard);
} else {
  initDashboard();
}
