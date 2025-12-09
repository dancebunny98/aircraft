// Copyright (c) 2024 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

// Data and calculations obtained from Quick Reference Handbook (In Flight Procedures, Landing Performance Assessment/Landing Distance)
// NOTE: This is a placeholder implementation. The performance tables need to be populated with actual A380-842 data.

import {
  AutobrakeMode,
  LandingPerformanceCalculator,
  LandingFlapsConfig,
  LandingRunwayConditions,
} from '@flybywiresim/fbw-sdk';

/**
 * Landing data for a specific aircraft configuration with a specific runway condition
 */
type LandingData = {
  refDistance: number;
  weightCorrectionAbove: number; // per 1T above reference weight
  weightCorrectionBelow: number; // per 1T below reference weight
  speedCorrection: number; // Per 5kt
  altitudeCorrection: number; // Per 1000ft ASL
  windCorrection: number; // Per 5KT tail wind
  tempCorrection: number; // Per 10 deg C above ISA
  slopeCorrection: number; // Per 1% down slope
  reverserCorrection: number; // Per thrust reverser operative
  overweightProcedureCorrection: number; // If overweight procedure applied
};

type FlapsConfigLandingData = {
  [flapsConfig in LandingFlapsConfig]: LandingData;
};

type AutobrakeConfigLandingData = {
  [autobrakeConfig in AutobrakeMode]: FlapsConfigLandingData;
};

type RunwayConditionLandingData = {
  [runwayCondition in LandingRunwayConditions]: AutobrakeConfigLandingData;
};

// Reference weight for A380X landing performance calculations (in tonnes)
// TODO: Verify actual reference weight for A380-842
const REFERENCE_WEIGHT_TONNES = 300; // Placeholder - A32NX uses 68T

const dryRunwayLandingData: AutobrakeConfigLandingData = {
  [AutobrakeMode.Max]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 2000, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 100, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 140, // TODO: Replace with actual A380X data
      altitudeCorrection: 80, // TODO: Replace with actual A380X data
      windCorrection: 260, // TODO: Replace with actual A380X data
      tempCorrection: 60, // TODO: Replace with actual A380X data
      slopeCorrection: 40, // TODO: Replace with actual A380X data
      reverserCorrection: 0, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 1820, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 2420, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 100, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 160, // TODO: Replace with actual A380X data
      altitudeCorrection: 100, // TODO: Replace with actual A380X data
      windCorrection: 260, // TODO: Replace with actual A380X data
      tempCorrection: 80, // TODO: Replace with actual A380X data
      slopeCorrection: 60, // TODO: Replace with actual A380X data
      reverserCorrection: -20, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 2160, // TODO: Replace with actual A380X data
    },
  },
  [AutobrakeMode.Medium]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 2660, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 60, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 180, // TODO: Replace with actual A380X data
      altitudeCorrection: 100, // TODO: Replace with actual A380X data
      windCorrection: 280, // TODO: Replace with actual A380X data
      tempCorrection: 80, // TODO: Replace with actual A380X data
      slopeCorrection: 20, // TODO: Replace with actual A380X data
      reverserCorrection: 0, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 440, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 3020, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 80, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 200, // TODO: Replace with actual A380X data
      altitudeCorrection: 100, // TODO: Replace with actual A380X data
      windCorrection: 280, // TODO: Replace with actual A380X data
      tempCorrection: 100, // TODO: Replace with actual A380X data
      slopeCorrection: 20, // TODO: Replace with actual A380X data
      reverserCorrection: 0, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 460, // TODO: Replace with actual A380X data
    },
  },
  [AutobrakeMode.Low]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 3720, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 80, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 260, // TODO: Replace with actual A380X data
      altitudeCorrection: 140, // TODO: Replace with actual A380X data
      windCorrection: 400, // TODO: Replace with actual A380X data
      tempCorrection: 140, // TODO: Replace with actual A380X data
      slopeCorrection: 60, // TODO: Replace with actual A380X data
      reverserCorrection: 0, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 420, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 4320, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 100, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 280, // TODO: Replace with actual A380X data
      altitudeCorrection: 160, // TODO: Replace with actual A380X data
      windCorrection: 440, // TODO: Replace with actual A380X data
      tempCorrection: 140, // TODO: Replace with actual A380X data
      slopeCorrection: 60, // TODO: Replace with actual A380X data
      reverserCorrection: -20, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 460, // TODO: Replace with actual A380X data
    },
  },
};

