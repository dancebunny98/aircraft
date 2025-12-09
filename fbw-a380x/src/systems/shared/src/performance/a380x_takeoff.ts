//  Copyright (c) 2024 FlyByWire Simulations
//  SPDX-License-Identifier: GPL-3.0

/* eslint-disable default-case */
/* eslint-disable max-len */

import {
  LerpLookupTable,
  LerpVectorLookupTable,
  MathUtils,
  ReadonlyFloat64Array,
  Vec2Math,
  Vec3Math,
  VecNMath,
} from '@microsoft/msfs-sdk';

import {
  LineupAngle,
  TakeoffPerformanceCalculator,
  TakeoffPerfomanceError,
  TakeoffPerformanceInputs,
  TakeoffPerformanceParameters,
  TakeoffPerformanceResult,
  TakeoffAntiIceSetting,
  RunwayCondition,
  LimitingFactor,
  LimitWeight,
  TakeoffPerformanceSpeeds,
} from '@flybywiresim/fbw-sdk';

/**
 * Takeoff performance calculator for an A380-842
 *
 * NOTE: This is a placeholder implementation. The performance tables and factors
 * need to be populated with actual A380-842 data from the aircraft performance manual.
 * The current implementation is based on the A32NX structure and should be updated
 * with A380X-specific performance data.
 */
export class A380842TakeoffPerformanceCalculator implements TakeoffPerformanceCalculator {
  private static readonly vec2Cache = Vec2Math.create();
  private static readonly vec3Cache = Vec3Math.create();
  private static readonly vec4Cache = VecNMath.create(4);

  private static resultCache: Partial<TakeoffPerformanceResult> = {};

  private static optResultCache: Partial<TakeoffPerformanceResult>[] = [{}, {}, {}];

  /** Max flex temp as a delta from ISA in °C. */
  private static readonly tMaxFlexDisa = 59; // TODO: Verify for A380X

  public readonly structuralMtow = 512_000; // kg - A380-842 MTOW

  public readonly maxPressureAlt = 9_200; // feet - TODO: Verify for A380X

  public readonly oew = 300_007; // kg - Operating Empty Weight from mod.rs

  public readonly maxHeadwind = 45; // knots - TODO: Verify for A380X

  public readonly maxTailwind = 15; // knots - TODO: Verify for A380X

  /** Lineup distance for each lineup angle, in metres. */
  private static readonly lineUpDistances: Record<LineupAngle, number> = {
    0: 0,
    90: 20.5, // TODO: Verify for A380X (larger aircraft may need more distance)
    180: 41, // TODO: Verify for A380X
  };

  /** Tref lookup table, (Tref [°C], elevation [feet]), lookup key = (elevation) */
  private static readonly tRefTable = new LerpLookupTable([
    [48, -2000],
    [44, 0],
    [43, 500],
    [42, 1000],
    [40, 2000],
    [36.4, 3000],
    [35, 3479],
    [16.4, 8348],
    [13.5, 9200],
  ]); // TODO: Verify for A380X

  /** Tmax lookup table, Tmax [°C], pressure alt [feet] => lookup key = (pressure alt) */
  private static readonly tMaxTable = new LerpLookupTable([
    [55, -2000],
    [55, 0],
    [38, 9200],
  ]); // TODO: Verify for A380X

  /** CONF 1+F runway limited weights at sea level/ISA/0 slope/no bleed/fwd cg/no wind/dry, MTOW [kg], runway length [metres] => lookup key = (runway length) */
  private static readonly runwayPerfLimitConf1 = new LerpLookupTable([
    // TODO: Populate with actual A380X performance data
    // These are placeholder values - need to be replaced with real A380X data
    [300_000, 2000],
    [400_000, 3000],
    [450_000, 3500],
    [500_000, 4000],
    [512_000, 4500],
  ]);

  /** CONF 2 runway limited weights at sea level/ISA/0 slope/no bleed/fwd cg/no wind/dry, MTOW [kg], runway length [metres] => lookup key = (runway length) */
  private static readonly runwayPerfLimitConf2 = new LerpLookupTable([
    // TODO: Populate with actual A380X performance data
    [300_000, 2000],
    [400_000, 3000],
    [450_000, 3500],
    [500_000, 4000],
    [512_000, 4500],
  ]);

  /** CONF 3 runway limited weights at sea level/ISA/0 slope/no bleed/fwd cg/no wind/dry, MTOW [kg], runway length [metres] => lookup key = (runway length) */
  private static readonly runwayPerfLimitConf3 = new LerpLookupTable([
    // TODO: Populate with actual A380X performance data
    [300_000, 2000],
    [400_000, 3000],
    [450_000, 3500],
    [500_000, 4000],
    [512_000, 4500],
  ]);

  /** Slope factor for each takeoff config. */
  private static readonly runwaySlopeFactor: Record<number, number> = {
    1: 0.00084, // TODO: Verify for A380X
    2: 0.00096, // TODO: Verify for A380X
    3: 0.0011, // TODO: Verify for A380X
  };

  /** Pressure altitude factors for each takeoff config. */
  private static readonly runwayPressureAltFactor: Record<number, [number, number]> = {
    1: [3.43e-8, 0.001192], // TODO: Verify for A380X
    2: [1.15e-8, 0.001216], // TODO: Verify for A380X
    3: [-4.6e-9, 0.001245], // TODO: Verify for A380X
  };

  /** Temperature factors for each takeoff config. */
  private static readonly runwayTemperatureFactor: Record<number, [number, number, number, number, number, number]> = {
    1: [0.00001, 0.095175, 0.000207, 0.040242, 0.00024, 0.066189], // TODO: Verify for A380X
    2: [-0.00001, 0.131948, 0.000155, 0.162938, 0.000225, 0.150363], // TODO: Verify for A380X
    3: [-0.0000438, 0.198845, 0.000188, 0.14547, 0.0002, 0.232529], // TODO: Verify for A380X
  };

  /** Headwind factors for each takeoff config. */
  private static readonly runwayHeadWindFactor: Record<number, [number, number, number, number]> = {
    1: [0.000029, -0.233075, 0.00242, 0.003772], // TODO: Verify for A380X
    2: [0.000051, -0.277863, 0.0018, 0.003366], // TODO: Verify for A380X
    3: [0.000115, -0.3951, 0.002357, 0.002125], // TODO: Verify for A380X
  };

  /** Tailwind factors for each takeoff config. */
  private static readonly runwayTailWindFactor: Record<number, [number, number, number, number]> = {
    1: [0.000065, -0.684701, 0.00498, 0.0808], // TODO: Verify for A380X
    2: [0.000198, -1.017, 0.00711, 0.009], // TODO: Verify for A380X
    3: [0.000271, -1.11506, 0.0078, 0.00875], // TODO: Verify for A380X
  };

  /** Segment segment weight factors for each takeoff config. */
  private static readonly secondSegmentBaseFactor: Record<number, [number, number]> = {
    1: [0.00391, 75.366], // TODO: Verify for A380X
    2: [0.005465, 72.227], // TODO: Verify for A380X
    3: [0.00495, 72.256], // TODO: Verify for A380X
  };

