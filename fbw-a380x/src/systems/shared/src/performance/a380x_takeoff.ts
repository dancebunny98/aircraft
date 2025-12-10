
/**
 * Enhanced A380X takeoff module with:
 * - Performance envelope polygon checks (MTOW/MZFW/MLW)
 * - CG (%MAC) calculation support (MAC length must be provided by the caller)
 * - Point‑in‑polygon geometric validation
 * - Extended weight validation
 */

// ----------------- Types & Metadata -----------------

export interface A380XWeights {
  maxGw: number;
  maxZfw: number;
  minZfw: number;
  maxCargo: number;
  maxFuel: number;
}

export const A380X_Weights: A380XWeights = {
  maxGw: 512000,
  maxZfw: 373000,
  minZfw: 300007,
  maxCargo: 51400,
  maxFuel: 323546,
};

export const A380X_PerformanceEnvelope = {
  mlw: [
    [29, 270000],
    [29, 375000],
    [29.75, 385000],
    [31.5, 395000],
    [43, 395000],
    [43, 270000],
  ],
  mzfw: [
    [29, 270000],
    [29, 360000],
    [31.5, 365000],
    [43, 365000],
    [43, 270000],
    [29, 270000],
  ],
  mtow: [
    [29, 270000],
    [29, 375000],
    [35.75, 510000],
    [43, 510000],
    [43, 270000],
  ],
};

// ----------------- Utility: CG %MAC -----------------

/**
 * Compute CG in %MAC.
 * @param cgPositionMeters - actual CG position from aircraft reference point
 * @param macStartMeters - MAC leading edge position
 * @param macLengthMeters - MAC length
 */
export function computeCgPercentMAC(
  cgPositionMeters: number,
  macStartMeters: number,
  macLengthMeters: number
): number {
  return ((cgPositionMeters - macStartMeters) / macLengthMeters) * 100;
}

// ----------------- Polygon & Envelope Checks -----------------

/** Check if a point is inside a polygon using ray casting */
function pointInPolygon(x: number, y: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0],
      yi = polygon[i][1];
    const xj = polygon[j][0],
      yj = polygon[j][1];

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Validate (cg, weight) against envelope polygons.
 * @param cgPercentMAC
 * @param weightKg
 */
export function checkPerformanceEnvelope(cgPercentMAC: number, weightKg: number) {
  const failing: string[] = [];
  const cat = [
    ["MTOW", A380X_PerformanceEnvelope.mtow],
    ["MZFW", A380X_PerformanceEnvelope.mzfw],
    ["MLW", A380X_PerformanceEnvelope.mlw],
  ];

  for (const [label, poly] of cat) {
    const ok = pointInPolygon(cgPercentMAC, weightKg, poly);
    if (!ok) failing.push(label);
  }

  return { ok: failing.length === 0, failing };
}

// ----------------- Weight Checks -----------------

export function checkWeights(gw: number, zfw: number, fuelKg: number) {
  const v: string[] = [];

  if (gw > A380X_Weights.maxGw) v.push("GW exceeds MaxGW");
  if (zfw > A380X_Weights.maxZfw) v.push("ZFW exceeds MaxZFW");
  if (zfw < A380X_Weights.minZfw) v.push("ZFW below MinZFW");
  if (fuelKg > A380X_Weights.maxFuel) v.push("Fuel exceeds max fuel");

  return { ok: v.length === 0, violations: v };
}

// ----------------- Simplified V-Speeds -----------------

export function estimateTakeoffSpeeds(weightKg: number, flapDeg = 25, runwaySlope = 0) {
  const ratio = weightKg / A380X_Weights.maxGw;

  const vrBase = 150;
  const vr = vrBase * Math.sqrt(Math.max(0.6, ratio)) * (1 - runwaySlope * 0.5);

  const flapEffect = flapDeg <= 20 ? 1.04 : flapDeg <= 25 ? 1.0 : 0.97;

  const vrAdj = Math.round(vr * flapEffect);

  return {
    v1: Math.max(110, vrAdj - 10),
    vr: Math.max(120, vrAdj),
    v2: Math.max(130, vrAdj + 20),
  };
}

// ----------------- Takeoff Distance -----------------

export function estimateTakeoffDistance(gw: number, flapDeg = 25, pressureAlt = 0, temp = 15) {
  const base = 2800;
  const weightFactor = Math.pow(gw / (0.75 * A380X_Weights.maxGw), 1.2);
  const flapFactor = flapDeg <= 20 ? 1.1 : flapDeg <= 25 ? 1.0 : 0.95;
  const altFactor = 1 + (pressureAlt / 10000) * 0.12;
  const tempFactor = 1 + ((temp - 15) / 30) * 0.08;

  return Math.round(base * weightFactor * flapFactor * altFactor * tempFactor * 1.1);
}
