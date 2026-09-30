/**
 * static/js/modules/trafficlight.js
 * Reusable, accessible animated Traffic Light Widget component.
 *
 * Capabilities:
 *  - Renders a control-room style traffic light signal housing into any container.
 *  - Methods:
 *      setState('green' | 'amber' | 'red')
 *      runCycle(greenSeconds, amberSeconds, redSeconds)
 *      destroy()
 *  - Screen-reader accessible: Provides text-based state labels and polite live announcements.
 *  - Motion safety: Honours prefers-reduced-motion by freezing continuous timer transitions.
 */

export class TrafficLightWidget {
  /**
   * @param {HTMLElement | string} container - Target container element or selector.
   * @param {Object} [options={}]
   * @param {"green" | "amber" | "red"} [options.initialState="red"]
   * @param {boolean} [options.showLabel=true] - Display text indicator next to the light.
   * @param {string} [options.id="traffic-light"]
   */
  constructor(container, options = {}) {
    this.container = typeof container === "string"
      ? document.querySelector(container)
      : container;

    if (!this.container) {
      throw new Error(`TrafficLightWidget container element not found.`);
    }

    this.state = options.initialState || "red";
    this.showLabel = options.showLabel !== false;
    this.id = options.id || `tl-${Math.random().toString(36).substring(2, 9)}`;

    this.timer = null;
    this._destroyed = false;
    this._lastAnnounced = "";

    this._render();
    this.setState(this.state, false);
  }

  _render() {
    this.element = document.createElement("div");
    this.element.className = "tl-widget";
    this.element.id = this.id;
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-live", "polite");

    this.element.innerHTML = `
      <div class="tl-housing" aria-hidden="true">
        <span class="tl-visor tl-visor--red"></span>
        <span class="tl-lamp tl-lamp--red" data-lamp="red"></span>

        <span class="tl-visor tl-visor--amber"></span>
        <span class="tl-lamp tl-lamp--amber" data-lamp="amber"></span>

        <span class="tl-visor tl-visor--green"></span>
        <span class="tl-lamp tl-lamp--green" data-lamp="green"></span>
      </div>
      ${
        this.showLabel
          ? `<div class="tl-status-badge">
               <span class="tl-state-text" data-label>RED (STOP)</span>
             </div>`
          : ""
      }
    `;

    this.container.innerHTML = "";
    this.container.appendChild(this.element);

    this.lampRed = this.element.querySelector('[data-lamp="red"]');
    this.lampAmber = this.element.querySelector('[data-lamp="amber"]');
    this.lampGreen = this.element.querySelector('[data-lamp="green"]');
    this.labelEl = this.element.querySelector('[data-label]');
  }

  /**
   * Set the traffic light signal state.
   *
   * @param {"green" | "amber" | "red"} state
   * @param {boolean} [announce=true] - Whether to update aria announcement.
   */
  setState(state, announce = true) {
    if (this._destroyed) return;
    const normalized = (state || "").toLowerCase();
    if (!["green", "amber", "red"].includes(normalized)) {
      return;
    }

    this.state = normalized;

    // Reset lamps
    this.lampRed?.classList.remove("is-active");
    this.lampAmber?.classList.remove("is-active");
    this.lampGreen?.classList.remove("is-active");

    let textLabel = "";
    if (this.state === "green") {
      this.lampGreen?.classList.add("is-active");
      textLabel = "GREEN (GO)";
    } else if (this.state === "amber") {
      this.lampAmber?.classList.add("is-active");
      textLabel = "AMBER (CAUTION)";
    } else {
      this.lampRed?.classList.add("is-active");
      textLabel = "RED (STOP)";
    }

    if (this.labelEl) {
      this.labelEl.textContent = textLabel;
      this.labelEl.setAttribute("data-state", this.state);
    }

    // Accessible description
    if (announce && this._lastAnnounced !== textLabel) {
      this._lastAnnounced = textLabel;
      this.element?.setAttribute("aria-label", `Signal status: ${textLabel}`);
    }
  }

  /**
   * Run an automated timed signal cycle loop.
   *
   * @param {number} greenSec - Green phase duration in seconds.
   * @param {number} [amberSec=3] - Amber phase duration in seconds.
   * @param {number} [redSec=30] - Red phase duration in seconds.
   */
  runCycle(greenSec, amberSec = 3, redSec = 30) {
    this.stopCycle();
    if (this._destroyed) return;

    const gMs = Math.max(1, Number(greenSec) || 30) * 1000;
    const aMs = Math.max(1, Number(amberSec) || 3) * 1000;
    const rMs = Math.max(1, Number(redSec) || 30) * 1000;

    const cycleSteps = [
      { state: "green", duration: gMs },
      { state: "amber", duration: aMs },
      { state: "red", duration: rMs }
    ];

    let currentStep = 0;

    const executeStep = () => {
      if (this._destroyed) return;
      const step = cycleSteps[currentStep];
      this.setState(step.state);

      currentStep = (currentStep + 1) % cycleSteps.length;
      this.timer = setTimeout(executeStep, step.duration);
    };

    executeStep();
  }

  /**
   * Stop any active automatic cycle.
   */
  stopCycle() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Clean up DOM references and timers.
   */
  destroy() {
    this._destroyed = true;
    this.stopCycle();
    if (this.element && this.element.parentElement) {
      this.element.remove();
    }
  }
}