  /** Slope factor for each takeoff config. */
  private static readonly secondSegmentSlopeFactor: Record<number, number> = {
    1: 0.000419, // TODO: Verify for A380X
    2: 0.000641, // TODO: Verify for A380X
    3: 0.000459, // TODO: Verify for A380X
  };

  /** Pressure altitude factors for each takeoff config. */
  private static readonly secondSegmentPressureAltFactor: Record<number, [number, number]> = {
    1: [-6.5e-8, 0.001769], // TODO: Verify for A380X
    2: [1.05e-7, 0.00055], // TODO: Verify for A380X
    3: [7.48e-8, 0.000506], // TODO: Verify for A380X
  };

  /** Temperature factors for each takeoff config. */
  private static readonly secondSegmentTemperatureFactor: Record<
    number,
    [number, number, number, number, number, number]
  > = {
    1: [0.000025, 0.001, 0.000155, 0.211445, 0.000071, 0.556741], // TODO: Verify for A380X
    2: [0.0000121, 0.042153, 0.0001256, 0.325925, 0.000082, 0.546259], // TODO: Verify for A380X
    3: [-0.0000294, 0.13903, 0.0000693, 0.480536, 0.000133, 0.480536], // TODO: Verify for A380X
  };

  /** Headwind factors for each takeoff config. */
  private static readonly secondSegmentHeadWindFactor: Record<number, [number, number, number, number]> = {
    1: [0.000019, -0.13052, 0.000813636, 0.000145238], // TODO: Verify for A380X
    2: [0.0000454, -0.20585, 0.000416667, 0.001778293], // TODO: Verify for A380X
    3: [0.000085, -0.30209, 0.001189394, 0.0038996], // TODO: Verify for A380X
  };

  /** Tailwind factors for each takeoff config. */
  private static readonly secondSegmentTailWindFactor: Record<number, [number, number, number, number]> = {
    1: [0.000104, -0.705693, 0.009, 0.00648], // TODO: Verify for A380X
    2: [0.000154, -0.8052, 0.009, 0.002444], // TODO: Verify for A380X
    3: [0.000054, -0.462, 0.00875, 0.006606505], // TODO: Verify for A380X
  };

  /** Segment segment weight factors for each takeoff config. */
  private static readonly brakeEnergyBaseFactor: Record<number, [number, number]> = {
    1: [0.00503, 72.524], // TODO: Verify for A380X
    2: [0.00672, 68.28], // TODO: Verify for A380X
    3: [0.00128, 83.951], // TODO: Verify for A380X
  };

  /** Slope factor for each takeoff config. */
  private static readonly brakeEnergySlopeFactor: Record<number, number> = {
    1: 0.000045, // TODO: Verify for A380X
    2: 0.000068, // TODO: Verify for A380X
    3: 0.000045, // TODO: Verify for A380X
  };

  /** Pressure altitude factors for each takeoff config. */
  private static readonly brakeEnergyPressureAltFactor: Record<number, [number, number]> = {
    1: [5.5e-8, 0.000968], // TODO: Verify for A380X
    2: [1.17e-7, 0.000595], // TODO: Verify for A380X
    3: [4.65e-8, 0.000658], // TODO: Verify for A380X
  };

  /** Temperature factors for each takeoff config. */
  private static readonly brakeEnergyTemperatureFactor: Record<number, [number, number]> = {
    1: [0.06, 0.54], // TODO: Verify for A380X
    2: [0.058, 0.545], // TODO: Verify for A380X
    3: [0.04642, 0.6], // TODO: Verify for A380X
  };

  /** Headwind factors for each takeoff config. */
  private static readonly brakeEnergyHeadWindFactor: Record<number, [number, number, number, number]> = {
    1: [0.0000311, -0.1769, 0.001125, 0], // TODO: Verify for A380X
    2: [0.0000316, -0.1799, 0.001182, 0], // TODO: Verify for A380X
    3: [0.0000147, -0.0928, 0.001111, 0], // TODO: Verify for A380X
  };

  /** Tailwind factors for each takeoff config. */
  private static readonly brakeEnergyTailWindFactor: Record<number, [number, number, number, number]> = {
    1: [0.000117, -0.8024, 0.0117879, 0.006667], // TODO: Verify for A380X
    2: [0.000157, -0.849, 0.0066818, 0.006667], // TODO: Verify for A380X
    3: [0.00013, -0.6946, 0.0068333, 0.006667], // TODO: Verify for A380X
  };

  /** Segment segment weight factors for each takeoff config. */
  private static readonly vmcgBaseFactor: Record<number, [number, number]> = {
    1: [0.0644, -19.526], // TODO: Verify for A380X
    2: [0.082005, -39.27], // TODO: Verify for A380X
    3: [0.0704, -25.6868], // TODO: Verify for A380X
  };

  /** Slope factor for each takeoff config. */
  private static readonly vmcgSlopeFactor: Record<number, number> = {
    1: 0.00084, // TODO: Verify for A380X
    2: 0.001054, // TODO: Verify for A380X
    3: 0.001068, // TODO: Verify for A380X
  };

  /** Pressure altitude factors for each takeoff config. */
  private static readonly vmcgPressureAltFactor: Record<number, [number, number]> = {
    1: [-8.35e-7, 0.00589], // TODO: Verify for A380X
    2: [-7.58e-7, 0.00703], // TODO: Verify for A380X
    3: [1.95e-7, 0.00266], // TODO: Verify for A380X
  };

  /** Temperature factors for each takeoff config. */
  private static readonly vmcgTemperatureFactor: Record<number, [number, number, number, number, number, number]> = {
    1: [-0.00133, 2.104, 0.000699, -0.128144, -0.000718, 1.8103], // TODO: Verify for A380X
    2: [-0.00097, 1.613, 0.000242, 0.462005, -0.000547, 1.603], // TODO: Verify for A380X
    3: [-0.000923, 1.6087, 0.00061, 0.002239, -0.000335, 1.2716], // TODO: Verify for A380X
  };

  /** Headwind factors for each takeoff config. */
  private static readonly vmcgHeadWindFactor: Record<
    number,
    [number, number, number, number, number, number, number, number]
  > = {
    1: [0.001198, -1.80539, 0.000097, -0.15121, -0.000255, 0.337391, 0.000066, -0.079718], // TODO: Verify for A380X
    2: [0.000697, -1.17473, 0.000031, -0.057504, -0.000184, 0.246185, 0.000012, 0.0216], // TODO: Verify for A380X
    3: [0.0023, -3.468, -0.000037, 0.033946, -0.000156, 0.213953, -0.000757, 1.094], // TODO: Verify for A380X
  };

  /** Tailwind factors for each takeoff config. */
  private static readonly vmcgTailWindFactor: Record<number, [number, number, number, number, number, number]> = {
    1: [0.00218, -5.489, -0.000106, 0.145473, 0.031431, -0.0356], // TODO: Verify for A380X
    2: [0.001892, -5.646, -0.000059, 0.079539, 0.009948, -0.010763], // TODO: Verify for A380X
    3: [0.000613, -3.165, -0.000022, 0.020622, 0.049286, -0.0396], // TODO: Verify for A380X
  };

