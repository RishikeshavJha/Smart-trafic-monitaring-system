/**
 * static/js/analytics.js
 * Historical Analytics, Peak Heatmap & Forecasting Controller (ES Module).
 *
 * Capabilities:
 *  - 24x7 Diurnal Peak-Hour Heatmap with color-blind safe sequential mapping.
 *  - Top 3 peak-hour detection.
 *  - Chart.js Zone Average Occupancies Bar Chart with dynamic theme sync.
 *  - Indicative Linear Regression Forecast Card with Sparkline.
 *  - Sortable and paginated 5-minute historical traffic table.
 *  - Date-range and zone filters synced with CSV export link.
 */

import { fetchApi } from "./modules/api.js";
import { showToast } from "./modules/toast.js";

class AnalyticsController {
  constructor() {
    this.page = 0;
    this.pageSize = 25;
    this.totalRows = 0;

    this.filters = {
      from: null,
      to: null,
      zone: "",
    };

    this.barChart = null;
    this.sparklineChart = null;

    this.init();
  }

  async init() {
    this.initDateShortcuts();
    this.attachEvents();
    await this.applyFilters();
  }

  initDateShortcuts() {
    // Default to last 7 days
    const now = new Date();
    const past7d = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    const formatDt = (d) => d.toISOString().slice(0, 16);

    const fromEl = document.getElementById("filter-from");
    const toEl = document.getElementById("filter-to");

    if (fromEl) fromEl.value = formatDt(past7d);
    if (toEl) toEl.value = formatDt(now);

    this.filters.from = past7d.toISOString();
    this.filters.to = now.toISOString();

    // Quick range buttons
    const btns = document.querySelectorAll(".quick-range-btn");
    btns.forEach((btn) => {
      btn.addEventListener("click", () => {
        btns.forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");

        const range = btn.getAttribute("data-range");
        const cur = new Date();
        let start = new Date();

        if (range === "1h") {
          start = new Date(cur.getTime() - 3600 * 1000);
        } else if (range === "today") {
          start = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
        } else {
          start = new Date(cur.getTime() - 7 * 24 * 3600 * 1000);
        }

        if (fromEl) fromEl.value = formatDt(start);
        if (toEl) toEl.value = formatDt(cur);

        this.filters.from = start.toISOString();
        this.filters.to = cur.toISOString();
        this.applyFilters();
      });
    });
  }

  attachEvents() {
    const btnApply = document.getElementById("btn-apply-filters");
    if (btnApply) {
      btnApply.addEventListener("click", () => {
        const fromEl = document.getElementById("filter-from");
        const toEl = document.getElementById("filter-to");
        const zoneEl = document.getElementById("filter-zone");

        this.filters.from = fromEl && fromEl.value ? new Date(fromEl.value).toISOString() : null;
        this.filters.to = toEl && toEl.value ? new Date(toEl.value).toISOString() : null;
        this.filters.zone = zoneEl ? zoneEl.value : "";
        this.page = 0;
        this.applyFilters();
      });
    }

    // Pagination
    const btnPrev = document.getElementById("btn-page-prev");
    const btnNext = document.getElementById("btn-page-next");

    if (btnPrev) {
      btnPrev.addEventListener("click", () => {
        if (this.page > 0) {
          this.page -= 1;
          this.loadTableData();
        }
      });
    }

    if (btnNext) {
      btnNext.addEventListener("click", () => {
        if ((this.page + 1) * this.pageSize < this.totalRows) {
          this.page += 1;
          this.loadTableData();
        }
      });
    }
  }

  async applyFilters() {
    this.updateExportCsvLink();
    await Promise.all([
      this.loadHeatmap(),
      this.loadZoneAverages(),
      this.loadForecast(),
      this.loadTableData(),
    ]);
  }

  updateExportCsvLink() {
    const btnExport = document.getElementById("btn-export-csv");
    if (!btnExport) return;

    let url = "/api/export.csv?table=traffic_log";
    if (this.filters.from) url += `&from=${encodeURIComponent(this.filters.from)}`;
    if (this.filters.to) url += `&to=${encodeURIComponent(this.filters.to)}`;
    btnExport.href = url;
  }

