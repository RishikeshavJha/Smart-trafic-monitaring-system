/**
 * static/js/intersection.js
 * High-Fidelity 4-Way Interactive Intersection Simulation Engine
 *
 * Features:
 *  - Premium 2D Top-Down Vector Vehicle Graphics (Cars, Buses, Trucks, Bikes, Emergency Cruiser)
 *  - Realistic Headlight Cones & Taillight Glow Effects
 *  - Proper 2-Lane Traffic Physics with Intelligent Car-Following Model (No overlapping/bunching)
 *  - Full 4-Way Signal Cycle (Green → Amber → Red)
 *  - Real-Time Webster Adaptive Signal Timing based on approach queue size
 *  - Interactive sliders & quick preset triggers
 *  - Live KPI stats & congestion monitoring
 */

// ============================================================================
// Constants & Configuration
// ============================================================================

const ROAD_COLORS = {
  N: { stroke: "#38bdf8", fill: "#0284c7", name: "North Road" },
  S: { stroke: "#34d399", fill: "#059669", name: "South Road" },
  E: { stroke: "#fbbf24", fill: "#d97706", name: "East Road"  },
  W: { stroke: "#f472b6", fill: "#db2777", name: "West Road"  },
};

const VEHICLE_TYPES = [
  "sedan", "sedan", "sedan", "suv", "bus", "truck", "bike", "police"
];

const VEHICLE_SPECS = {
  sedan: {
    w: 32, h: 15, speed: 2.2, minGap: 14,
    colors: ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#e2e8f0", "#334155"]
  },
  suv: {
    w: 36, h: 17, speed: 2.0, minGap: 16,
    colors: ["#1e293b", "#b91c1c", "#15803d", "#d97706", "#475569", "#ffffff"]
  },
  bus: {
    w: 56, h: 18, speed: 1.6, minGap: 20,
    colors: ["#f59e0b", "#38bdf8", "#10b981"]
  },
  truck: {
    w: 50, h: 18, speed: 1.5, minGap: 20,
    colors: ["#94a3b8", "#ef4444", "#3b82f6", "#f97316"]
  },
  bike: {
    w: 20, h: 8, speed: 2.8, minGap: 10,
    colors: ["#f43f5e", "#8b5cf6", "#06b6d4", "#ffffff"]
  },
  police: {
    w: 33, h: 15, speed: 2.6, minGap: 14,
    colors: ["#0f172a"]
  }
};

const SIGNAL_PHASES = ["N", "S", "E", "W"];

// Webster formula constants
const BASE_GREEN = 30; // seconds baseline
const K_FACTOR   = 1.5; // s per vehicle
const MIN_GREEN  = 10;
const MAX_GREEN  = 60;
const AMBER_TIME = 3;   // seconds

// Canvas logical dimensions
const C = 640;
const R = 480;
const ROAD_W = 96;     // road width (48px per lane)
const LANE_OFFSET = 24; // distance from center line to incoming/outgoing lane center

// ============================================================================
// Simulation State
// ============================================================================

const sim = {
  running: true,
  paused: false,

  // Road vehicle density targets (0–25)
  roadCount: { N: 6, S: 5, E: 4, W: 4 },

  // Active vehicles on canvas
  vehicles: [],
  vehicleIdSeq: 0,

  // Signal cycle
  currentPhase: 0,         // index in SIGNAL_PHASES
  phaseState: "green",     // "green" | "amber"
  phaseElapsed: 0,
  phaseDurations: { N: 30, S: 30, E: 30, W: 30 },
  signalLights: { N: "green", S: "red", E: "red", W: "red" },

  // Metrics
  totalVehiclesServed: 0,
  avgWaitTime: 0,
  junctionDelay: 6.2,
  congestionLevel: "LOW",

  // Spawn tracking
  spawnTimers: { N: 0, S: 0, E: 0, W: 0 },

  lastTime: 0,
  animFrameId: null,
};

// ============================================================================
// Webster Adaptive Calculation
// ============================================================================

function computeWebsterGreen(count) {
  return Math.round(Math.min(MAX_GREEN, Math.max(MIN_GREEN, BASE_GREEN + K_FACTOR * count)));
}

function computeDelay(green, other = 30) {
  const cycle = green + other;
  return Number((((cycle - green) ** 2) / (2 * cycle)).toFixed(1));
}

function recomputeSignalTimings() {
  const counts = sim.roadCount;
  sim.phaseDurations.N = computeWebsterGreen(counts.N);
  sim.phaseDurations.S = computeWebsterGreen(counts.S);
  sim.phaseDurations.E = computeWebsterGreen(counts.E);
  sim.phaseDurations.W = computeWebsterGreen(counts.W);

  const activeRoad = SIGNAL_PHASES[sim.currentPhase];
  const activeGreen = sim.phaseDurations[activeRoad];
  sim.junctionDelay = computeDelay(activeGreen);

  const maxCount = Math.max(...Object.values(counts));
  if (maxCount >= 18) sim.congestionLevel = "CRITICAL";
  else if (maxCount >= 10) sim.congestionLevel = "MEDIUM";
  else sim.congestionLevel = "LOW";

  updateUI();
}

// ============================================================================
// Vehicle Kinematics & Car-Following Model
// ============================================================================