  /** Takeoff CG envelope. key = TOW [kg] => [lower limit, upper limit] %MAC. */
  private static readonly takeoffCgLimits = new LerpVectorLookupTable([
    // TODO: Populate with actual A380X CG limits
    // These are placeholder values - need to be replaced with real A380X data
    [Vec2Math.create(23, 43), 300_000],
    [Vec2Math.create(23, 43), 400_000],
    [Vec2Math.create(23, 43), 500_000],
    [Vec2Math.create(23, 43), 512_000],
  ]);

  private static readonly cgFactors: Record<number, [number, number]> = {
    1: [-0.041448, 3.357], // TODO: Verify for A380X
    2: [-0.03277, 2.686], // TODO: Verify for A380X
    3: [-0.0249, 2.086], // TODO: Verify for A380X
  };

  /** Minimum V1 limited by VMCG/VMCA tables... lookup key is pressure altitude [feet], value is kcas. The speeds are the same for all configs. */
  private static readonly minimumV1Vmc = new LerpLookupTable([
    // TODO: Populate with actual A380X VMCG/VMCA data
    [122, -2000],
    [121, 0],
    [121, 2000],
    [120, 3000],
    [120, 4000],
    [118, 6000],
    [116, 8000],
    [115, 9200],
  ]);

  /** Minimum Vr limited by VMCG/VMCA tables... lookup key is pressure altitude [feet], value is kcas. The speeds are the same for all configs. */
  private static readonly minimumVrVmc = new LerpLookupTable([
    // TODO: Populate with actual A380X VMCG/VMCA data
    [123, -2000],
    [122, 0],
    [122, 3000],
    [121, 4000],
    [120, 6000],
    [117, 8000],
    [116, 9200],
  ]);