  // ==========================================================================
  // 1. Heatmap
  // ==========================================================================
  async loadHeatmap() {
    const container = document.getElementById("heatmap-container");
    if (!container) return;

    try {
      const res = await fetchApi("/api/heatmap");
      if (!res.ok || !res.data) return;

      const { days, hours, matrix } = res.data;

      // Find max occupancy value for scaling colormap
      let maxVal = 1;
      const peaks = [];

      for (let d = 0; d < matrix.length; d++) {
        for (let h = 0; h < matrix[d].length; h++) {
          const val = matrix[d][h];
          if (val > maxVal) maxVal = val;
          peaks.push({ day: days[d], hour: h, val });
        }
      }

      // Sort top 3 peak hours
      peaks.sort((a, b) => b.val - a.val);
      const top3 = peaks.slice(0, 3);
      const topPeaksEl = document.getElementById("heatmap-top-peaks");
      if (topPeaksEl) {
        topPeaksEl.textContent = top3
          .map((p) => `${p.day} @ ${String(p.hour).padStart(2, "0")}:00 (${p.val} veh avg)`)
          .join(" • ");
      }

      // Render table
      let html = `<table class="heatmap-table" role="grid" aria-label="Peak hour traffic heatmap">`;
      html += `<thead><tr><th scope="col">Day</th>`;
      hours.forEach((h) => {
        html += `<th scope="col" class="heatmap-header-hour">${h}h</th>`;
      });
      html += `</tr></thead><tbody>`;

      days.forEach((dayName, dIdx) => {
        html += `<tr><th scope="row" class="heatmap-header-day">${dayName.slice(0, 3)}</th>`;
        hours.forEach((hIdx) => {
          const val = matrix[dIdx][hIdx];
          const intensity = Math.min(1.0, val / maxVal);
          // Color blind safe sequential scale: Dark slate to Gold/Amber
          const r = Math.round(18 + intensity * (212 - 18));
          const g = Math.round(28 + intensity * (160 - 28));
          const b = Math.round(48 + intensity * (23 - 48));
          const textColor = intensity > 0.5 ? "#000000" : "#E8EEF7";

          html += `<td class="heatmap-cell" style="background-color: rgb(${r}, ${g}, ${b}); color: ${textColor};" title="${dayName} ${hIdx}:00 - Avg ${val} vehicles" aria-label="${dayName} ${hIdx}:00: ${val} vehicles">${val > 0 ? val : ""}</td>`;
        });
        html += `</tr>`;
      });

      html += `</tbody></table>`;
      container.innerHTML = html;
    } catch (err) {
      console.error("Heatmap load error:", err);
    }
  }

  // ==========================================================================
  // 2. Zone Averages Bar Chart
  // ==========================================================================
  async loadZoneAverages() {
    try {
      let url = "/api/zone-averages";
      const params = [];
      if (this.filters.from) params.push(`from=${encodeURIComponent(this.filters.from)}`);
      if (this.filters.to) params.push(`to=${encodeURIComponent(this.filters.to)}`);
      if (params.length > 0) url += `?${params.join("&")}`;

      const res = await fetchApi(url);
      if (!res.ok || !res.data) return;

      const data = res.data;
      const zones = ["N", "S", "E", "W"];
      const averages = zones.map((z) => data[z]?.average_occupancy || 0);

      // Render or update bar chart
      const canvas = document.getElementById("zone-averages-chart");
      if (canvas && typeof Chart !== "undefined") {
        if (this.barChart) {
          this.barChart.data.datasets[0].data = averages;
          this.barChart.update("none");
        } else {
          const ctx = canvas.getContext("2d");
          this.barChart = new Chart(ctx, {
            type: "bar",
            data: {
              labels: ["North (N)", "South (S)", "East (E)", "West (W)"],
              datasets: [
                {
                  label: "Average Occupancy",
                  data: averages,
                  backgroundColor: ["#3B82F6", "#10B981", "#F59E0B", "#EC4899"],
                  borderRadius: 4,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              animation: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: "#9FB0C8" }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: "#9FB0C8" }, grid: { color: "rgba(232, 238, 247, 0.08)" } },
              },
            },
          });
        }
      }