function createVehicle(road) {
  const type = VEHICLE_TYPES[Math.floor(Math.random() * VEHICLE_TYPES.length)];
  const spec = VEHICLE_SPECS[type];
  const color = spec.colors[Math.floor(Math.random() * spec.colors.length)];

  const cx = C / 2;
  const cy = R / 2;
  const halfRoad = ROAD_W / 2;

  let x, y, angle, stopDist;
  const stopOffset = halfRoad + 14; // Stop line distance from intersection center

  switch (road) {
    case "N":
      // North approach moves Downwards (+Y) on the Left incoming lane
      x = cx - LANE_OFFSET;
      y = -spec.w;
      angle = Math.PI / 2; // facing down
      stopDist = cy - stopOffset;
      break;
    case "S":
      // South approach moves Upwards (-Y) on the Right incoming lane
      x = cx + LANE_OFFSET;
      y = R + spec.w;
      angle = -Math.PI / 2; // facing up
      stopDist = cy + stopOffset;
      break;
    case "E":
      // East approach moves Leftwards (-X) on the Top incoming lane
      x = C + spec.w;
      y = cy - LANE_OFFSET;
      angle = Math.PI; // facing left
      stopDist = cx + stopOffset;
      break;
    case "W":
      // West approach moves Rightwards (+X) on the Bottom incoming lane
      x = -spec.w;
      y = cy + LANE_OFFSET;
      angle = 0; // facing right
      stopDist = cx - stopOffset;
      break;
  }

  return {
    id: sim.vehicleIdSeq++,
    road,
    type,
    color,
    x, y,
    w: spec.w,
    h: spec.h,
    angle,
    maxSpeed: spec.speed + (Math.random() * 0.4 - 0.2),
    currentSpeed: spec.speed,
    minGap: spec.minGap,
    stopDist,
    state: "approaching", // "approaching" | "stopped" | "crossing" | "exited"
    waitTime: 0,
    strobeTimer: 0, // For police lightbar
    alpha: 0.1,
  };
}

function spawnVehicles(dt) {
  for (const road of SIGNAL_PHASES) {
    const targetCount = sim.roadCount[road];
    if (targetCount <= 0) continue;

    // Active vehicles approaching or waiting on this road
    const activeOnRoad = sim.vehicles.filter(v => v.road === road && (v.state === "approaching" || v.state === "stopped"));
    const visibleLimit = Math.min(targetCount, 12);

    sim.spawnTimers[road] = (sim.spawnTimers[road] || 0) + dt;
    const spawnInterval = Math.max(0.7, 3.2 - targetCount * 0.1);

    // Ensure entrance point is clear before inserting a new vehicle
    const entranceClear = !activeOnRoad.some(v => {
      if (road === "N") return v.y < 40;
      if (road === "S") return v.y > R - 40;
      if (road === "E") return v.x > C - 40;
      if (road === "W") return v.x < 40;
      return false;
    });

    if (sim.spawnTimers[road] >= spawnInterval && activeOnRoad.length < visibleLimit && entranceClear) {
      sim.vehicles.push(createVehicle(road));
      sim.spawnTimers[road] = 0;
    }
  }
}

function updateVehicles(dt) {
  const cx = C / 2;
  const cy = R / 2;
  const intersectionRadius = ROAD_W / 2 + 10;

  for (let i = 0; i < sim.vehicles.length; i++) {
    const v = sim.vehicles[i];
    if (v.state === "exited") continue;

    // Fade-in
    if (v.alpha < 1) {
      v.alpha = Math.min(1, v.alpha + dt * 4);
    }

    if (v.type === "police") {
      v.strobeTimer = (v.strobeTimer + dt * 10) % (Math.PI * 2);
    }

    const isGreen = sim.signalLights[v.road] === "green";
    const isAmber = sim.signalLights[v.road] === "amber";

    // ── Find lead vehicle directly ahead on the same incoming approach ──
    let leadVehicle = null;
    let minDistanceToLead = Infinity;

    for (let j = 0; j < sim.vehicles.length; j++) {
      if (i === j) continue;
      const other = sim.vehicles[j];
      if (other.road !== v.road || other.state === "exited") continue;

      let dist = Infinity;
      if (v.road === "N" && other.y > v.y) dist = other.y - v.y;
      else if (v.road === "S" && other.y < v.y) dist = v.y - other.y;
      else if (v.road === "E" && other.x < v.x) dist = v.x - other.x;
      else if (v.road === "W" && other.x > v.x) dist = other.x - v.x;

      if (dist > 0 && dist < minDistanceToLead) {
        minDistanceToLead = dist;
        leadVehicle = other;
      }
    }

    // ── Distance to Stop Line ──
    let distToStop = Infinity;
    if (v.road === "N") distToStop = v.stopDist - v.y;
    else if (v.road === "S") distToStop = v.y - v.stopDist;
    else if (v.road === "E") distToStop = v.x - v.stopDist;
    else if (v.road === "W") distToStop = v.stopDist - v.x;

    // ── Determine Target Speed via Car-Following Rules ──
    let desiredSpeed = v.maxSpeed;

    // Stop at red/amber unless already inside intersection
    const mustStopAtSignal = (!isGreen && !isAmber) || (isAmber && distToStop > 25);

    if (v.state !== "crossing") {
      if (mustStopAtSignal && distToStop > 0) {
        if (distToStop < 6) {
          desiredSpeed = 0;
        } else if (distToStop < 40) {
          desiredSpeed = Math.min(desiredSpeed, (distToStop / 40) * v.maxSpeed * 0.7);
        }
      }

      // Safe buffer behind lead car
      if (leadVehicle) {
        const safeGap = (v.w / 2) + (leadVehicle.w / 2) + v.minGap;
        if (minDistanceToLead < safeGap) {
          desiredSpeed = 0;
        } else if (minDistanceToLead < safeGap + 35) {
          const ratio = (minDistanceToLead - safeGap) / 35;
          desiredSpeed = Math.min(desiredSpeed, leadVehicle.currentSpeed * ratio);
        }
      }
    }

    // Smooth Acceleration / Braking
    const accel = desiredSpeed > v.currentSpeed ? 0.08 : 0.18;
    v.currentSpeed += (desiredSpeed - v.currentSpeed) * accel;
    if (Math.abs(v.currentSpeed) < 0.02) v.currentSpeed = 0;

    // State Transitions
    if (v.currentSpeed === 0 && distToStop <= 8 && mustStopAtSignal) {
      v.state = "stopped";
      v.waitTime += dt;
      sim.avgWaitTime = 0.96 * sim.avgWaitTime + 0.04 * v.waitTime;
    } else {
      if (v.state === "stopped" && (isGreen || desiredSpeed > 0)) {
        v.state = "approaching";
      }
    }

    // Advance position
    const moveStep = v.currentSpeed * (dt * 60);
    switch (v.road) {
      case "N": v.y += moveStep; break;
      case "S": v.y -= moveStep; break;
      case "E": v.x -= moveStep; break;
      case "W": v.x += moveStep; break;
    }

    // Crossing Check
    const distCenter = Math.hypot(v.x - cx, v.y - cy);
    if (distCenter < intersectionRadius && v.state !== "crossing") {
      v.state = "crossing";
    }

    // Exit check
    if (v.x < -70 || v.x > C + 70 || v.y < -70 || v.y > R + 70) {
      v.state = "exited";
      sim.totalVehiclesServed++;
    }
  }

  // Cleanup exited vehicles
  sim.vehicles = sim.vehicles.filter(v => v.state !== "exited");
}