const goodRunwayLandingData: AutobrakeConfigLandingData = {
  [AutobrakeMode.Max]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 2640, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 100, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 220, // TODO: Replace with actual A380X data
      altitudeCorrection: 140, // TODO: Replace with actual A380X data
      windCorrection: 400, // TODO: Replace with actual A380X data
      tempCorrection: 120, // TODO: Replace with actual A380X data
      slopeCorrection: 100, // TODO: Replace with actual A380X data
      reverserCorrection: -40, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 1420, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 3140, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 120, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -40, // TODO: Replace with actual A380X data
      speedCorrection: 240, // TODO: Replace with actual A380X data
      altitudeCorrection: 160, // TODO: Replace with actual A380X data
      windCorrection: 460, // TODO: Replace with actual A380X data
      tempCorrection: 140, // TODO: Replace with actual A380X data
      slopeCorrection: 120, // TODO: Replace with actual A380X data
      reverserCorrection: -60, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 1620, // TODO: Replace with actual A380X data
    },
  },
  [AutobrakeMode.Medium]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 2760, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 100, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 220, // TODO: Replace with actual A380X data
      altitudeCorrection: 140, // TODO: Replace with actual A380X data
      windCorrection: 400, // TODO: Replace with actual A380X data
      tempCorrection: 120, // TODO: Replace with actual A380X data
      slopeCorrection: 100, // TODO: Replace with actual A380X data
      reverserCorrection: 0, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 400, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 3260, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 100, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -40, // TODO: Replace with actual A380X data
      speedCorrection: 240, // TODO: Replace with actual A380X data
      altitudeCorrection: 160, // TODO: Replace with actual A380X data
      windCorrection: 460, // TODO: Replace with actual A380X data
      tempCorrection: 140, // TODO: Replace with actual A380X data
      slopeCorrection: 120, // TODO: Replace with actual A380X data
      reverserCorrection: -40, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 580, // TODO: Replace with actual A380X data
    },
  },
  [AutobrakeMode.Low]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 3720, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 80, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 260, // TODO: Replace with actual A380X data
      altitudeCorrection: 140, // TODO: Replace with actual A380X data
      windCorrection: 400, // TODO: Replace with actual A380X data
      tempCorrection: 140, // TODO: Replace with actual A380X data
      slopeCorrection: 60, // TODO: Replace with actual A380X data
      reverserCorrection: 0, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 420, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 4320, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 100, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -40, // TODO: Replace with actual A380X data
      speedCorrection: 280, // TODO: Replace with actual A380X data
      altitudeCorrection: 160, // TODO: Replace with actual A380X data
      windCorrection: 440, // TODO: Replace with actual A380X data
      tempCorrection: 140, // TODO: Replace with actual A380X data
      slopeCorrection: 60, // TODO: Replace with actual A380X data
      reverserCorrection: -20, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 460, // TODO: Replace with actual A380X data
    },
  },
};

