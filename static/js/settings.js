/**
 * static/js/settings.js
 * Settings & Interactive ROI/Line Canvas Editor Controller (ES Module).
 *
 * Capabilities:
 *  - Loads current system settings from GET /api/settings.
 *  - Renders input source picker via SourcePicker module.
 *  - Canvas editor over a live JPEG frame (/api/snapshot) with draggable handles:
 *      • 2 Counting Line endpoints (Cyan).
 *      • 4 Polygon Zones (N=Blue, S=Green, E=Amber, W=Pink) or 1 Single ROI.
 *  - Keyboard accessibility for canvas handles (Tab to cycle, Arrow to nudge by 1%, Shift+Arrow by 5%).
 *  - Validates fields client-side and renders inline server validation errors.
 *  - Saves settings via POST /api/settings and shows toasts.
 *  - "Restore defaults" confirm modal.
 */

import { fetchApi } from "./modules/api.js";
import { showToast } from "./modules/toast.js";
import { SourcePicker } from "./modules/source-picker.js";

// Factory defaults
const DEFAULT_CONFIG = {
  density_low: 5,
  density_high: 12,
  congestion_seconds: 10,
  base_green: 30,
  min_green: 10,
  max_green: 60,
  k: 1.5,
  other_phase_seconds: 30,
  fixed_green: 30,
  counting_line: [[0.1, 0.55], [0.9, 0.55]],
  zones: {
    N: [[0.35, 0.0], [0.65, 0.0], [0.65, 0.4], [0.35, 0.4]],
    S: [[0.35, 0.6], [0.65, 0.6], [0.65, 1.0], [0.35, 1.0]],
    E: [[0.6, 0.35], [1.0, 0.35], [1.0, 0.65], [0.6, 0.65]],
    W: [[0.0, 0.35], [0.4, 0.35], [0.4, 0.65], [0.0, 0.65]],
  },
};

const ZONE_COLORS = {
  N: { stroke: "#3B82F6", fill: "rgba(59, 130, 246, 0.25)" },
  S: { stroke: "#10B981", fill: "rgba(16, 185, 129, 0.25)" },
  E: { stroke: "#F59E0B", fill: "rgba(245, 158, 11, 0.25)" },
  W: { stroke: "#EC4899", fill: "rgba(236, 72, 153, 0.25)" },
};

class SettingsController {
  constructor() {
    this.currentSettings = { ...DEFAULT_CONFIG };
    this.sourcePicker = null;

    // Canvas state
    this.canvas = document.getElementById("roi-canvas");
    this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
    this.bgImage = new Image();
    this.isSingleRoi = false;

    // Active handles list: [{ id, type: 'line'|'zone', key, index, x, y }]
    this.handles = [];
    this.selectedHandleIdx = -1;
    this.draggedHandleIdx = -1;

    this.init();
  }

  async init() {
    // 1. Initialize Source Picker
    const spContainer = document.getElementById("source-picker-container");
    if (spContainer) {
      this.sourcePicker = new SourcePicker(spContainer, {
        initialSource: "simulation",
        onSourceChange: (source, details) => {
          this.currentSettings.default_source = source;
          this.currentSettings.source_details = details;
        },
      });
    }

    // 2. Fetch current settings from API
    await this.loadSettings();

    // 3. Setup Canvas Editor & Background Snapshot Image
    this.initCanvasEditor();

    // 4. Attach Form & Modal Event Handlers
    this.attachEvents();
  }

