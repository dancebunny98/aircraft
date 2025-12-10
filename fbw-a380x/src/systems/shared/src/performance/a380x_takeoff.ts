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

// To be continued - Part 5: Contaminated runway data...