const goodMediumRunwayLandingData: AutobrakeConfigLandingData = {
  [AutobrakeMode.Max]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 3140, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 80, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 200, // TODO: Replace with actual A380X data
      altitudeCorrection: 120, // TODO: Replace with actual A380X data
      windCorrection: 380, // TODO: Replace with actual A380X data
      tempCorrection: 120, // TODO: Replace with actual A380X data
      slopeCorrection: 140, // TODO: Replace with actual A380X data
      reverserCorrection: -100, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 1600, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 3640, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 100, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -40, // TODO: Replace with actual A380X data
      speedCorrection: 200, // TODO: Replace with actual A380X data
      altitudeCorrection: 140, // TODO: Replace with actual A380X data
      windCorrection: 400, // TODO: Replace with actual A380X data
      tempCorrection: 140, // TODO: Replace with actual A380X data
      slopeCorrection: 160, // TODO: Replace with actual A380X data
      reverserCorrection: -160, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 1860, // TODO: Replace with actual A380X data
    },
  },
  [AutobrakeMode.Medium]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 3240, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 80, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 200, // TODO: Replace with actual A380X data
      altitudeCorrection: 120, // TODO: Replace with actual A380X data
      windCorrection: 380, // TODO: Replace with actual A380X data
      tempCorrection: 120, // TODO: Replace with actual A380X data
      slopeCorrection: 160, // TODO: Replace with actual A380X data
      reverserCorrection: -120, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 400, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 3740, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 80, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -40, // TODO: Replace with actual A380X data
      speedCorrection: 200, // TODO: Replace with actual A380X data
      altitudeCorrection: 140, // TODO: Replace with actual A380X data
      windCorrection: 400, // TODO: Replace with actual A380X data
      tempCorrection: 140, // TODO: Replace with actual A380X data
      slopeCorrection: 180, // TODO: Replace with actual A380X data
      reverserCorrection: -180, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 560, // TODO: Replace with actual A380X data
    },
  },
  [AutobrakeMode.Low]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 3760, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 80, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 260, // TODO: Replace with actual A380X data
      altitudeCorrection: 140, // TODO: Replace with actual A380X data
      windCorrection: 420, // TODO: Replace with actual A380X data
      tempCorrection: 120, // TODO: Replace with actual A380X data
      slopeCorrection: 100, // TODO: Replace with actual A380X data
      reverserCorrection: -20, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 420, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 4340, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 100, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -40, // TODO: Replace with actual A380X data
      speedCorrection: 280, // TODO: Replace with actual A380X data
      altitudeCorrection: 160, // TODO: Replace with actual A380X data
      windCorrection: 440, // TODO: Replace with actual A380X data
      tempCorrection: 160, // TODO: Replace with actual A380X data
      slopeCorrection: 120, // TODO: Replace with actual A380X data
      reverserCorrection: -60, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 460, // TODO: Replace with actual A380X data
    },
  },
};

const mediumRunwayLandingData: AutobrakeConfigLandingData = {
  [AutobrakeMode.Max]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 3520, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 80, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 200, // TODO: Replace with actual A380X data
      altitudeCorrection: 140, // TODO: Replace with actual A380X data
      windCorrection: 440, // TODO: Replace with actual A380X data
      tempCorrection: 120, // TODO: Replace with actual A380X data
      slopeCorrection: 220, // TODO: Replace with actual A380X data
      reverserCorrection: -180, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 1500, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 4100, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 100, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -40, // TODO: Replace with actual A380X data
      speedCorrection: 220, // TODO: Replace with actual A380X data
      altitudeCorrection: 160, // TODO: Replace with actual A380X data
      windCorrection: 480, // TODO: Replace with actual A380X data
      tempCorrection: 140, // TODO: Replace with actual A380X data
      slopeCorrection: 240, // TODO: Replace with actual A380X data
      reverserCorrection: -260, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 1760, // TODO: Replace with actual A380X data
    },
  },
  [AutobrakeMode.Medium]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 3620, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 80, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 220, // TODO: Replace with actual A380X data
      altitudeCorrection: 140, // TODO: Replace with actual A380X data
      windCorrection: 460, // TODO: Replace with actual A380X data
      tempCorrection: 120, // TODO: Replace with actual A380X data
      slopeCorrection: 220, // TODO: Replace with actual A380X data
      reverserCorrection: -200, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 400, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 4200, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 100, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -40, // TODO: Replace with actual A380X data
      speedCorrection: 220, // TODO: Replace with actual A380X data
      altitudeCorrection: 160, // TODO: Replace with actual A380X data
      windCorrection: 480, // TODO: Replace with actual A380X data
      tempCorrection: 140, // TODO: Replace with actual A380X data
      slopeCorrection: 260, // TODO: Replace with actual A380X data
      reverserCorrection: -280, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 600, // TODO: Replace with actual A380X data
    },
  },
  [AutobrakeMode.Low]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 3920, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 80, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 260, // TODO: Replace with actual A380X data
      altitudeCorrection: 140, // TODO: Replace with actual A380X data
      windCorrection: 480, // TODO: Replace with actual A380X data
      tempCorrection: 140, // TODO: Replace with actual A380X data
      slopeCorrection: 200, // TODO: Replace with actual A380X data
      reverserCorrection: -80, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 460, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 4540, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 100, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -40, // TODO: Replace with actual A380X data
      speedCorrection: 280, // TODO: Replace with actual A380X data
      altitudeCorrection: 160, // TODO: Replace with actual A380X data
      windCorrection: 500, // TODO: Replace with actual A380X data
      tempCorrection: 160, // TODO: Replace with actual A380X data
      slopeCorrection: 220, // TODO: Replace with actual A380X data
      reverserCorrection: -140, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 520, // TODO: Replace with actual A380X data
    },
  },
};