  /** Minimum V2 limited by VMCG/VMCA tables... outer key is takeoff config, lookup key is pressure altitude [feet], value is kcas. */
  private static readonly minimumV2Vmc: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      // TODO: Populate with actual A380X VMCG/VMCA data
      [127, -2000],
      [126, 0],
      [126, 1000],
      [125, 2000],
      [125, 3000],
      [124, 4000],
      [123, 6000],
      [120, 8000],
      [118, 9200],
    ]),
    2: new LerpLookupTable([
      [127, -2000],
      [126, 0],
      [126, 1000],
      [125, 2000],
      [125, 3000],
      [124, 4000],
      [123, 6000],
      [120, 8000],
      [118, 9200],
    ]),
    3: new LerpLookupTable([
      [126, -2000],
      [125, 0],
      [125, 1000],
      [124, 2000],
      [124, 3000],
      [123, 4000],
      [122, 6000],
      [119, 8000],
      [117, 9200],
    ]),
  };

  /** Minimum V2 limited by VMU/VMCA tables... outer key is takeoff config, lookup keys are (pressure altitude [feet], takeoff weight [kg]), value is kcas. */
  private static readonly minimumV2Vmu: Record<number, LerpLookupTable> = {
    // TODO: Populate with actual A380X VMU/VMCA data
    // This is a simplified placeholder - needs full 3D lookup table
    1: new LerpLookupTable([
      [127, -2000, 300_000],
      [132, -2000, 400_000],
      [137, -2000, 500_000],
      [142, -2000, 512_000],
    ]),
    2: new LerpLookupTable([
      [127, -2000, 300_000],
      [132, -2000, 400_000],
      [137, -2000, 500_000],
      [142, -2000, 512_000],
    ]),
    3: new LerpLookupTable([
      [126, -2000, 300_000],
      [132, -2000, 400_000],
      [137, -2000, 500_000],
      [142, -2000, 512_000],
    ]),
  };

  // TODO: Add all contaminated runway tables (water, slush, snow, etc.)
  // These need to be populated with actual A380X performance data

  public getCrosswindLimit(runwayCondition: RunwayCondition, oat: number): number {
    // TODO: Verify crosswind limits for A380X
    switch (runwayCondition) {
      case RunwayCondition.Dry:
      case RunwayCondition.Wet:
        return 35;
      case RunwayCondition.ContaminatedCompactedSnow:
        return oat <= -15 ? 29 : 25;
      case RunwayCondition.Contaminated10mmDrySnow:
      case RunwayCondition.Contaminated100mmDrySnow:
      case RunwayCondition.Contaminated5mmWetSnow:
      case RunwayCondition.Contaminated15mmWetSnow:
      case RunwayCondition.Contaminated30mmWetSnow:
        return 25;
      case RunwayCondition.Contaminated6mmWater:
      case RunwayCondition.Contaminated13mmWater:
      case RunwayCondition.Contaminated6mmSlush:
      case RunwayCondition.Contaminated13mmSlush:
        return 20;
    }
  }

  private checkInputs(inputs: TakeoffPerformanceInputs, params: TakeoffPerformanceParameters): TakeoffPerfomanceError {
    if (inputs.conf !== 1 && inputs.conf !== 2 && inputs.conf !== 3) {
      return TakeoffPerfomanceError.InvalidData;
    }
    if (inputs.tow > this.structuralMtow) {
      return TakeoffPerfomanceError.StructuralMtow;
    }
    if (params.pressureAlt > this.maxPressureAlt) {
      return TakeoffPerfomanceError.MaximumPressureAlt;
    }
    if (inputs.oat > params.tMax) {
      return TakeoffPerfomanceError.MaximumTemperature;
    }
    if (inputs.tow < this.oew) {
      return TakeoffPerfomanceError.OperatingEmptyWeight;
    }
    if (inputs.cg !== undefined && !this.isCgWithinLimits(inputs.cg, inputs.tow)) {
      return TakeoffPerfomanceError.CgOutOfLimits;
    }
    if (inputs.wind < -this.maxTailwind) {
      return TakeoffPerfomanceError.MaximumTailwind;
    }
    if (Math.abs(inputs.slope) > 2) {
      return TakeoffPerfomanceError.MaximumRunwaySlope;
    }

    return TakeoffPerfomanceError.None;
  }

  private isContaminated(runwayCondition: RunwayCondition): boolean {
    return runwayCondition !== RunwayCondition.Dry && runwayCondition !== RunwayCondition.Wet;
  }

  /** @inheritdoc */
  public calculateTakeoffPerformance(
    tow: number,
    forwardCg: boolean,
    conf: number,
    tora: number,
    slope: number,
    lineupAngle: LineupAngle,
    wind: number,
    elevation: number,
    qnh: number,
    oat: number,
    antiIce: TakeoffAntiIceSetting,
    packs: boolean,
    forceToga: boolean,
    runwayCondition: RunwayCondition,
    cg?: number,
    out?: Partial<TakeoffPerformanceResult>,
  ): TakeoffPerformanceResult {
    const result: Partial<TakeoffPerformanceResult> = {};
    result.inputs = {
      tow,
      forwardCg,
      cg,
      conf,
      tora,
      slope,
      lineupAngle,
      wind,
      elevation,
      qnh,
      oat,
      antiIce,
      packs,
      forceToga,
      runwayCondition,
    };

    const isaTemp = this.calculateIsaTemp(elevation);
    const tRef = this.calculateTref(elevation);
    const pressureAlt = this.calculatePressureAltitude(elevation, qnh);
    const tMax = this.calculateTmax(pressureAlt);
    const tFlexMax = this.calculateTflexMax(isaTemp);
    const headwind = Math.min(this.maxHeadwind, wind);

    result.params = {
      adjustedTora: tora - (A380842TakeoffPerformanceCalculator.lineUpDistances[lineupAngle] ?? 0),
      pressureAlt,
      isaTemp,
      tRef,
      tMax,
      tFlexMax,
      headwind,
    };

    result.error = this.checkInputs(result.inputs, result.params);

    if (result.error === TakeoffPerfomanceError.None) {
      result.limits = {
        [LimitingFactor.Runway]: this.calculateWeightLimits(LimitingFactor.Runway, result),
        [LimitingFactor.SecondSegment]: this.calculateWeightLimits(LimitingFactor.SecondSegment, result),
        [LimitingFactor.BrakeEnergy]: this.calculateWeightLimits(LimitingFactor.BrakeEnergy, result),
        [LimitingFactor.Vmcg]: this.calculateWeightLimits(LimitingFactor.Vmcg, result),
      };

      result.oatLimitingFactor = this.getLimitingFactor('oatLimit', result);
      result.tRefLimitingFactor = this.getLimitingFactor('tRefLimit', result);
      result.tMaxLimitingFactor = this.getLimitingFactor('tMaxLimit', result);
      result.tFlexMaxLimitingFactor = this.getLimitingFactor('tFlexMaxLimit', result);

      const dryMtow = result.limits[result.tRefLimitingFactor].oatLimit!;
      result.tvmcg = this.calculateTvmcg(result.inputs, result.params);

      let mtow: number;
      if (runwayCondition === RunwayCondition.Dry) {
        mtow = dryMtow;
      } else if (runwayCondition === RunwayCondition.Wet) {
        // TODO: Implement wet runway adjustments for A380X
        mtow = dryMtow;
      } else {
        // TODO: Implement contaminated runway calculations for A380X
        result.error = TakeoffPerfomanceError.InvalidData;
        mtow = dryMtow;
      }
      result.mtow = mtow;

      const applyForwardCgWeightCorrection =
        forwardCg &&
        (result.oatLimitingFactor === LimitingFactor.Runway || result.oatLimitingFactor === LimitingFactor.Vmcg);
      const applyForwardCgSpeedCorrection = applyForwardCgWeightCorrection && mtow <= 400_000; // TODO: Verify threshold

      if (applyForwardCgWeightCorrection) {
        const cgFactors = A380842TakeoffPerformanceCalculator.cgFactors[conf];
        mtow += Math.max(0, cgFactors[0] * mtow + cgFactors[1]);
      }

      if (mtow >= tow) {
        result.flex = undefined;

        let needVSpeedCalculated = true;
        if (forceToga) {
          // find the speeds for a flex takeoff with 15 knot tailwind
          const tailwindResult = this.calculateTakeoffPerformance(
            tow,
            forwardCg,
            conf,
            tora,
            slope,
            lineupAngle,
            -15,
            elevation,
            qnh,
            oat,
            antiIce,
            packs,
            false,
            runwayCondition,
            cg,
            A380842TakeoffPerformanceCalculator.resultCache,
          );

          if (tailwindResult.error === TakeoffPerfomanceError.None) {
            needVSpeedCalculated = false;
            result.v1 = tailwindResult.v1;
            result.vR = tailwindResult.vR;
            result.v2 = tailwindResult.v2;
            result.intermediateSpeeds = tailwindResult.intermediateSpeeds
              ? { ...tailwindResult.intermediateSpeeds }
              : undefined;
          }
        } else if (!this.isContaminated(result.inputs.runwayCondition)) {
          [result.flex, result.params.flexLimitingFactor] = this.calculateFlexTemp(result, result.tvmcg);
        }

        if (needVSpeedCalculated) {
          this.calculateVSpeeds(result, applyForwardCgSpeedCorrection, result.tvmcg);
        }
      } else {
        result.error = TakeoffPerfomanceError.TooHeavy;
      }
    }

    if (cg !== undefined) {
      result.stabTrim = this.calculateStabTrim(cg);
    } else {
      result.stabTrim = undefined;
    }

    return result as TakeoffPerformanceResult;
  }

  /** @inheritdoc */
  public calculateTakeoffPerformanceOptConf(
    tow: number,
    forwardCg: boolean,
    tora: number,
    slope: number,
    lineupAngle: LineupAngle,
    wind: number,
    elevation: number,
    qnh: number,
    oat: number,
    antiIce: TakeoffAntiIceSetting,
    packs: boolean,
    forceToga: boolean,
    runwayCondition: RunwayCondition,
    cg?: number,
    out?: Partial<TakeoffPerformanceResult>,
  ): TakeoffPerformanceResult {
    const results = [1, 2, 3].map((conf) =>
      this.calculateTakeoffPerformance(
        tow,
        forwardCg,
        conf,
        tora,
        slope,
        lineupAngle,
        wind,
        elevation,
        qnh,
        oat,
        antiIce,
        packs,
        forceToga,
        runwayCondition,
        cg,
      ),
    );

    const filteredResults = results.filter((r) => r.error === TakeoffPerfomanceError.None);

    if (filteredResults.length === 0) {
      return A380842TakeoffPerformanceCalculator.deepCopy(results[results.length - 1], out);
    }

    filteredResults.sort((a, b) => (a.flex === b.flex ? (a.v1 ?? 0) - (b.v1 ?? 0) : (b.flex ?? 0) - (a.flex ?? 0)));
    return A380842TakeoffPerformanceCalculator.deepCopy(filteredResults[0], out ?? {});
  }

  private static deepCopy(
    result: TakeoffPerformanceResult,
    out?: Partial<TakeoffPerformanceResult>,
  ): TakeoffPerformanceResult {
    return JSON.parse(JSON.stringify(result));
  }

  private calculateTvmcg(inputs: TakeoffPerformanceInputs, params: TakeoffPerformanceParameters): number {
    // TODO: Implement TVMCG calculation for A380X
    // Placeholder implementation
    return params.tRef;
  }

  /**
   * Get the ISA temperature from elevation.
   * @param elevation Elevation in feet.
   * @returns ISA temperature in °C.
   */
  private calculateIsaTemp(elevation: number): number {
    return 15 - elevation * 0.0019812;
  }

  /**
   * Get the Tref temperature from elevation.
   * @param elevation Elevation in feet.
   * @returns Tref in °C.
   */
  private calculateTref(elevation: number): number {
    return A380842TakeoffPerformanceCalculator.tRefTable.get(elevation);
  }

  /**
   * Get the Tmax temperature from elevation.
   * @param pressureAlt Pressure altitude in feet.
   * @returns Tmax in °C.
   */
  private calculateTmax(pressureAlt: number): number {
    return A380842TakeoffPerformanceCalculator.tMaxTable.get(pressureAlt);
  }

  /**
   * Get the maximum flex temperature from ISA temp.
   * @param isa ISA temperature in °C.
   * @returns Tflexmax in °C.
   */
  private calculateTflexMax(isa: number): number {
    return isa + A380842TakeoffPerformanceCalculator.tMaxFlexDisa;
  }

  private calculatePressureAltitude(elevation: number, qnh: number): number {
    return elevation + 145442.15 * (1 - (qnh / 1013.25) ** 0.190263);
  }

  private calculateBaseRunwayPerfLimit(length: number, conf: number): number {
    switch (conf) {
      case 1:
        return A380842TakeoffPerformanceCalculator.runwayPerfLimitConf1.get(length);
      case 2:
        return A380842TakeoffPerformanceCalculator.runwayPerfLimitConf2.get(length);
      case 3:
        return A380842TakeoffPerformanceCalculator.runwayPerfLimitConf3.get(length);
      default:
        return NaN;
    }
  }

  private calculateBaseLimit(length: number, conf: number, factors: Record<number, [number, number]>): number {
    const [factor1, factor2] = factors[conf];
    return 1000 * (length * factor1 + factor2);
  }

  private calculateWeightLimits(
    limitingFactor: LimitingFactor,
    result: Partial<TakeoffPerformanceResult>,
  ): LimitWeight {
    if (!result.inputs || !result.params) {
      throw new Error('Invalid result object!');
    }

    const weights: Partial<LimitWeight> = {};

    let baseFactors: typeof A380842TakeoffPerformanceCalculator.secondSegmentBaseFactor | undefined;
    let slopeFactors: typeof A380842TakeoffPerformanceCalculator.runwaySlopeFactor;
    let altFactors: typeof A380842TakeoffPerformanceCalculator.runwayPressureAltFactor;
    let tempDeltaFunc: typeof this.calculateRunwayTempDelta;
    let windDeltaFunc: typeof this.calculateRunwayWindDelta;

    switch (limitingFactor) {
      case LimitingFactor.Runway:
        slopeFactors = A380842TakeoffPerformanceCalculator.runwaySlopeFactor;
        altFactors = A380842TakeoffPerformanceCalculator.runwayPressureAltFactor;
        tempDeltaFunc = this.calculateRunwayTempDelta;
        windDeltaFunc = this.calculateRunwayWindDelta;
        break;
      case LimitingFactor.SecondSegment:
        baseFactors = A380842TakeoffPerformanceCalculator.secondSegmentBaseFactor;
        slopeFactors = A380842TakeoffPerformanceCalculator.secondSegmentSlopeFactor;
        altFactors = A380842TakeoffPerformanceCalculator.secondSegmentPressureAltFactor;
        tempDeltaFunc = this.calculateSecondSegmentTempDelta;
        windDeltaFunc = this.calculateSecondSegmentWindDelta;
        break;
      case LimitingFactor.BrakeEnergy:
        baseFactors = A380842TakeoffPerformanceCalculator.brakeEnergyBaseFactor;
        slopeFactors = A380842TakeoffPerformanceCalculator.brakeEnergySlopeFactor;
        altFactors = A380842TakeoffPerformanceCalculator.brakeEnergyPressureAltFactor;
        tempDeltaFunc = this.calculateBrakeEnergyTempDelta;
        windDeltaFunc = this.calculateBrakeEnergyWindDelta;
        break;
      case LimitingFactor.Vmcg:
        baseFactors = A380842TakeoffPerformanceCalculator.vmcgBaseFactor;
        slopeFactors = A380842TakeoffPerformanceCalculator.vmcgSlopeFactor;
        altFactors = A380842TakeoffPerformanceCalculator.vmcgPressureAltFactor;
        tempDeltaFunc = this.calculateVmcgTempDelta;
        windDeltaFunc = this.calculateVmcgWindDelta;
        break;
      default:
        throw new Error('Invalid limiting factor!');
    }

    if (limitingFactor === LimitingFactor.Runway) {
      weights.baseLimit = this.calculateBaseRunwayPerfLimit(result.params.adjustedTora, result.inputs.conf);
    } else {
      if (!baseFactors) {
        throw new Error('Missing base factors!');
      }
      weights.baseLimit = this.calculateBaseLimit(result.params.adjustedTora, result.inputs.conf, baseFactors);
    }

    weights.deltaSlope = 1000 * slopeFactors[result.inputs.conf] * result.params.adjustedTora * result.inputs.slope;
    weights.slopeLimit = weights.baseLimit - weights.deltaSlope;

    const [altFactor1, altFactor2] = altFactors[result.inputs.conf];
    weights.deltaAlt = 1000 * result.params.pressureAlt * (result.params.pressureAlt * altFactor1 + altFactor2);
    weights.altLimit = weights.slopeLimit - weights.deltaAlt;

    const deltaBleed =
      (result.inputs.antiIce === TakeoffAntiIceSetting.EngineWing ? 1_600 : 0) + (result.inputs.packs ? 1_500 : 0);

    weights.oatDeltaTemp = tempDeltaFunc(
      result.inputs.oat,
      result.inputs.conf,
      result.params.tRef,
      result.params.tMax,
      result.params.tFlexMax,
      result.params.adjustedTora,
      result.params.pressureAlt,
      result.params.isaTemp,
    );
    weights.oatDeltaWind = windDeltaFunc(
      result.inputs.oat,
      result.inputs.conf,
      result.params.isaTemp,
      result.params.tRef,
      result.params.tMax,
      result.params.tFlexMax,
      result.params.adjustedTora,
      result.params.headwind,
    );
    weights.oatLimitNoBleed = weights.altLimit - weights.oatDeltaTemp - weights.oatDeltaWind;
    weights.oatLimit = weights.oatLimitNoBleed - deltaBleed;

    weights.tRefDeltaTemp = tempDeltaFunc(
      result.params.tRef,
      result.inputs.conf,
      result.params.tRef,
      result.params.tMax,
      result.params.tFlexMax,
      result.params.adjustedTora,
      result.params.pressureAlt,
      result.params.isaTemp,
    );
    weights.tRefDeltaWind = windDeltaFunc(
      result.params.tRef,
      result.inputs.conf,
      result.params.isaTemp,
      result.params.tRef,
      result.params.tMax,
      result.params.tFlexMax,
      result.params.adjustedTora,
      result.params.headwind,
    );
    weights.tRefLimitNoBleed = weights.altLimit - weights.tRefDeltaTemp - weights.tRefDeltaWind;
    weights.tRefLimit = weights.tRefLimitNoBleed - deltaBleed;

    weights.tMaxDeltaTemp = tempDeltaFunc(
      result.params.tMax,
      result.inputs.conf,
      result.params.tRef,
      result.params.tMax,
      result.params.tFlexMax,
      result.params.adjustedTora,
      result.params.pressureAlt,
      result.params.isaTemp,
    );
    weights.tMaxDeltaWind = windDeltaFunc(
      result.params.tMax,
      result.inputs.conf,
      result.params.isaTemp,
      result.params.tRef,
      result.params.tMax,
      result.params.tFlexMax,
      result.params.adjustedTora,
      result.params.headwind,
    );
    weights.tMaxLimitNoBleed = weights.altLimit - weights.tMaxDeltaTemp - weights.tMaxDeltaWind;
    weights.tMaxLimit = weights.tMaxLimitNoBleed - deltaBleed;

    weights.tFlexMaxDeltaTemp = tempDeltaFunc(
      result.params.tFlexMax,
      result.inputs.conf,
      result.params.tRef,
      result.params.tMax,
      result.params.tFlexMax,
      result.params.adjustedTora,
      result.params.pressureAlt,
      result.params.isaTemp,
    );
    weights.tFlexMaxDeltaWind = windDeltaFunc(
      result.params.tFlexMax,
      result.inputs.conf,
      result.params.isaTemp,
      result.params.tRef,
      result.params.tMax,
      result.params.tFlexMax,
      result.params.adjustedTora,
      result.params.headwind,
    );
    weights.tFlexMaxLimitNoBleed = weights.altLimit - weights.tFlexMaxDeltaTemp - weights.tFlexMaxDeltaWind;
    weights.tFlexMaxLimit = weights.tFlexMaxLimitNoBleed - deltaBleed;

    return weights as LimitWeight;
  }

  private getLimitingFactor(
    temp: 'oatLimit' | 'tRefLimit' | 'tMaxLimit' | 'tFlexMaxLimit',
    result: Partial<TakeoffPerformanceResult>,
  ): LimitingFactor {
    if (!result.limits) {
      throw new Error('Invalid result object!');
    }

    let limitingWeight = Infinity;
    let limitingFactor = LimitingFactor.Runway;

    for (const factor of Object.values(LimitingFactor) as LimitingFactor[]) {
      const weights = result.limits[factor];
      if (weights !== undefined && weights[temp] < limitingWeight) {
        limitingWeight = weights[temp];
        limitingFactor = factor;
      }
    }

    return limitingFactor;
  }

  private calculateFlexTemp(
    result: Partial<TakeoffPerformanceResult>,
    tvmcg: number,
  ): [number | undefined, LimitingFactor | undefined] {
    if (
      !result.inputs ||
      !result.params ||
      !result.limits ||
      !result.tRefLimitingFactor ||
      !result.tMaxLimitingFactor ||
      !result.tFlexMaxLimitingFactor
    ) {
      throw new Error('Invalid result object!');
    }

    if (result.inputs.tow < result.limits[result.tRefLimitingFactor].tRefLimit) {
      let flexTemp: number | undefined;
      let flexLimitingFactor: LimitingFactor | undefined;
      let iterFrom: number;
      let iterTo: number;
      let fromLimitingFactor: LimitingFactor;
      let fromLimitingWeights: LimitWeight;
      let toLimitingFactor: LimitingFactor;
      let toLimitingWeights: LimitWeight;

      if (result.inputs.tow > result.limits[result.tMaxLimitingFactor].tMaxLimitNoBleed) {
        iterFrom = result.params.tRef;
        iterTo = result.params.tMax;
        fromLimitingFactor = result.tRefLimitingFactor;
        fromLimitingWeights = result.limits[result.tRefLimitingFactor];
        toLimitingFactor = result.tMaxLimitingFactor;
        toLimitingWeights = result.limits[result.tMaxLimitingFactor];
      } else if (result.inputs.tow > result.limits[result.tFlexMaxLimitingFactor].tFlexMaxLimitNoBleed) {
        iterFrom = result.params.tMax;
        iterTo = result.params.tFlexMax;
        fromLimitingFactor = result.tMaxLimitingFactor;
        fromLimitingWeights = result.limits[result.tMaxLimitingFactor];
        toLimitingFactor = result.tFlexMaxLimitingFactor;
        toLimitingWeights = result.limits[result.tFlexMaxLimitingFactor];
      } else {
        iterFrom = result.params.tFlexMax;
        iterTo = result.params.tFlexMax + 8;
        fromLimitingFactor = result.tFlexMaxLimitingFactor;
        fromLimitingWeights = result.limits[result.tFlexMaxLimitingFactor];
        toLimitingFactor = result.tFlexMaxLimitingFactor;
        toLimitingWeights = fromLimitingWeights;
      }

      for (let t = iterFrom; t <= iterTo; t++) {
        const fromLimitTow = this.calculateFlexTow(result, fromLimitingFactor, fromLimitingWeights, t);
        const toLimitTow = this.calculateFlexTow(result, toLimitingFactor, toLimitingWeights, t);
        if (result.inputs.tow <= Math.min(fromLimitTow, toLimitTow)) {
          flexTemp = t;
          flexLimitingFactor = fromLimitTow <= toLimitTow ? fromLimitingFactor : toLimitingFactor;
        }
      }

      if (flexTemp !== undefined && flexLimitingFactor !== undefined) {
        if (result.inputs.antiIce === TakeoffAntiIceSetting.Engine) {
          flexTemp -= 2;
        } else if (result.inputs.antiIce === TakeoffAntiIceSetting.EngineWing) {
          flexTemp -= 6;
        }
        if (result.inputs.packs) {
          flexTemp -= 2;
        }

        flexTemp = Math.min(flexTemp, result.params.tFlexMax);
        flexTemp = Math.trunc(flexTemp);

        if (flexTemp > result.inputs.oat) {
          return [flexTemp, flexLimitingFactor];
        }
      }
    }

    return [undefined, undefined];
  }

  private calculateFlexTow(
    result: Partial<TakeoffPerformanceResult>,
    limitingFactor: LimitingFactor,
    limitingWeights: LimitWeight,
    temperature: number,
  ): number {
    if (!result.inputs || !result.params) {
      throw new Error('Invalid result object!');
    }

    switch (limitingFactor) {
      case LimitingFactor.Runway:
        return (
          limitingWeights.altLimit -
          this.calculateRunwayTempDelta(
            temperature,
            result.inputs.conf,
            result.params.tRef,
            result.params.tMax,
            result.params.tFlexMax,
            result.params.adjustedTora,
            result.params.pressureAlt,
            result.params.isaTemp,
          ) -
          this.calculateRunwayWindDelta(
            temperature,
            result.inputs.conf,
            result.params.isaTemp,
            result.params.tRef,
            result.params.tMax,
            result.params.tFlexMax,
            result.params.adjustedTora,
            result.params.headwind,
          )
        );
      case LimitingFactor.SecondSegment:
        return (
          limitingWeights.altLimit -
          this.calculateSecondSegmentTempDelta(
            temperature,
            result.inputs.conf,
            result.params.tRef,
            result.params.tMax,
            result.params.tFlexMax,
            result.params.adjustedTora,
            result.params.pressureAlt,
            result.params.isaTemp,
          ) -
          this.calculateSecondSegmentWindDelta(
            temperature,
            result.inputs.conf,
            result.params.isaTemp,
            result.params.tRef,
            result.params.tMax,
            result.params.tFlexMax,
            result.params.adjustedTora,
            result.params.headwind,
          )
        );
      case LimitingFactor.BrakeEnergy:
        return (
          limitingWeights.altLimit -
          this.calculateBrakeEnergyTempDelta(
            temperature,
            result.inputs.conf,
            result.params.tRef,
            result.params.tMax,
            result.params.tFlexMax,
            result.params.adjustedTora,
            result.params.pressureAlt,
            result.params.isaTemp,
          ) -
          this.calculateBrakeEnergyWindDelta(
            temperature,
            result.inputs.conf,
            result.params.isaTemp,
            result.params.tRef,
            result.params.tMax,
            result.params.tFlexMax,
            result.params.adjustedTora,
            result.params.headwind,
          )
        );
      case LimitingFactor.Vmcg:
        return (
          limitingWeights.altLimit -
          this.calculateVmcgTempDelta(
            temperature,
            result.inputs.conf,
            result.params.tRef,
            result.params.tMax,
            result.params.tFlexMax,
            result.params.adjustedTora,
            result.params.pressureAlt,
            result.params.isaTemp,
          ) -
          this.calculateVmcgWindDelta(
            temperature,
            result.inputs.conf,
            result.params.isaTemp,
            result.params.tRef,
            result.params.tMax,
            result.params.tFlexMax,
            result.params.adjustedTora,
            result.params.headwind,
          )
        );
    }
    return 0;
  }

  private calculateVSpeeds(
    result: Partial<TakeoffPerformanceResult>,
    applyForwardCgSpeedCorrection: boolean,
    tvmcg: number,
  ): void {
    if (!result.inputs || !result.params) {
      throw new Error('Invalid result object!');
    }

    // TODO: Implement V-speed calculations for A380X
    // This is a placeholder that needs to be implemented with actual A380X data
    if (result.inputs.runwayCondition === RunwayCondition.Dry || result.inputs.runwayCondition === RunwayCondition.Wet) {
      this.calculateDryVSpeeds(result, applyForwardCgSpeedCorrection);
      if (result.inputs.runwayCondition === RunwayCondition.Dry) {
        result.v1 = result.intermediateSpeeds?.dryV1;
        result.vR = result.intermediateSpeeds?.dryVR;
        result.v2 = result.intermediateSpeeds?.dryV2;
      } else {
        // Wet runway adjustments - TODO: Implement for A380X
        result.v1 = result.intermediateSpeeds?.dryV1;
        result.vR = result.intermediateSpeeds?.dryVR;
        result.v2 = result.intermediateSpeeds?.dryV2;
      }
      return;
    }

    // Contaminated runways - TODO: Implement for A380X
    result.error = TakeoffPerfomanceError.InvalidData;
  }

  private calculateDryVSpeeds(result: Partial<TakeoffPerformanceResult>, applyForwardCgSpeedCorrection: boolean): void {
    // TODO: Implement dry V-speed calculations for A380X
    // This is a placeholder that needs actual A380X performance data
    if (!result.inputs || !result.params) {
      throw new Error('Invalid result object!');
    }

    // Placeholder V-speed calculation - needs to be replaced with actual A380X data
    const speeds: Partial<TakeoffPerformanceSpeeds> = {};
    speeds.v2Base = 140 + (result.inputs.tow / 1000) * 0.1;
    speeds.vRBase = 130 + (result.inputs.tow / 1000) * 0.1;
    speeds.v1Base = 120 + (result.inputs.tow / 1000) * 0.1;

    speeds.dryV1 = speeds.v1Base;
    speeds.dryVR = speeds.vRBase;
    speeds.dryV2 = speeds.v2Base;

    result.intermediateSpeeds = speeds as TakeoffPerformanceSpeeds;
  }

  private reconcileVSpeeds(
    result: Partial<TakeoffPerformanceResult>,
    v1: number,
    vR: number,
    v2: number,
  ): [number, number, number] {
    if (!result.inputs || !result.params) {
      throw new Error('Invalid result object!');
    }

    const minV1Vmc = Math.ceil(A380842TakeoffPerformanceCalculator.minimumV1Vmc.get(result.params.pressureAlt));
    const minVrVmc = Math.ceil(A380842TakeoffPerformanceCalculator.minimumVrVmc.get(result.params.pressureAlt));
    const minV2Vmc = Math.ceil(
      A380842TakeoffPerformanceCalculator.minimumV2Vmc[result.inputs.conf].get(result.params.pressureAlt),
    );
    const minv2Vmu = Math.ceil(
      A380842TakeoffPerformanceCalculator.minimumV2Vmu[result.inputs.conf].get(
        result.params.pressureAlt,
        result.inputs.tow,
      ),
    );

    let v1Corrected = Math.round(Math.max(v1, minV1Vmc));
    let vRCorrected = Math.round(Math.max(vR, minVrVmc));
    const v2Corrected = Math.round(Math.max(v2, minV2Vmc, minv2Vmu));

    if (vRCorrected > v2Corrected) {
      vRCorrected = v2Corrected;
      if (vRCorrected < minVrVmc) {
        result.error = TakeoffPerfomanceError.VmcgVmcaLimits;
      }
    }

    if (v2Corrected > 195) {
      const maxVr = Math.trunc(195 - (v2Corrected - 195));
      if (vRCorrected > 195) {
        result.error = TakeoffPerfomanceError.MaximumTireSpeed;
      } else if (vRCorrected > maxVr) {
        vRCorrected = maxVr;
        if (vRCorrected < minVrVmc) {
          result.error = TakeoffPerfomanceError.VmcgVmcaLimits;
        }
      }
    }

    if (v1Corrected > vRCorrected) {
      v1Corrected = vRCorrected;
      if (v1Corrected < minV1Vmc) {
        result.error = TakeoffPerfomanceError.VmcgVmcaLimits;
      }
    }

    return [v1Corrected, vRCorrected, v2Corrected];
  }

  /** Calculates the temperature correction in kg. */
  private calculateRunwayTempDelta(
    temp: number,
    conf: number,
    tRef: number,
    tMax: number,
    tFlexMax: number,
    runwayLength: number,
    pressureAlt: number,
    isaTemp: number,
  ): number {
    if (temp > tFlexMax) {
      return NaN;
    }

    const tempFactors = A380842TakeoffPerformanceCalculator.runwayTemperatureFactor[conf];

    const runwayAltFactor = runwayLength - pressureAlt / 12;
    let weightDelta = 1000 * (runwayAltFactor * tempFactors[0] + tempFactors[1]) * (Math.min(temp, tRef) - isaTemp);
    if (temp > tRef) {
      weightDelta += 1000 * (runwayAltFactor * tempFactors[2] + tempFactors[3]) * (Math.min(temp, tMax) - tRef);
    }
    if (temp > tMax) {
      weightDelta += 1000 * (runwayAltFactor * tempFactors[4] + tempFactors[5]) * (temp - tMax);
    }
    return weightDelta;
  }

  /** Calculates the temperature correction in kg. */
  private calculateSecondSegmentTempDelta(
    temp: number,
    conf: number,
    tRef: number,
    tMax: number,
    tFlexMax: number,
    runwayLength: number,
    pressureAlt: number,
    isaTemp: number,
  ): number {
    if (temp > tFlexMax) {
      return NaN;
    }

    const tempFactors = A380842TakeoffPerformanceCalculator.secondSegmentTemperatureFactor[conf];

    let weightDelta =
      1000 * ((runwayLength - pressureAlt / 5) * tempFactors[0] + tempFactors[1]) * (Math.min(temp, tRef) - isaTemp);
    if (temp > tRef) {
      weightDelta +=
        1000 * ((runwayLength - pressureAlt / 5) * tempFactors[2] + tempFactors[3]) * (Math.min(temp, tMax) - tRef);
    }
    if (temp > tMax) {
      weightDelta += 1000 * ((runwayLength - pressureAlt / 5) * tempFactors[4] + tempFactors[5]) * (temp - tMax);
    }
    return weightDelta;
  }

  /** Calculates the temperature correction in kg. */
  private calculateBrakeEnergyTempDelta(
    temp: number,
    conf: number,
    tRef: number,
    tMax: number,
    tFlexMax: number,
    runwayLength: number,
    pressureAlt: number,
    isaTemp: number,
  ): number {
    if (temp > tFlexMax) {
      return NaN;
    }

    const tempFactors = A380842TakeoffPerformanceCalculator.brakeEnergyTemperatureFactor[conf];

    let weightDelta = 1000 * tempFactors[0] * (Math.min(temp, tRef) - isaTemp);
    if (temp > tRef) {
      weightDelta += 1000 * tempFactors[1] * (Math.min(temp, tMax) - tRef);
    }
    return weightDelta;
  }

  /** Calculates the temperature correction in kg. */
  private calculateVmcgTempDelta(
    temp: number,
    conf: number,
    tRef: number,
    tMax: number,
    tFlexMax: number,
    runwayLength: number,
    pressureAlt: number,
    isaTemp: number,
  ): number {
    if (temp > tFlexMax) {
      return NaN;
    }

    const tempFactors = A380842TakeoffPerformanceCalculator.vmcgTemperatureFactor[conf];

    let weightDelta = 1000 * (runwayLength * tempFactors[0] + tempFactors[1]) * (Math.min(temp, tRef) - isaTemp);
    if (temp > tRef) {
      weightDelta += 1000 * (runwayLength * tempFactors[2] + tempFactors[3]) * (Math.min(temp, tMax) - tRef);
    }
    if (temp > tMax) {
      weightDelta += 1000 * (runwayLength * tempFactors[4] + tempFactors[5]) * (temp - tMax);
    }
    return weightDelta;
  }

  /** Calculates the wind correction in kg, -ve is a positive increment on the limit weight (deltas are subtracted). */
  private calculateRunwayWindDelta(
    temp: number,
    conf: number,
    isaTemp: number,
    tRef: number,
    tMax: number,
    tFlexMax: number,
    runwayLength: number,
    wind: number,
  ): number {
    if (temp > tFlexMax) {
      return NaN;
    }

    const windFactors =
      wind >= 0
        ? A380842TakeoffPerformanceCalculator.runwayHeadWindFactor[conf]
        : A380842TakeoffPerformanceCalculator.runwayTailWindFactor[conf];

    let weightDelta = 1000 * (runwayLength * windFactors[0] + windFactors[1]) * wind;
    if (temp > tRef) {
      weightDelta += 1000 * windFactors[2] * wind * (Math.min(temp, tMax) - tRef);
    }
    if (temp > tMax) {
      weightDelta += 1000 * windFactors[3] * wind * (temp - tMax);
    }

    if (Math.sign(weightDelta) === Math.sign(wind)) {
      return 0;
    }
    return weightDelta;
  }

  /** Calculates the wind correction in kg, -ve is a positive increment on the limit weight (deltas are subtracted). */
  private calculateSecondSegmentWindDelta(
    temp: number,
    conf: number,
    isaTemp: number,
    tRef: number,
    tMax: number,
    tFlexMax: number,
    runwayLength: number,
    wind: number,
  ): number {
    if (temp > tFlexMax) {
      return NaN;
    }

    const windFactors =
      wind >= 0
        ? A380842TakeoffPerformanceCalculator.secondSegmentHeadWindFactor[conf]
        : A380842TakeoffPerformanceCalculator.secondSegmentTailWindFactor[conf];

    let weightDelta = 1000 * (runwayLength * windFactors[0] + windFactors[1]) * wind;
    if (temp > tRef) {
      weightDelta += 1000 * windFactors[2] * wind * (Math.min(temp, tMax) - tRef);
    }
    if (temp > tMax) {
      weightDelta += 1000 * windFactors[3] * wind * (temp - tMax);
    }

    if (Math.sign(weightDelta) === Math.sign(wind)) {
      return 0;
    }
    return weightDelta;
  }

  /** Calculates the wind correction in kg, -ve is a positive increment on the limit weight (deltas are subtracted). */
  private calculateBrakeEnergyWindDelta(
    temp: number,
    conf: number,
    isaTemp: number,
    tRef: number,
    tMax: number,
    tFlexMax: number,
    runwayLength: number,
    wind: number,
  ): number {
    if (temp > tFlexMax) {
      return NaN;
    }

    const windFactors =
      wind >= 0
        ? A380842TakeoffPerformanceCalculator.brakeEnergyHeadWindFactor[conf]
        : A380842TakeoffPerformanceCalculator.brakeEnergyTailWindFactor[conf];

    let weightDelta = 1000 * (runwayLength * windFactors[0] + windFactors[1]) * wind;
    if (temp > tRef) {
      weightDelta += 1000 * windFactors[2] * wind * (Math.min(temp, tMax) - tRef);
    }
    if (temp > tMax) {
      weightDelta += 1000 * windFactors[3] * wind * (temp - tMax);
    }

    if (Math.sign(weightDelta) === Math.sign(wind)) {
      return 0;
    }
    return weightDelta;
  }

  /** Calculates the wind correction in kg, -ve is a positive increment on the limit weight (deltas are subtracted). */
  private calculateVmcgWindDelta(
    temp: number,
    conf: number,
    isaTemp: number,
    tRef: number,
    tMax: number,
    tFlexMax: number,
    runwayLength: number,
    wind: number,
  ): number {
    if (temp > tFlexMax) {
      return NaN;
    }

    let weightDelta: number;

    if (wind >= 0) {
      const windFactors = A380842TakeoffPerformanceCalculator.vmcgHeadWindFactor[conf];

      weightDelta = 1000 * (runwayLength * windFactors[0] + windFactors[1]) * wind;
      if (temp > isaTemp) {
        weightDelta +=
          1000 * (runwayLength * windFactors[2] + windFactors[3]) * wind * (Math.min(temp, tRef) - isaTemp);
      }
      if (temp > tRef) {
        weightDelta += 1000 * (runwayLength * windFactors[4] + windFactors[5]) * wind * (Math.min(temp, tMax) - tRef);
      }
      if (temp >= tMax) {
        weightDelta += 1000 * (runwayLength * windFactors[6] + windFactors[7]) * wind * (temp - tMax);
      }
    } else {
      const windFactors = A380842TakeoffPerformanceCalculator.vmcgTailWindFactor[conf];

      weightDelta = 1000 * (runwayLength * windFactors[0] + windFactors[1]) * wind;
      if (temp > isaTemp) {
        weightDelta +=
          1000 * (runwayLength * windFactors[2] + windFactors[3]) * wind * (Math.min(temp, tRef) - isaTemp);
      }
      if (temp > tRef) {
        weightDelta += 1000 * windFactors[4] * wind * (Math.min(temp, tMax) - tRef);
      }
      if (temp > tMax) {
        weightDelta += 1000 * windFactors[5] * wind * (temp - tMax);
      }
    }

    if (Math.sign(weightDelta) === Math.sign(wind)) {
      return 0;
    }
    return weightDelta;
  }

  private calculateStabTrim(cg: number): number {
    // TODO: Verify CG to trim relationship for A380X
    return MathUtils.round(MathUtils.lerp(cg, 23, 43, 3.8, -2.5, true, true), 0.1);
  }

  /** @inheritdoc */
  public isCgWithinLimits(cg: number, tow: number): boolean {
    const cgLimits = A380842TakeoffPerformanceCalculator.takeoffCgLimits.get(
      A380842TakeoffPerformanceCalculator.vec2Cache,
      tow,
    );
    return cg >= cgLimits[0] && cg <= cgLimits[1];
  }
}
