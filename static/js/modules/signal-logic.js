/**
 * static/js/modules/signal-logic.js
 * Pure mathematical functions for traffic signal timing and delay estimation.
 *
 * NOTE: The identical formulas and parameter constraints must be maintained
 * in the Python backend engine (engine.py) to ensure client/server consistency.
 *
 * Mathematical Foundation & Documented Assumptions:
 * 1. suggestGreen:
 *    - Linear responsive scaling model based on detected vehicle queue count:
 *      suggestGreen = round(clamp(base + k * max(count, 0), minG, maxG))
 *    - Note on constraints: With k >= 0 and count >= 0, the computed value is never
 *      below base, so minG only binds when base < minG or k < 0.
 *
 * 2. estimateDelay:
 *    - Uses the simplified uniform-delay term from Webster's delay model:
 *      d = (C - g)^2 / (2 * C)  [in seconds per vehicle]
 *      where C = cycle length (s) and g = effective green time (s).
 *    - Assumptions & Limitations (displayed in UI tooltips & reports):
 *      a. Assumes uniform vehicle arrivals and low-to-moderate saturation.
 *      b. Estimates delay specifically for the approach being served.
 *      c. Ignores the overflow queue term and the additional delay that a longer
 *         green on this phase imposes on the opposing cross-traffic phase.
 *      d. Intended strictly as an illustrative ESTIMATE for academic evaluation,
 *         NOT a certified field measurement.
 */

/**
 * Calculate the suggested green phase duration in seconds.
 *
 * @param {number} count - Detected vehicle count waiting on the approach (>= 0).
 * @param {number} [base=30] - Base nominal green duration in seconds.
 * @param {number} [k=1.5] - Scaling coefficient (seconds of green added per vehicle).
 * @param {number} [minG=10] - Minimum allowed green duration in seconds.
 * @param {number} [maxG=60] - Maximum allowed green duration in seconds.
 * @returns {number} Suggested green duration in seconds (rounded integer).
 * @throws {Error} If minG > maxG or parameters are invalid.
 */
export function suggestGreen(count, base = 30, k = 1.5, minG = 10, maxG = 60) {
  if (minG > maxG) {
    throw new Error(`min_green (${minG}) cannot exceed max_green (${maxG})`);
  }

  const validCount = Math.max(Number(count) || 0, 0);
  const raw = base + k * validCount;
  const clamped = Math.max(minG, Math.min(maxG, raw));
  return Math.round(clamped);
}

/**
 * Estimate the average delay per vehicle on the served approach using Webster's uniform delay formula.
 *
 * Formula:
 *   delay = (C - g)^2 / (2 * C)
 *
 * @param {number} cycle - Total cycle length in seconds (C > 0).
 * @param {number} green - Green phase allocation for this approach in seconds (g >= 0).
 * @returns {number} Estimated average delay in seconds per vehicle, rounded to 2 decimal places.
 */
export function estimateDelay(cycle, green) {
  const c = Number(cycle);
  if (c <= 0 || isNaN(c)) {
    return 0;
  }

  // Green cannot exceed the cycle or be negative
  const g = Math.max(0, Math.min(c, Number(green) || 0));
  const red = c - g;
  const delay = (red * red) / (2 * c);
  return Number(delay.toFixed(2));
}

/**
 * Calculate the total intersection cycle length.
 *
 * @param {number} green - Green phase duration for current approach in seconds.
 * @param {number} [otherPhase=30] - Combined time allocated to opposing phase & yellow/all-red clearance.
 * @returns {number} Total cycle duration in seconds.
 */
export function cycleLength(green, otherPhase = 30) {
  const g = Math.max(0, Number(green) || 0);
  const other = Math.max(0, Number(otherPhase) || 0);
  return g + other;
}
