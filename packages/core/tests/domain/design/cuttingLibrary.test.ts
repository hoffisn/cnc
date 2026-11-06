import { describe, expect, it } from 'vitest';
import { StockMaterial, findCuttingToolPreset, recommendCuttingParameters } from '@core/domain/design/cuttingLibrary';
import { MACHINE_PROFILES, MachineProfileId, applyMachineProfile } from '@core/domain/design/machineProfile';
import { DEFAULT_WORK_SURFACE } from '@core/domain/design/workSurface';
import { findDesignIssues } from '@core/domain/design/designRules';
import { EMPTY_DESIGN_PROJECT } from '@core/domain/design/designProject';

describe('recommendCuttingParameters', () => {
  it('gives each tooth its chip at the spindle speed and slows down for harder material', () => {
    const tool = findCuttingToolPreset('end-mill-3.175-2');
    if (!tool) throw new Error('a library tool was expected');

    const softwood = recommendCuttingParameters(tool, StockMaterial.Softwood, 10000);
    expect(softwood).toEqual({ feedRate: 1020, plungeFeedRate: 310, depthPerPassMm: 1.6 });

    const aluminum = recommendCuttingParameters(tool, StockMaterial.Aluminum, 10000);
    expect(aluminum.feedRate).toBeLessThan(softwood.feedRate / 3);
    expect(aluminum.depthPerPassMm).toBeCloseTo(0.3);
  });
});

describe('applyMachineProfile', () => {
  const desktop = MACHINE_PROFILES[MachineProfileId.Cnc3018];

  it('sets up a valid surface that fits the machine', () => {
    const surface = applyMachineProfile(DEFAULT_WORK_SURFACE, desktop);
    expect(surface).toMatchObject({ machineProfileId: MachineProfileId.Cnc3018, tableWidthMm: 300, tableDepthMm: 180, toolDiameterMm: 3.175, depthPerPassMm: 0.6 });
    expect(findDesignIssues({ ...EMPTY_DESIGN_PROJECT, surface })).toEqual([]);
  });

  it('keeps recommendations within what a light frame withstands', () => {
    const surface = applyMachineProfile({ ...DEFAULT_WORK_SURFACE, material: StockMaterial.Softwood }, desktop);
    expect(surface.feedRate).toBe(desktop.limits.maxFeedRate);
    expect(surface.depthPerPassMm).toBe(desktop.limits.maxDepthPerPassMm);
  });
});
