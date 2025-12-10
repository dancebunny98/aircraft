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
 * Takeoff performance calculator for an A380-842 with forward CG
 * 
 * ⚠️⚠️⚠️ CRITICAL WARNING - FOR SIMULATION ONLY ⚠️⚠️⚠️
 * =======================================================
 * This calculator uses SCALED/ESTIMATED data based on A320 performance
 * multiplied by weight ratio (A380/A320 ≈ 6.48x) and speed adjustments.
 * 
 * THIS IS NOT REAL A380-842 PERFORMANCE DATA!
 * DO NOT USE FOR REAL FLIGHT OPERATIONS!
 * 
 * Real A380 performance data must come from the official Airbus AFM.
 * =======================================================
 * 
 * Based on configuration file: A380-842 WV003
 * MSN Reference: MSN 225
 * Engines: 972B-84
 * Max Takeoff Weight: 512,000 kg
 * Max Zero Fuel Weight: 373,000 kg
 * Operating Empty Weight: ~300,007 kg
 * CG Range: 29% - 43% MAC
 */
export class A380842TakeoffPerformanceCalculator implements TakeoffPerformanceCalculator {
  private static readonly vec2Cache = Vec2Math.create();
  private static readonly vec3Cache = Vec3Math.create();
  private static readonly vec4Cache = VecNMath.create(4);

  private static resultCache: Partial<TakeoffPerformanceResult> = {};
  private static optResultCache: Partial<TakeoffPerformanceResult>[] = [{}, {}, {}];

  /** Weight scaling factor A380/A320 for demonstration purposes */
  private static readonly WEIGHT_SCALE = 512_000 / 79_000; // ≈ 6.48

  /** Speed increase for A380 vs A320 (approximate) */
  private static readonly SPEED_OFFSET = 25; // knots

  /** Max flex temp as a delta from ISA in °C */
  private static readonly tMaxFlexDisa = 59;

  // ============================================================================
  // A380-842 BASIC PARAMETERS (from configuration file)
  // ============================================================================
  
  /** Maximum structural takeoff weight in kg */
  public readonly structuralMtow = 512_000; // kg (from config: maxGw)

  /** Maximum pressure altitude for takeoff in feet */
  public readonly maxPressureAlt = 9_200; // feet

  /** Operating empty weight in kg (approximation) */
  public readonly oew = 300_007; // kg (from config: minZfw)

  /** Maximum zero fuel weight in kg */
  public readonly maxZfw = 373_000; // kg (from config: maxZfw)

  /** Maximum cargo weight in kg */
  public readonly maxCargo = 51_400; // kg (from config: maxCargo)

  /** Maximum fuel weight in kg */
  public readonly maxFuel = 323_546; // kg (from config: maxFuel)

  /** Maximum headwind for takeoff calculations in knots */
  public readonly maxHeadwind = 45; // knots

  /** Maximum tailwind for takeoff calculations in knots */
  public readonly maxTailwind = 15; // knots

  /** Aircraft wheelbase in meters */
  private static readonly WHEELBASE = 31.9; // meters (from config)

  /** Aircraft length in meters */
  private static readonly LENGTH = 72.72; // meters (from config)

  /** Lineup distance for each lineup angle, in metres (scaled for A380 size) */
  private static readonly lineUpDistances: Record<LineupAngle, number> = {
    0: 0,
    90: 32,   // Larger than A320 (was 20.5) due to aircraft size
    180: 64,  // Larger than A320 (was 41) due to aircraft size
  };