const mediumPoorRunwayLandingData: AutobrakeConfigLandingData = {
  [AutobrakeMode.Max]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 3860, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 140, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 340, // TODO: Replace with actual A380X data
      altitudeCorrection: 220, // TODO: Replace with actual A380X data
      windCorrection: 700, // TODO: Replace with actual A380X data
      tempCorrection: 200, // TODO: Replace with actual A380X data
      slopeCorrection: 300, // TODO: Replace with actual A380X data
      reverserCorrection: -220, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 960, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 4760, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 160, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -60, // TODO: Replace with actual A380X data
      speedCorrection: 340, // TODO: Replace with actual A380X data
      altitudeCorrection: 280, // TODO: Replace with actual A380X data
      windCorrection: 820, // TODO: Replace with actual A380X data
      tempCorrection: 240, // TODO: Replace with actual A380X data
      slopeCorrection: 400, // TODO: Replace with actual A380X data
      reverserCorrection: -300, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 1160, // TODO: Replace with actual A380X data
    },
  },
  [AutobrakeMode.Medium]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 3920, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 140, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 320, // TODO: Replace with actual A380X data
      altitudeCorrection: 220, // TODO: Replace with actual A380X data
      windCorrection: 720, // TODO: Replace with actual A380X data
      tempCorrection: 180, // TODO: Replace with actual A380X data
      slopeCorrection: 300, // TODO: Replace with actual A380X data
      reverserCorrection: -220, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 460, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 4800, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 160, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -60, // TODO: Replace with actual A380X data
      speedCorrection: 340, // TODO: Replace with actual A380X data
      altitudeCorrection: 280, // TODO: Replace with actual A380X data
      windCorrection: 820, // TODO: Replace with actual A380X data
      tempCorrection: 240, // TODO: Replace with actual A380X data
      slopeCorrection: 400, // TODO: Replace with actual A380X data
      reverserCorrection: -320, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 620, // TODO: Replace with actual A380X data
    },
  },
  [AutobrakeMode.Low]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 4000, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 140, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -20, // TODO: Replace with actual A380X data
      speedCorrection: 320, // TODO: Replace with actual A380X data
      altitudeCorrection: 240, // TODO: Replace with actual A380X data
      windCorrection: 720, // TODO: Replace with actual A380X data
      tempCorrection: 180, // TODO: Replace with actual A380X data
      slopeCorrection: 300, // TODO: Replace with actual A380X data
      reverserCorrection: -80, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 440, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 4860, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 160, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -60, // TODO: Replace with actual A380X data
      speedCorrection: 360, // TODO: Replace with actual A380X data
      altitudeCorrection: 280, // TODO: Replace with actual A380X data
      windCorrection: 800, // TODO: Replace with actual A380X data
      tempCorrection: 260, // TODO: Replace with actual A380X data
      slopeCorrection: 420, // TODO: Replace with actual A380X data
      reverserCorrection: -160, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 580, // TODO: Replace with actual A380X data
    },
  },
};

