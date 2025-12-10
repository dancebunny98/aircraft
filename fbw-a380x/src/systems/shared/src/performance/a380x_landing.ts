
/**
 * Enhanced A380X landing module with:
 * - MLW envelope polygon validation
 * - CG %MAC support
 * - Improved approach speed estimation
 */

export const A380X_Limits = {
  maxLandingWeight: 395000,
};

export const A380X_LandingEnvelope = {
  mlw: [
    [29, 270000],
    [29, 375000],
    [29.75, 385000],
    [31.5, 395000],
    [43, 395000],
    [43, 270000],
  ],
};

function pointInPolygon(x: number, y: number, poly: number[][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0],
      yi = poly[i][1];
    const xj = poly[j][0],
      yj = poly[j][1];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function checkLandingEnvelope(cgPercentMAC: number, weightKg: number) {
  const ok = pointInPolygon(cgPercentMAC, weightKg, A380X_LandingEnvelope.mlw);
  return { ok, failing: ok ? [] : ["MLW envelope"] };
}

export function estimateApproachSpeeds(landingWeightKg: number, flapDeg = 40) {
  const ratio = landingWeightKg / A380X_Limits.maxLandingWeight;
  const vrefBase = 135;
  const vref = Math.round(vrefBase * Math.sqrt(Math.max(0.6, ratio)));

  const flapEffect = flapDeg >= 40 ? 0.96 : flapDeg >= 30 ? 1.0 : 1.04;
  const vrefAdj = Math.round(vref * flapEffect);

  return {
    vref: Math.max(120, vrefAdj),
    final: Math.max(110, vrefAdj - 5),
  };
}

export function estimateLandingDistance(weightKg: number, alt = 0, temp = 15) {
  const base = 1800;
  const weightFactor = Math.pow(weightKg / 395000, 1.1);
  const altFactor = 1 + (alt / 10000) * 0.1;
  const tempFactor = 1 + ((temp - 15) / 30) * 0.06;
  return Math.round(base * weightFactor * altFactor * tempFactor * 1.15);
}
