import { findCuttingToolPreset, recommendCuttingParameters, type CuttingLimits, type CuttingParameters } from './cuttingLibrary';
import type { WorkSurface } from './workSurface';

/** Kinds of machine a project can be set up for at once. */
export enum MachineProfileId {
  /** Desktop machine with a 300 × 180 mm field and a 775 motor spindle. */
  Cnc3018 = 'cnc-3018',
  /** Benchtop machine with a 600 × 400 mm field and a water-cooled spindle. */
  Cnc6040 = 'cnc-6040',
  /** Sheet router of a small production shop. */
  SheetRouter = 'sheet-router',
}

/** Table, sheet and cutting settings that suit one kind of machine. */
export interface MachineProfile {
  readonly id: MachineProfileId;
  readonly tableWidthMm: number;
  readonly tableDepthMm: number;
  /** Sheet a new job on this machine usually starts with. */
  readonly sheet: { readonly widthMm: number; readonly depthMm: number; readonly thicknessMm: number };
  readonly sheetOffsetXMm: number;
  readonly sheetOffsetYMm: number;
  readonly toolPresetId: string;
  readonly spindleSpeedRpm: number;
  readonly safeHeightMm: number;
  /** What the frame withstands: recommendations never go beyond it, whatever the cutter could take. */
  readonly limits: CuttingLimits;
  /** Cutting settings used until a material is chosen: safe for any wood on this machine. */
  readonly cutting: CuttingParameters;
}

export const MACHINE_PROFILES: Readonly<Record<MachineProfileId, MachineProfile>> = {
  [MachineProfileId.Cnc3018]: {
    id: MachineProfileId.Cnc3018,
    tableWidthMm: 300,
    tableDepthMm: 180,
    sheet: { widthMm: 200, depthMm: 150, thicknessMm: 6 },
    sheetOffsetXMm: 50,
    sheetOffsetYMm: 15,
    toolPresetId: 'end-mill-3.175-2',
    spindleSpeedRpm: 7000,
    safeHeightMm: 3,
    limits: { maxFeedRate: 600, maxDepthPerPassMm: 1 },
    cutting: { feedRate: 400, plungeFeedRate: 120, depthPerPassMm: 0.6 },
  },
  [MachineProfileId.Cnc6040]: {
    id: MachineProfileId.Cnc6040,
    tableWidthMm: 600,
    tableDepthMm: 400,
    sheet: { widthMm: 500, depthMm: 300, thicknessMm: 10 },
    sheetOffsetXMm: 50,
    sheetOffsetYMm: 50,
    toolPresetId: 'end-mill-3.175-2',
    spindleSpeedRpm: 18000,
    safeHeightMm: 5,
    limits: { maxFeedRate: 2500, maxDepthPerPassMm: 3 },
    cutting: { feedRate: 1200, plungeFeedRate: 300, depthPerPassMm: 1.5 },
  },
  [MachineProfileId.SheetRouter]: {
    id: MachineProfileId.SheetRouter,
    tableWidthMm: 1300,
    tableDepthMm: 900,
    sheet: { widthMm: 1000, depthMm: 600, thicknessMm: 18 },
    sheetOffsetXMm: 100,
    sheetOffsetYMm: 100,
    toolPresetId: 'end-mill-6-2',
    spindleSpeedRpm: 18000,
    safeHeightMm: 5,
    limits: { maxFeedRate: 6000, maxDepthPerPassMm: 6 },
    cutting: { feedRate: 1500, plungeFeedRate: 400, depthPerPassMm: 3 },
  },
};

export function findMachineProfile(id: MachineProfileId | null): MachineProfile | null {
  return id === null ? null : MACHINE_PROFILES[id];
}

/**
 * Sets a surface up for a machine: its table, a sheet that fits it, its usual cutter and
 * cutting settings within what its frame withstands. Units, zero and material are kept.
 */
export function applyMachineProfile(surface: WorkSurface, profile: MachineProfile): WorkSurface {
  const tool = findCuttingToolPreset(profile.toolPresetId);
  const cutting =
    tool && surface.material
      ? recommendCuttingParameters(tool, surface.material, profile.spindleSpeedRpm, profile.limits)
      : profile.cutting;
  return {
    ...surface,
    machineProfileId: profile.id,
    tableWidthMm: profile.tableWidthMm,
    tableDepthMm: profile.tableDepthMm,
    sheetWidthMm: profile.sheet.widthMm,
    sheetDepthMm: profile.sheet.depthMm,
    sheetThicknessMm: profile.sheet.thicknessMm,
    sheetOffsetXMm: profile.sheetOffsetXMm,
    sheetOffsetYMm: profile.sheetOffsetYMm,
    toolPresetId: profile.toolPresetId,
    toolDiameterMm: tool?.diameterMm ?? surface.toolDiameterMm,
    spindleSpeedRpm: profile.spindleSpeedRpm,
    safeHeightMm: profile.safeHeightMm,
    ...cutting,
  };
}
