/**
 * static/js/modules/source-picker.js
 * Accessible, reusable Source Selector & Video Upload Component (ES Module).
 *
 * Features:
 *  - Radio group semantics (role="radiogroup") with keyboard arrow-key navigation.
 *  - 4 Modes: Simulation, Sample Video, Upload Video, and Live Webcam.
 *  - Drag & drop video upload area with keyboard-accessible file input.
 *  - Client-side pre-validation: file extension (.mp4, .avi) and max size (100 MB).
 *  - Real-time XMLHttpRequest upload progress bar with percentage readout.
 *  - CSRF header integration from <meta name="csrf-token">.
 *  - Dropdown populated with dynamic sample list from GET /api/samples.
 *  - Toast alerts on upload success, network error, or validation failure.
 */

import { fetchApi } from "./api.js";
import { showToast } from "./toast.js";

export class SourcePicker {
  /**
   * @param {HTMLElement | string} container - Target container element or selector.
   * @param {Object} [options={}]
   * @param {string} [options.initialSource="simulation"]
   * @param {Function} [options.onSourceChange] - Callback (source, details) => void
   */
  constructor(container, options = {}) {
    this.container = typeof container === "string"
      ? document.querySelector(container)
      : container;

    if (!this.container) {
      throw new Error("SourcePicker container element not found.");
    }

    this.currentSource = options.initialSource || "simulation";
    this.onSourceChange = options.onSourceChange || (() => {});
    this.uploadedFileId = null;
    this.selectedSample = null;
    this.availableSamples = [];

    this._render();
    this._attachEvents();
    this._loadSamples();
  }

  _render() {
    this.container.innerHTML = `
      <div class="source-picker-widget stack stack-md" role="region" aria-label="Traffic Data Input Selector">
        <!-- Segmented Radiogroup -->
        <div class="dash-source-selector" role="radiogroup" aria-label="Select traffic stream input mode">
          <label class="segmented-option">
            <input type="radio" name="source-input-mode" value="simulation" ${this.currentSource === "simulation" ? "checked" : ""}>
            <span class="segmented-btn">Simulation</span>
          </label>
          <label class="segmented-option">
            <input type="radio" name="source-input-mode" value="sample" ${this.currentSource === "sample" ? "checked" : ""}>
            <span class="segmented-btn">Sample Video</span>
          </label>
          <label class="segmented-option">
            <input type="radio" name="source-input-mode" value="upload" ${this.currentSource === "upload" ? "checked" : ""}>
            <span class="segmented-btn">Upload Video</span>
          </label>
          <label class="segmented-option">
            <input type="radio" name="source-input-mode" value="webcam" ${this.currentSource === "webcam" ? "checked" : ""}>
            <span class="segmented-btn">Live Webcam</span>
          </label>
        </div>

        <!-- Conditional Panels -->
        <!-- 1. Simulation Panel -->
        <div class="source-subpanel" id="panel-source-simulation" style="${this.currentSource === "simulation" ? "display: block;" : "display: none;"}">
          <p style="font-size: var(--text-sm); color: var(--text-muted); margin: 0;">
            Running realistic diurnal traffic generator. High/low peaks, vehicle classifications, and directional queue densities.
          </p>
        </div>

        <!-- 2. Sample Video Panel -->
        <div class="source-subpanel" id="panel-source-sample" style="${this.currentSource === "sample" ? "display: block;" : "display: none;"}">
          <div class="cluster cluster-sm" style="align-items: center;">
            <label for="sample-select-dropdown" style="font-size: var(--text-sm); font-weight: var(--font-weight-semibold);">
              Choose Sample:
            </label>
            <select id="sample-select-dropdown" class="input-select" style="min-width: 220px;">
              <option value="">Loading samples...</option>
            </select>
          </div>
        </div>

        <!-- 3. Upload Video Panel -->
        <div class="source-subpanel" id="panel-source-upload" style="${this.currentSource === "upload" ? "display: block;" : "display: none;"}">
          <div class="upload-dropzone" id="upload-dropzone" tabindex="0" role="button" aria-label="Upload traffic video. Drag and drop file here or press Enter to browse">
            <input type="file" id="upload-file-input" accept=".mp4,.avi,video/mp4,video/avi" style="display: none;" />
            <div class="stack stack-xs" style="align-items: center; text-align: center;">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--brand-secondary);">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <strong style="font-size: var(--text-sm);">Drop traffic video here or click to browse</strong>
              <span style="font-size: var(--text-xs); color: var(--text-muted);">Supports MP4 and AVI containers up to 100 MB</span>
            </div>
          </div>

          <!-- Progress and File Info Area -->
          <div id="upload-progress-area" class="stack stack-xs" style="display: none; margin-top: var(--space-2);">
            <div class="cluster cluster-between" style="font-size: var(--text-xs);">
              <span id="upload-file-name" class="font-mono" style="color: var(--text);">video.mp4</span>
              <span id="upload-progress-pct" class="font-mono" style="color: var(--brand-secondary);">0%</span>
            </div>
            <div class="upload-progress-track" style="height: 6px; background: var(--surface-raised); border-radius: 3px; overflow: hidden; border: 1px solid var(--rule);">
              <div id="upload-progress-bar" style="width: 0%; height: 100%; background: var(--signal-green); transition: width 0.15s ease;"></div>
            </div>
          </div>
        </div>

        <!-- 4. Webcam Panel -->
        <div class="source-subpanel" id="panel-source-webcam" style="${this.currentSource === "webcam" ? "display: block;" : "display: none;"}">
          <div class="cluster cluster-sm" style="align-items: center;">
            <span class="badge badge--simulated">Camera #0</span>
            <p style="font-size: var(--text-sm); color: var(--text-muted); margin: 0;">
              Connects to primary USB / integrated video capture device (Camera Index 0). Ensure browser and OS permissions allow camera access.
            </p>
          </div>
        </div>
      </div>
    `;
  }