  // ============================================================================
  // TEMPERATURE REFERENCE TABLES
  // ============================================================================

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
  ]);

  /** Tmax lookup table, Tmax [°C], pressure alt [feet] => lookup key = (pressure alt) */
  private static readonly tMaxTable = new LerpLookupTable([
    [55, -2000],
    [55, 0],
    [38, 9200],
  ]);

  // ============================================================================
  // RUNWAY PERFORMANCE LIMITS (SCALED FOR A380-842)
  // All weights multiplied by 6.48, capped at MTOW = 512,000 kg
  // ============================================================================

  /** CONF 1+F runway limited weights at sea level/ISA/0 slope/no bleed/fwd cg/no wind/dry */
  private static readonly runwayPerfLimitConf1 = new LerpLookupTable([
    [349_600, 1000],   // 53,950 * 6.48
    [384_264, 1219],   // 59,300 * 6.48
    [445_176, 1604],   // 68,700 * 6.48
    [490_536, 1959],   // 75,700 * 6.48
    [512_000, 2134],   // Capped at MTOW
    [512_000, 2239],   // Capped at MTOW
    [512_000, 2459],   // Capped at MTOW
    [512_000, 2559],   // Capped at MTOW
    [512_000, 2709],   // Capped at MTOW
    [512_000, 2918],   // Capped at MTOW
    [512_000, 3000],   // Capped at MTOW
    [512_000, 3180],   // Capped at MTOW
    [512_000, 3800],   // Capped at MTOW
    [512_000, 5000],   // Capped at MTOW
  ]);

  /** CONF 2 runway limited weights at sea level/ISA/0 slope/no bleed/fwd cg/no wind/dry */
  private static readonly runwayPerfLimitConf2 = new LerpLookupTable([
    [353_160, 1000],   // 54,500 * 6.48
    [392_040, 1219],   // 60,500 * 6.48
    [460_080, 1604],   // 71,000 * 6.48
    [508_032, 1959],   // 78,400 * 6.48
    [512_000, 2134],   // Capped at MTOW
    [512_000, 2239],   // Capped at MTOW
    [512_000, 2459],   // Capped at MTOW
    [512_000, 2709],   // Capped at MTOW
    [512_000, 2879],   // Capped at MTOW
    [512_000, 2987],   // Capped at MTOW
    [512_000, 3600],   // Capped at MTOW
    [512_000, 3800],   // Capped at MTOW
    [512_000, 3900],   // Capped at MTOW
    [512_000, 5000],   // Capped at MTOW
  ]);

  /** CONF 3 runway limited weights at sea level/ISA/0 slope/no bleed/fwd cg/no wind/dry */
  private static readonly runwayPerfLimitConf3 = new LerpLookupTable([
    [344_088, 1000],   // 53,100 * 6.48
    [390_096, 1219],   // 60,200 * 6.48
    [470_448, 1604],   // 72,600 * 6.48
    [512_000, 1959],   // Capped at MTOW
    [512_000, 2134],   // Capped at MTOW
    [512_000, 2239],   // Capped at MTOW
    [512_000, 2459],   // Capped at MTOW
    [512_000, 2709],   // Capped at MTOW
    [512_000, 2839],   // Capped at MTOW
    [512_000, 3180],   // Capped at MTOW
    [512_000, 3800],   // Capped at MTOW
    [512_000, 5000],   // Capped at MTOW
  ]);

  // ============================================================================
  // CORRECTION FACTORS - SLOPE
  // ============================================================================

  /** Slope factor for each takeoff config */
  private static readonly runwaySlopeFactor: Record<number, number> = {
    1: 0.00084,
    2: 0.00096,
    3: 0.0011,
  };

  // ============================================================================
  // CORRECTION FACTORS - PRESSURE ALTITUDE
  // ============================================================================

  /** Runway performance pressure altitude factors for each takeoff config */
  private static readonly runwayPressureAltFactor: Record<number, [number, number]> = {
    1: [3.43e-8, 0.001192],
    2: [1.15e-8, 0.001216],
    3: [-4.6e-9, 0.001245],
  };

  // ============================================================================
  // CORRECTION FACTORS - TEMPERATURE
  // ============================================================================

  /** Runway performance temperature factors for each takeoff config */
  private static readonly runwayTemperatureFactor: Record<number, [number, number, number, number, number, number]> = {
    1: [0.00001, 0.095175, 0.000207, 0.040242, 0.00024, 0.066189],
    2: [-0.00001, 0.131948, 0.000155, 0.162938, 0.000225, 0.150363],
    3: [-0.0000438, 0.198845, 0.000188, 0.14547, 0.0002, 0.232529],
  };

  // ============================================================================
  // CORRECTION FACTORS - WIND (RUNWAY PERFORMANCE)
  // ============================================================================

  /** Runway performance headwind factors for each takeoff config */
  private static readonly runwayHeadWindFactor: Record<number, [number, number, number, number]> = {
    1: [0.000029, -0.233075, 0.00242, 0.003772],
    2: [0.000051, -0.277863, 0.0018, 0.003366],
    3: [0.000115, -0.3951, 0.002357, 0.002125],
  };

  /** Runway performance tailwind factors for each takeoff config */
  private static readonly runwayTailWindFactor: Record<number, [number, number, number, number]> = {
    1: [0.000065, -0.684701, 0.00498, 0.0808],
    2: [0.000198, -1.017, 0.00711, 0.009],
    3: [0.000271, -1.11506, 0.0078, 0.00875],
  };

  // ============================================================================
  // SECOND SEGMENT CLIMB FACTORS
  // ============================================================================

  /** Second segment base factors for each takeoff config */
  private static readonly secondSegmentBaseFactor: Record<number, [number, number]> = {
    1: [0.00391, 75.366],
    2: [0.005465, 72.227],
    3: [0.00495, 72.256],
  };

  /** Second segment slope factor for each takeoff config */
  private static readonly secondSegmentSlopeFactor: Record<number, number> = {
    1: 0.000419,
    2: 0.000641,
    3: 0.000459,
  };

  /** Second segment pressure altitude factors for each takeoff config */
  private static readonly secondSegmentPressureAltFactor: Record<number, [number, number]> = {
    1: [-6.5e-8, 0.001769],
    2: [1.05e-7, 0.00055],
    3: [7.48e-8, 0.000506],
  };

  /** Second segment temperature factors for each takeoff config */
  private static readonly secondSegmentTemperatureFactor: Record<number, [number, number, number, number, number, number]> = {
    1: [0.000025, 0.001, 0.000155, 0.211445, 0.000071, 0.556741],
    2: [0.0000121, 0.042153, 0.0001256, 0.325925, 0.000082, 0.546259],
    3: [-0.0000294, 0.13903, 0.0000693, 0.480536, 0.000133, 0.480536],
  };

  /** Second segment headwind factors for each takeoff config */
  private static readonly secondSegmentHeadWindFactor: Record<number, [number, number, number, number]> = {
    1: [0.000019, -0.13052, 0.000813636, 0.000145238],
    2: [0.0000454, -0.20585, 0.000416667, 0.001778293],
    3: [0.000085, -0.30209, 0.001189394, 0.0038996],
  };

  /** Second segment tailwind factors for each takeoff config */
  private static readonly secondSegmentTailWindFactor: Record<number, [number, number, number, number]> = {
    1: [0.000104, -0.705693, 0.009, 0.00648],
    2: [0.000154, -0.8052, 0.009, 0.002444],
    3: [0.000054, -0.462, 0.00875, 0.006606505],
  };

  // ============================================================================
  // BRAKE ENERGY FACTORS
  // ============================================================================

  /** Brake energy base factors for each takeoff config */
  private static readonly brakeEnergyBaseFactor: Record<number, [number, number]> = {
    1: [0.00503, 72.524],
    2: [0.00672, 68.28],
    3: [0.00128, 83.951],
  };

  /** Brake energy slope factor for each takeoff config */
  private static readonly brakeEnergySlopeFactor: Record<number, number> = {
    1: 0.000045,
    2: 0.000068,
    3: 0.000045,
  };

  /** Brake energy pressure altitude factors for each takeoff config */
  private static readonly brakeEnergyPressureAltFactor: Record<number, [number, number]> = {
    1: [5.5e-8, 0.000968],
    2: [1.17e-7, 0.000595],
    3: [4.65e-8, 0.000658],
  };

  /** Brake energy temperature factors for each takeoff config */
  private static readonly brakeEnergyTemperatureFactor: Record<number, [number, number]> = {
    1: [0.06, 0.54],
    2: [0.058, 0.545],
    3: [0.04642, 0.6],
  };

  /** Brake energy headwind factors for each takeoff config */
  private static readonly brakeEnergyHeadWindFactor: Record<number, [number, number, number, number]> = {
    1: [0.0000311, -0.1769, 0.001125, 0],
    2: [0.0000316, -0.1799, 0.001182, 0],
    3: [0.0000147, -0.0928, 0.001111, 0],
  };

  /** Brake energy tailwind factors for each takeoff config */
  private static readonly brakeEnergyTailWindFactor: Record<number, [number, number, number, number]> = {
    1: [0.000117, -0.8024, 0.0117879, 0.006667],
    2: [0.000157, -0.849, 0.0066818, 0.006667],
    3: [0.00013, -0.6946, 0.0068333, 0.006667],
  };

  // ============================================================================
  // VMCG FACTORS
  // ============================================================================

  /** VMCG base factors for each takeoff config */
  private static readonly vmcgBaseFactor: Record<number, [number, number]> = {
    1: [0.0644, -19.526],
    2: [0.082005, -39.27],
    3: [0.0704, -25.6868],
  };

  /** VMCG slope factor for each takeoff config */
  private static readonly vmcgSlopeFactor: Record<number, number> = {
    1: 0.00084,
    2: 0.001054,
    3: 0.001068,
  };

  /** VMCG pressure altitude factors for each takeoff config */
  private static readonly vmcgPressureAltFactor: Record<number, [number, number]> = {
    1: [-8.35e-7, 0.00589],
    2: [-7.58e-7, 0.00703],
    3: [1.95e-7, 0.00266],
  };

  /** VMCG temperature factors for each takeoff config */
  private static readonly vmcgTemperatureFactor: Record<number, [number, number, number, number, number, number]> = {
    1: [-0.00133, 2.104, 0.000699, -0.128144, -0.000718, 1.8103],
    2: [-0.00097, 1.613, 0.000242, 0.462005, -0.000547, 1.603],
    3: [-0.000923, 1.6087, 0.00061, 0.002239, -0.000335, 1.2716],
  };

  /** VMCG headwind factors for each takeoff config */
  private static readonly vmcgHeadWindFactor: Record<number, [number, number, number, number, number, number, number, number]> = {
    1: [0.001198, -1.80539, 0.000097, -0.15121, -0.000255, 0.337391, 0.000066, -0.079718],
    2: [0.000697, -1.17473, 0.000031, -0.057504, -0.000184, 0.246185, 0.000012, 0.0216],
    3: [0.0023, -3.468, -0.000037, 0.033946, -0.000156, 0.213953, -0.000757, 1.094],
  };

  /** VMCG tailwind factors for each takeoff config */
  private static readonly vmcgTailWindFactor: Record<number, [number, number, number, number, number, number]> = {
    1: [0.00218, -5.489, -0.000106, 0.145473, 0.031431, -0.0356],
    2: [0.001892, -5.646, -0.000059, 0.079539, 0.009948, -0.010763],
    3: [0.000613, -3.165, -0.000022, 0.020622, 0.049286, -0.0396],
  };

  // ============================================================================
  // A380-842 TAKEOFF CG ENVELOPE (from configuration file)
  // CG Range: 29% - 43% MAC
  // Weight Range: 270,000 kg - 512,000 kg (MTOW)
  // ============================================================================

  /** 
   * Takeoff CG envelope. key = TOW [kg] => [lower limit, upper limit] %MAC
   * Based on A380-842 config file performanceEnvelope
   */
  private static readonly takeoffCgLimits = new LerpVectorLookupTable([
    [Vec2Math.create(29, 43), 270_000],   // Minimum weight
    [Vec2Math.create(29, 43), 375_000],   
    [Vec2Math.create(29, 43), 510_000],   
    [Vec2Math.create(29, 43), 512_000],   // MTOW
  ]);

  /** CG correction factors for each config */
  private static readonly cgFactors: Record<number, [number, number]> = {
    1: [-0.041448, 3.357],
    2: [-0.03277, 2.686],
    3: [-0.0249, 2.086],
  };

  // ============================================================================
  // MINIMUM V-SPEEDS (VMCG/VMCA LIMITS)
  // All speeds increased by +25 knots for A380 vs A320
  // ============================================================================

  /** Minimum V1 limited by VMCG/VMCA - lookup key is pressure altitude [feet], value is KCAS */
  private static readonly minimumV1Vmc = new LerpLookupTable([
    [147, -2000],  // 122 + 25
    [146, 0],      // 121 + 25
    [146, 2000],   // 121 + 25
    [145, 3000],   // 120 + 25
    [145, 4000],   // 120 + 25
    [143, 6000],   // 118 + 25
    [141, 8000],   // 116 + 25
    [140, 9200],   // 115 + 25
    [132, 14000],  // 107 + 25
    [131, 15000],  // 106 + 25
  ]);

  /** Minimum Vr limited by VMCG/VMCA - lookup key is pressure altitude [feet], value is KCAS */
  private static readonly minimumVrVmc = new LerpLookupTable([
    [148, -2000],  // 123 + 25
    [147, 0],      // 122 + 25
    [147, 3000],   // 122 + 25
    [146, 4000],   // 121 + 25
    [145, 6000],   // 120 + 25
    [142, 8000],   // 117 + 25
    [141, 9200],   // 116 + 25
    [132, 14000],  // 107 + 25
    [131, 15000],  // 106 + 25
  ]);

  /** Minimum V2 limited by VMCG/VMCA - outer key is takeoff config, lookup key is pressure altitude [feet], value is KCAS */
  private static readonly minimumV2Vmc: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [152, -2000],  // 127 + 25
      [151, 0],      // 126 + 25
      [151, 1000],   // 126 + 25
      [150, 2000],   // 125 + 25
      [150, 3000],   // 125 + 25
      [149, 4000],   // 124 + 25
      [148, 6000],   // 123 + 25
      [145, 8000],   // 120 + 25
      [143, 9200],   // 118 + 25
      [134, 14000],  // 109 + 25
      [132, 15000],  // 107 + 25
    ]),
    2: new LerpLookupTable([
      [152, -2000],  // 127 + 25
      [151, 0],
      [151, 1000],
      [150, 2000],
      [150, 3000],
      [149, 4000],
      [148, 6000],
      [145, 8000],
      [143, 9200],
      [134, 14000],
      [132, 15000],
    ]),
    3: new LerpLookupTable([
      [151, -2000],  // 126 + 25
      [150, 0],      // 125 + 25
      [150, 1000],
      [149, 2000],
      [149, 3000],
      [148, 4000],
      [147, 6000],
      [144, 8000],
      [142, 9200],
      [133, 14000],
      [131, 15000],
    ]),
  };

  /** 
   * Minimum V2 limited by VMU/VMCA 
   * Outer key is takeoff config
   * Lookup keys are (pressure altitude [feet], takeoff weight [kg])
   * Value is KCAS (+25 knots for A380, weights scaled by 6.48)
   */
  private static readonly minimumV2Vmu: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      // Weight = original * 6.48, Speed = original + 25
      [152, -2000, 291_600],   // 45,000 * 6.48, 127 + 25
      [152, -2000, 324_000],   // 50,000 * 6.48
      [152, -2000, 356_400],   // 55,000 * 6.48
      [157, -2000, 388_800],   // 60,000 * 6.48, 132 + 25
      [162, -2000, 421_200],   // 65,000 * 6.48, 137 + 25
      [167, -2000, 453_600],   // 70,000 * 6.48, 142 + 25
      [171, -2000, 486_000],   // 75,000 * 6.48, 146 + 25
      [176, -2000, 512_000],   // MTOW, 151 + 25
      [151, -1000, 291_600],
      [151, -1000, 324_000],
      [152, -1000, 356_400],
      [157, -1000, 388_800],
      [162, -1000, 421_200],
      [167, -1000, 453_600],
      [172, -1000, 486_000],
      [176, -1000, 512_000],
      [151, 0, 291_600],
      [151, 0, 324_000],
      [152, 0, 356_400],
      [157, 0, 388_800],
      [162, 0, 421_200],
      [167, 0, 453_600],
      [172, 0, 486_000],
      [176, 0, 512_000],
      [151, 1000, 291_600],
      [151, 1000, 324_000],
      [152, 1000, 356_400],
      [157, 1000, 388_800],
      [162, 1000, 421_200],
      [167, 1000, 453_600],
      [172, 1000, 486_000],
      [176, 1000, 512_000],
      [150, 2000, 291_600],
      [150, 2000, 324_000],
      [152, 2000, 356_400],
      [157, 2000, 388_800],
      [162, 2000, 421_200],
      [167, 2000, 453_600],
      [172, 2000, 486_000],
      [176, 2000, 512_000],
      [150, 3000, 291_600],
      [150, 3000, 324_000],
      [152, 3000, 356_400],
      [157, 3000, 388_800],
      [162, 3000, 421_200],
      [167, 3000, 453_600],
      [172, 3000, 486_000],
      [176, 3000, 512_000],
      [149, 4000, 291_600],
      [149, 4000, 324_000],
      [152, 4000, 356_400],
      [157, 4000, 388_800],
      [162, 4000, 421_200],
      [167, 4000, 453_600],
      [172, 4000, 486_000],
      [177, 4000, 512_000],
      [149, 5000, 291_600],
      [149, 5000, 324_000],
      [152, 5000, 356_400],
      [157, 5000, 388_800],
      [162, 5000, 421_200],
      [167, 5000, 453_600],
      [172, 5000, 486_000],
      [177, 5000, 512_000],
      [148, 6000, 291_600],
      [148, 6000, 324_000],
      [152, 6000, 356_400],
      [157, 6000, 388_800],
      [162, 6000, 421_200],
      [167, 6000, 453_600],
      [172, 6000, 486_000],
      [177, 6000, 512_000],
      [147, 7000, 291_600],
      [147, 7000, 324_000],
      [152, 7000, 356_400],
      [157, 7000, 388_800],
      [162, 7000, 421_200],
      [167, 7000, 453_600],
      [172, 7000, 486_000],
      [177, 7000, 512_000],
      [145, 8000, 291_600],
      [146, 8000, 324_000],
      [152, 8000, 356_400],
      [157, 8000, 388_800],
      [162, 8000, 421_200],
      [168, 8000, 453_600],
      [173, 8000, 486_000],
      [177, 8000, 512_000],
      [144, 9000, 291_600],
      [146, 9000, 324_000],
      [152, 9000, 356_400],
      [157, 9000, 388_800],
      [162, 9000, 421_200],
      [168, 9000, 453_600],
      [173, 9000, 486_000],
      [178, 9000, 512_000],
      [142, 10000, 291_600],
      [146, 10000, 324_000],
      [152, 10000, 356_400],
      [157, 10000, 388_800],
      [162, 10000, 421_200],
      [168, 10000, 453_600],
      [173, 10000, 486_000],
      [178, 10000, 512_000],
      [140, 11000, 291_600],
      [146, 11000, 324_000],
      [152, 11000, 356_400],
      [157, 11000, 388_800],
      [163, 11000, 421_200],
      [168, 11000, 453_600],
      [174, 11000, 486_000],
      [179, 11000, 512_000],
      [140, 12000, 291_600],
      [146, 12000, 324_000],
      [152, 12000, 356_400],
      [157, 12000, 388_800],
      [163, 12000, 421_200],
      [168, 12000, 453_600],
      [174, 12000, 486_000],
      [179, 12000, 512_000],
      [140, 13000, 291_600],
      [146, 13000, 324_000],
      [152, 13000, 356_400],
      [157, 13000, 388_800],
      [163, 13000, 421_200],
      [169, 13000, 453_600],
      [174, 13000, 486_000],
      [179, 13000, 512_000],
      [140, 14100, 291_600],
      [146, 14100, 324_000],
      [152, 14100, 356_400],
      [157, 14100, 388_800],
      [163, 14100, 421_200],
      [169, 14100, 453_600],
      [175, 14100, 486_000],
      [180, 14100, 512_000],
      [140, 15100, 291_600],
      [146, 15100, 324_000],
      [152, 15100, 356_400],
      [158, 15100, 388_800],
      [164, 15100, 421_200],
      [169, 15100, 453_600],
      [175, 15100, 486_000],
      [180, 15100, 512_000],
    ]),
    2: new LerpLookupTable([
      [152, -2000, 291_600],
      [152, -2000, 324_000],
      [152, -2000, 356_400],
      [152, -2000, 388_800],
      [157, -2000, 421_200],
      [161, -2000, 453_600],
      [166, -2000, 486_000],
      [170, -2000, 512_000],
      [151, -1000, 291_600],
      [151, -1000, 324_000],
      [151, -1000, 356_400],
      [152, -1000, 388_800],
      [157, -1000, 421_200],
      [161, -1000, 453_600],
      [166, -1000, 486_000],
      [170, -1000, 512_000],
      [151, 0, 291_600],
      [151, 0, 324_000],
      [151, 0, 356_400],
      [152, 0, 388_800],
      [157, 0, 421_200],
      [162, 0, 453_600],
      [166, 0, 486_000],
      [171, 0, 512_000],
      [151, 1000, 291_600],
      [151, 1000, 324_000],
      [151, 1000, 356_400],
      [152, 1000, 388_800],
      [157, 1000, 421_200],
      [162, 1000, 453_600],
      [166, 1000, 486_000],
      [171, 1000, 512_000],
      [150, 2000, 291_600],
      [150, 2000, 324_000],
      [150, 2000, 356_400],
      [152, 2000, 388_800],
      [157, 2000, 421_200],
      [162, 2000, 453_600],
      [166, 2000, 486_000],
      [171, 2000, 512_000],
      [150, 3000, 291_600],
      [150, 3000, 324_000],
      [150, 3000, 356_400],
      [152, 3000, 388_800],
      [157, 3000, 421_200],
      [162, 3000, 453_600],
      [167, 3000, 486_000],
      [171, 3000, 512_000],
      [149, 4000, 291_600],
      [149, 4000, 324_000],
      [149, 4000, 356_400],
      [152, 4000, 388_800],
      [157, 4000, 421_200],
      [162, 4000, 453_600],
      [167, 4000, 486_000],
      [171, 4000, 512_000],
      [149, 5000, 291_600],
      [149, 5000, 324_000],
      [149, 5000, 356_400],
      [152, 5000, 388_800],
      [157, 5000, 421_200],
      [162, 5000, 453_600],
      [167, 5000, 486_000],
      [171, 5000, 512_000],
      [148, 6000, 291_600],
      [148, 6000, 324_000],
      [148, 6000, 356_400],
      [152, 6000, 388_800],
      [157, 6000, 421_200],
      [162, 6000, 453_600],
      [167, 6000, 486_000],
      [171, 6000, 512_000],
      [147, 7000, 291_600],
      [147, 7000, 324_000],
      [147, 7000, 356_400],
      [152, 7000, 388_800],
      [157, 7000, 421_200],
      [162, 7000, 453_600],
      [167, 7000, 486_000],
      [171, 7000, 512_000],
      [145, 8000, 291_600],
      [145, 8000, 324_000],
      [147, 8000, 356_400],
      [152, 8000, 388_800],
      [157, 8000, 421_200],
      [162, 8000, 453_600],
      [167, 8000, 486_000],
      [171, 8000, 512_000],
      [144, 9000, 291_600],
      [144, 9000, 324_000],
      [147, 9000, 356_400],
      [152, 9000, 388_800],
      [157, 9000, 421_200],
      [162, 9000, 453_600],
      [167, 9000, 486_000],
      [172, 9000, 512_000],
      [142, 10000, 291_600],
      [142, 10000, 324_000],
      [147, 10000, 356_400],
      [152, 10000, 388_800],
      [157, 10000, 421_200],
      [162, 10000, 453_600],
      [167, 10000, 486_000],
      [172, 10000, 512_000],
      [140, 11000, 291_600],
      [142, 11000, 324_000],
      [147, 11000, 356_400],
      [152, 11000, 388_800],
      [157, 11000, 421_200],
      [162, 11000, 453_600],
      [167, 11000, 486_000],
      [172, 11000, 512_000],
      [138, 12000, 291_600],
      [142, 12000, 324_000],
      [147, 12000, 356_400],
      [152, 12000, 388_800],
      [157, 12000, 421_200],
      [163, 12000, 453_600],
      [168, 12000, 486_000],
      [172, 12000, 512_000],
      [136, 13000, 291_600],
      [141, 13000, 324_000],
      [147, 13000, 356_400],
      [152, 13000, 388_800],
      [158, 13000, 421_200],
      [163, 13000, 453_600],
      [168, 13000, 486_000],
      [173, 13000, 512_000],
      [136, 14100, 291_600],
      [141, 14100, 324_000],
      [147, 14100, 356_400],
      [152, 14100, 388_800],
      [158, 14100, 421_200],
      [163, 14100, 453_600],
      [168, 14100, 486_000],
      [173, 14100, 512_000],
      [136, 15100, 291_600],
      [141, 15100, 324_000],
      [147, 15100, 356_400],
      [152, 15100, 388_800],
      [158, 15100, 421_200],
      [163, 15100, 453_600],
      [168, 15100, 486_000],
      [173, 15100, 512_000],
    ]),
    3: new LerpLookupTable([
      [151, -2000, 291_600],
      [151, -2000, 324_000],
      [151, -2000, 356_400],
      [151, -2000, 388_800],
      [153, -2000, 421_200],
      [157, -2000, 453_600],
      [162, -2000, 486_000],
      [166, -2000, 512_000],
      [150, -1000, 291_600],
      [150, -1000, 324_000],
      [150, -1000, 356_400],
      [150, -1000, 388_800],
      [153, -1000, 421_200],
      [157, -1000, 453_600],
      [162, -1000, 486_000],
      [166, -1000, 512_000],
      [150, 0, 291_600],
      [150, 0, 324_000],
      [150, 0, 356_400],
      [150, 0, 388_800],
      [153, 0, 421_200],
      [157, 0, 453_600],
      [162, 0, 486_000],
      [166, 0, 512_000],
      [150, 1000, 291_600],
      [150, 1000, 324_000],
      [150, 1000, 356_400],
      [150, 1000, 388_800],
      [153, 1000, 421_200],
      [157, 1000, 453_600],
      [162, 1000, 486_000],
      [166, 1000, 512_000],
      [149, 2000, 291_600],
      [149, 2000, 324_000],
      [149, 2000, 356_400],
      [149, 2000, 388_800],
      [153, 2000, 421_200],
      [157, 2000, 453_600],
      [162, 2000, 486_000],
      [166, 2000, 512_000],
      [149, 3000, 291_600],
      [149, 3000, 324_000],
      [149, 3000, 356_400],
      [149, 3000, 388_800],
      [153, 3000, 421_200],
      [158, 3000, 453_600],
      [162, 3000, 486_000],
      [166, 3000, 512_000],
      [148, 4000, 291_600],
      [148, 4000, 324_000],
      [148, 4000, 356_400],
      [148, 4000, 388_800],
      [153, 4000, 421_200],
      [158, 4000, 453_600],
      [162, 4000, 486_000],
      [166, 4000, 512_000],
      [148, 5000, 291_600],
      [148, 5000, 324_000],
      [148, 5000, 356_400],
      [148, 5000, 388_800],
      [153, 5000, 421_200],
      [158, 5000, 453_600],
      [162, 5000, 486_000],
      [167, 5000, 512_000],
      [147, 6000, 291_600],
      [147, 6000, 324_000],
      [147, 6000, 356_400],
      [148, 6000, 388_800],
      [153, 6000, 421_200],
      [158, 6000, 453_600],
      [162, 6000, 486_000],
      [167, 6000, 512_000],
      [146, 7000, 291_600],
      [146, 7000, 324_000],
      [146, 7000, 356_400],
      [148, 7000, 388_800],
      [153, 7000, 421_200],
      [158, 7000, 453_600],
      [163, 7000, 486_000],
      [167, 7000, 512_000],
      [144, 8000, 291_600],
      [144, 8000, 324_000],
      [144, 8000, 356_400],
      [148, 8000, 388_800],
      [153, 8000, 421_200],
      [158, 8000, 453_600],
      [163, 8000, 486_000],
      [167, 8000, 512_000],
      [143, 9000, 291_600],
      [143, 9000, 324_000],
      [143, 9000, 356_400],
      [148, 9000, 388_800],
      [153, 9000, 421_200],
      [158, 9000, 453_600],
      [163, 9000, 486_000],
      [167, 9000, 512_000],
      [141, 10000, 291_600],
      [141, 10000, 324_000],
      [143, 10000, 356_400],
      [148, 10000, 388_800],
      [153, 10000, 421_200],
      [158, 10000, 453_600],
      [163, 10000, 486_000],
      [167, 10000, 512_000],
      [139, 11000, 291_600],
      [139, 11000, 324_000],
      [143, 11000, 356_400],
      [148, 11000, 388_800],
      [153, 11000, 421_200],
      [158, 11000, 453_600],
      [163, 11000, 486_000],
      [167, 11000, 512_000],
      [137, 12000, 291_600],
      [138, 12000, 324_000],
      [143, 12000, 356_400],
      [148, 12000, 388_800],
      [153, 12000, 421_200],
      [158, 12000, 453_600],
      [163, 12000, 486_000],
      [168, 12000, 512_000],
      [135, 13000, 291_600],
      [138, 13000, 324_000],
      [143, 13000, 356_400],
      [148, 13000, 388_800],
      [153, 13000, 421_200],
      [158, 13000, 453_600],
      [163, 13000, 486_000],
      [168, 13000, 512_000],
      [133, 14100, 291_600],
      [138, 14100, 324_000],
      [143, 14100, 356_400],
      [148, 14100, 388_800],
      [153, 14100, 421_200],
      [159, 14100, 453_600],
      [164, 14100, 486_000],
      [168, 14100, 512_000],
      [132, 15100, 291_600],
      [138, 15100, 324_000],
      [143, 15100, 356_400],
      [148, 15100, 388_800],
      [154, 15100, 421_200],
      [159, 15100, 453_600],
      [164, 15100, 486_000],
      [168, 15100, 512_000],
    ]),
  };

 // ============================================================================
  // V-SPEED CALCULATION FACTORS (RUNWAY/VMCG LIMITED)
  // ============================================================================

  /** V2 runway VMCG base factors */
  private static readonly v2RunwayVmcgBaseFactors: Record<number, [number, number]> = {
    1: [0.920413, 77.3469],
    2: [0.87805, 75.1346],
    3: [0.96131, 65.525],
  };

  private static readonly v2RunwayVmcgAltFactors: Record<number, [number, number]> = {
    1: [0.00002333, -0.00144],
    2: [0.00001713, -0.001057],
    3: [0.00001081, -0.0006236],
  };

  private static readonly vRRunwayVmcgBaseFactors: Record<number, [number, number]> = {
    1: [0.83076, 81.086],
    2: [0.728085, 84.111],
    3: [0.742761, 78.721],
  };

  private static readonly vRRunwayVmcgRunwayFactors: Record<number, [number, number, number]> = {
    1: [2280, 0.0001718, -0.01585],
    2: [2280, 0.0003239, -0.027272],
    3: [1900, 0.00057992, -0.045646],
  };

  private static readonly vRRunwayVmcgAltFactors: Record<number, [number, number]> = {
    1: [0.000029048, -0.001958],
    2: [0.000035557, -0.0025644],
    3: [1.02964e-5, -0.000545643],
  };

  private static readonly vRRunwayVmcgSlopeFactors: Record<number, number> = {
    1: 0.000887,
    2: 0.000887,
    3: 0.000887,
  };

  private static readonly vRRunwayVmcgHeadwindFactors: Record<number, [number, number]> = {
    1: [0, 0],
    2: [-0.027617, 2.1252],
    3: [0.003355, -0.263036],
  };

  private static readonly vRRunwayVmcgTailwindFactors: Record<number, [number, number]> = {
    1: [-0.008052, 0.6599],
    2: [-0.010709, 0.90273],
    3: [-0.027796, 2.107178],
  };

  private static readonly v1RunwayVmcgBaseFactors: Record<number, [number, number]> = {
    1: [0.4259042, 106.763],
    2: [0.398826, 106.337],
    3: [0.469648, 95.776],
  };

  private static readonly v1RunwayVmcgRunwayFactors: Record<number, [number, number, number]> = {
    1: [2280, 0.0003156, -0.03189],
    2: [2280, 0.0004396, -0.041238],
    3: [1900, 0.00144, -0.112592],
  };

  private static readonly v1RunwayVmcgAltFactors: Record<number, [number, number]> = {
    1: [0.00003416, -0.0028035],
    2: [0.00004354, -0.0035876],
    3: [0.0000847, -0.006666],
  };

  private static readonly v1RunwayVmcgSlopeFactors: Record<number, number> = {
    1: 0.000887,
    2: 0.000887,
    3: 0.000887,
  };

  private static readonly v1RunwayVmcgHeadwindFactors: Record<number, [number, number]> = {
    1: [0.00526, -0.2105],
    2: [0.00974, -0.53],
    3: [0.002333, -0.079528],
  };

  private static readonly v1RunwayVmcgTailwindFactors: Record<number, [number, number]> = {
    1: [-0.009243, 1.108],
    2: [-0.008207, 1.07],
    3: [-0.043516, 3.423],
  };

  // ============================================================================
  // V-SPEED CALCULATION FACTORS (SECOND SEGMENT/BRAKE ENERGY LIMITED)
  // ============================================================================

  private static readonly v2SecondSegBrakeThresholds: Record<number, [number, number]> = {
    1: [-0.011031, 189.0],
    2: [0.02346, 68.33],
    3: [0.014175, 106.14],
  };

  private static readonly v2SecondSegBrakeBaseTable1: Record<number, [number, number]> = {
    1: [0.72637, 101.077],
    2: [0.74005, 97.048],
    3: [0.3746, 130.078],
  };

  private static readonly v2SecondSegBrakeBaseTable2: Record<number, [number, number]> = {
    1: [0.868263, 85.8],
    2: [0.46666, 111.0],
    3: [0.859926, 82.4377],
  };

  private static readonly v2SecondSegBrakeRunwayTable1: Record<number, [number, number]> = {
    1: [3180, -0.015997],
    2: [3180, -0.012],
    3: [3180, -0.019296],
  };

  private static readonly v2SecondSegBrakeRunwayTable2: Record<number, [number, number]> = {
    1: [3180, -0.007],
    2: [3180, -0.007],
    3: [3180, -0.013],
  };

  private static readonly v2SecondSegBrakeAltFactors: Record<number, [number, number, number, number]> = {
    1: [-0.00000924, -0.00075879, 0.000546, -1.075],
    2: [-0.00000387, -0.0009333, 0.000546, -1.075],
    3: [0.000034, -0.004043, 0.000468, -0.778471],
  };

  private static readonly v2SecondSegBrakeSlopeFactors: Record<number, [number, number]> = {
    1: [0.0000571, -0.008306],
    2: [0.0000286, -0.00415],
    3: [0.000001, -0.000556],
  };

  private static readonly v2SecondSegBrakeHeadwindFactors: Record<number, number> = {
    1: 0.2,
    2: 0.2,
    3: 0.2,
  };

  private static readonly v2SecondSegBrakeTailwindFactors: Record<number, number> = {
    1: 0.65,
    2: 0.5,
    3: 0.7,
  };

  private static readonly vRSecondSegBrakeBaseTable1: Record<number, [number, number]> = {
    1: [0.701509, 102.667],
    2: [0.696402, 100.226],
    3: [0.381534, 129.61],
  };

  private static readonly vRSecondSegBrakeBaseTable2: Record<number, [number, number]> = {
    1: [0.573107, 105.783],
    2: [0.932193, 115.336],
    3: [0.572407, 105.428],
  };

  private static readonly vRSecondSegBrakeRunwayTable1: Record<number, [number, number, number]> = {
    1: [3180, -0.000181, -0.005195],
    2: [3180, -0.000225, -0.000596],
    3: [3180, 0.000054, -0.024442],
  };

  private static readonly vRSecondSegBrakeRunwayTable2: Record<number, [number, number, number]> = {
    1: [3180, 0.004582, -0.395175],
    2: [3180, 0.000351, -0.03216],
    3: [3180, -0.000263, 0.014135],
  };

  private static readonly vRSecondSegBrakeAltTable1: Record<number, [number, number, number, number]> = {
    1: [-0.000034, 0.001018, 0.000154, 0.415385],
    2: [-0.00001, -0.000253, 0.000328, -0.24493],
    3: [0.000017, -0.003017, 0.000398, -0.5117],
  };

  private static readonly vRSecondSegBrakeAltTable2: Record<number, [number, number, number, number]> = {
    1: [0.000574, -0.047508, 0.000154, 0.415385],
    2: [0.000253, -0.019907, 0.000328, -0.24493],
    3: [0.000247, -0.019502, 0.000398, -0.5117],
  };

  private static readonly vRSecondSegBrakeSlopeFactors: Record<number, [number, number]> = {
    1: [0.000293, -0.023877],
    2: [0.000309, -0.025884],
    3: [0.000049, -0.005035],
  };

  private static readonly vRSecondSegBrakeHeadwindFactors: Record<number, [number, number]> = {
    1: [0.00668, -0.30215],
    2: [0.015247, -0.946949],
    3: [0.028496, -1.808403],
  };

  private static readonly vRSecondSegBrakeTailwindFactors: Record<number, [number, number]> = {
    1: [0.014683, -0.347428],
    2: [0.019024, -0.725293],
    3: [-0.002393, 0.994507],
  };

  private static readonly v1SecondSegBrakeBaseTable1: Record<number, [number, number]> = {
    1: [0.580888, 111.076],
    2: [0.663598, 102.54],
    3: [0.112254, 147.272],
  };

  private static readonly v1SecondSegBrakeBaseTable2: Record<number, [number, number]> = {
    1: [0.460256, 104.849],
    2: [0.583566, 84.342],
    3: [0.527615, 95.085],
  };

  private static readonly v1SecondSegBrakeRunwayTable1: Record<number, [number, number, number]> = {
    1: [3180, -0.000218, -0.003633],
    2: [3180, -0.000473, 0.015987],
    3: [3180, 0.000017, -0.022792],
  };

  private static readonly v1SecondSegBrakeRunwayTable2: Record<number, [number, number, number]> = {
    1: [3180, 0.005044, -0.418865],
    2: [3180, 0.00052, -0.024703],
    3: [3180, 0.000688, -0.048497],
  };

  private static readonly v1SecondSegBrakeAltTable1: Record<number, [number, number, number, number]> = {
    1: [-0.000084, 0.00393, 0.000231, 0.123077],
    2: [-0.0000086, -0.000333, 0.000172, 0.347893],
    3: [0.000159, -0.012122, 0.000382, -0.452242],
  };

  private static readonly v1SecondSegBrakeAltTable2: Record<number, [number, number, number, number]> = {
    1: [0.000957, -0.077197, 0.000231, 0.123077],
    2: [0.000354, -0.025738, 0.000172, 0.347893],
    3: [0.000927, -0.072365, 0.000382, -0.452242],
  };

  private static readonly v1SecondSegBrakeSlopeFactors: Record<number, [number, number]> = {
    1: [0.00003, -0.001069],
    2: [0.00003, -0.001069],
    3: [0.0000431, -0.003239],
  };

  private static readonly v1SecondSegBrakeHeadwindFactors: Record<number, [number, number]> = {
    1: [0.019515, -1.23885],
    2: [0.019515, -1.23886],
    3: [0.065846, -4.365037],
  };

  private static readonly v1SecondSegBrakeTailwindFactors: Record<number, [number, number]> = {
    1: [0.032069, -1.44],
    2: [0.030147, -1.4286],
    3: [-0.001744, 1.0938],
  };

  // ============================================================================
  // WET RUNWAY ADJUSTMENTS
  // ============================================================================

  /**
   * Factors to determine the temperature above which we're VMCG limited on the wet runway.
   * Maps headwind component to TVMCG factors.
   */
  private static readonly tvmcgFactors: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [Vec2Math.create(0.06485, -99.47), -15],
      [Vec2Math.create(0.9895, -116.54), 0],
      [Vec2Math.create(0.13858, -171.15), 10],
    ]),
    2: new LerpVectorLookupTable([
      [Vec2Math.create(0.06573, -102.97), -15],
      [Vec2Math.create(0.10579, -132.96), 0],
      [Vec2Math.create(0.06575, -64.4), 10],
    ]),
    3: new LerpVectorLookupTable([
      [Vec2Math.create(0.07002, -106.62), -15],
      [Vec2Math.create(0.08804, -108.42), 0],
      [Vec2Math.create(0.07728, -82.08), 10],
    ]),
  };

  /**
   * Factors to determine the TOW adjustment on a wet runway when not VMCG limited.
   * Maps headwind component to adjustment factors.
   */
  private static readonly wetTowAdjustmentFactorsAtOrBelowTvmcg: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [VecNMath.create(0.05498, -126.98, 0.00903, -28.35), -15],
      [VecNMath.create(0.02391, -48.94, 0.00043, -1.64), 0],
      [VecNMath.create(0.01044, -21.53, 0.00022, -1.12), 10],
    ]),
    2: new LerpVectorLookupTable([
      [VecNMath.create(0.03856, -94.674, 0.00965, -30.09), -15],
      [VecNMath.create(0.02686, -48.63, -0.00011, -0.08), 0],
      [VecNMath.create(0.00057, -2.94, -0.00004, -0.13), 10],
    ]),
    3: new LerpVectorLookupTable([
      [VecNMath.create(0.01924, -57.58, 0, 0), -15],
      [VecNMath.create(0.02184, -44.91, -0.00019, 0.1), 0],
      [VecNMath.create(0.00057, -2.94, 0.00047, -1.6), 10],
    ]),
  };

  /**
   * Factors to determine the TOW adjustment on a wet runway when VMCG limited.
   * Maps headwind component to adjustment factors.
   */
  private static readonly wetTowAdjustmentFactorsAboveTvmcg: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [VecNMath.create(0.0197, -61.23, 0, 0), -15],
      [VecNMath.create(0.01887, -48.47, 0, 0), 0],
      [VecNMath.create(0.045, -86.32, 0, 0), 10],
    ]),
    2: new LerpVectorLookupTable([
      [VecNMath.create(0.01941, -60.02, 0, 0), -15],
      [VecNMath.create(0.02797, -61.99, 0, 0), 0],
      [VecNMath.create(0.03129, -63.61, 0, 0), 10],
    ]),
    3: new LerpVectorLookupTable([
      [VecNMath.create(0.01978, -61.43, 0, 0), -15],
      [VecNMath.create(0.02765, -61.88, 0, 0), 0],
      [VecNMath.create(0.03662, -72.45, 0, 0), 10],
    ]),
  };

  /**
   * Factors to determine the flex adjustment on a wet runway when not VMCG limited.
   * Maps headwind component to adjustment factors.
   */
  private static readonly wetFlexAdjustmentFactorsAtOrBelowTvmcg: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [VecNMath.create(0.07933, -190.57, 0.02074, -65.05), -15],
      [VecNMath.create(0.04331, -90.86, 0.00098, -3.88), 0],
      [VecNMath.create(0.0233, -48.8, 0.00072, -3.14), 10],
    ]),
    2: new LerpVectorLookupTable([
      [VecNMath.create(0.029, -89.9, 0.0099, -38.42), -15],
      [VecNMath.create(0.03845, -80.2, -1, 0), 0],
      [VecNMath.create(0.00167, -7.01, 0.000266, -1.61), 10],
    ]),
    3: new LerpVectorLookupTable([
      [VecNMath.create(0.03993, -94.09, 0, 0), -15],
      [VecNMath.create(0.03845, -80.2, -1, 0), 0],
      [VecNMath.create(0.00835, -18.34, -1, 0), 10],
    ]),
  };

  /**
   * Factors to determine the flex adjustment on a wet runway when VMCG limited.
   * Maps headwind component to adjustment factors.
   */
  private static readonly wetFlexAdjustmentFactorsAboveTvmcg: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [VecNMath.create(-0.03716, 31.85, 0.08618, -234.92), -15],
      [VecNMath.create(-0.05861, 51.01, 0.04322, -113.39), 0],
      [VecNMath.create(0.1012, -195.48, 0, 0), 10],
    ]),
    2: new LerpVectorLookupTable([
      [VecNMath.create(-0.0285, 19.43, 0.06951, -193.38), -15],
      [VecNMath.create(-0.04698, 37.58, 0.06438, -139.9), 0],
      [VecNMath.create(0.06159, -126.56, 0, 0), 10],
    ]),
    3: new LerpVectorLookupTable([
      [VecNMath.create(-0.0024, 4.25, -0.02118, 46.2), -15],
      [VecNMath.create(-0.02645, 9.81, 0.06116, -131.79), 0],
      [VecNMath.create(0.04841, -104.22, 0, 0), 10],
    ]),
  };

  /**
   * Factors to determine the V1 adjustment on a wet runway when not VMCG limited.
   * Maps headwind component to adjustment factors.
   */
  private static readonly wetV1AdjustmentFactorsAtOrBelowTvmcg: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [VecNMath.create(0.01428, -32.58, 0.00048, -2.03), -15],
      [VecNMath.create(-0.00786, 6.81, 0.00234, -14.23), 0],
      [VecNMath.create(-0.00246, -3.68, 0.00145, -11.32), 10],
    ]),
    2: new LerpVectorLookupTable([
      [VecNMath.create(-0.01563, 28.93, -0.00559, 6.36), -15],
      [VecNMath.create(-0.00474, 6.98, 0.0024, -13.2), 0],
      [VecNMath.create(0.00236, -11.92, 0, 0), 10],
    ]),
    3: new LerpVectorLookupTable([
      [VecNMath.create(-0.01018, 18.83, 0, 0), -15],
      [VecNMath.create(-0.00931, 10.01, 0.00017, -8.5), 0],
      [VecNMath.create(-0.00005, -7.98, 0, 0), 10],
    ]),
  };

  /**
   * Factors to determine the V1 adjustment on a wet runway when VMCG limited.
   * Maps headwind component to adjustment factors.
   */
  private static readonly wetV1AdjustmentFactorsAboveTvmcg: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [VecNMath.create(-0.00131, 0.91, -0.02013, 42.56), -15],
      [VecNMath.create(0.10383, -169.42, -0.00529, 6.73), 0],
      [VecNMath.create(-0.01594, 21.8, 0, 0), 10],
    ]),
    2: new LerpVectorLookupTable([
      [VecNMath.create(-0.00789, 15.29, 0, 0), -15],
      [VecNMath.create(-0.00971, 14, 0, 0), 0],
      [VecNMath.create(-0.00684, 8.43, 0, 0), 10],
    ]),
    3: new LerpVectorLookupTable([
      [VecNMath.create(-0.0024, 4.25, -0.02118, 46.2), -15],
      [VecNMath.create(-0.00727, 10.12, 0, 0), 0],
      [VecNMath.create(-0.00671, 8.65, -0.0333, 50.84), 10],
    ]),
  };

  /**
   * Factors to determine the Vr adjustment on a wet runway when not VMCG limited.
   * Maps headwind component to adjustment factors.
   */
  private static readonly wetVRAdjustmentFactorsAtOrBelowTvmcg: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [VecNMath.create(0.01428, -32.58, 0.00048, -2.03), -15],
      [VecNMath.create(0.00353, -7.19, 0.00022, -0.64), 0],
      [VecNMath.create(0.0022, -4.14, 0.00053, -1.54), 10],
    ]),
    2: new LerpVectorLookupTable([
      [VecNMath.create(0.00693, -16.96, -0.00559, 6.36), -15],
      [VecNMath.create(0.00864, -17.08, 0, 0), 0],
      [VecNMath.create(0, 0, 0, 0), 10],
    ]),
    3: new LerpVectorLookupTable([
      [VecNMath.create(0.00151, -6.16, 0, 0), -15],
      [VecNMath.create(-0.00557, -11.68, -0.0004, 0.54), 0],
      [VecNMath.create(-0.0001, -0.11, 0, 0), 10],
    ]),
  };

  /**
   * Factors to determine the V2 adjustment on a wet runway when not VMCG limited.
   * Maps headwind component to adjustment factors.
   */
  private static readonly wetV2AdjustmentFactorsAtOrBelowTvmcg: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [VecNMath.create(0.01936, -43.79, 0.000483, -2.03), -15],
      [VecNMath.create(0.00353, -7.19, 0.00022, -0.64), 0],
      [VecNMath.create(0.0022, -4.14, 0.00053, -1.54), 10],
    ]),
    2: new LerpVectorLookupTable([
      [VecNMath.create(0.01198, -28.31, 0, 0), -15],
      [VecNMath.create(0.00864, -17.08, 0, 0), 0],
      [VecNMath.create(0, 0, 0, 0), 10],
    ]),
    3: new LerpVectorLookupTable([
      [VecNMath.create(0.00246, -8.65, 0, 0), -15],
      [VecNMath.create(0.00114, -3.52, 0, 0), 0],
      [VecNMath.create(-0.0001, -0.11, 0, 0), 10],
    ]),
  };

  // ============================================================================
  // CONTAMINATED RUNWAY DATA - 6.3mm (1/4") WATER
  // All weights scaled by 6.48, speeds increased by +25 knots
  // ============================================================================

  /**
   * Weight Correction for runways contaminated with 6.3 mm/1/4" of water.
   * Maps runway length in metres to weight correction in kg.
   */
  private static readonly weightCorrectionContaminated6mmWater: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [97_200, 2_500],   // 15,000 * 6.48
      [93_312, 3_000],   // 14,400 * 6.48
      [68_040, 3_500],   // 10,500 * 6.48
      [44_064, 4_000],   // 6,800 * 6.48
    ]),
    2: new LerpLookupTable([
      [112_752, 2_000],  // 17,400 * 6.48
      [112_752, 2_500],
      [100_440, 3_000],  // 15,500 * 6.48
    ]),
    3: new LerpLookupTable([
      [121_176, 1_750],  // 18,700 * 6.48
      [121_176, 2_000],
      [112_752, 2_500],
    ]),
  };

  /** Minimum takeoff weight for each config on runways contaminated with 6.3 mm/1/4" of water */
  private static minCorrectedTowContaminated6mmWater: Record<number, number> = {
    1: 374_544,  // 57,800 * 6.48
    2: 368_064,  // 56,800 * 6.48
    3: 370_656,  // 57,200 * 6.48
  };

  /**
   * MTOW for runways contaminated with 6.3 mm/1/4" of water.
   * Maps corrected weight in kg to MTOW in kg.
   */
  private static readonly mtowContaminated6mmWater: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [308_448, 374_544],  // 47,600 * 6.48, 57,800 * 6.48
      [343_440, 382_320],  // 53,000 * 6.48, 59,000 * 6.48
      [393_336, 393_336],  // 60,700 * 6.48
      [512_000, 512_000],  // MTOW
    ]),
    2: new LerpLookupTable([
      [308_448, 368_064],
      [382_320, 382_320],
      [512_000, 512_000],
    ]),
    3: new LerpLookupTable([
      [308_448, 370_656],
      [362_880, 382_320],
      [387_504, 387_504],  // 59,800 * 6.48
      [512_000, 512_000],
    ]),
  };

  /**
   * V-Speeds for runways contaminated with 6.3 mm/1/4" of water.
   * Maps actual takeoff weight in kg to v1, vr, v2 in knots (+25 for A380).
   */
  private static readonly vSpeedsContaminated6mmWater: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [Vec3Math.create(147, 150, 152), 308_448],  // V+25, W*6.48
      [Vec3Math.create(147, 152, 154), 317_520],
      [Vec3Math.create(147, 158, 160), 349_920],
      [Vec3Math.create(147, 164, 166), 382_320],
      [Vec3Math.create(147, 166, 168), 393_336],
      [Vec3Math.create(151, 170, 172), 414_720],
      [Vec3Math.create(157, 176, 178), 447_120],
      [Vec3Math.create(162, 181, 183), 479_520],
      [Vec3Math.create(167, 186, 188), 512_000],
    ]),
    2: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 153, 154), 317_520],
      [Vec3Math.create(147, 159, 160), 349_920],
      [Vec3Math.create(147, 166, 167), 382_320],
      [Vec3Math.create(152, 171, 172), 414_720],
      [Vec3Math.create(158, 177, 178), 447_120],
      [Vec3Math.create(164, 183, 184), 479_520],
      [Vec3Math.create(169, 188, 189), 512_000],
    ]),
    3: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 151), 308_448],
      [Vec3Math.create(147, 153, 153), 317_520],
      [Vec3Math.create(147, 159, 159), 349_920],
      [Vec3Math.create(147, 165, 165), 382_320],
      [Vec3Math.create(147, 166, 166), 387_504],
      [Vec3Math.create(152, 171, 171), 414_720],
      [Vec3Math.create(158, 177, 177), 447_120],
      [Vec3Math.create(164, 183, 183), 479_520],
      [Vec3Math.create(169, 188, 188), 512_000],
    ]),
  };

  // ============================================================================
  // CONTAMINATED RUNWAY DATA - 12.7mm (1/2") WATER
  // ============================================================================

  private static readonly weightCorrectionContaminated13mmWater: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [121_176, 2_500],  // 18,700 * 6.48
      [113_400, 3_000],  // 17,500 * 6.48
      [88_128, 3_500],   // 13,600 * 6.48
      [62_856, 4_000],   // 9,700 * 6.48
    ]),
    2: new LerpLookupTable([
      [136_080, 2_000],  // 21,000 * 6.48
      [134_784, 2_500],  // 20,800 * 6.48
      [119_880, 3_000],  // 18,500 * 6.48
    ]),
    3: new LerpLookupTable([
      [141_912, 1_750],  // 21,900 * 6.48
      [141_912, 2_000],
      [132_840, 2_500],  // 20,500 * 6.48
    ]),
  };

  private static minCorrectedTowContaminated13mmWater: Record<number, number> = {
    1: 345_384,  // 53,300 * 6.48
    2: 345_384,
    3: 366_120,  // 56,500 * 6.48
  };

  private static readonly mtowContaminated13mmWater: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [308_448, 345_384],
      [330_480, 349_920],
      [355_104, 355_104],  // 54,800 * 6.48
      [512_000, 512_000],
    ]),
    2: new LerpLookupTable([
      [308_448, 345_384],
      [330_480, 349_920],
      [354_456, 354_456],  // 54,700 * 6.48
      [512_000, 512_000],
    ]),
    3: new LerpLookupTable([
      [308_448, 366_120],
      [382_320, 382_320],
      [512_000, 512_000],
    ]),
  };

  private static readonly vSpeedsContaminated13mmWater: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [Vec3Math.create(147, 150, 152), 308_448],
      [Vec3Math.create(147, 152, 154), 317_520],
      [Vec3Math.create(147, 158, 160), 349_920],
      [Vec3Math.create(147, 159, 161), 355_104],
      [Vec3Math.create(152, 164, 166), 382_320],
      [Vec3Math.create(158, 170, 172), 414_720],
      [Vec3Math.create(157, 176, 178), 447_120],
      [Vec3Math.create(169, 181, 183), 479_520],
      [Vec3Math.create(174, 186, 188), 512_000],
    ]),
    2: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 153, 154), 317_520],
      [Vec3Math.create(147, 159, 160), 349_920],
      [Vec3Math.create(147, 160, 161), 354_456],
      [Vec3Math.create(153, 166, 167), 382_320],
      [Vec3Math.create(158, 171, 172), 414_720],
      [Vec3Math.create(164, 177, 178), 447_120],
      [Vec3Math.create(170, 183, 184), 479_520],
      [Vec3Math.create(175, 188, 189), 512_000],
    ]),
    3: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 151), 308_448],
      [Vec3Math.create(147, 153, 153), 317_520],
      [Vec3Math.create(147, 159, 159), 349_920],
      [Vec3Math.create(147, 165, 165), 382_320],
      [Vec3Math.create(153, 171, 171), 414_720],
      [Vec3Math.create(159, 177, 177), 447_120],
      [Vec3Math.create(165, 183, 183), 479_520],
      [Vec3Math.create(170, 188, 188), 512_000],
    ]),
  };

  // ============================================================================
  // CONTAMINATED RUNWAY DATA - 6.3mm (1/4") SLUSH
  // ============================================================================

  private static readonly weightCorrectionContaminated6mmSlush: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [99_792, 2_500],   // 15,400 * 6.48
      [92_016, 3_000],   // 14,200 * 6.48
      [67_392, 3_500],   // 10,400 * 6.48
      [42_768, 4_000],   // 6,600 * 6.48
    ]),
    2: new LerpLookupTable([
      [115_992, 2_000],  // 17,900 * 6.48
      [115_344, 2_500],  // 17,800 * 6.48
      [100_440, 3_000],
    ]),
    3: new LerpLookupTable([
      [124_416, 1_750],  // 19,200 * 6.48
      [123_120, 2_000],  // 19,000 * 6.48
      [111_456, 2_500],  // 17,200 * 6.48
    ]),
  };

  private static minCorrectedTowContaminated6mmSlush: Record<number, number> = {
    1: 370_656,  // 57,200 * 6.48
    2: 364_176,  // 56,200 * 6.48
    3: 345_384,  // 53,300 * 6.48
  };

  private static readonly mtowContaminated6mmSlush: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [308_448, 370_656],
      [362_880, 382_320],
      [387_504, 387_504],
      [512_000, 512_000],
    ]),
    2: new LerpLookupTable([
      [308_448, 364_176],
      [362_880, 382_320],
      [512_000, 512_000],
    ]),
    3: new LerpLookupTable([
      [308_448, 345_384],
      [330_480, 349_920],
      [355_104, 355_104],
      [512_000, 512_000],
    ]),
  };

  private static readonly vSpeedsContaminated6mmSlush: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [Vec3Math.create(147, 150, 152), 308_448],
      [Vec3Math.create(147, 152, 154), 317_520],
      [Vec3Math.create(147, 158, 160), 349_920],
      [Vec3Math.create(152, 164, 166), 382_320],
      [Vec3Math.create(152, 165, 167), 387_504],
      [Vec3Math.create(152, 170, 172), 414_720],
      [Vec3Math.create(158, 176, 178), 447_120],
      [Vec3Math.create(163, 181, 183), 479_520],
      [Vec3Math.create(168, 186, 188), 512_000],
    ]),
    2: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 153, 154), 317_520],
      [Vec3Math.create(147, 159, 160), 349_920],
      [Vec3Math.create(147, 165, 166), 377_784],
      [Vec3Math.create(148, 166, 167), 382_320],
      [Vec3Math.create(153, 171, 172), 414_720],
      [Vec3Math.create(159, 177, 178), 447_120],
      [Vec3Math.create(165, 183, 184), 479_520],
      [Vec3Math.create(170, 188, 189), 512_000],
    ]),
    3: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 151), 308_448],
      [Vec3Math.create(147, 153, 153), 317_520],
      [Vec3Math.create(147, 159, 159), 349_920],
      [Vec3Math.create(147, 160, 160), 355_104],
      [Vec3Math.create(152, 165, 165), 382_320],
      [Vec3Math.create(158, 171, 171), 414_720],
      [Vec3Math.create(164, 177, 177), 447_120],
      [Vec3Math.create(170, 183, 183), 479_520],
      [Vec3Math.create(175, 188, 188), 512_000],
    ]),
  };

  // ============================================================================
  // CONTAMINATED RUNWAY DATA - 12.7mm (1/2") SLUSH
  // ============================================================================

  private static readonly weightCorrectionContaminated13mmSlush: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [125_712, 2_500],  // 19,400 * 6.48
      [115_344, 3_000],
      [88_776, 3_500],   // 13,700 * 6.48
      [64_800, 4_000],   // 10,000 * 6.48
    ]),
    2: new LerpLookupTable([
      [142_560, 2_000],  // 22,000 * 6.48
      [139_968, 2_500],  // 21,600 * 6.48
      [121_824, 3_000],  // 18,800 * 6.48
    ]),
    3: new LerpLookupTable([
      [117_936, 1_750],  // 18,200 * 6.48
      [146_448, 2_000],  // 22,600 * 6.48
      [135_432, 2_500],  // 20,900 * 6.48
    ]),
  };

  private static minCorrectedTowContaminated13mmSlush: Record<number, number> = {
    1: 340_848,  // 52,600 * 6.48
    2: 336_960,  // 52,000 * 6.48
    3: 336_960,
  };

  private static readonly mtowContaminated13mmSlush: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [308_448, 340_848],
      [349_920, 349_920],
      [512_000, 512_000],
    ]),
    2: new LerpLookupTable([
      [308_448, 336_960],
      [344_736, 344_736],  // 53,200 * 6.48
      [512_000, 512_000],
    ]),
    3: new LerpLookupTable([
      [308_448, 336_960],
      [344_736, 344_736],
      [512_000, 512_000],
    ]),
  };

  private static readonly vSpeedsContaminated13mmSlush: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 153, 154), 317_520],
      [Vec3Math.create(147, 159, 160), 349_920],
      [Vec3Math.create(153, 165, 166), 382_320],
      [Vec3Math.create(159, 171, 172), 414_720],
      [Vec3Math.create(165, 177, 178), 447_120],
      [Vec3Math.create(170, 182, 183), 479_520],
      [Vec3Math.create(175, 187, 188), 512_000],
    ]),
    2: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 153, 154), 317_520],
      [Vec3Math.create(147, 158, 159), 344_736],
      [Vec3Math.create(148, 159, 160), 349_920],
      [Vec3Math.create(155, 166, 167), 382_320],
      [Vec3Math.create(160, 171, 172), 414_720],
      [Vec3Math.create(166, 177, 178), 447_120],
      [Vec3Math.create(172, 183, 184), 479_520],
      [Vec3Math.create(177, 188, 189), 512_000],
    ]),
    3: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 151), 308_448],
      [Vec3Math.create(147, 153, 153), 317_520],
      [Vec3Math.create(147, 158, 158), 344_736],
      [Vec3Math.create(148, 159, 159), 349_920],
      [Vec3Math.create(154, 165, 165), 382_320],
      [Vec3Math.create(160, 171, 171), 414_720],
      [Vec3Math.create(166, 177, 177), 447_120],
      [Vec3Math.create(172, 183, 183), 479_520],
      [Vec3Math.create(177, 188, 188), 512_000],
    ]),
  };

  // ============================================================================
  // CONTAMINATED RUNWAY DATA - COMPACTED SNOW
  // ============================================================================

  private static readonly weightCorrectionContaminatedCompactedSnow: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [66_096, 2_500],   // 10,200 * 6.48
      [58_320, 3_000],   // 9,000 * 6.48
      [30_456, 3_500],   // 4,700 * 6.48
      [19_440, 4_000],   // 3,000 * 6.48
    ]),
    2: new LerpLookupTable([
      [86_184, 2_000],   // 13,300 * 6.48
      [82_296, 2_500],   // 12,700 * 6.48
      [66_744, 3_000],   // 10,300 * 6.48
    ]),
    3: new LerpLookupTable([
      [97_848, 1_750],   // 15,100 * 6.48
      [95_904, 2_000],   // 14,800 * 6.48
      [82_296, 2_500],
    ]),
  };

  private static minCorrectedTowContaminatedCompactedSnow: Record<number, number> = {
    1: 370_656,
    2: 364_176,
    3: 366_120,
  };

  private static readonly mtowContaminatedCompactedSnow: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [308_448, 370_656],
      [362_880, 382_320],
      [387_504, 387_504],
      [512_000, 512_000],
    ]),
    2: new LerpLookupTable([
      [308_448, 364_176],
      [377_784, 377_784],  // 58,300 * 6.48
      [512_000, 512_000],
    ]),
    3: new LerpLookupTable([
      [308_448, 366_120],
      [382_320, 382_320],
      [512_000, 512_000],
    ]),
  };

  private static readonly vSpeedsContaminatedCompactedSnow: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 153, 154), 317_520],
      [Vec3Math.create(147, 159, 160), 349_920],
      [Vec3Math.create(147, 165, 166), 382_320],
      [Vec3Math.create(147, 166, 167), 387_504],
      [Vec3Math.create(152, 171, 172), 414_720],
      [Vec3Math.create(158, 177, 178), 447_120],
      [Vec3Math.create(163, 182, 183), 479_520],
      [Vec3Math.create(168, 187, 188), 512_000],
    ]),
    2: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 153, 154), 317_520],
      [Vec3Math.create(147, 159, 160), 349_920],
      [Vec3Math.create(147, 165, 166), 377_784],
      [Vec3Math.create(148, 166, 167), 382_320],
      [Vec3Math.create(153, 171, 172), 414_720],
      [Vec3Math.create(159, 177, 178), 447_120],
      [Vec3Math.create(165, 183, 184), 479_520],
      [Vec3Math.create(170, 188, 189), 512_000],
    ]),
    3: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 151), 308_448],
      [Vec3Math.create(147, 153, 153), 317_520],
      [Vec3Math.create(147, 159, 159), 349_920],
      [Vec3Math.create(147, 165, 165), 382_320],
      [Vec3Math.create(153, 171, 171), 414_720],
      [Vec3Math.create(159, 177, 177), 447_120],
      [Vec3Math.create(165, 183, 183), 479_520],
      [Vec3Math.create(170, 188, 188), 512_000],
    ]),
  };

  // ============================================================================
  // CONTAMINATED RUNWAY DATA - 5mm (1/5") WET SNOW
  // ============================================================================

  private static readonly weightCorrectionContaminated5mmWetSnow: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [73_872, 2_500],   // 11,400 * 6.48
      [68_040, 3_000],   // 10,500 * 6.48
      [38_880, 3_500],   // 6,000 * 6.48
      [19_440, 4_000],   // 3,000 * 6.48
    ]),
    2: new LerpLookupTable([
      [97_200, 2_000],   // 15,000 * 6.48
      [92_016, 2_500],   // 14,200 * 6.48
      [77_112, 3_000],   // 11,900 * 6.48
    ]),
    3: new LerpLookupTable([
      [113_400, 1_750],  // 17,500 * 6.48
      [110_808, 2_000],  // 17,100 * 6.48
      [92_664, 2_500],   // 14,300 * 6.48
    ]),
  };

  private static minCorrectedTowContaminated5mmWetSnow: Record<number, number> = {
    1: 366_120,  // 56,500 * 6.48
    2: 371_952,  // 57,400 * 6.48
    3: 374_544,  // 57,800 * 6.48
  };

  private static readonly mtowContaminated5mmWetSnow: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [308_448, 366_120],
      [382_320, 382_320],
      [512_000, 512_000],
    ]),
    2: new LerpLookupTable([
      [308_448, 371_952],
      [362_880, 382_320],
      [388_800, 388_800],  // 60,000 * 6.48
      [512_000, 512_000],
    ]),
    3: new LerpLookupTable([
      [308_448, 374_544],
      [343_440, 382_320],
      [393_336, 393_336],  // 60,700 * 6.48
      [512_000, 512_000],
    ]),
  };

  private static readonly vSpeedsContaminated5mmWetSnow: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 153, 154), 317_520],
      [Vec3Math.create(147, 159, 160), 349_920],
      [Vec3Math.create(147, 165, 166), 382_320],
      [Vec3Math.create(153, 171, 172), 414_720],
      [Vec3Math.create(159, 177, 178), 447_120],
      [Vec3Math.create(164, 182, 183), 479_520],
      [Vec3Math.create(169, 187, 188), 512_000],
    ]),
    2: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 153, 154), 317_520],
      [Vec3Math.create(147, 159, 160), 349_920],
      [Vec3Math.create(147, 166, 167), 382_320],
      [Vec3Math.create(147, 167, 168), 388_800],
      [Vec3Math.create(151, 171, 172), 414_720],
      [Vec3Math.create(157, 177, 178), 447_120],
      [Vec3Math.create(163, 183, 184), 479_520],
      [Vec3Math.create(168, 188, 189), 512_000],
    ]),
    3: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 151), 308_448],
      [Vec3Math.create(147, 153, 153), 317_520],
      [Vec3Math.create(147, 159, 159), 349_920],
      [Vec3Math.create(147, 165, 165), 382_320],
      [Vec3Math.create(147, 167, 167), 393_336],
      [Vec3Math.create(151, 171, 171), 414_720],
      [Vec3Math.create(157, 177, 177), 447_120],
      [Vec3Math.create(163, 183, 183), 479_520],
      [Vec3Math.create(168, 188, 188), 512_000],
    ]),
  };

  // ============================================================================
  // CONTAMINATED RUNWAY DATA - 15mm (3/5") WET SNOW
  // ============================================================================

  private static readonly weightCorrectionContaminated15mmWetSnow: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [105_624, 2_500],  // 16,300 * 6.48
      [96_552, 3_000],   // 14,900 * 6.48
      [70_632, 3_500],   // 10,900 * 6.48
      [46_008, 4_000],   // 7,100 * 6.48
    ]),
    2: new LerpLookupTable([
      [123_120, 2_000],  // 19,000 * 6.48
      [121_176, 2_500],  // 18,700 * 6.48
      [104_328, 3_000],  // 16,100 * 6.48
    ]),
    3: new LerpLookupTable([
      [130_896, 1_750],  // 20,200 * 6.48
      [129_600, 2_000],  // 20,000 * 6.48
      [117_288, 2_500],  // 18,100 * 6.48
    ]),
  };

  private static minCorrectedTowContaminated15mmWetSnow: Record<number, number> = {
    1: 349_272,  // 53,900 * 6.48
    2: 345_384,  // 53,300 * 6.48
    3: 345_384,
  };

  private static readonly mtowContaminated15mmWetSnow: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [308_448, 349_272],
      [311_040, 349_920],  // 48,000 * 6.48, 54,000 * 6.48
      [360_936, 360_936],  // 55,700 * 6.48
      [512_000, 512_000],
    ]),
    2: new LerpLookupTable([
      [308_448, 345_384],
      [330_480, 349_920],
      [354_456, 354_456],  // 54,700 * 6.48
      [512_000, 512_000],
    ]),
    3: new LerpLookupTable([
      [308_448, 345_384],
      [330_480, 349_920],
      [355_104, 355_104],  // 54,800 * 6.48
      [512_000, 512_000],
    ]),
  };

  private static readonly vSpeedsContaminated15mmWetSnow: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 153, 154), 317_520],
      [Vec3Math.create(147, 159, 160), 349_920],
      [Vec3Math.create(147, 161, 162), 360_936],
      [Vec3Math.create(151, 165, 166), 382_320],
      [Vec3Math.create(157, 171, 172), 414_720],
      [Vec3Math.create(163, 177, 178), 447_120],
      [Vec3Math.create(168, 182, 183), 479_520],
      [Vec3Math.create(173, 187, 188), 512_000],
    ]),
    2: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 153, 154), 317_520],
      [Vec3Math.create(147, 159, 160), 349_920],
      [Vec3Math.create(147, 160, 161), 354_456],
      [Vec3Math.create(153, 166, 167), 382_320],
      [Vec3Math.create(158, 171, 172), 414_720],
      [Vec3Math.create(164, 177, 178), 447_120],
      [Vec3Math.create(170, 183, 184), 479_520],
      [Vec3Math.create(175, 188, 189), 512_000],
    ]),
    3: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 151), 308_448],
      [Vec3Math.create(147, 153, 153), 317_520],
      [Vec3Math.create(147, 159, 159), 349_920],
      [Vec3Math.create(147, 160, 160), 355_104],
      [Vec3Math.create(152, 165, 165), 382_320],
      [Vec3Math.create(158, 171, 171), 414_720],
      [Vec3Math.create(164, 177, 177), 447_120],
      [Vec3Math.create(170, 183, 183), 479_520],
      [Vec3Math.create(175, 188, 188), 512_000],
    ]),
  };

  // ============================================================================
  // CONTAMINATED RUNWAY DATA - 30mm (6/5") WET SNOW
  // ============================================================================

  private static readonly weightCorrectionContaminated30mmWetSnow: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [149_040, 2_500],  // 23,000 * 6.48
      [136_728, 3_000],  // 21,100 * 6.48
      [124_416, 3_500],  // 19,200 * 6.48
      [124_416, 4_000],
    ]),
    2: new LerpLookupTable([
      [160_056, 2_000],  // 24,700 * 6.48
      [158_112, 2_500],  // 24,400 * 6.48
      [145_152, 3_000],  // 22,400 * 6.48
    ]),
    3: new LerpLookupTable([
      [163_296, 1_750],  // 25,200 * 6.48
      [162_000, 2_000],  // 25,000 * 6.48
      [153_576, 2_500],  // 23,700 * 6.48
    ]),
  };

  private static minCorrectedTowContaminated30mmWetSnow: Record<number, number> = {
    1: 311_688,  // 48,100 * 6.48
    2: 308_448,  // 47,600 * 6.48
    3: 308_448,
  };

  private static readonly mtowContaminated30mmWetSnow: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [308_448, 311_688],
      [313_104, 313_104],  // 48,300 * 6.48
      [512_000, 512_000],
    ]),
    2: new LerpLookupTable([
      [308_448, 308_448],
      [512_000, 512_000],
    ]),
    3: new LerpLookupTable([
      [308_448, 308_448],
      [512_000, 512_000],
    ]),
  };

  private static readonly vSpeedsContaminated30mmWetSnow: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 152, 153), 313_104],
      [Vec3Math.create(148, 153, 154), 317_520],
      [Vec3Math.create(155, 159, 160), 349_920],
      [Vec3Math.create(162, 166, 167), 382_320],
      [Vec3Math.create(167, 171, 172), 414_720],
      [Vec3Math.create(173, 177, 178), 447_120],
      [Vec3Math.create(179, 183, 184), 479_520],
      [Vec3Math.create(184, 188, 189), 512_000],
    ]),
    2: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(149, 153, 154), 317_520],
      [Vec3Math.create(155, 159, 160), 349_920],
      [Vec3Math.create(162, 166, 167), 382_320],
      [Vec3Math.create(167, 171, 172), 414_720],
      [Vec3Math.create(173, 177, 178), 447_120],
      [Vec3Math.create(179, 183, 184), 479_520],
      [Vec3Math.create(184, 188, 189), 512_000],
    ]),
    3: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 151), 308_448],
      [Vec3Math.create(149, 153, 153), 317_520],
      [Vec3Math.create(155, 159, 159), 349_920],
      [Vec3Math.create(161, 165, 165), 382_320],
      [Vec3Math.create(167, 171, 171), 414_720],
      [Vec3Math.create(173, 177, 177), 447_120],
      [Vec3Math.create(179, 183, 183), 479_520],
      [Vec3Math.create(184, 188, 188), 512_000],
    ]),
  };

  // ============================================================================
  // CONTAMINATED RUNWAY DATA - 10mm (2/5") DRY SNOW
  // ============================================================================

  private static readonly weightCorrectionContaminated10mmDrySnow: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [73_872, 2_500],
      [68_040, 3_000],
      [38_880, 3_500],
      [19_440, 4_000],
    ]),
    2: new LerpLookupTable([
      [97_200, 2_000],
      [92_016, 2_500],
      [76_464, 3_000],  // 11,800 * 6.48
    ]),
    3: new LerpLookupTable([
      [113_400, 1_750],
      [110_808, 2_000],
      [92_664, 2_500],
    ]),
  };

  private static minCorrectedTowContaminated10mmDrySnow: Record<number, number> = {
    1: 366_120,
    2: 371_952,
    3: 374_544,
  };

  private static readonly mtowContaminated10mmDrySnow: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [308_448, 366_120],
      [382_320, 382_320],
      [512_000, 512_000],
    ]),
    2: new LerpLookupTable([
      [308_448, 371_952],
      [362_880, 382_320],
      [388_800, 388_800],
      [512_000, 512_000],
    ]),
    3: new LerpLookupTable([
      [308_448, 374_544],
      [343_440, 382_320],
      [393_336, 393_336],
      [512_000, 512_000],
    ]),
  };

  private static readonly vSpeedsContaminated10mmDrySnow: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 153, 154), 317_520],
      [Vec3Math.create(147, 159, 160), 349_920],
      [Vec3Math.create(147, 165, 166), 382_320],
      [Vec3Math.create(153, 171, 172), 414_720],
      [Vec3Math.create(159, 177, 178), 447_120],
      [Vec3Math.create(164, 182, 183), 479_520],
      [Vec3Math.create(169, 187, 188), 512_000],
    ]),
    2: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 153, 154), 317_520],
      [Vec3Math.create(147, 159, 160), 349_920],
      [Vec3Math.create(147, 166, 167), 382_320],
      [Vec3Math.create(147, 167, 168), 388_800],
      [Vec3Math.create(151, 171, 172), 414_720],
      [Vec3Math.create(157, 177, 178), 447_120],
      [Vec3Math.create(163, 183, 184), 479_520],
      [Vec3Math.create(168, 188, 189), 512_000],
    ]),
    3: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 151), 308_448],
      [Vec3Math.create(147, 153, 153), 317_520],
      [Vec3Math.create(147, 159, 159), 349_920],
      [Vec3Math.create(147, 165, 165), 382_320],
      [Vec3Math.create(147, 167, 167), 393_336],
      [Vec3Math.create(151, 171, 171), 414_720],
      [Vec3Math.create(157, 177, 177), 447_120],
      [Vec3Math.create(163, 183, 183), 479_520],
      [Vec3Math.create(168, 188, 188), 512_000],
    ]),
  };

  // ============================================================================
  // CONTAMINATED RUNWAY DATA - 100mm (4") DRY SNOW
  // ============================================================================

  private static readonly weightCorrectionContaminated100mmDrySnow: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [125_064, 2_500],  // 19,300 * 6.48
      [127_008, 3_000],  // 19,600 * 6.48
      [113_400, 3_500],  // 17,500 * 6.48
      [102_384, 4_000],  // 15,800 * 6.48
    ]),
    2: new LerpLookupTable([
      [136_728, 2_000],  // 21,100 * 6.48
      [142_560, 2_500],  // 22,000 * 6.48
      [138_672, 3_000],  // 21,400 * 6.48
    ]),
    3: new LerpLookupTable([
      [143_208, 1_750],  // 22,100 * 6.48
      [144_504, 2_000],  // 22,300 * 6.48
      [141_264, 2_500],  // 21,800 * 6.48
    ]),
  };

  private static minCorrectedTowContaminated100mmDrySnow: Record<number, number> = {
    1: 315_576,  // 48,700 * 6.48
    2: 313_104,  // 48,300 * 6.48
    3: 315_576,
  };

  private static readonly mtowContaminated100mmDrySnow: Record<number, LerpLookupTable> = {
    1: new LerpLookupTable([
      [308_448, 315_576],
      [317_520, 317_520],  // 49,000 * 6.48
      [512_000, 512_000],
    ]),
    2: new LerpLookupTable([
      [308_448, 311_688],  // 48,100 * 6.48
      [313_104, 313_104],
      [512_000, 512_000],
    ]),
    3: new LerpLookupTable([
      [308_448, 315_576],
      [317_520, 317_520],
      [512_000, 512_000],
    ]),
  };

  private static readonly vSpeedsContaminated100mmDrySnow: Record<number, LerpVectorLookupTable> = {
    1: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 153, 154), 317_520],
      [Vec3Math.create(153, 159, 160), 349_920],
      [Vec3Math.create(159, 165, 166), 382_320],
      [Vec3Math.create(165, 171, 172), 414_720],
      [Vec3Math.create(171, 177, 178), 447_120],
      [Vec3Math.create(176, 182, 183), 479_520],
      [Vec3Math.create(181, 187, 188), 512_000],
    ]),
    2: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 152), 308_448],
      [Vec3Math.create(147, 152, 153), 313_104],
      [Vec3Math.create(148, 153, 154), 317_520],
      [Vec3Math.create(154, 159, 160), 349_920],
      [Vec3Math.create(161, 166, 167), 382_320],
      [Vec3Math.create(166, 171, 172), 414_720],
      [Vec3Math.create(172, 177, 178), 447_120],
      [Vec3Math.create(178, 183, 184), 479_520],
      [Vec3Math.create(183, 188, 189), 512_000],
    ]),
    3: new LerpVectorLookupTable([
      [Vec3Math.create(147, 151, 151), 308_448],
      [Vec3Math.create(147, 153, 153), 317_520],
      [Vec3Math.create(153, 159, 159), 349_920],
      [Vec3Math.create(159, 165, 165), 382_320],
      [Vec3Math.create(165, 171, 171), 414_720],
      [Vec3Math.create(171, 177, 177), 447_120],
      [Vec3Math.create(177, 183, 183), 479_520],
      [Vec3Math.create(182, 188, 188), 512_000],
    ]),
  };

  // ============================================================================
  // PUBLIC METHODS - CROSSWIND LIMITS
  // ============================================================================

  public getCrosswindLimit(runwayCondition: RunwayCondition, oat: number): number {
    switch (runwayCondition) {
      case RunwayCondition.Dry:
      case RunwayCondition.Wet:
        return 35; // knots (may be higher for A380 - verify with AFM)
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

  // ============================================================================
  // PUBLIC METHODS - CG LIMITS CHECK
  // ============================================================================

  /**
   * Check if CG is within A380-842 takeoff limits
   * A380-842 CG range: 29% to 43% MAC (from config file)
   */
  public isCgWithinLimits(cg: number, tow: number): boolean {
    const cgLimits = A380842TakeoffPerformanceCalculator.takeoffCgLimits.get(
      A380842TakeoffPerformanceCalculator.vec2Cache,
      tow,
    );
    return cg >= cgLimits[0] && cg <= cgLimits[1];
  }

  // ============================================================================
  // PRIVATE METHODS - INPUT VALIDATION
  // ============================================================================

  private checkInputs(
    inputs: TakeoffPerformanceInputs, 
    params: TakeoffPerformanceParameters
  ): TakeoffPerfomanceError {
    // Check configuration (1, 2 or 3)
    if (inputs.conf !== 1 && inputs.conf !== 2 && inputs.conf !== 3) {
      return TakeoffPerfomanceError.InvalidData;
    }
    
    // Check TOW does not exceed MTOW
    if (inputs.tow > this.structuralMtow) {
      return TakeoffPerfomanceError.StructuralMtow;
    }
    
    // Check pressure altitude
    if (params.pressureAlt > this.maxPressureAlt) {
      return TakeoffPerfomanceError.MaximumPressureAlt;
    }
    
    // Check temperature
    if (inputs.oat > params.tMax) {
      return TakeoffPerfomanceError.MaximumTemperature;
    }
    
    // Check minimum weight (not less than OEW)
    if (inputs.tow < this.oew) {
      return TakeoffPerfomanceError.OperatingEmptyWeight;
    }
    
    // Check CG (if provided)
    if (inputs.cg !== undefined && !this.isCgWithinLimits(inputs.cg, inputs.tow)) {
      return TakeoffPerfomanceError.CgOutOfLimits;
    }
    
    // Check tailwind
    if (inputs.wind < -this.maxTailwind) {
      return TakeoffPerfomanceError.MaximumTailwind;
    }
    
    // Check runway slope (max ±2%)
    if (Math.abs(inputs.slope) > 2) {
      return TakeoffPerfomanceError.MaximumRunwaySlope;
    }

    return TakeoffPerfomanceError.None;
  }

  private isContaminated(runwayCondition: RunwayCondition): boolean {
    return runwayCondition !== RunwayCondition.Dry && runwayCondition !== RunwayCondition.Wet;
  }

// ============================================================================
  // MAIN CALCULATION METHOD
  // ============================================================================

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
        const factors: ReadonlyFloat64Array = (
          result.inputs.oat > result.tvmcg
            ? A380842TakeoffPerformanceCalculator.wetTowAdjustmentFactorsAboveTvmcg
            : A380842TakeoffPerformanceCalculator.wetTowAdjustmentFactorsAtOrBelowTvmcg
        )[result.inputs.conf].get(A380842TakeoffPerformanceCalculator.vec4Cache, result.params.headwind);

        const lengthAltCoef = result.params.adjustedTora - result.params.pressureAlt / 20;
        const wetMtowAdjustment = Math.min(
          0,
          factors[0] * lengthAltCoef + factors[1],
          factors[2] * lengthAltCoef + factors[3],
        );
        mtow = dryMtow - wetMtowAdjustment;
      } else {
        // Contaminated runway
        mtow = this.calculateContaminatedMtow(result, dryMtow);
      }
      
      result.mtow = Math.min(mtow, this.structuralMtow);

      const applyForwardCgWeightCorrection =
        forwardCg &&
        (result.oatLimitingFactor === LimitingFactor.Runway || result.oatLimitingFactor === LimitingFactor.Vmcg);
      const applyForwardCgSpeedCorrection = applyForwardCgWeightCorrection && mtow <= 473_040; // 73,000 * 6.48

      if (applyForwardCgWeightCorrection) {
        const cgFactors = A380842TakeoffPerformanceCalculator.cgFactors[conf];
        mtow += Math.max(0, cgFactors[0] * mtow + cgFactors[1]);
      }

      if (mtow >= tow) {
        result.flex = undefined;

        let needVSpeedCalculated = true;
        if (forceToga) {
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

  // ============================================================================
  // TEMPERATURE CALCULATION METHODS
  // ============================================================================

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
   * Get the Tmax temperature from pressure altitude.
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

  /**
   * Calculate pressure altitude from elevation and QNH.
   * @param elevation Field elevation in feet.
   * @param qnh QNH in hectopascals.
   * @returns Pressure altitude in feet.
   */
  private calculatePressureAltitude(elevation: number, qnh: number): number {
    return elevation + 145442.15 * (1 - (qnh / 1013.25) ** 0.190263);
  }

  /**
   * Calculate TVMCG temperature for wet runway.
   * @param inputs Takeoff inputs.
   * @param params Takeoff parameters.
   * @returns TVMCG temperature in °C.
   */
  private calculateTvmcg(inputs: TakeoffPerformanceInputs, params: TakeoffPerformanceParameters): number {
    const factors: LerpVectorLookupTable = A380842TakeoffPerformanceCalculator.tvmcgFactors[inputs.conf];
    const [factor1, factor2] = factors.get(
      A380842TakeoffPerformanceCalculator.vec2Cache,
      Math.max(params.headwind, -15),
    );
    return factor1 * (params.adjustedTora - params.pressureAlt / 10) + factor2;
  }

  /**
   * Calculate stabilizer trim setting for A380.
   * A380 CG range: 29% to 43% MAC
   * @param cg Center of gravity in % MAC.
   * @returns Stabilizer trim setting.
   */
  private calculateStabTrim(cg: number): number {
    // Linear interpolation from +3.8 at CG=29% to -2.5 at CG=43%
    return MathUtils.round(
      MathUtils.lerp(cg, 29, 43, 3.8, -2.5, true, true), 
      0.1
    );
  }

  // ============================================================================
  // WEIGHT LIMITS CALCULATION
  // ============================================================================

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

    // Base weight limits at sea level, ISA etc.
    if (limitingFactor === LimitingFactor.Runway) {
      weights.baseLimit = this.calculateBaseRunwayPerfLimit(result.params.adjustedTora, result.inputs.conf);
    } else {
      if (!baseFactors) {
        throw new Error('Missing base factors!');
      }
      weights.baseLimit = this.calculateBaseLimit(result.params.adjustedTora, result.inputs.conf, baseFactors);
    }

    // Correction for runway slope (downhill = increased weight limit)
    weights.deltaSlope = 1000 * slopeFactors[result.inputs.conf] * result.params.adjustedTora * result.inputs.slope;
    weights.slopeLimit = weights.baseLimit - weights.deltaSlope;

    // Correction for pressure altitude
    const [altFactor1, altFactor2] = altFactors[result.inputs.conf];
    weights.deltaAlt = 1000 * result.params.pressureAlt * (result.params.pressureAlt * altFactor1 + altFactor2);
    weights.altLimit = weights.slopeLimit - weights.deltaAlt;

    // Correction for bleeds
    const deltaBleed =
      (result.inputs.antiIce === TakeoffAntiIceSetting.EngineWing ? 10_368 : 0) + // 1,600 * 6.48
      (result.inputs.packs ? 9_720 : 0); // 1,500 * 6.48

    // Correction for air temperature and wind
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

  /**
   * Determine which factor is limiting the takeoff weight most for a given temperature.
   * @param temp The temperature limit to check.
   * @param result The partially calculated result.
   * @returns The most limiting factor.
   */
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

    // ============================================================================
  // TEMPERATURE DELTA CALCULATIONS
  // ============================================================================

  /** Calculates the runway performance temperature correction in kg. */
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

  /** Calculates the second segment temperature correction in kg. */
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

  /** Calculates the brake energy temperature correction in kg. */
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
    // No correction above Tmax
    return weightDelta;
  }

  /** Calculates the VMCG temperature correction in kg. */
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

  // ============================================================================
  // WIND DELTA CALCULATIONS
  // ============================================================================

  /** Calculates the runway performance wind correction in kg, -ve is a positive increment on the limit weight. */
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

    // Cover edge case near the ends of the data
    if (Math.sign(weightDelta) === Math.sign(wind)) {
      return 0;
    }
    return weightDelta;
  }

  /** Calculates the second segment wind correction in kg. */
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

  /** Calculates the brake energy wind correction in kg. */
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

  /** Calculates the VMCG wind correction in kg. */
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

  // ============================================================================
  // CONTAMINATED RUNWAY MTOW CALCULATION
  // ============================================================================

  private calculateContaminatedMtow(
    result: Partial<TakeoffPerformanceResult>,
    dryMtow: number,
  ): number {
    if (!result.inputs || !result.params) {
      throw new Error('Invalid result object!');
    }

    let correctionFactors: Record<number, LerpLookupTable>;
    let mtowFactors: Record<number, LerpLookupTable>;
    let minCorrectedWeight: Record<number, number>;

    switch (result.inputs.runwayCondition) {
      case RunwayCondition.Contaminated6mmWater:
        correctionFactors = A380842TakeoffPerformanceCalculator.weightCorrectionContaminated6mmWater;
        mtowFactors = A380842TakeoffPerformanceCalculator.mtowContaminated6mmWater;
        minCorrectedWeight = A380842TakeoffPerformanceCalculator.minCorrectedTowContaminated6mmWater;
        break;
      case RunwayCondition.Contaminated13mmWater:
        correctionFactors = A380842TakeoffPerformanceCalculator.weightCorrectionContaminated13mmWater;
        mtowFactors = A380842TakeoffPerformanceCalculator.mtowContaminated13mmWater;
        minCorrectedWeight = A380842TakeoffPerformanceCalculator.minCorrectedTowContaminated13mmWater;
        break;
      case RunwayCondition.Contaminated6mmSlush:
        correctionFactors = A380842TakeoffPerformanceCalculator.weightCorrectionContaminated6mmSlush;
        mtowFactors = A380842TakeoffPerformanceCalculator.mtowContaminated6mmSlush;
        minCorrectedWeight = A380842TakeoffPerformanceCalculator.minCorrectedTowContaminated6mmSlush;
        break;
      case RunwayCondition.Contaminated13mmSlush:
        correctionFactors = A380842TakeoffPerformanceCalculator.weightCorrectionContaminated13mmSlush;
        mtowFactors = A380842TakeoffPerformanceCalculator.mtowContaminated13mmSlush;
        minCorrectedWeight = A380842TakeoffPerformanceCalculator.minCorrectedTowContaminated13mmSlush;
        break;
      case RunwayCondition.ContaminatedCompactedSnow:
        correctionFactors = A380842TakeoffPerformanceCalculator.weightCorrectionContaminatedCompactedSnow;
        mtowFactors = A380842TakeoffPerformanceCalculator.mtowContaminatedCompactedSnow;
        minCorrectedWeight = A380842TakeoffPerformanceCalculator.minCorrectedTowContaminatedCompactedSnow;
        break;
      case RunwayCondition.Contaminated5mmWetSnow:
        correctionFactors = A380842TakeoffPerformanceCalculator.weightCorrectionContaminated5mmWetSnow;
        mtowFactors = A380842TakeoffPerformanceCalculator.mtowContaminated5mmWetSnow;
        minCorrectedWeight = A380842TakeoffPerformanceCalculator.minCorrectedTowContaminated5mmWetSnow;
        break;
      case RunwayCondition.Contaminated15mmWetSnow:
        correctionFactors = A380842TakeoffPerformanceCalculator.weightCorrectionContaminated15mmWetSnow;
        mtowFactors = A380842TakeoffPerformanceCalculator.mtowContaminated15mmWetSnow;
        minCorrectedWeight = A380842TakeoffPerformanceCalculator.minCorrectedTowContaminated15mmWetSnow;
        break;
      case RunwayCondition.Contaminated30mmWetSnow:
        correctionFactors = A380842TakeoffPerformanceCalculator.weightCorrectionContaminated30mmWetSnow;
        mtowFactors = A380842TakeoffPerformanceCalculator.mtowContaminated30mmWetSnow;
        minCorrectedWeight = A380842TakeoffPerformanceCalculator.minCorrectedTowContaminated30mmWetSnow;
        break;
      case RunwayCondition.Contaminated10mmDrySnow:
        correctionFactors = A380842TakeoffPerformanceCalculator.weightCorrectionContaminated10mmDrySnow;
        mtowFactors = A380842TakeoffPerformanceCalculator.mtowContaminated10mmDrySnow;
        minCorrectedWeight = A380842TakeoffPerformanceCalculator.minCorrectedTowContaminated10mmDrySnow;
        break;
      case RunwayCondition.Contaminated100mmDrySnow:
        correctionFactors = A380842TakeoffPerformanceCalculator.weightCorrectionContaminated100mmDrySnow;
        mtowFactors = A380842TakeoffPerformanceCalculator.mtowContaminated100mmDrySnow;
        minCorrectedWeight = A380842TakeoffPerformanceCalculator.minCorrectedTowContaminated100mmDrySnow;
        break;
      default:
        throw new Error('Invalid runway condition');
    }

    const correctedWeight = dryMtow - correctionFactors[result.inputs.conf].get(result.params.adjustedTora);
    const mtow = mtowFactors[result.inputs.conf].get(correctedWeight);

    const minimumTow = minCorrectedWeight[result.inputs.conf];
    if (correctedWeight < minimumTow) {
      result.error = TakeoffPerfomanceError.TooLight;
    }

    return mtow;
  }

  // ============================================================================
  // FLEX TEMPERATURE CALCULATION
  // ============================================================================

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

    // We can use flex if TOW is below the tRef limit weight
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

        if (result.inputs.runwayCondition === RunwayCondition.Wet) {
          const factors: ReadonlyFloat64Array = (
            result.inputs.oat > tvmcg
              ? A380842TakeoffPerformanceCalculator.wetFlexAdjustmentFactorsAboveTvmcg
              : A380842TakeoffPerformanceCalculator.wetFlexAdjustmentFactorsAtOrBelowTvmcg
          )[result.inputs.conf].get(A380842TakeoffPerformanceCalculator.vec4Cache, result.params.headwind);

          const lengthAltCoef = result.params.adjustedTora - result.params.pressureAlt / 20;
          const wetFlexAdjustment = Math.min(
            0,
            factors[0] * lengthAltCoef + factors[1],
            factors[2] * lengthAltCoef + factors[3],
          );
          flexTemp -= wetFlexAdjustment;
        }

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

// To be continued - Part 9 (FINAL): V-speed calculations and utility methods...