// ============================================================================
// Traffic Light State Machine
// ============================================================================

function updateSignals(dt) {
  sim.phaseElapsed += dt;
  const activeRoad = SIGNAL_PHASES[sim.currentPhase];
  const greenDuration = sim.phaseDurations[activeRoad];

  if (sim.phaseState === "green") {
    sim.signalLights = { N: "red", S: "red", E: "red", W: "red" };
    sim.signalLights[activeRoad] = "green";

    if (sim.phaseElapsed >= greenDuration) {
      sim.phaseState = "amber";
      sim.phaseElapsed = 0;
    }
  } else if (sim.phaseState === "amber") {
    sim.signalLights[activeRoad] = "amber";

    if (sim.phaseElapsed >= AMBER_TIME) {
      sim.signalLights[activeRoad] = "red";
      sim.currentPhase = (sim.currentPhase + 1) % SIGNAL_PHASES.length;
      sim.phaseState = "green";
      sim.phaseElapsed = 0;
      recomputeSignalTimings();
    }
  }
}

// ============================================================================
// Canvas Vector Rendering
// ============================================================================

let canvas, ctx;

function initCanvas() {
  canvas = document.getElementById("intersection-canvas");
  if (!canvas) return false;

  const dpr = window.devicePixelRatio || 1;
  const displayW = canvas.clientWidth || C;
  const displayH = Math.round(displayW * (R / C));

  canvas.width  = displayW * dpr;
  canvas.height = displayH * dpr;
  canvas.style.height = displayH + "px";

  ctx = canvas.getContext("2d");
  ctx.scale(dpr * (displayW / C), dpr * (displayH / R));
  return true;
}

// ── Draw Road Geometry & Environment ──
function drawEnvironment() {
  const cx = C / 2;
  const cy = R / 2;
  const halfRoad = ROAD_W / 2;

  // 1. Dark Urban Background
  ctx.fillStyle = "#090d16";
  ctx.fillRect(0, 0, C, R);

  // 2. Corner City Blocks (Modern building footprints & ambient lighting)
  const blocks = [
    { x: 0, y: 0, w: cx - halfRoad, h: cy - halfRoad },
    { x: cx + halfRoad, y: 0, w: cx - halfRoad, h: cy - halfRoad },
    { x: 0, y: cy + halfRoad, w: cx - halfRoad, h: cy - halfRoad },
    { x: cx + halfRoad, y: cy + halfRoad, w: cx - halfRoad, h: cy - halfRoad },
  ];

  for (const b of blocks) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(b.x, b.y, b.w, b.h);

    // Sidewalk border
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 4;
    ctx.strokeRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4);

    // Corner curb highlight
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }

  // 3. Asphalt Roads
  ctx.fillStyle = "#161e2e";
  // Horizontal Road (East-West)
  ctx.fillRect(0, cy - halfRoad, C, ROAD_W);
  // Vertical Road (North-South)
  ctx.fillRect(cx - halfRoad, 0, ROAD_W, R);

  // 4. Center Junction Box
  ctx.fillStyle = "#192233";
  ctx.fillRect(cx - halfRoad, cy - halfRoad, ROAD_W, ROAD_W);

  // Yellow hatched junction markings ("Keep Clear")
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - halfRoad, cy - halfRoad, ROAD_W, ROAD_W);
  ctx.clip();
  ctx.strokeStyle = "rgba(251, 191, 36, 0.12)";
  ctx.lineWidth = 1.5;
  for (let d = -ROAD_W; d < ROAD_W * 2; d += 14) {
    ctx.beginPath();
    ctx.moveTo(cx - halfRoad + d, cy - halfRoad);
    ctx.lineTo(cx - halfRoad + d + ROAD_W, cy + halfRoad);
    ctx.stroke();
  }
  ctx.restore();

  // 5. Solid Double Yellow Center Medians
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 1.5;

  // North road median
  drawDoubleLine(cx - 2, 0, cx - 2, cy - halfRoad - 20, cx + 2, 0, cx + 2, cy - halfRoad - 20);
  // South road median
  drawDoubleLine(cx - 2, cy + halfRoad + 20, cx - 2, R, cx + 2, cy + halfRoad + 20, cx + 2, R);
  // East road median
  drawDoubleLine(cx + halfRoad + 20, cy - 2, C, cy - 2, cx + halfRoad + 20, cy + 2, C, cy + 2);
  // West road median
  drawDoubleLine(0, cy - 2, cx - halfRoad - 20, cy - 2, 0, cy + 2, cx - halfRoad - 20, cy + 2);

  // 6. White Stop Lines
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  // North approach stop bar (left lane only)
  ctx.moveTo(cx - halfRoad + 2, cy - halfRoad - 18);
  ctx.lineTo(cx, cy - halfRoad - 18);
  // South approach stop bar (right lane only)
  ctx.moveTo(cx, cy + halfRoad + 18);
  ctx.lineTo(cx + halfRoad - 2, cy + halfRoad + 18);
  // East approach stop bar (top lane only)
  ctx.moveTo(cx + halfRoad + 18, cy - halfRoad + 2);
  ctx.lineTo(cx + halfRoad + 18, cy);
  // West approach stop bar (bottom lane only)
  ctx.moveTo(cx - halfRoad - 18, cy);
  ctx.lineTo(cx - halfRoad - 18, cy + halfRoad - 2);
  ctx.stroke();

  // 7. Zebra Crosswalks
  drawCrosswalk(cx - halfRoad, cy - halfRoad - 16, ROAD_W, 14, "H");
  drawCrosswalk(cx - halfRoad, cy + halfRoad + 2, ROAD_W, 14, "H");
  drawCrosswalk(cx - halfRoad - 16, cy - halfRoad, 14, ROAD_W, "V");
  drawCrosswalk(cx + halfRoad + 2, cy - halfRoad, 14, ROAD_W, "V");

  // 8. Road Direction Lane Arrows
  drawLaneArrow(cx - LANE_OFFSET, cy - halfRoad - 40, "down");
  drawLaneArrow(cx + LANE_OFFSET, cy + halfRoad + 40, "up");
  drawLaneArrow(cx + halfRoad + 40, cy - LANE_OFFSET, "left");
  drawLaneArrow(cx - halfRoad - 40, cy + LANE_OFFSET, "right");
}