const poorRunwayLandingData: AutobrakeConfigLandingData = {
  [AutobrakeMode.Max]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 5520, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 120, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -40, // TODO: Replace with actual A380X data
      speedCorrection: 280, // TODO: Replace with actual A380X data
      altitudeCorrection: 220, // TODO: Replace with actual A380X data
      windCorrection: 860, // TODO: Replace with actual A380X data
      tempCorrection: 220, // TODO: Replace with actual A380X data
      slopeCorrection: 920, // TODO: Replace with actual A380X data
      reverserCorrection: -740, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 1100, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 6500, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 140, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -60, // TODO: Replace with actual A380X data
      speedCorrection: 300, // TODO: Replace with actual A380X data
      altitudeCorrection: 260, // TODO: Replace with actual A380X data
      windCorrection: 940, // TODO: Replace with actual A380X data
      tempCorrection: 260, // TODO: Replace with actual A380X data
      slopeCorrection: 1100, // TODO: Replace with actual A380X data
      reverserCorrection: -980, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 1320, // TODO: Replace with actual A380X data
    },
  },
  [AutobrakeMode.Medium]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 5580, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 120, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -40, // TODO: Replace with actual A380X data
      speedCorrection: 260, // TODO: Replace with actual A380X data
      altitudeCorrection: 220, // TODO: Replace with actual A380X data
      windCorrection: 880, // TODO: Replace with actual A380X data
      tempCorrection: 200, // TODO: Replace with actual A380X data
      slopeCorrection: 940, // TODO: Replace with actual A380X data
      reverserCorrection: -760, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 460, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 6560, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 140, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -60, // TODO: Replace with actual A380X data
      speedCorrection: 300, // TODO: Replace with actual A380X data
      altitudeCorrection: 260, // TODO: Replace with actual A380X data
      windCorrection: 940, // TODO: Replace with actual A380X data
      tempCorrection: 240, // TODO: Replace with actual A380X data
      slopeCorrection: 1120, // TODO: Replace with actual A380X data
      reverserCorrection: -980, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 620, // TODO: Replace with actual A380X data
    },
  },
  [AutobrakeMode.Low]: {
    [LandingFlapsConfig.Full]: {
      refDistance: 5660, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 120, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -40, // TODO: Replace with actual A380X data
      speedCorrection: 280, // TODO: Replace with actual A380X data
      altitudeCorrection: 220, // TODO: Replace with actual A380X data
      windCorrection: 880, // TODO: Replace with actual A380X data
      tempCorrection: 220, // TODO: Replace with actual A380X data
      slopeCorrection: 940, // TODO: Replace with actual A380X data
      reverserCorrection: -760, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 440, // TODO: Replace with actual A380X data
    },
    [LandingFlapsConfig.Conf3]: {
      refDistance: 6660, // TODO: Replace with actual A380X data
      weightCorrectionAbove: 140, // TODO: Replace with actual A380X data
      weightCorrectionBelow: -60, // TODO: Replace with actual A380X data
      speedCorrection: 280, // TODO: Replace with actual A380X data
      altitudeCorrection: 260, // TODO: Replace with actual A380X data
      windCorrection: 940, // TODO: Replace with actual A380X data
      tempCorrection: 240, // TODO: Replace with actual A380X data
      slopeCorrection: 1120, // TODO: Replace with actual A380X data
      reverserCorrection: -1000, // TODO: Replace with actual A380X data
      overweightProcedureCorrection: 580, // TODO: Replace with actual A380X data
    },
  },
};

/**
 * Stores all landing data for the aircraft.
 * Retrieve with runwayConditionLandingData[runwayCondition][autobrakeMode][flapsConfig]
 */
const runwayConditionLandingData: RunwayConditionLandingData = {
  [LandingRunwayConditions.Dry]: dryRunwayLandingData,
  [LandingRunwayConditions.Good]: goodRunwayLandingData,
  [LandingRunwayConditions.GoodMedium]: goodMediumRunwayLandingData,
  [LandingRunwayConditions.Medium]: mediumRunwayLandingData,
  [LandingRunwayConditions.MediumPoor]: mediumPoorRunwayLandingData,
  [LandingRunwayConditions.Poor]: poorRunwayLandingData,
};

/**
 * Safety margin multiplier, obtained from QRH In-Flight Performance section
 * TODO: Verify for A380X
 */
const SAFETY_MARGIN = 1.15;

/**
 * VLS speed (kts) for full flap configuration
 * Index 0 = 270T, Index 8 = 512T, ~30T increment
 * TODO: Replace with actual A380X VLS data
 */
const CONF_FULL_VLS = [140, 150, 160, 170, 180, 190, 200, 210, 220];

/**
 * VLS speed (kts) for conf 3 flaps
 * Index 0 = 270T, Index 8 = 512T, ~30T increment
 * TODO: Replace with actual A380X VLS data
 */
const CONF3_VLS = [145, 155, 165, 175, 185, 195, 205, 215, 225];

/**
 * Gets the interpolated VLS speed (kts) for the given mass, in tonnes, and the appropriate VLS speed table.
 * @param mass Mass in tonnes
 * @param vlsSpeedTable VLS speed table
 */
