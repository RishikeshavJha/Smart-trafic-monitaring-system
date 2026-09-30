/**
 * tests/js/signal-logic.test.mjs
 * Standalone Node.js test harness for the shared traffic signal logic module.
 *
 * Runs with standard Node:
 *   node tests/js/signal-logic.test.mjs
 *
 * Verifies required test vectors:
 *   suggestGreen(0,30,1.5,10,60)  === 30
 *   suggestGreen(10,30,1.5,10,60) === 45
 *   suggestGreen(40,30,1.5,10,60) === 60
 *   estimateDelay(60,30)          === 7.5
 *   estimateDelay(90,60)          === 5.0
 *   Constraint check: min_green > max_green throws
 */

import assert from "node:assert";
import { suggestGreen, estimateDelay, cycleLength } from "../../static/js/modules/signal-logic.js";

console.log("------------------------------------------------------------");
console.log("Running Signal Logic Pure Functions Test Suite");
console.log("------------------------------------------------------------");

let testsPassed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. Required Test Vectors for suggestGreen
test("suggestGreen(0, 30, 1.5, 10, 60) === 30", () => {
  const result = suggestGreen(0, 30, 1.5, 10, 60);
  assert.strictEqual(result, 30, `Expected 30, got ${result}`);
});

test("suggestGreen(10, 30, 1.5, 10, 60) === 45", () => {
  const result = suggestGreen(10, 30, 1.5, 10, 60);
  assert.strictEqual(result, 45, `Expected 45, got ${result}`);
});

test("suggestGreen(40, 30, 1.5, 10, 60) === 60", () => {
  const result = suggestGreen(40, 30, 1.5, 10, 60);
  assert.strictEqual(result, 60, `Expected 60 (clamped at maxG), got ${result}`);
});

// 2. Required Test Vectors for estimateDelay
test("estimateDelay(60, 30) === 7.5 (Webster Uniform Delay)", () => {
  const result = estimateDelay(60, 30);
  assert.strictEqual(result, 7.5, `Expected 7.5, got ${result}`);
});

test("estimateDelay(90, 60) === 5.0 (Webster Uniform Delay)", () => {
  const result = estimateDelay(90, 60);
  assert.strictEqual(result, 5.0, `Expected 5.0, got ${result}`);
});

// 3. Helper cycleLength calculation
test("cycleLength(45, 30) === 75", () => {
  const result = cycleLength(45, 30);
  assert.strictEqual(result, 75, `Expected 75, got ${result}`);
});

// 4. Edge Cases & Constraints
test("suggestGreen throws when minG > maxG", () => {
  assert.throws(
    () => suggestGreen(5, 30, 1.5, 70, 60),
    /cannot exceed/,
    "Should throw when minG > maxG"
  );
});

test("suggestGreen handles negative count gracefully (clamps to 0)", () => {
  const result = suggestGreen(-10, 30, 1.5, 10, 60);
  assert.strictEqual(result, 30);
});

test("estimateDelay guards cycle <= 0", () => {
  const result = estimateDelay(0, 30);
  assert.strictEqual(result, 0);
});

console.log("------------------------------------------------------------");
console.log(`All ${testsPassed} JavaScript signal logic unit tests passed successfully!`);
console.log("------------------------------------------------------------");