function drawDoubleLine(x1, y1, x2, y2, x3, y3, x4, y4) {
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.moveTo(x3, y3); ctx.lineTo(x4, y4);
  ctx.stroke();
}

function drawCrosswalk(x, y, w, h, dir) {
  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  const step = 8;
  if (dir === "H") {
    for (let sx = x + 3; sx < x + w - 4; sx += step) {
      ctx.fillRect(sx, y, 4, h);
    }
  } else {
    for (let sy = y + 3; sy < y + h - 4; sy += step) {
      ctx.fillRect(x, sy, w, 4);
    }
  }
}

function drawLaneArrow(x, y, dir) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
  ctx.beginPath();
  const s = 7;
  switch (dir) {
    case "down":
      ctx.moveTo(0, s); ctx.lineTo(-s, -s); ctx.lineTo(0, -s + 3); ctx.lineTo(s, -s);
      break;
    case "up":
      ctx.moveTo(0, -s); ctx.lineTo(-s, s); ctx.lineTo(0, s - 3); ctx.lineTo(s, s);
      break;
    case "left":
      ctx.moveTo(-s, 0); ctx.lineTo(s, -s); ctx.lineTo(s - 3, 0); ctx.lineTo(s, s);
      break;
    case "right":
      ctx.moveTo(s, 0); ctx.lineTo(-s, -s); ctx.lineTo(-s + 3, 0); ctx.lineTo(-s, s);
      break;
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Draw High-End Vector Vehicles ──
function drawVehicles() {
  for (const v of sim.vehicles) {
    if (v.state === "exited") continue;

    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.angle);
    ctx.globalAlpha = v.alpha;

    // Headlight cone onto road ahead (+X is forward in local vehicle space)
    drawHeadlightBeam(ctx, v);

    // Vehicle Vector Model
    switch (v.type) {
      case "bus":     drawBus(ctx, v); break;
      case "truck":   drawTruck(ctx, v); break;
      case "bike":    drawMotorcycle(ctx, v); break;
      case "police":  drawPoliceCar(ctx, v); break;
      case "suv":     drawSUV(ctx, v); break;
      default:        drawSedan(ctx, v); break;
    }

    ctx.restore();
  }
}

// ── Headlight Beam Projection ──
function drawHeadlightBeam(ctx, v) {
  const fw = v.w / 2;
  const fh = v.h / 2;

  // Soft forward illumination
  const grad = ctx.createRadialGradient(fw + 10, 0, 5, fw + 35, 0, 30);
  grad.addColorStop(0, "rgba(254, 240, 138, 0.22)");
  grad.addColorStop(0.5, "rgba(254, 240, 138, 0.08)");
  grad.addColorStop(1, "rgba(254, 240, 138, 0)");

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(fw, -fh * 0.7);
  ctx.lineTo(fw + 45, -fh * 1.6);
  ctx.lineTo(fw + 45, fh * 1.6);
  ctx.lineTo(fw, fh * 0.7);
  ctx.closePath();
  ctx.fill();
}