const getInterpolatedVlsTableValue = (mass: number, vlsSpeedTable: number[]): number => {
  // A380X weight range: 270T to 512T
  const minWeight = 270;
  const maxWeight = 512;
  const weightIncrement = (maxWeight - minWeight) / (vlsSpeedTable.length - 1);

  const index = Math.max(0, Math.min(vlsSpeedTable.length - 1, Math.ceil((mass - minWeight) / weightIncrement)));

  if (index === 0) return vlsSpeedTable[0];
  if (index >= vlsSpeedTable.length - 1) return vlsSpeedTable[vlsSpeedTable.length - 1];

  const lower = vlsSpeedTable[index - 1];
  const upper = vlsSpeedTable[index];

  const oneTonSpeedIncrement = (upper - lower) / weightIncrement;

  return lower + oneTonSpeedIncrement * ((mass - minWeight) % weightIncrement);
};

function getTailWind(windDirection: number, windMagnitude: number, runwayHeading: number): number {
  const windDirectionRelativeToRwy = windDirection - runwayHeading;
  const windDirectionRelativeToRwyRadians = toRadians(windDirectionRelativeToRwy);

  const tailWind = Math.cos(Math.PI - windDirectionRelativeToRwyRadians) * windMagnitude;
  return tailWind;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

export class A380842LandingCalculator implements LandingPerformanceCalculator {
  /**
   * Calculates the landing distances for each autobrake mode for the given conditions
   * @param weight Aircraft weight in KGs
   * @param flaps Flap Configuration
   * @param runwayCondition
   * @param approachSpeed Actual approach speed in kts
   * @param windDirection Heading wind is coming from, relative to north
   * @param windMagnitude Magnitude of wind in Knots
   * @param runwayHeading Heading of runway relative to north
   * @param reverseThrust Indicates if reverse thrust is active
   * @param altitude Runway altitude in feet ASL
   * @param temperature OAT of runway
   * @param slope Runway slope in %. Negative is downward slope
   * @param overweightProcedure Overweight procedure is being used if true
   * @param autoland Indicates if the usage of autoland is active
   */
  public calculateLandingDistances(
    weight: number,
    flaps: LandingFlapsConfig,
    runwayCondition: LandingRunwayConditions,
    approachSpeed: number,
    windDirection: number,
    windMagnitude: number,
    runwayHeading: number,
    reverseThrust: boolean,
    altitude: number,
    temperature: number,
    slope: number,
    overweightProcedure: boolean,
    pressure: number,
    autoland: boolean,
  ): { maxAutobrakeDist: number; mediumAutobrakeDist: number; lowAutobrakeDist: number } {
    return {
      maxAutobrakeDist:
        SAFETY_MARGIN *
        this.calculateRequiredLandingDistance(
          weight,
          flaps,
          runwayCondition,
          AutobrakeMode.Max,
          approachSpeed,
          windDirection,
          windMagnitude,
          runwayHeading,
          reverseThrust,
          altitude,
          temperature,
          slope,
          overweightProcedure,
          pressure,
          autoland,
        ),
      mediumAutobrakeDist:
        SAFETY_MARGIN *
        this.calculateRequiredLandingDistance(
          weight,
          flaps,
          runwayCondition,
          AutobrakeMode.Medium,
          approachSpeed,
          windDirection,
          windMagnitude,
          runwayHeading,
          reverseThrust,
          altitude,
          temperature,
          slope,
          overweightProcedure,
          pressure,
          autoland,
        ),
      lowAutobrakeDist:
        SAFETY_MARGIN *
        this.calculateRequiredLandingDistance(
          weight,
          flaps,
          runwayCondition,
          AutobrakeMode.Low,
          approachSpeed,
          windDirection,
          windMagnitude,
          runwayHeading,
          reverseThrust,
          altitude,
          temperature,
          slope,
          overweightProcedure,
          pressure,
          autoland,
        ),
    };
  }

  /**
   * Calculates the required landing distance for the given conditions
   * @param weight Aircraft weight in KGs
   * @param flaps Flap Configuration
   * @param runwayCondition
   * @param autobrakeMode
   * @param approachSpeed Actual approach speed in kts
   * @param windDirection Heading wind is coming from, relative to north
   * @param windMagnitude Magnitude of wind in Knots
   * @param runwayHeading Heading of runway relative to north
   * @param reverseThrust Indicates if reverse thrust is active
   * @param altitude Runway altitude in feet ASL
   * @param temperature OAT of runway
   * @param slope Runway slope in %. Negative is downward slope
   * @param overweightProcedure Overweight procedure is being used if true
   * @param autoland Indicates if the usage of autoland is active
   */
  private calculateRequiredLandingDistance(
    weight: number,
    flaps: LandingFlapsConfig,
    runwayCondition: LandingRunwayConditions,
    autobrakeMode: AutobrakeMode,
    approachSpeed: number,
    windDirection: number,
    windMagnitude: number,
    runwayHeading: number,
    reverseThrust: boolean,
    altitude: number,
    temperature: number,
    slope: number,
    overweightProcedure: boolean,
    pressure: number,
    autoland: boolean,
  ): number {
    const pressureAltitude = altitude + this.getPressureAltitude(pressure);
    const isaTemperature = this.getISATemperature(pressureAltitude);

    let targetApproachSpeed: number;
    const tonnage = weight / 1000;

    if (flaps === LandingFlapsConfig.Full) {
      targetApproachSpeed = getInterpolatedVlsTableValue(tonnage, CONF_FULL_VLS);
    } else {
      targetApproachSpeed = getInterpolatedVlsTableValue(tonnage, CONF3_VLS);
    }

    const landingData = runwayConditionLandingData[runwayCondition][autobrakeMode][flaps];

    let tailWind = getTailWind(windDirection, windMagnitude, runwayHeading);
    if (tailWind < 0) {
      tailWind = 0;
    }

    const weightDifference = weight / 1000 - REFERENCE_WEIGHT_TONNES;
    let weightCorrection: number;
    if (weightDifference < 0) {
      weightCorrection = landingData.weightCorrectionBelow * Math.abs(weightDifference);
    } else {
      weightCorrection = landingData.weightCorrectionAbove * weightDifference;
    }

    let speedDifference = approachSpeed - targetApproachSpeed;
    if (speedDifference < 0) {
      speedDifference = 0;
    }

    const speedCorrection = (speedDifference / 5) * landingData.speedCorrection;
    const windCorrection = (tailWind / 5) * landingData.windCorrection;
    let reverserCorrection;
    if (reverseThrust) {
      reverserCorrection = landingData.reverserCorrection * 2;
    } else {
      reverserCorrection = 0;
    }

    const altitudeCorrection = pressureAltitude > 0 ? (pressureAltitude / 1000) * landingData.altitudeCorrection : 0;
    const slopeCorrection = slope < 0 ? Math.abs(slope) * landingData.slopeCorrection : 0;
    const temperatureCorrection =
      temperature > isaTemperature ? ((temperature - isaTemperature) / 10) * landingData.tempCorrection : 0;
    const overweightProcCorrection = overweightProcedure ? landingData.overweightProcedureCorrection : 0;

    let autolandCorrection;

    if (autoland) {
      // TODO: Verify autoland correction for A380X
      autolandCorrection = flaps === LandingFlapsConfig.Full ? 560 : 500; // Scaled from A32NX
    } else {
      autolandCorrection = 0;
    }

    const requiredLandingDistance =
      landingData.refDistance +
      weightCorrection +
      speedCorrection +
      windCorrection +
      reverserCorrection +
      altitudeCorrection +
      slopeCorrection +
      temperatureCorrection +
      overweightProcCorrection +
      autolandCorrection;

    return Math.round(requiredLandingDistance);
  }

  /**
   * Converts a given pressure to equivalent pressure altitude
   * @param pressure Pressure in mb
   * @returns Pressure altitude in feet
   */
  private getPressureAltitude(pressure: number): number {
    // Equation from Boeing Jet Transport Performance Methods document
    return 145442.15 * (1 - (pressure / 1013.25) ** 0.190263);
  }

  /**
   * Calculates ISA temperature for a given pressure altitude
   * @param PressureAltitude is pressure altitude in feet
   * @returns ISA temperature in degrees C
   */
  private getISATemperature(pressureAltitude: number): number {
    return 15 - 0.0019812 * pressureAltitude;
  }
}
