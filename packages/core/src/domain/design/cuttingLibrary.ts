/** Material of the sheet; it sets how hard the tool may be pushed. */
export enum StockMaterial {
  Softwood = 'softwood',
  Hardwood = 'hardwood',
  Plywood = 'plywood',
  Mdf = 'mdf',
  Acrylic = 'acrylic',
  Hdpe = 'hdpe',
  Aluminum = 'aluminum',
}

/** A common cutter; the library recommends cutting parameters for it. */
export interface CuttingToolPreset {
  readonly id: string;
  readonly diameterMm: number;
  /** Number of cutting edges: each one takes a chip per revolution. */
  readonly fluteCount: number;
}

/** Speeds and depth that a tool, a material and a spindle speed allow together. */
export interface CuttingParameters {
  readonly feedRate: number;
  readonly plungeFeedRate: number;
  readonly depthPerPassMm: number;
}

/** How a material behaves under a cutter, relative to the cutter's diameter. */
interface MaterialCuttingData {
  /** Chip thickness per tooth, per millimeter of diameter. */
  readonly chipLoadPerDiameter: number;
  readonly depthPerPassInDiameters: number;
  /** Plunging is slower than cutting sideways, as the tool's tip cuts poorly. */
  readonly plungeRatio: number;
}

/**
 * Conservative values for light hobby and small production machines,
 * where frame stiffness rather than the cutter is the limit.
 */
const MATERIAL_CUTTING_DATA: Readonly<Record<StockMaterial, MaterialCuttingData>> = {
  [StockMaterial.Softwood]: { chipLoadPerDiameter: 0.016, depthPerPassInDiameters: 0.5, plungeRatio: 0.3 },
  [StockMaterial.Hardwood]: { chipLoadPerDiameter: 0.012, depthPerPassInDiameters: 0.3, plungeRatio: 0.3 },
  [StockMaterial.Plywood]: { chipLoadPerDiameter: 0.013, depthPerPassInDiameters: 0.4, plungeRatio: 0.3 },
  [StockMaterial.Mdf]: { chipLoadPerDiameter: 0.016, depthPerPassInDiameters: 0.5, plungeRatio: 0.3 },
  [StockMaterial.Acrylic]: { chipLoadPerDiameter: 0.012, depthPerPassInDiameters: 0.3, plungeRatio: 0.25 },
  [StockMaterial.Hdpe]: { chipLoadPerDiameter: 0.019, depthPerPassInDiameters: 0.5, plungeRatio: 0.3 },
  [StockMaterial.Aluminum]: { chipLoadPerDiameter: 0.004, depthPerPassInDiameters: 0.1, plungeRatio: 0.2 },
};

/** Flat end mills found in most workshops, from engraving to cutting out. */
export const CUTTING_TOOL_PRESETS: readonly CuttingToolPreset[] = [
  { id: 'end-mill-1-2', diameterMm: 1, fluteCount: 2 },
  { id: 'end-mill-2-2', diameterMm: 2, fluteCount: 2 },
  { id: 'end-mill-3.175-1', diameterMm: 3.175, fluteCount: 1 },
  { id: 'end-mill-3.175-2', diameterMm: 3.175, fluteCount: 2 },
  { id: 'end-mill-4-2', diameterMm: 4, fluteCount: 2 },
  { id: 'end-mill-6-1', diameterMm: 6, fluteCount: 1 },
  { id: 'end-mill-6-2', diameterMm: 6, fluteCount: 2 },
  { id: 'end-mill-8-2', diameterMm: 8, fluteCount: 2 },
];

const FEED_ROUNDING_MM_PER_MIN = 10;
const DEPTH_ROUNDING_MM = 0.1;
const MIN_FEED_RATE = 50;
const MIN_DEPTH_PER_PASS_MM = 0.1;

const roundTo = (value: number, step: number): number => Math.round(value / step) * step;

export function findCuttingToolPreset(id: string | null): CuttingToolPreset | null {
  return CUTTING_TOOL_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * Recommends cutting parameters: the feed gives each tooth a chip of the right thickness
 * at the given spindle speed, and the depth per pass follows the material's hardness.
 */
export function recommendCuttingParameters(
  tool: CuttingToolPreset,
  material: StockMaterial,
  spindleSpeedRpm: number,
): CuttingParameters {
  const data = MATERIAL_CUTTING_DATA[material];
  const chipLoadMm = data.chipLoadPerDiameter * tool.diameterMm;
  const feedRate = Math.max(roundTo(spindleSpeedRpm * tool.fluteCount * chipLoadMm, FEED_ROUNDING_MM_PER_MIN), MIN_FEED_RATE);
  return {
    feedRate,
    plungeFeedRate: Math.max(roundTo(feedRate * data.plungeRatio, FEED_ROUNDING_MM_PER_MIN), MIN_FEED_RATE),
    depthPerPassMm: Math.max(roundTo(tool.diameterMm * data.depthPerPassInDiameters, DEPTH_ROUNDING_MM), MIN_DEPTH_PER_PASS_MM),
  };
}
