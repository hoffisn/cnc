import {
  DesignOperationKind,
  NO_HOLDING_TABS,
  ShapeCut,
  ToolSide,
  type DesignOperation,
  type HoldingTabs,
  type SheetPath,
  type SheetPoint,
} from './designOperation';
import { CUTTING_TOOL_PRESETS, StockMaterial } from './cuttingLibrary';
import { DEFAULT_WORK_SURFACE, LengthUnit, ZeroOrigin, type WorkSurface } from './workSurface';

/** Current schema of persisted projects. */
export const DESIGN_PROJECT_SCHEMA_VERSION = 1;

/**
 * What an engineer is making: the surface and the ordered list of operations.
 * This is the source of truth; G-code is derived from it and never edited back.
 */
export interface DesignProject {
  readonly schemaVersion: number;
  readonly surface: WorkSurface;
  /** Operations in cutting order. */
  readonly operations: readonly DesignOperation[];
}

/** A project with nothing drawn yet. */
export const EMPTY_DESIGN_PROJECT: DesignProject = {
  schemaVersion: DESIGN_PROJECT_SCHEMA_VERSION,
  surface: DEFAULT_WORK_SURFACE,
  operations: [],
};

/** Result of reading a project from untrusted storage. */
export interface ParsedDesignProject {
  readonly project: DesignProject;
  /** Some stored values were damaged and got replaced with defaults or dropped. */
  readonly wasRecovered: boolean;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isEnumValue = <TEnum extends string>(enumObject: Readonly<Record<string, TEnum>>, value: unknown): value is TEnum =>
  Object.values(enumObject).includes(value as TEnum);

function readPoint(value: unknown): SheetPoint | null {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  return { x: value.x, y: value.y };
}

/** Reads the paths of a shape; a single damaged point discards the shape, as its form would be wrong. */
function readPaths(value: unknown): SheetPath[] | null {
  if (!Array.isArray(value)) return null;
  const paths: SheetPath[] = [];
  for (const stored of value) {
    if (!isRecord(stored) || !Array.isArray(stored.points)) return null;
    if (typeof stored.isClosed !== 'boolean' || typeof stored.isSmooth !== 'boolean') return null;
    const points = stored.points.map(readPoint);
    if (points.some((point) => point === null)) return null;
    paths.push({ points: points as SheetPoint[], isClosed: stored.isClosed, isSmooth: stored.isSmooth });
  }
  return paths;
}

/** Reads holding tabs; projects saved before tabs existed have none. */
function readTabs(value: unknown): HoldingTabs | null {
  if (value === undefined) return NO_HOLDING_TABS;
  if (!isRecord(value)) return null;
  const { count, widthMm, heightMm } = value;
  if (!Number.isInteger(count) || !isFiniteNumber(widthMm) || !isFiniteNumber(heightMm)) return null;
  return { count: count as number, widthMm, heightMm };
}

/** Reads one stored operation. Geometry validity is checked later by the design rules, as for any edit. */
function parseOperation(stored: unknown): DesignOperation | null {
  if (!isRecord(stored)) return null;
  const { id, kind, depthMm } = stored;
  if (typeof id !== 'string' || id.length === 0 || !isFiniteNumber(depthMm)) return null;

  const center = readPoint(stored.center);
  const corner = readPoint(stored.corner);
  const { widthMm, heightMm, diameterMm, toolSide } = stored;
  const hasRectangle = corner !== null && isFiniteNumber(widthMm) && isFiniteNumber(heightMm);
  const hasCircle = center !== null && isFiniteNumber(diameterMm);
  const hasToolSide = isEnumValue<ToolSide>(ToolSide, toolSide);
  const tabs = readTabs(stored.tabs);

  switch (kind) {
    case DesignOperationKind.Hole:
      return center && { kind, id, depthMm, center };
    case DesignOperationKind.HoleGrid: {
      const origin = readPoint(stored.origin);
      const { columnCount, rowCount, spacingXMm, spacingYMm } = stored;
      if (!origin || !isFiniteNumber(spacingXMm) || !isFiniteNumber(spacingYMm)) return null;
      if (!Number.isInteger(columnCount) || !Number.isInteger(rowCount)) return null;
      return { kind, id, depthMm, origin, columnCount: columnCount as number, rowCount: rowCount as number, spacingXMm, spacingYMm };
    }
    case DesignOperationKind.Slot: {
      const start = readPoint(stored.start);
      const end = readPoint(stored.end);
      return start && end && { kind, id, depthMm, start, end };
    }
    case DesignOperationKind.RectangleOutline:
      return hasRectangle && hasToolSide && tabs ? { kind, id, depthMm, corner, widthMm, heightMm, toolSide, tabs } : null;
    case DesignOperationKind.CircleOutline:
      return hasCircle && hasToolSide && tabs ? { kind, id, depthMm, center, diameterMm, toolSide, tabs } : null;
    case DesignOperationKind.RectanglePocket:
      return hasRectangle ? { kind, id, depthMm, corner, widthMm, heightMm } : null;
    case DesignOperationKind.CirclePocket:
      return hasCircle ? { kind, id, depthMm, center, diameterMm } : null;
    case DesignOperationKind.Shape: {
      const paths = readPaths(stored.paths);
      const { cut } = stored;
      if (!paths || !isEnumValue<ShapeCut>(ShapeCut, cut) || !hasToolSide || !tabs) return null;
      return { kind, id, depthMm, paths, cut, toolSide, tabs };
    }
    default:
      return null;
  }
}

/** Reads a work surface field by field, so one damaged value does not discard the others. */
function parseWorkSurface(stored: UnknownRecord): { surface: WorkSurface; wasRecovered: boolean } {
  let wasRecovered = false;
  const positive = (key: keyof WorkSurface, defaultValue: number): number => {
    const value = stored[key];
    if (isFiniteNumber(value) && value > 0) return value;
    wasRecovered = true;
    return defaultValue;
  };
  const nonNegative = (key: keyof WorkSurface, defaultValue: number): number => {
    const value = stored[key];
    if (isFiniteNumber(value) && value >= 0) return value;
    wasRecovered = true;
    return defaultValue;
  };
  const defaults = DEFAULT_WORK_SURFACE;
  const { zeroOrigin, displayUnit, material, toolPresetId } = stored;
  if (!isEnumValue<ZeroOrigin>(ZeroOrigin, zeroOrigin) || !isEnumValue<LengthUnit>(LengthUnit, displayUnit)) {
    wasRecovered = true;
  }

  return {
    surface: {
      tableWidthMm: positive('tableWidthMm', defaults.tableWidthMm),
      tableDepthMm: positive('tableDepthMm', defaults.tableDepthMm),
      sheetWidthMm: positive('sheetWidthMm', defaults.sheetWidthMm),
      sheetDepthMm: positive('sheetDepthMm', defaults.sheetDepthMm),
      sheetThicknessMm: positive('sheetThicknessMm', defaults.sheetThicknessMm),
      sheetOffsetXMm: nonNegative('sheetOffsetXMm', defaults.sheetOffsetXMm),
      sheetOffsetYMm: nonNegative('sheetOffsetYMm', defaults.sheetOffsetYMm),
      zeroOrigin: isEnumValue<ZeroOrigin>(ZeroOrigin, zeroOrigin) ? zeroOrigin : defaults.zeroOrigin,
      toolDiameterMm: positive('toolDiameterMm', defaults.toolDiameterMm),
      safeHeightMm: positive('safeHeightMm', defaults.safeHeightMm),
      feedRate: positive('feedRate', defaults.feedRate),
      plungeFeedRate: positive('plungeFeedRate', defaults.plungeFeedRate),
      depthPerPassMm: positive('depthPerPassMm', defaults.depthPerPassMm),
      spindleSpeedRpm: positive('spindleSpeedRpm', defaults.spindleSpeedRpm),
      displayUnit: isEnumValue<LengthUnit>(LengthUnit, displayUnit) ? displayUnit : defaults.displayUnit,
      material: isEnumValue<StockMaterial>(StockMaterial, material) ? material : null,
      toolPresetId: CUTTING_TOOL_PRESETS.some((preset) => preset.id === toolPresetId) ? (toolPresetId as string) : null,
    },
    wasRecovered,
  };
}

/**
 * Reads a project loaded from disk.
 *
 * @param stored - Raw stored value; `null` or `undefined` means no project was saved yet.
 */
export function parseDesignProject(stored: unknown): ParsedDesignProject {
  if (stored === null || stored === undefined) return { project: EMPTY_DESIGN_PROJECT, wasRecovered: false };
  if (!isRecord(stored)) return { project: EMPTY_DESIGN_PROJECT, wasRecovered: true };

  const parsedSurface = parseWorkSurface(isRecord(stored.surface) ? stored.surface : {});
  const storedOperations: readonly unknown[] = Array.isArray(stored.operations) ? stored.operations : [];
  const knownIds = new Set<string>();
  const operations: DesignOperation[] = [];
  for (const storedOperation of storedOperations) {
    const operation = parseOperation(storedOperation);
    if (operation && !knownIds.has(operation.id)) {
      knownIds.add(operation.id);
      operations.push(operation);
    }
  }

  return {
    project: { schemaVersion: DESIGN_PROJECT_SCHEMA_VERSION, surface: parsedSurface.surface, operations },
    wasRecovered:
      parsedSurface.wasRecovered || !Array.isArray(stored.operations) || operations.length !== storedOperations.length,
  };
}