  async loadSettings() {
    try {
      const res = await fetchApi("/api/settings");
      if (res.ok && res.data) {
        this.currentSettings = { ...DEFAULT_CONFIG, ...res.data };
        this.populateFormFields(this.currentSettings);
        if (this.sourcePicker && res.data.default_source) {
          this.sourcePicker.setSource(res.data.default_source);
        }
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }

  populateFormFields(cfg) {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };

    setVal("setting-density-low", cfg.density_low ?? 5);
    setVal("setting-density-high", cfg.density_high ?? 12);
    setVal("setting-congestion-sec", cfg.congestion_seconds ?? 10);
    setVal("setting-base-green", cfg.base_green ?? 30);
    setVal("setting-k", cfg.k ?? 1.5);
    setVal("setting-min-green", cfg.min_green ?? 10);
    setVal("setting-max-green", cfg.max_green ?? 60);
    setVal("setting-fixed-green", cfg.fixed_green ?? 30);
    setVal("setting-other-phase", cfg.other_phase_seconds ?? 30);

    this.rebuildHandles();
    this.redrawCanvas();
  }

  initCanvasEditor() {
    if (!this.canvas) return;

    this.bgImage.crossOrigin = "anonymous";
    this.bgImage.src = `/api/snapshot?t=${Date.now()}`;
    this.bgImage.onload = () => this.redrawCanvas();

    // Mouse interaction
    this.canvas.addEventListener("mousedown", (e) => this.handleMouseDown(e));
    window.addEventListener("mousemove", (e) => this.handleMouseMove(e));
    window.addEventListener("mouseup", () => this.handleMouseUp());

    // Keyboard navigation (Tab & Arrow Nudge)
    this.canvas.addEventListener("keydown", (e) => this.handleKeyDown(e));

    // Single ROI Checkbox
    const singleRoiCheck = document.getElementById("check-single-roi");
    if (singleRoiCheck) {
      singleRoiCheck.addEventListener("change", (e) => {
        this.isSingleRoi = e.target.checked;
        this.rebuildHandles();
        this.redrawCanvas();
      });
    }

    // Reset Canvas ROI button
    const btnResetRoi = document.getElementById("btn-reset-roi");
    if (btnResetRoi) {
      btnResetRoi.addEventListener("click", () => {
        this.currentSettings.counting_line = JSON.parse(JSON.stringify(DEFAULT_CONFIG.counting_line));
        this.currentSettings.zones = JSON.parse(JSON.stringify(DEFAULT_CONFIG.zones));
        this.rebuildHandles();
        this.redrawCanvas();
        showToast("Reset canvas calibration to default coordinates", "info", 3000);
      });
    }
  }

  rebuildHandles() {
    this.handles = [];
    const line = this.currentSettings.counting_line || DEFAULT_CONFIG.counting_line;

    // Line handles
    this.handles.push({ type: "line", index: 0, x: line[0][0], y: line[0][1], label: "Line P1" });
    this.handles.push({ type: "line", index: 1, x: line[1][0], y: line[1][1], label: "Line P2" });

    // Zone handles
    if (this.isSingleRoi) {
      const poly = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
      poly.forEach((pt, idx) => {
        this.handles.push({ type: "zone", key: "ROI", index: idx, x: pt[0], y: pt[1], label: `ROI P${idx + 1}` });
      });
    } else {
      const zones = this.currentSettings.zones || DEFAULT_CONFIG.zones;
      ["N", "S", "E", "W"].forEach((zKey) => {
        const poly = zones[zKey] || [];
        poly.forEach((pt, idx) => {
          this.handles.push({ type: "zone", key: zKey, index: idx, x: pt[0], y: pt[1], label: `${zKey} P${idx + 1}` });
        });
      });
    }

    this.updateScreenReaderSummary();
  }

  redrawCanvas() {
    if (!this.ctx || !this.canvas) return;
    const w = this.canvas.width;
    const h = this.canvas.height;

    this.ctx.clearRect(0, 0, w, h);

    // Draw background snapshot or fallback
    if (this.bgImage.complete && this.bgImage.naturalWidth > 0) {
      this.ctx.drawImage(this.bgImage, 0, 0, w, h);
    } else {
      this.ctx.fillStyle = "#0B1220";
      this.ctx.fillRect(0, 0, w, h);
    }

    // Draw Polygons
    if (this.isSingleRoi) {
      const pts = this.handles.filter((hnd) => hnd.type === "zone" && hnd.key === "ROI");
      this.drawPolygon(pts, "#3B82F6", "rgba(59, 130, 246, 0.25)", "Single Zone ROI");
    } else {
      ["N", "S", "E", "W"].forEach((zKey) => {
        const pts = this.handles.filter((hnd) => hnd.type === "zone" && hnd.key === zKey);
        const col = ZONE_COLORS[zKey] || { stroke: "#3B82F6", fill: "rgba(59,130,246,0.25)" };
        this.drawPolygon(pts, col.stroke, col.fill, `Zone ${zKey}`);
      });
    }

    // Draw Counting Line
    const linePts = this.handles.filter((hnd) => hnd.type === "line");
    if (linePts.length >= 2) {
      const p1 = { x: linePts[0].x * w, y: linePts[0].y * h };
      const p2 = { x: linePts[1].x * w, y: linePts[1].y * h };

      this.ctx.strokeStyle = "#000000";
      this.ctx.lineWidth = 4;
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();

      this.ctx.strokeStyle = "#00FFFF";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();
    }

    // Draw Handles
    this.handles.forEach((hnd, idx) => {
      const px = hnd.x * w;
      const py = hnd.y * h;
      const isSelected = idx === this.selectedHandleIdx;

      this.ctx.fillStyle = isSelected ? "#FFFFFF" : (hnd.type === "line" ? "#00FFFF" : "#D4A017");
      this.ctx.strokeStyle = "#0B1220";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(px, py, isSelected ? 7 : 5, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
    });
  }

  drawPolygon(pts, strokeColor, fillColor, label) {
    if (pts.length < 3) return;
    const w = this.canvas.width;
    const h = this.canvas.height;

    this.ctx.beginPath();
    this.ctx.moveTo(pts[0].x * w, pts[0].y * h);
    for (let i = 1; i < pts.length; i++) {
      this.ctx.lineTo(pts[i].x * w, pts[i].y * h);
    }
    this.ctx.closePath();

    this.ctx.fillStyle = fillColor;
    this.ctx.fill();
    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // Centroid label
    let cx = 0, cy = 0;
    pts.forEach((p) => { cx += p.x * w; cy += p.y * h; });
    cx /= pts.length;
    cy /= pts.length;

    this.ctx.fillStyle = "#FFFFFF";
    this.ctx.font = "bold 11px 'Space Grotesk', sans-serif";
    this.ctx.fillText(label, cx - 20, cy);
  }

  handleMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / rect.width;
    const clickY = (e.clientY - rect.top) / rect.height;

    const threshold = 14 / rect.width; // Click radius
    let foundIdx = -1;

    for (let i = 0; i < this.handles.length; i++) {
      const hnd = this.handles[i];
      const dx = hnd.x - clickX;
      const dy = hnd.y - clickY;
      if (Math.sqrt(dx * dx + dy * dy) < threshold) {
        foundIdx = i;
        break;
      }
    }

    this.selectedHandleIdx = foundIdx;
    this.draggedHandleIdx = foundIdx;
    this.redrawCanvas();
    this.canvas.focus();
  }

  handleMouseMove(e) {
    if (this.draggedHandleIdx === -1 || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    const hnd = this.handles[this.draggedHandleIdx];
    hnd.x = Number(nx.toFixed(3));
    hnd.y = Number(ny.toFixed(3));

    this.syncHandleToSettings(hnd);
    this.redrawCanvas();
    this.updateScreenReaderSummary();
  }

  handleMouseUp() {
    this.draggedHandleIdx = -1;
  }

  handleKeyDown(e) {
    if (e.key === "Tab") {
      e.preventDefault();
      const step = e.shiftKey ? -1 : 1;
      this.selectedHandleIdx = (this.selectedHandleIdx + step + this.handles.length) % this.handles.length;
      this.redrawCanvas();
      this.updateScreenReaderSummary();
      return;
    }

    if (this.selectedHandleIdx === -1) return;
    const delta = e.shiftKey ? 0.05 : 0.01;
    const hnd = this.handles[this.selectedHandleIdx];
    let changed = false;

    if (e.key === "ArrowLeft") { hnd.x = Math.max(0, hnd.x - delta); changed = true; }
    if (e.key === "ArrowRight") { hnd.x = Math.min(1, hnd.x + delta); changed = true; }
    if (e.key === "ArrowUp") { hnd.y = Math.max(0, hnd.y - delta); changed = true; }
    if (e.key === "ArrowDown") { hnd.y = Math.min(1, hnd.y + delta); changed = true; }

    if (changed) {
      e.preventDefault();
      hnd.x = Number(hnd.x.toFixed(3));
      hnd.y = Number(hnd.y.toFixed(3));
      this.syncHandleToSettings(hnd);
      this.redrawCanvas();
      this.updateScreenReaderSummary();
    }
  }

  syncHandleToSettings(hnd) {
    if (hnd.type === "line") {
      this.currentSettings.counting_line[hnd.index] = [hnd.x, hnd.y];
    } else if (hnd.type === "zone") {
      if (hnd.key === "ROI") {
        this.currentSettings.zones = {
          N: [[hnd.x, hnd.y], [hnd.x, hnd.y], [hnd.x, hnd.y], [hnd.x, hnd.y]],
        };
      } else {
        if (!this.currentSettings.zones[hnd.key]) {
          this.currentSettings.zones[hnd.key] = [];
        }
        this.currentSettings.zones[hnd.key][hnd.index] = [hnd.x, hnd.y];
      }
    }
  }

  updateScreenReaderSummary() {
    const sr = document.getElementById("roi-sr-summary");
    if (!sr) return;
    const sel = this.selectedHandleIdx >= 0 ? this.handles[this.selectedHandleIdx] : null;
    const selText = sel ? `Selected handle: ${sel.label} at [${sel.x}, ${sel.y}].` : "No handle selected.";
    sr.textContent = `${selText} Total calibration points: ${this.handles.length}.`;
  }

  attachEvents() {
    // Save Settings Button
    const btnSave = document.getElementById("btn-save-settings");
    if (btnSave) {
      btnSave.addEventListener("click", () => this.saveSettings());
    }

    // Restore Defaults Modal
    const btnRestore = document.getElementById("btn-restore-defaults");
    const modal = document.getElementById("confirm-modal");
    const btnModalCancel = document.getElementById("modal-cancel-btn");
    const btnModalConfirm = document.getElementById("modal-confirm-btn");

    if (btnRestore && modal) {
      btnRestore.addEventListener("click", () => {
        modal.style.display = "flex";
      });
    }

    if (btnModalCancel && modal) {
      btnModalCancel.addEventListener("click", () => {
        modal.style.display = "none";
      });
    }

    if (btnModalConfirm && modal) {
      btnModalConfirm.addEventListener("click", () => {
        modal.style.display = "none";
        this.populateFormFields(DEFAULT_CONFIG);
        this.saveSettings();
        showToast("Restored and saved factory default settings", "success", 4000);
      });
    }
  }

  async saveSettings() {
    this.clearInlineErrors();

    const getNum = (id) => {
      const el = document.getElementById(id);
      return el ? parseFloat(el.value) : undefined;
    };

    const payload = {
      density_low: parseInt(getNum("setting-density-low"), 10),
      density_high: parseInt(getNum("setting-density-high"), 10),
      congestion_seconds: parseInt(getNum("setting-congestion-sec"), 10),
      base_green: parseInt(getNum("setting-base-green"), 10),
      k: getNum("setting-k"),
      min_green: parseInt(getNum("setting-min-green"), 10),
      max_green: parseInt(getNum("setting-max-green"), 10),
      fixed_green: parseInt(getNum("setting-fixed-green"), 10),
      other_phase_seconds: parseInt(getNum("setting-other-phase"), 10),
      counting_line: this.currentSettings.counting_line,
      zones: this.currentSettings.zones,
      default_source: this.currentSettings.default_source || "simulation",
    };

    // Client pre-validation
    if (payload.density_low >= payload.density_high) {
      this.showInlineError("err-density-low", "Low max must be strictly less than High min");
      showToast("Validation error: Low threshold must be less than High threshold", "error", 5000);
      return;
    }
    if (payload.min_green > payload.max_green) {
      this.showInlineError("err-min-green", "Min green cannot exceed Max green");
      showToast("Validation error: Min green cannot exceed Max green", "error", 5000);
      return;
    }

    try {
      const res = await fetchApi("/api/settings", {
        method: "POST",
        body: payload,
      });

      if (res.ok) {
        showToast("System settings saved successfully!", "success", 4000);
      } else {
        const err = res.error || {};
        if (err.details) {
          Object.entries(err.details).forEach(([field, msg]) => {
            const errId = `err-${field.replace(/_/g, "-")}`;
            this.showInlineError(errId, msg);
          });
        }
        showToast(`Save failed: ${err.message || "Invalid settings"}`, "error", 6000);
      }
    } catch (e) {
      showToast("Network error while saving settings", "error", 5000);
    }
  }

  showInlineError(id, msg) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = msg;
      el.classList.add("is-visible");
    }
  }

  clearInlineErrors() {
    document.querySelectorAll(".form-error-msg").forEach((el) => {
      el.textContent = "";
      el.classList.remove("is-visible");
    });
  }
}

// Initialize on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => new SettingsController());
} else {
  new SettingsController();
}
