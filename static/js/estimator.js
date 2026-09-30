/**
 * static/js/estimator.js
 * Signal Timing Estimator interactive controller.
 *
 * Responsibilities:
 *  - Manages real-time binding between inputs (slider, base, k, min, max, other phase) and outputs.
 *  - Calculates baseline vs suggested green phase times and Webster delays.
 *  - Drives the TrafficLightWidget visualizer according to the current suggestion.
 *  - Validates constraints (e.g. min_green <= max_green, base >= 0).
 *  - Updates aria-live polite announcements for accessibility.
 */

import { suggestGreen, estimateDelay, cycleLength } from "./modules/signal-logic.js";
import { TrafficLightWidget } from "./modules/trafficlight.js";

export function initEstimator() {
  const slider = document.getElementById("est-vehicle-count");
  const countDisplay = document.getElementById("est-count-display");
  const baseInput = document.getElementById("est-base-green");
  const kInput = document.getElementById("est-k-factor");
  const minInput = document.getElementById("est-min-green");
  const maxInput = document.getElementById("est-max-green");
  const otherInput = document.getElementById("est-other-phase");

  const baselineGreenEl = document.getElementById("est-baseline-green");
  const suggestedGreenEl = document.getElementById("est-suggested-green");
  const baselineDelayEl = document.getElementById("est-baseline-delay");
  const suggestedDelayEl = document.getElementById("est-suggested-delay");
  const delayDeltaEl = document.getElementById("est-delay-delta");
  const errorMsgEl = document.getElementById("est-error-msg");

  const lightContainer = document.getElementById("est-traffic-light");

  if (!slider || !lightContainer) return;

  // Initialize Traffic Light Widget
  let lightWidget = null;
  try {
    lightWidget = new TrafficLightWidget(lightContainer, {
      initialState: "green",
      showLabel: true,
      id: "estimator-tl-widget"
    });
  } catch (err) {
    console.error("Traffic light widget failed to initialize:", err);
  }

  function calculateAndRender() {
    const count = Number(slider.value) || 0;
    const base = Number(baseInput?.value) || 30;
    const k = Number(kInput?.value) || 1.5;
    const minG = Number(minInput?.value) || 10;
    const maxG = Number(maxInput?.value) || 60;
    const otherPhase = Number(otherInput?.value) || 30;

    // Sync count text
    if (countDisplay) {
      countDisplay.textContent = `${count}`;
    }

    // Validation
    if (minG > maxG) {
      if (errorMsgEl) {
        errorMsgEl.textContent = `Min green (${minG}s) cannot exceed Max green (${maxG}s).`;
        errorMsgEl.style.display = "flex";
      }
      minInput?.setAttribute("aria-invalid", "true");
      maxInput?.setAttribute("aria-invalid", "true");
      return;
    } else {
      if (errorMsgEl) {
        errorMsgEl.style.display = "none";
      }
      minInput?.removeAttribute("aria-invalid");
      maxInput?.removeAttribute("aria-invalid");
    }

    try {
      // 1. Fixed Baseline (Fixed 30s green)
      const fixedGreen = 30;
      const fixedCycle = cycleLength(fixedGreen, otherPhase);
      const fixedDelay = estimateDelay(fixedCycle, fixedGreen);

      // 2. Adaptive Suggestion
      const suggestedG = suggestGreen(count, base, k, minG, maxG);
      const suggestedCycle = cycleLength(suggestedG, otherPhase);
      const suggestedD = estimateDelay(suggestedCycle, suggestedG);

      // 3. Delta Calculation (difference in delay per vehicle)
      const delta = Number((suggestedD - fixedDelay).toFixed(2));

      // 4. Update DOM Elements
      if (baselineGreenEl) baselineGreenEl.textContent = `${fixedGreen}s`;
      if (suggestedGreenEl) suggestedGreenEl.textContent = `${suggestedG}s`;
      if (baselineDelayEl) baselineDelayEl.textContent = `${fixedDelay.toFixed(1)}s`;
      if (suggestedDelayEl) suggestedDelayEl.textContent = `${suggestedD.toFixed(1)}s`;

      if (delayDeltaEl) {
        if (delta < 0) {
          delayDeltaEl.className = "delta-badge delta-badge--faster";
          delayDeltaEl.textContent = `${Math.abs(delta).toFixed(1)}s delay reduction / veh`;
        } else if (delta > 0) {
          delayDeltaEl.className = "delta-badge delta-badge--slower";
          delayDeltaEl.textContent = `+${delta.toFixed(1)}s for queue clearance`;
        } else {
          delayDeltaEl.className = "delta-badge delta-badge--neutral";
          delayDeltaEl.textContent = `0.0s baseline match`;
        }
      }

      // 5. Update Traffic Light Widget
      if (lightWidget) {
        if (suggestedG >= 45) {
          lightWidget.setState("green");
        } else if (suggestedG > 30) {
          lightWidget.setState("green");
        } else {
          lightWidget.setState("amber");
        }
      }
    } catch (err) {
      if (errorMsgEl) {
        errorMsgEl.textContent = err.message;
        errorMsgEl.style.display = "flex";
      }
    }
  }

  // Bind input listeners
  const inputs = [slider, baseInput, kInput, minInput, maxInput, otherInput];
  inputs.forEach((input) => {
    if (input) {
      input.addEventListener("input", calculateAndRender);
    }
  });

  // Initial calculation
  calculateAndRender();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initEstimator);
} else {
  initEstimator();
}