  _attachEvents() {
    // 1. Radio selector changes & keyboard navigation
    const radios = this.container.querySelectorAll('input[name="source-input-mode"]');
    radios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.setSource(e.target.value);
      });
    });

    // 2. Sample dropdown change
    const sampleDropdown = this.container.querySelector("#sample-select-dropdown");
    if (sampleDropdown) {
      sampleDropdown.addEventListener("change", (e) => {
        this.selectedSample = e.target.value;
        this.onSourceChange("sample", { sample_name: this.selectedSample });
      });
    }

    // 3. Upload drag & drop
    const dropzone = this.container.querySelector("#upload-dropzone");
    const fileInput = this.container.querySelector("#upload-file-input");

    if (dropzone && fileInput) {
      dropzone.addEventListener("click", () => fileInput.click());
      dropzone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fileInput.click();
        }
      });

      ["dragenter", "dragover"].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          dropzone.classList.add("is-dragover");
        });
      });

      ["dragleave", "drop"].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          dropzone.classList.remove("is-dragover");
        });
      });

      dropzone.addEventListener("drop", (e) => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
          this._handleFileUpload(files[0]);
        }
      });

      fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this._handleFileUpload(e.target.files[0]);
        }
      });
    }
  }

  async _loadSamples() {
    try {
      const res = await fetchApi("/api/samples");
      const dropdown = this.container.querySelector("#sample-select-dropdown");
      if (!dropdown) return;

      if (res.ok && res.data && res.data.samples && res.data.samples.length > 0) {
        this.availableSamples = res.data.samples;
        dropdown.innerHTML = this.availableSamples
          .map((s) => `<option value="${s.name}">${s.name} (${Math.round(s.size_bytes / (1024 * 1024) * 10) / 10} MB)</option>`)
          .join("");
        this.selectedSample = this.availableSamples[0].name;
      } else {
        dropdown.innerHTML = `<option value="sample.mp4">Default Sample (sample.mp4)</option>`;
        this.selectedSample = "sample.mp4";
      }
    } catch (err) {
      const dropdown = this.container.querySelector("#sample-select-dropdown");
      if (dropdown) {
        dropdown.innerHTML = `<option value="sample.mp4">Default Sample (sample.mp4)</option>`;
      }
    }
  }

  _handleFileUpload(file) {
    if (!file) return;

    // 1. Client-side pre-validation
    const name = file.name.toLowerCase();
    if (!name.endsWith(".mp4") && !name.endsWith(".avi")) {
      showToast("Only .mp4 and .avi video files are supported.", "error", 5000);
      return;
    }

    const maxBytes = 100 * 1024 * 1024; // 100 MB
    if (file.size > maxBytes) {
      showToast("File exceeds maximum allowed size of 100 MB.", "error", 5000);
      return;
    }

    // 2. Show progress bar
    const progArea = this.container.querySelector("#upload-progress-area");
    const progName = this.container.querySelector("#upload-file-name");
    const progPct = this.container.querySelector("#upload-progress-pct");
    const progBar = this.container.querySelector("#upload-progress-bar");

    if (progArea) progArea.style.display = "flex";
    if (progName) progName.textContent = file.name;
    if (progPct) progPct.textContent = "0%";
    if (progBar) {
      progBar.style.width = "0%";
      progBar.style.background = "var(--signal-amber)";
    }

    // 3. Upload via XMLHttpRequest for true progress events
    const formData = new FormData();
    formData.append("file", file);

    const csrfMeta = document.querySelector('meta[name="csrf-token"]');
    const csrfToken = csrfMeta ? csrfMeta.getAttribute("content") : "";

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload", true);
    if (csrfToken) {
      xhr.setRequestHeader("X-CSRFToken", csrfToken);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        if (progPct) progPct.textContent = `${pct}%`;
        if (progBar) progBar.style.width = `${pct}%`;
      }
    };

    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && res.ok && res.data) {
          if (progBar) progBar.style.background = "var(--signal-green)";
          if (progPct) progPct.textContent = "100% Ready";
          this.uploadedFileId = res.data.file_id;
          showToast(`Uploaded ${res.data.original_name} successfully!`, "success", 4000);
          this.onSourceChange("upload", { file_id: this.uploadedFileId });
        } else {
          if (progBar) progBar.style.background = "var(--signal-red)";
          const msg = res.error?.message || "Upload rejected by server";
          showToast(`Upload failed: ${msg}`, "error", 6000);
        }
      } catch (err) {
        if (progBar) progBar.style.background = "var(--signal-red)";
        showToast("Unexpected response from upload server", "error", 5000);
      }
    };

    xhr.onerror = () => {
      if (progBar) progBar.style.background = "var(--signal-red)";
      showToast("Network error occurred during video upload", "error", 5000);
    };

    xhr.send(formData);
  }

  setSource(source) {
    this.currentSource = source;

    // Toggle radio check
    const radio = this.container.querySelector(`input[name="source-input-mode"][value="${source}"]`);
    if (radio) radio.checked = true;

    // Toggle subpanels
    ["simulation", "sample", "upload", "webcam"].forEach((mode) => {
      const panel = this.container.querySelector(`#panel-source-${mode}`);
      if (panel) {
        panel.style.display = mode === source ? "block" : "none";
      }
    });

    // Dispatch callback
    const details = {};
    if (source === "upload" && this.uploadedFileId) {
      details.file_id = this.uploadedFileId;
    } else if (source === "sample") {
      details.sample_name = this.selectedSample || "sample.mp4";
    } else if (source === "webcam") {
      details.camera_index = 0;
    }

    this.onSourceChange(source, details);
  }
}