// ── 1. Sedan Car ──
function drawSedan(ctx, v) {
  const w = v.w, h = v.h;
  const hw = w / 2, hh = h / 2;

  // Soft Drop Shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  roundRect(ctx, -hw + 1, -hh + 2, w, h, 4);
  ctx.fill();

  // Wheels / Tires
  ctx.fillStyle = "#0f172a";
  roundRect(ctx, -hw + 4, -hh - 1.5, 6, 2.5, 1); ctx.fill();
  roundRect(ctx, hw - 10, -hh - 1.5, 6, 2.5, 1); ctx.fill();
  roundRect(ctx, -hw + 4, hh - 1, 6, 2.5, 1); ctx.fill();
  roundRect(ctx, hw - 10, hh - 1, 6, 2.5, 1); ctx.fill();

  // Body Chassis
  const grad = ctx.createLinearGradient(-hw, -hh, -hw, hh);
  grad.addColorStop(0, adjustLightness(v.color, 20));
  grad.addColorStop(0.5, v.color);
  grad.addColorStop(1, adjustLightness(v.color, -20));

  ctx.fillStyle = grad;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.lineWidth = 0.75;
  roundRect(ctx, -hw, -hh, w, h, 4);
  ctx.fill(); ctx.stroke();

  // Side Mirrors
  ctx.fillStyle = v.color;
  ctx.fillRect(hw - 11, -hh - 2, 3, 2);
  ctx.fillRect(hw - 11, hh, 3, 2);

  // Cabin / Glass Windows (Curved Windshields)
  ctx.fillStyle = "#0f172a";
  roundRect(ctx, -hw + 7, -hh + 2, w - 15, h - 4, 2);
  ctx.fill();

  // Front Windshield Glass Reflection
  ctx.fillStyle = "rgba(186, 230, 253, 0.75)";
  roundRect(ctx, hw - 12, -hh + 3, 4, h - 6, 1);
  ctx.fill();

  // Rear Windshield Glass
  ctx.fillStyle = "rgba(186, 230, 253, 0.5)";
  roundRect(ctx, -hw + 8, -hh + 3, 3, h - 6, 1);
  ctx.fill();

  // Roof
  ctx.fillStyle = v.color;
  roundRect(ctx, -hw + 11, -hh + 2.5, w - 24, h - 5, 2);
  ctx.fill();

  // Headlights (Dual Front LEDs)
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#fef08a";
  ctx.shadowBlur = 6;
  ctx.fillRect(hw - 2, -hh + 2, 2, 3);
  ctx.fillRect(hw - 2, hh - 5, 2, 3);
  ctx.shadowBlur = 0;

  // Taillights (Red Brakes)
  const isBraking = v.state === "stopped" || v.currentSpeed < 0.5;
  ctx.fillStyle = isBraking ? "#ef4444" : "#991b1b";
  if (isBraking) {
    ctx.shadowColor = "#ef4444";
    ctx.shadowBlur = 8;
  }
  ctx.fillRect(-hw, -hh + 2, 2, 3);
  ctx.fillRect(-hw, hh - 5, 2, 3);
  ctx.shadowBlur = 0;
}

// ── 2. SUV ──
function drawSUV(ctx, v) {
  const w = v.w, h = v.h;
  const hw = w / 2, hh = h / 2;

  // Shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  roundRect(ctx, -hw + 1, -hh + 2, w, h, 5);
  ctx.fill();

  // Tires
  ctx.fillStyle = "#0f172a";
  roundRect(ctx, -hw + 5, -hh - 2, 7, 3, 1); ctx.fill();
  roundRect(ctx, hw - 12, -hh - 2, 7, 3, 1); ctx.fill();
  roundRect(ctx, -hw + 5, hh - 1, 7, 3, 1); ctx.fill();
  roundRect(ctx, hw - 12, hh - 1, 7, 3, 1); ctx.fill();

  // Main Body
  ctx.fillStyle = v.color;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
  ctx.lineWidth = 0.8;
  roundRect(ctx, -hw, -hh, w, h, 4);
  ctx.fill(); ctx.stroke();

  // Side mirrors
  ctx.fillStyle = v.color;
  ctx.fillRect(hw - 12, -hh - 2.5, 4, 2.5);
  ctx.fillRect(hw - 12, hh, 4, 2.5);

  // Cabin
  ctx.fillStyle = "#1e293b";
  roundRect(ctx, -hw + 6, -hh + 2, w - 13, h - 4, 2);
  ctx.fill();

  // Glass
  ctx.fillStyle = "rgba(186, 230, 253, 0.7)";
  roundRect(ctx, hw - 12, -hh + 3, 5, h - 6, 1); ctx.fill();
  roundRect(ctx, -hw + 7, -hh + 3, 4, h - 6, 1); ctx.fill();

  // Roof with Roof Rails
  ctx.fillStyle = adjustLightness(v.color, -10);
  roundRect(ctx, -hw + 11, -hh + 2.5, w - 24, h - 5, 2);
  ctx.fill();
  ctx.fillStyle = "#64748b";
  ctx.fillRect(-hw + 12, -hh + 3, w - 26, 1);
  ctx.fillRect(-hw + 12, hh - 4, w - 26, 1);

  // Headlights & Taillights
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(hw - 2, -hh + 2, 2, 3.5);
  ctx.fillRect(hw - 2, hh - 5.5, 2, 3.5);

  const isBraking = v.state === "stopped" || v.currentSpeed < 0.5;
  ctx.fillStyle = isBraking ? "#ef4444" : "#991b1b";
  if (isBraking) { ctx.shadowColor = "#ef4444"; ctx.shadowBlur = 8; }
  ctx.fillRect(-hw, -hh + 2, 2, 3.5);
  ctx.fillRect(-hw, hh - 5.5, 2, 3.5);
  ctx.shadowBlur = 0;
}

