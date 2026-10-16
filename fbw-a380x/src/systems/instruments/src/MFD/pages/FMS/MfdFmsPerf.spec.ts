// Copyright (c) 2026 dancebunny98
// SPDX-License-Identifier: GPL-3.0

import { Subject } from '@microsoft/msfs-sdk';
import { describe, expect, it, vi } from 'vitest';
import { MfdFmsPerf } from './MfdFmsPerf';

describe('A380 FMS takeoff request', () => {
  it('keeps received EFB data pending until INSERT and then locks that revision', () => {
    const setPerformanceData = vi.fn();
    const setTakeoffFlaps = vi.fn();
    const page = Object.create(MfdFmsPerf.prototype) as MfdFmsPerf;
    Object.assign(page, {
      props: {
        flightPlanInterface: { setPerformanceData },
        fmcService: { master: { acInterface: { setTakeoffFlaps } } },
      },
      loadedFlightPlanIndex: Subject.create(0),
      toRequestState: Subject.create('idle'),
      toRequestFailure: Subject.create('EFB NO REPLY'),
      toRequestDisabled: Subject.create(false),
      toRequestTimer: null,
      pendingEfbTakeoff: null,
      lastInsertedEfbTakeoffRevision: 0,
      toThrustSettingChanged: vi.fn(),
    });
    const values = new Map<string, number>([
      ['L:A380X_EFB_TO_VALID', Math.floor(Date.now() / 1_000)],
      ['L:A380X_EFB_TO_REV', 1],
      ['L:A380X_EFB_TO_AIRPORT', Number.parseInt('EGLL', 36)],
      ['L:A380X_EFB_TO_RUNWAY', Number.parseInt('27L', 36)],
      ['L:A380X_EFB_TO_WEIGHT', 361_546],
      ['L:A380X_EFB_TO_V1', 123],
      ['L:A380X_EFB_TO_VR', 150],
      ['L:A380X_EFB_TO_V2', 159],
      ['L:A380X_EFB_TO_FLAPS', 1],
      ['L:A380X_EFB_TO_FLEX', 68],
      ['L:A380X_EFB_TO_TRIM', 0],
      ['L:A380X_EFB_TO_TRIM_VALID', 0],
      ['L:A380X_EFB_TO_PACKS', 1],
      ['L:A380X_EFB_TO_ANTI_ICE', 0],
    ]);
    const getSimVar = vi.spyOn(SimVar, 'GetSimVarValue').mockImplementation((name) => values.get(name) ?? 0);
    const setSimVar = vi.spyOn(SimVar, 'SetSimVarValue').mockResolvedValue(undefined);

    page['requestEfbTakeoff']();
    expect(page['toRequestState'].get()).toBe('received');
    expect(setPerformanceData).not.toHaveBeenCalled();

    page['clearEfbTakeoff']();
    expect(page['toRequestState'].get()).toBe('idle');
    expect(setPerformanceData).not.toHaveBeenCalled();
    page['requestEfbTakeoff']();

    page['confirmEfbTakeoff']();
    expect(setPerformanceData).toHaveBeenCalledWith('v1', 123, 0);
    expect(setPerformanceData).toHaveBeenCalledWith('vr', 150, 0);
    expect(setPerformanceData).toHaveBeenCalledWith('v2', 159, 0);
    expect(page['toRequestState'].get()).toBe('idle');
    expect(page['toRequestDisabled'].get()).toBe(true);
    expect(setSimVar).toHaveBeenCalledWith('L:A380X_EFB_TO_INSERTED_REV', 'number', 1);
    getSimVar.mockRestore();
    setSimVar.mockRestore();
  });
});
