import { suggestGreen, estimateDelay, cycleLength } from "../static/js/modules/signal-logic.js";

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`Assertion failed [${msg}]: expected ${expected}, got ${actual}`);
  }
}

// Test suggestGreen
assertEqual(suggestGreen(0), 30, 'suggestGreen 0 count');
assertEqual(suggestGreen(10), 45, 'suggestGreen 10 count');
assertEqual(suggestGreen(-5), 30, 'suggestGreen negative clamp to 0');
assertEqual(suggestGreen(30), 60, 'suggestGreen max green clamp');

// Test cycleLength
assertEqual(cycleLength(30, 30), 60, 'cycleLength 30+30');
assertEqual(cycleLength(45, 30), 75, 'cycleLength 45+30');

// Test estimateDelay(cycle, green)
const d1 = estimateDelay(60, 30);
assertEqual(d1, 7.5, 'estimateDelay C=60, g=30');

const d2 = estimateDelay(75, 45);
assertEqual(d2, 6.0, 'estimateDelay C=75, g=45');

console.log('All JS signal-logic assertions PASSED successfully!');