// ── 3. City Transit Bus ──
function drawBus(ctx, v) {
  const w = v.w, h = v.h;
  const hw = w / 2, hh = h / 2;

  // Shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  roundRect(ctx, -hw + 1, -hh + 2, w, h, 3);
  ctx.fill();

  // Chassis
  ctx.fillStyle = v.color;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
  ctx.lineWidth = 0.8;
  roundRect(ctx, -hw, -hh, w, h, 3);
  ctx.fill(); ctx.stroke();

  // Dual Windshield
  ctx.fillStyle = "#0f172a";
  roundRect(ctx, hw - 8, -hh + 2, 6, h - 4, 1.5);
  ctx.fill();
  ctx.fillStyle = "rgba(186, 230, 253, 0.8)";
  ctx.fillRect(hw - 6, -hh + 3, 4, (h - 7) / 2);
  ctx.fillRect(hw - 6, 1, 4, (h - 7) / 2);

  // Passenger Windows Row (Top & Bottom)
  ctx.fillStyle = "#1e293b";
  for (let wx = -hw + 8; wx < hw - 10; wx += 9) {
    ctx.fillRect(wx, -hh + 1.5, 6, 2.5);
    ctx.fillRect(wx, hh - 4, 6, 2.5);
  }

  // Roof AC Units
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  roundRect(ctx, -hw + 12, -hh + 5, 14, h - 10, 2); ctx.fill();
  roundRect(ctx, hw - 22, -hh + 5, 10, h - 10, 2); ctx.fill();

  // Headlights
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(hw - 1, -hh + 2, 2, 3);
  ctx.fillRect(hw - 1, hh - 5, 2, 3);

  // Taillight bar
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(-hw, -hh + 2, 2, h - 4);
}

// ── 4. Delivery Truck ──
function drawTruck(ctx, v) {
  const w = v.w, h = v.h;
  const hw = w / 2, hh = h / 2;

  // Shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  roundRect(ctx, -hw + 1, -hh + 2, w, h, 2);
  ctx.fill();

  // Cargo Container Box
  ctx.fillStyle = "#e2e8f0";
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 0.8;
  roundRect(ctx, -hw, -hh, w - 16, h, 2);
  ctx.fill(); ctx.stroke();

  // Corrugated roof lines
  ctx.strokeStyle = "rgba(0, 0, 0, 0.1)";
  ctx.lineWidth = 1;
  for (let lx = -hw + 4; lx < -hw + w - 18; lx += 5) {
    ctx.beginPath(); ctx.moveTo(lx, -hh + 2); ctx.lineTo(lx, hh - 2); ctx.stroke();
  }

  // Cab in Front
  ctx.fillStyle = v.color;
  roundRect(ctx, hw - 15, -hh + 1, 14, h - 2, 3);
  ctx.fill();

  // Cab Windshield
  ctx.fillStyle = "rgba(186, 230, 253, 0.8)";
  roundRect(ctx, hw - 6, -hh + 2.5, 4, h - 5, 1);
  ctx.fill();

  // Large Side Mirrors
  ctx.fillStyle = "#334155";
  ctx.fillRect(hw - 9, -hh - 2.5, 4, 2);
  ctx.fillRect(hw - 9, hh + 0.5, 4, 2);

  // Headlights & Rear Hazard Lights
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(hw - 1, -hh + 2, 2, 3);
  ctx.fillRect(hw - 1, hh - 5, 2, 3);

  ctx.fillStyle = "#ef4444";
  ctx.fillRect(-hw, -hh + 2, 2, 3);
  ctx.fillRect(-hw, hh - 5, 2, 3);
}

// ── 5. Motorcycle ──
function drawMotorcycle(ctx, v) {
  const w = v.w, h = v.h;
  const hw = w / 2, hh = h / 2;

  // Shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.fillRect(-hw, -1, w, 2);

  // Front and rear tires
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(hw - 4, -1.5, 4, 3);
  ctx.fillRect(-hw, -1.5, 4, 3);

  // Bike Frame
  ctx.fillStyle = v.color;
  ctx.fillRect(-hw + 3, -1.5, w - 6, 3);

  // Handlebars
  ctx.fillStyle = "#94a3b8";
  ctx.fillRect(hw - 6, -hh, 2, h);

  // Rider Body & Helmet
  ctx.fillStyle = "#1e293b";
  ctx.beginPath(); ctx.arc(-1, 0, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = v.color;
  ctx.beginPath(); ctx.arc(1, 0, 2.5, 0, Math.PI * 2); ctx.fill();

  // Headlight
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#fef08a";
  ctx.shadowBlur = 6;
  ctx.fillRect(hw - 1, -1, 2, 2);
  ctx.shadowBlur = 0;
}

// ── 6. Police Cruiser (Emergency Strobe) ──
function drawPoliceCar(ctx, v) {
  drawSedan(ctx, v);

  // Flashing Emergency Lightbar on Roof
  const hw = v.w / 2;
  const isRed = Math.sin(v.strobeTimer) > 0;

  ctx.fillStyle = isRed ? "#ef4444" : "#3b82f6";
  ctx.shadowColor = isRed ? "#ef4444" : "#3b82f6";
  ctx.shadowBlur = 10;
  ctx.fillRect(-1, -4, 3, 8);
  ctx.shadowBlur = 0;
}

// ── 4 Corner Traffic Light Posts ──
function drawTrafficLights() {
  const cx = C / 2;
  const cy = R / 2;
  const halfRoad = ROAD_W / 2;

  const positions = {
    N: { x: cx - halfRoad - 14, y: cy - halfRoad - 28, angle: 0 },
    S: { x: cx + halfRoad + 14, y: cy + halfRoad + 28, angle: Math.PI },
    E: { x: cx + halfRoad + 28, y: cy - halfRoad - 14, angle: Math.PI / 2 },
    W: { x: cx - halfRoad - 28, y: cy + halfRoad + 14, angle: -Math.PI / 2 },
  };

  for (const road of SIGNAL_PHASES) {
    const p = positions[road];
    const light = sim.signalLights[road];

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    // Housing Base
    ctx.fillStyle = "#0f172a";
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;
    roundRect(ctx, -8, -20, 16, 40, 3);
    ctx.fill(); ctx.stroke();

    // 3 Lenses: Red, Amber, Green
    const redOn = light === "red";
    const ambOn = light === "amber";
    const grnOn = light === "green";

    drawSignalLens(ctx, 0, -12, redOn ? "#ef4444" : "#450a0a", redOn);
    drawSignalLens(ctx, 0, 0,   ambOn ? "#f59e0b" : "#451a03", ambOn);
    drawSignalLens(ctx, 0, 12,  grnOn ? "#10b981" : "#022c22", grnOn);

    ctx.restore();
  }
}

function drawSignalLens(ctx, x, y, color, isOn) {
  ctx.fillStyle = color;
  if (isOn) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
  }
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

// ── Overlay HUD Badges ──
function drawHUD() {
  const cx = C / 2, cy = R / 2;

  const roadLabels = [
    { road: "N", x: cx, y: 16, text: `NORTH ROAD · ${sim.roadCount.N} VEHS` },
    { road: "S", x: cx, y: R - 14, text: `SOUTH ROAD · ${sim.roadCount.S} VEHS` },
    { road: "E", x: C - 14, y: cy, text: `EAST ROAD · ${sim.roadCount.E} VEHS`, vertical: true },
    { road: "W", x: 14, y: cy, text: `WEST ROAD · ${sim.roadCount.W} VEHS`, vertical: true },
  ];

  ctx.save();
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const item of roadLabels) {
    const col = ROAD_COLORS[item.road];
    const isSignalGreen = sim.signalLights[item.road] === "green";

    ctx.save();
    ctx.translate(item.x, item.y);
    if (item.vertical) {
      ctx.rotate(item.road === "E" ? -Math.PI / 2 : Math.PI / 2);
    }

    const tw = ctx.measureText(item.text).width + 20;
    ctx.fillStyle = "rgba(11, 15, 25, 0.88)";
    roundRect(ctx, -tw / 2, -9, tw, 18, 4);
    ctx.fill();

    ctx.strokeStyle = isSignalGreen ? "#10b981" : col.stroke;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = isSignalGreen ? "#34d399" : "#e2e8f0";
    ctx.fillText(item.text, 0, 0);

    ctx.restore();
  }

  ctx.restore();
}