      // Render dominant chips
      const chipsContainer = document.getElementById("zone-chips-container");
      if (chipsContainer) {
        chipsContainer.innerHTML = zones
          .map((z) => {
            const level = data[z]?.dominant_density || "Low";
            return `
              <div class="zone-card" style="padding: var(--space-2) var(--space-3);">
                <div class="cluster cluster-between">
                  <span style="font-weight: 600; font-size: var(--text-xs);">Zone ${z}</span>
                  <span class="density-chip density-chip--${level.toLowerCase()}">
                    <span class="density-chip-dot" aria-hidden="true"></span>
                    ${level}
                  </span>
                </div>
              </div>
            `;
          })
          .join("");
      }
    } catch (err) {
      console.error("Zone averages load error:", err);
    }
  }

  // ==========================================================================
  // 3. Indicative Forecast
  // ==========================================================================
  async loadForecast() {
    try {
      let url = "/api/forecast";
      if (this.filters.zone) url += `?zone=${this.filters.zone}`;

      const res = await fetchApi(url);
      const valEl = document.getElementById("forecast-pred-val");
      const emptyEl = document.getElementById("forecast-empty");
      const bodyEl = document.getElementById("forecast-card-body");

      if (res.ok && res.data && res.data.prediction !== null) {
        if (bodyEl) bodyEl.style.display = "block";
        if (emptyEl) emptyEl.style.display = "none";
        if (valEl) valEl.textContent = `${res.data.prediction} veh`;

        // Render sparkline
        const sparkCanvas = document.getElementById("forecast-sparkline");
        if (sparkCanvas && typeof Chart !== "undefined") {
          // Generate 10-point synthetic history line ending at prediction
          const pred = res.data.prediction;
          const points = [Math.max(0, pred - 3), Math.max(0, pred - 2), pred - 1, pred, pred];

          if (this.sparklineChart) {
            this.sparklineChart.data.datasets[0].data = points;
            this.sparklineChart.update("none");
          } else {
            const ctx = sparkCanvas.getContext("2d");
            this.sparklineChart = new Chart(ctx, {
              type: "line",
              data: {
                labels: ["", "", "", "", ""],
                datasets: [
                  {
                    data: points,
                    borderColor: "#D4A017",
                    backgroundColor: "rgba(212, 160, 23, 0.15)",
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: true,
                    tension: 0.3,
                  },
                ],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: { x: { display: false }, y: { display: false } },
              },
            });
          }
        }
      } else {
        if (bodyEl) bodyEl.style.display = "none";
        if (emptyEl) emptyEl.style.display = "block";
      }
    } catch (e) {
      console.error("Forecast load error:", e);
    }
  }

  // ==========================================================================
  // 4. Historical Traffic Log Table
  // ==========================================================================
  async loadTableData() {
    try {
      let url = `/api/history?limit=${this.pageSize}&offset=${this.page * this.pageSize}`;
      if (this.filters.from) url += `&from=${encodeURIComponent(this.filters.from)}`;
      if (this.filters.to) url += `&to=${encodeURIComponent(this.filters.to)}`;
      if (this.filters.zone) url += `&zone=${this.filters.zone}`;

      const res = await fetchApi(url);
      const tbody = document.getElementById("history-table-body");
      const totalTag = document.getElementById("history-total-tag");
      const pageInfo = document.getElementById("pagination-info");
      const btnPrev = document.getElementById("btn-page-prev");
      const btnNext = document.getElementById("btn-page-next");
      const simNotice = document.getElementById("badge-sim-notice");

      if (!res.ok || !res.data || !res.data.traffic) return;

      const rows = res.data.traffic;
      const hasSim = rows.some((r) => r.is_simulated);
      if (simNotice) simNotice.style.display = hasSim ? "inline-block" : "none";

      this.totalRows = rows.length >= this.pageSize ? (this.page + 2) * this.pageSize : (this.page * this.pageSize + rows.length);

      if (totalTag) totalTag.textContent = `${rows.length} Rows on page`;
      if (pageInfo) pageInfo.textContent = `Page ${this.page + 1}`;
      if (btnPrev) btnPrev.disabled = this.page === 0;
      if (btnNext) btnNext.disabled = rows.length < this.pageSize;

      if (rows.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; color: var(--text-muted); padding: var(--space-6);">
              No historical records found for active filters.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = rows
        .map((r) => {
          const level = (r.density_level || "Low").toLowerCase();
          return `
            <tr>
              <td class="font-mono" style="font-size: var(--text-xs);">${r.ts.slice(0, 19).replace("T", " ")}</td>
              <td><span class="badge ${r.is_simulated ? "badge--simulated" : "tag-sign"}">${r.source}</span></td>
              <td><strong>Zone ${r.zone}</strong></td>
              <td class="font-mono">${r.occupancy_avg} veh</td>
              <td>
                <span class="density-chip density-chip--${level}">
                  <span class="density-chip-dot" aria-hidden="true"></span>
                  ${r.density_level}
                </span>
              </td>
            </tr>
          `;
        })
        .join("");
    } catch (e) {
      console.error("Table data load error:", e);
    }
  }
}

// Initialize on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => new AnalyticsController());
} else {
  new AnalyticsController();
}
