// Copyright (c) 2026 dancebunny98
// SPDX-License-Identifier: GPL-3.0

import { Subject } from '@microsoft/msfs-sdk';
import { describe, expect, it, vi } from 'vitest';
import { MfdFmsFuelLoad } from './MfdFmsFuelLoad';

describe('A380 FMS fuel planning request', () => {
  it('stages, inserts and locks a fuel import until the EFB data changes', () => {
    const setPerformanceData = vi.fn();
    const updatePaxNumber = vi.fn();
    const page = Object.create(MfdFmsFuelLoad.prototype) as MfdFmsFuelLoad;
    Object.assign(page, {
      props: {
        flightPlanInterface: { setPerformanceData },
        fmcService: { master: { acInterface: { updatePaxNumber } } },
      },
      loadedFlightPlanIndex: Subject.create(0),
      fuelPlanningReceived: Subject.create(false),
      fuelPlanningIsDisabled: Subject.create(false),
      pendingEfbFuelData: null,
    });

    const values = new Map<string, number>([
      ['L:A380X_EFB_OFP_VALID', 1],
      ['L:A380X_EFB_OFP_ZFW', 350_000],
      ['L:A380X_EFB_OFP_BLOCK_FUEL', 100_000],
      ['L:A380X_EFB_OFP_TAXI_FUEL', 1_500],
      ['L:A380X_EFB_OFP_PAX', 400],
      ['L:A32NX_AIRFRAME_ZFW', 0],
      ['L:A32NX_AIRFRAME_ZFW_CG_PERCENT_MAC', 35],
      ['L:A380X_EFB_LOADED_PAX_VALID', 0],
      ['FUEL TOTAL QUANTITY WEIGHT', 0],
      ['L:A32NX_FUEL_DESIRED', 100_000],
    ]);
    const getSimVar = vi.spyOn(SimVar, 'GetSimVarValue').mockImplementation((name) => values.get(name) ?? 0);

    page['requestEfbFuelData']();
    expect(page['fuelPlanningReceived'].get()).toBe(true);
    expect(setPerformanceData).not.toHaveBeenCalled();

    page['insertEfbFuelData']();
    expect(setPerformanceData).toHaveBeenCalledWith('zeroFuelWeight', 350, 0);
    expect(setPerformanceData).toHaveBeenCalledWith('blockFuel', 100, 0);
    expect(setPerformanceData).toHaveBeenCalledWith('paxNumber', 400, 0);
    expect(page['fuelPlanningReceived'].get()).toBe(false);
    expect(page['fuelPlanningIsDisabled'].get()).toBe(true);

    values.set('FUEL TOTAL QUANTITY WEIGHT', 105_000);
    page['refreshFuelPlanningAvailability']();
    expect(page['fuelPlanningIsDisabled'].get()).toBe(false);
    page['requestEfbFuelData']();
    page['clearEfbFuelData']();
    expect(page['fuelPlanningReceived'].get()).toBe(false);
    expect(setPerformanceData).toHaveBeenCalledTimes(5);
    getSimVar.mockRestore();
  });
});