// ── Main Frame Render ──
function render() {
  if (!ctx) return;
  ctx.clearRect(0, 0, C, R);
  drawEnvironment();
  drawTrafficLights();
  drawVehicles();
  drawHUD();
}

// ============================================================================
// Main Simulation Loop
// ============================================================================

function tick(timestamp) {
  if (!sim.running) return;

  if (!sim.lastTime) sim.lastTime = timestamp;
  let dt = (timestamp - sim.lastTime) / 1000;
  sim.lastTime = timestamp;

  if (dt > 0.1) dt = 0.1; // Cap large frame delta

  if (!sim.paused) {
    updateSignals(dt);
    spawnVehicles(dt);
    updateVehicles(dt);
  }

  render();
  sim.animFrameId = requestAnimationFrame(tick);
}

// ============================================================================
// UI Updates & Event Handling
// ============================================================================

function updateUI() {
  const activeRoad = SIGNAL_PHASES[sim.currentPhase];
  const g = sim.phaseDurations[activeRoad];
  const remaining = Math.max(0, g - sim.phaseElapsed).toFixed(0);

  // Top Stats
  const statServed = document.getElementById("stat-served");
  const statActive = document.getElementById("stat-active");
  const statDelay  = document.getElementById("stat-delay");
  const statTotal  = document.getElementById("stat-total");

  if (statServed) statServed.textContent = sim.totalVehiclesServed;
  if (statActive) statActive.textContent = sim.vehicles.length;
  if (statDelay)  statDelay.textContent  = `${sim.junctionDelay}s`;
  if (statTotal) {
    const totalQ = Object.values(sim.roadCount).reduce((a, b) => a + b, 0);
    statTotal.textContent = totalQ;
  }

  // Signal Phase Rows
  for (const road of SIGNAL_PHASES) {
    const stateEl = document.getElementById(`phase-state-${road}`);
    const timerEl = document.getElementById(`phase-timer-${road}`);
    const lightEl = document.getElementById(`phase-light-${road}`);
    const rowEl   = stateEl ? stateEl.closest(".phase-row") : null;

    const light = sim.signalLights[road];
    if (stateEl) {
      const isAct = road === activeRoad;
      stateEl.textContent = `${ROAD_COLORS[road].name} (${road}) – ${sim.phaseDurations[road]}s`;
    }
    if (timerEl) {
      if (road === activeRoad) {
        timerEl.textContent = sim.phaseState === "amber" ? `⚡ ${AMBER_TIME}s` : `🟢 ${remaining}s`;
      } else {
        timerEl.textContent = `🔴 ${sim.phaseDurations[road]}s`;
      }
    }
    if (lightEl) {
      lightEl.className = `phase-light phase-light--${light}`;
    }
    if (rowEl) {
      rowEl.classList.toggle("phase-row--active", road === activeRoad);
    }
  }

  // Webster Advisory Panel
  const advRoad = document.getElementById("advisory-active-road");
  const advGreen = document.getElementById("advisory-green-time");
  const advDelay = document.getElementById("advisory-adaptive-delay");
  const advFixedDelay = document.getElementById("advisory-fixed-delay");
  const formulaEl = document.getElementById("webster-formula");

  if (advRoad) advRoad.textContent = `${ROAD_COLORS[activeRoad].name}`;
  if (advGreen) advGreen.textContent = `${g}s`;
  if (advDelay) advDelay.textContent = `${sim.junctionDelay}s`;
  if (advFixedDelay) advFixedDelay.textContent = `${computeDelay(BASE_GREEN)}s`;
  if (formulaEl) formulaEl.textContent = `${g}s`;

  // Congestion Pill
  const pill = document.getElementById("congestion-pill");
  if (pill) {
    pill.className = `congestion-pill congestion-pill--${sim.congestionLevel === "LOW" ? "ok" : sim.congestionLevel === "MEDIUM" ? "warning" : "critical"}`;
    pill.innerHTML = `<span>●</span> ${sim.congestionLevel} CONGESTION`;
  }
}

