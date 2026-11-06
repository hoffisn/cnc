import type { ReliefStock } from '@core/domain/toolpath/relief';
import type { StockMaterial } from './cuttingLibrary';
import { MachineProfileId } from './machineProfile';

/** Unit the operator prefers for entering work surface dimensions. Values are always stored in millimeters. */
export enum LengthUnit {
  Millimeter = 'mm',
  Centimeter = 'cm',
  Meter = 'm',
}

/** Millimeters in one unit of each {@link LengthUnit}. */
export const MILLIMETERS_PER_LENGTH_UNIT: Readonly<Record<LengthUnit, number>> = {
  [LengthUnit.Millimeter]: 1,
  [LengthUnit.Centimeter]: 10,
  [LengthUnit.Meter]: 1000,
};

/** Point of the sheet where the cutter's zero position is set. */
export enum ZeroOrigin {
  SheetLowerLeft = 'sheet-lower-left',
  SheetLowerRight = 'sheet-lower-right',
  SheetUpperLeft = 'sheet-upper-left',
  SheetUpperRight = 'sheet-upper-right',
  SheetCenter = 'sheet-center',
}

/** The machine's table, the sheet lying on it, and the parameters of cutting that sheet. */
export interface WorkSurface {
  /** Kind of machine the surface was set up for; `null` for a machine set up by hand. */
  readonly machineProfileId: MachineProfileId | null;
  readonly tableWidthMm: number;
  readonly tableDepthMm: number;
  readonly sheetWidthMm: number;
  readonly sheetDepthMm: number;
  readonly sheetThicknessMm: number;
  /** Distance from the table's left edge to the sheet's left edge. */
  readonly sheetOffsetXMm: number;
  /** Distance from the table's front edge to the sheet's front edge. */
  readonly sheetOffsetYMm: number;
  readonly zeroOrigin: ZeroOrigin;
  readonly toolDiameterMm: number;
  /** Height above the sheet at which the tool travels between cuts. */
  readonly safeHeightMm: number;
  /** Cutting speed, in mm/min. */
  readonly feedRate: number;
  /** Speed of entering the material, in mm/min. */
  readonly plungeFeedRate: number;
  /** Largest depth removed in one pass. */
  readonly depthPerPassMm: number;
  readonly spindleSpeedRpm: number;
  readonly displayUnit: LengthUnit;
  /** Material the cutting parameters were chosen for; `null` when they were set by hand. */
  readonly material: StockMaterial | null;
  /** Library cutter the parameters were chosen for; `null` for a cutter not in the library. */
  readonly toolPresetId: string | null;
}

/** Surface of a new project: a typical sheet on a typical hobby or small production table. */
export const DEFAULT_WORK_SURFACE: WorkSurface = {
  machineProfileId: MachineProfileId.SheetRouter,
  tableWidthMm: 1300,
  tableDepthMm: 900,
  sheetWidthMm: 1000,
  sheetDepthMm: 600,
  sheetThicknessMm: 18,
  sheetOffsetXMm: 100,
  sheetOffsetYMm: 100,
  zeroOrigin: ZeroOrigin.SheetLowerLeft,
  toolDiameterMm: 6,
  safeHeightMm: 5,
  feedRate: 1500,
  plungeFeedRate: 400,
  depthPerPassMm: 3,
  spindleSpeedRpm: 18000,
  displayUnit: LengthUnit.Millimeter,
  material: null,
  toolPresetId: null,
};

/** Describes the sheet in program coordinates, with its top at `Z0`. */
export function describeSheetStock(surface: WorkSurface): ReliefStock {
  const zero = findZeroOnSheet(surface);
  return {
    minX: -zero.x,
    minY: -zero.y,
    maxX: surface.sheetWidthMm - zero.x,
    maxY: surface.sheetDepthMm - zero.y,
    topZ: 0,
    bottomZ: -surface.sheetThicknessMm,
  };
}

/** Finds where the zero position is, in sheet coordinates with the origin at the sheet's lower left corner. */
export function findZeroOnSheet(surface: WorkSurface): { readonly x: number; readonly y: number } {
  const { sheetWidthMm: width, sheetDepthMm: depth } = surface;
  switch (surface.zeroOrigin) {
    case ZeroOrigin.SheetLowerLeft:
      return { x: 0, y: 0 };
    case ZeroOrigin.SheetLowerRight:
      return { x: width, y: 0 };
    case ZeroOrigin.SheetUpperLeft:
      return { x: 0, y: depth };
    case ZeroOrigin.SheetUpperRight:
      return { x: width, y: depth };
    case ZeroOrigin.SheetCenter:
      return { x: width / 2, y: depth / 2 };
  }
}