// ============================================================================
// Live Backend Synchronization (Bi-directional Dashboard ↔ Simulator)
// ============================================================================

let _syncTimer = null;

function syncWithBackend() {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    fetch("/api/v1/simulation/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zones: {
          N: sim.roadCount.N,
          S: sim.roadCount.S,
          E: sim.roadCount.E,
          W: sim.roadCount.W,
        }
      })
    }).catch((err) => {
      console.warn("Telemetry sync warning:", err);
    });
  }, 120);
}

function loadBackendState() {
  fetch("/api/v1/simulation/state")
    .then((res) => res.json())
    .then((resp) => {
      if (resp && resp.ok && resp.data && resp.data.snapshot && resp.data.snapshot.zones) {
        const z = resp.data.snapshot.zones;
        const n = z.N ? z.N.count : sim.roadCount.N;
        const s = z.S ? z.S.count : sim.roadCount.S;
        const e = z.E ? z.E.count : sim.roadCount.E;
        const w = z.W ? z.W.count : sim.roadCount.W;
        setRoads(n, s, e, w, false);
      }
    })
    .catch(() => {});
}

function wireSliders() {
  for (const road of SIGNAL_PHASES) {
    const r = road.toLowerCase();
    const slider = document.getElementById(`slider-${r}`);
    const countEl = document.getElementById(`count-${r}`);
    const fillEl  = document.getElementById(`fill-${r}`);
    const badgeEl = document.getElementById(`badge-${r}`);

    if (slider) {
      slider.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10) || 0;
        sim.roadCount[road] = val;

        if (countEl) countEl.textContent = `${val} vehs`;
        if (fillEl) fillEl.style.width = `${(val / 25) * 100}%`;

        const level = val < 6 ? "low" : val < 14 ? "medium" : "high";
        if (badgeEl) {
          badgeEl.className = `density-badge density-badge--${level}`;
          badgeEl.textContent = level.toUpperCase();
        }

        recomputeSignalTimings();
        syncWithBackend();
      });
    }
  }
}

function wireQuickActions() {
  const actions = {
    "qa-rush-north": () => setRoads(22, 5, 4, 4),
    "qa-rush-south": () => setRoads(4, 22, 5, 4),
    "qa-rush-east":  () => setRoads(4, 4, 22, 5),
    "qa-rush-west":  () => setRoads(5, 4, 4, 22),
    "qa-peak-hour":  () => setRoads(20, 18, 16, 17),
    "qa-balanced":   () => setRoads(8, 8, 8, 8),
    "qa-clear":      () => setRoads(0, 0, 0, 0),
    "qa-pause":      () => {
      sim.paused = !sim.paused;
      const btn = document.getElementById("qa-pause");
      if (btn) {
        btn.innerHTML = `<span class="quick-btn-icon">${sim.paused ? "▶" : "⏸"}</span> ${sim.paused ? "Resume Simulation" : "Pause Simulation"}`;
      }
    },
  };

  for (const [id, fn] of Object.entries(actions)) {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", fn);
  }
}

function setRoads(n, s, e, w, triggerSync = true) {
  sim.roadCount = { N: n, S: s, E: e, W: w };

  for (const [road, val] of Object.entries({ N: n, S: s, E: e, W: w })) {
    const r = road.toLowerCase();
    const slider  = document.getElementById(`slider-${r}`);
    const countEl = document.getElementById(`count-${r}`);
    const fillEl  = document.getElementById(`fill-${r}`);
    const badgeEl = document.getElementById(`badge-${r}`);

    if (slider) slider.value = val;
    if (countEl) countEl.textContent = `${val} vehs`;
    if (fillEl) fillEl.style.width = `${(val / 25) * 100}%`;

    const level = val < 6 ? "low" : val < 14 ? "medium" : "high";
    if (badgeEl) {
      badgeEl.className = `density-badge density-badge--${level}`;
      badgeEl.textContent = level.toUpperCase();
    }
  }

  recomputeSignalTimings();
  if (triggerSync) {
    syncWithBackend();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function adjustLightness(hex, percent) {
  let num = parseInt(hex.replace("#", ""), 16);
  if (isNaN(num)) return hex;
  let r = (num >> 16) + Math.round(255 * (percent / 100));
  let g = ((num >> 8) & 0x00ff) + Math.round(255 * (percent / 100));
  let b = (num & 0x0000ff) + Math.round(255 * (percent / 100));
  r = Math.min(255, Math.max(0, r));
  g = Math.min(255, Math.max(0, g));
  b = Math.min(255, Math.max(0, b));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// ============================================================================
// Initialization
// ============================================================================

function init() {
  if (!initCanvas()) return;

  wireSliders();
  wireQuickActions();
  loadBackendState();
  recomputeSignalTimings();
  syncWithBackend();

  // Periodic UI update for signal countdown timer
  setInterval(updateUI, 200);

  // Resize handler
  window.addEventListener("resize", () => {
    initCanvas();
  });

  // Start Animation Loop
  sim.animFrameId = requestAnimationFrame(tick);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
