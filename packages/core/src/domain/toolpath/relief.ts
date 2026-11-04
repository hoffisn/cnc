import { COORDINATES_PER_SEGMENT, SegmentKind, type Toolpath } from './toolpath';

/** Surface left after machining: heights at the nodes of a uniform XY grid. */
export interface Relief {
  readonly columnCount: number;
  readonly rowCount: number;
  readonly originX: number;
  readonly originY: number;
  readonly cellSize: number;
  /** Heights row by row: `columnCount × rowCount` values. */
  readonly heights: Float32Array;
  readonly stockTopZ: number;
  /** Underside of the stock when it is known; otherwise a thickness is chosen for display. */
  readonly stockBottomZ: number | null;
  readonly lowestZ: number;
}

/** Real dimensions of the workpiece, in program coordinates. */
export interface ReliefStock {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly topZ: number;
  readonly bottomZ: number;
}

/** Parameters of the machining simulation. */
export interface ReliefOptions {
  /** Diameter of a flat-end cylindrical cutter, in millimeters. */
  readonly toolDiameter: number;
  /** Grid nodes along the longer side, which trades quality for speed. */
  readonly maxResolution: number;
  /** Workpiece to carve. Without it, the stock is estimated from the program itself. */
  readonly stock?: ReliefStock;
}

/** Stock overhang around the part, relative to the tool radius. */
const STOCK_MARGIN_TOOL_RADII = 1.5;
const MIN_GRID_NODES = 2;
const HORIZONTAL_EPSILON = 1e-12;

/**
 * Picks the top of the stock: normally `Z0`; when the whole program stays above zero
 * (zero set on the machine table), the highest cutting point.
 *
 * @returns `null` when all cuts are at the same non-negative height and nothing can be removed.
 */
function resolveStockTop(partMinZ: number, partMaxZ: number): number | null {
  if (partMinZ < 0) return 0;
  return partMaxZ > partMinZ ? partMaxZ : null;
}

/** Guesses a workpiece from the program itself: its cuts plus a margin around them. */
function estimateStock(toolpath: Toolpath, toolRadius: number): ReliefStock | null {
  const { partBounds } = toolpath;
  if (!partBounds) return null;
  const topZ = resolveStockTop(partBounds.min.z, partBounds.max.z);
  if (topZ === null) return null;
  const margin = toolRadius * STOCK_MARGIN_TOOL_RADII;
  return {
    minX: partBounds.min.x - margin,
    minY: partBounds.min.y - margin,
    maxX: partBounds.max.x + margin,
    maxY: partBounds.max.y + margin,
    topZ,
    bottomZ: partBounds.min.z,
  };
}

/** Height grid carved by a cutter. Coordinates of a segment are passed as scalars to avoid allocations. */
class CarvableHeightGrid {
  readonly heights: Float32Array;
  lowestZ: number;
  private readonly toolRadiusSquared: number;

  constructor(
    readonly columnCount: number,
    readonly rowCount: number,
    readonly originX: number,
    readonly originY: number,
    readonly cellSize: number,
    readonly stockTopZ: number,
    private readonly toolRadius: number,
  ) {
    this.heights = new Float32Array(columnCount * rowCount).fill(stockTopZ);
    this.lowestZ = stockTopZ;
    this.toolRadiusSquared = toolRadius * toolRadius;
  }

  /**
   * Sweeps the cutter along a segment.
   * For each row only the X range the tool's footprint can touch is visited, so long diagonals
   * cost time proportional to their length rather than to the area of their bounding box.
   */
  carveSegment(startX: number, startY: number, startZ: number, endX: number, endY: number, endZ: number): void {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const { toolRadius, originX, originY, cellSize, columnCount, rowCount } = this;

    const firstRow = Math.max(Math.floor((Math.min(startY, endY) - toolRadius - originY) / cellSize), 0);
    const lastRow = Math.min(Math.ceil((Math.max(startY, endY) + toolRadius - originY) / cellSize), rowCount - 1);

    for (let row = firstRow; row <= lastRow; row += 1) {
      const rowY = originY + row * cellSize;

      let enterFraction = 0;
      let exitFraction = 1;
      if (Math.abs(deltaY) > HORIZONTAL_EPSILON) {
        const lowerCrossing = (rowY - toolRadius - startY) / deltaY;
        const upperCrossing = (rowY + toolRadius - startY) / deltaY;
        enterFraction = Math.max(Math.min(lowerCrossing, upperCrossing), 0);
        exitFraction = Math.min(Math.max(lowerCrossing, upperCrossing), 1);
      }
      const enterX = startX + deltaX * enterFraction;
      const exitX = startX + deltaX * exitFraction;
      const firstColumn = Math.max(Math.floor((Math.min(enterX, exitX) - toolRadius - originX) / cellSize), 0);
      const lastColumn = Math.min(Math.ceil((Math.max(enterX, exitX) + toolRadius - originX) / cellSize), columnCount - 1);

      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const lowestToolZ = this.lowestToolZAt(originX + column * cellSize, rowY, startX, startY, startZ, deltaX, deltaY, endZ);
        if (lowestToolZ === null) continue;
        const nodeIndex = row * columnCount + column;
        if (lowestToolZ < (this.heights[nodeIndex] as number)) {
          this.heights[nodeIndex] = lowestToolZ;
          if (lowestToolZ < this.lowestZ) this.lowestZ = lowestToolZ;
        }
      }
    }
  }

  /**
   * Finds how low the tool reaches over a grid node.
   * A node stays under the flat cutter along a whole chord of the segment,
   * and on a ramp the lowest point of that chord is at one of its ends.
   *
   * @returns Tool height, or `null` when the footprint does not cover the node.
   */
  private lowestToolZAt(
    nodeX: number,
    nodeY: number,
    startX: number,
    startY: number,
    startZ: number,
    deltaX: number,
    deltaY: number,
    endZ: number,
  ): number | null {
    const offsetX = nodeX - startX;
    const offsetY = nodeY - startY;
    const planarLengthSquared = deltaX * deltaX + deltaY * deltaY;

    let closestFraction = 0;
    if (planarLengthSquared > 0) {
      closestFraction = Math.min(Math.max((offsetX * deltaX + offsetY * deltaY) / planarLengthSquared, 0), 1);
    }
    const perpendicularX = offsetX - deltaX * closestFraction;
    const perpendicularY = offsetY - deltaY * closestFraction;
    const distanceSquared = perpendicularX * perpendicularX + perpendicularY * perpendicularY;
    if (distanceSquared > this.toolRadiusSquared) return null;

    if (planarLengthSquared === 0) return Math.min(startZ, endZ);

    const halfChordFraction = Math.sqrt((this.toolRadiusSquared - distanceSquared) / planarLengthSquared);
    const chordStart = Math.max(closestFraction - halfChordFraction, 0);
    const chordEnd = Math.min(closestFraction + halfChordFraction, 1);
    const deltaZ = endZ - startZ;
    return Math.min(startZ + deltaZ * chordStart, startZ + deltaZ * chordEnd);
  }
}

/**
 * Predicts the machined part: sweeps a flat-end cutter along all cutting moves
 * and keeps the lowest height at each grid node.
 *
 * @returns The relief, or `null` when the program removes no material, such as a flat contour.
 */
export function computeRelief(toolpath: Toolpath, options: ReliefOptions): Relief | null {
  if (options.toolDiameter <= 0 || options.maxResolution < MIN_GRID_NODES) return null;

  const toolRadius = options.toolDiameter / 2;
  const stock = options.stock ?? estimateStock(toolpath, toolRadius);
  if (!stock) return null;
  const stockTopZ = stock.topZ;
  const stockWidth = stock.maxX - stock.minX;
  const stockDepth = stock.maxY - stock.minY;
  const cellSize = Math.max(stockWidth, stockDepth) / (options.maxResolution - 1);

  const grid = new CarvableHeightGrid(
    Math.max(Math.ceil(stockWidth / cellSize) + 1, MIN_GRID_NODES),
    Math.max(Math.ceil(stockDepth / cellSize) + 1, MIN_GRID_NODES),
    stock.minX,
    stock.minY,
    cellSize,
    stockTopZ,
    toolRadius,
  );

  const coordinates = toolpath.segmentCoordinates;
  for (let segmentIndex = 0; segmentIndex < toolpath.segmentCount; segmentIndex += 1) {
    if (toolpath.segmentKinds[segmentIndex] !== SegmentKind.Feed) continue;
    const offset = segmentIndex * COORDINATES_PER_SEGMENT;
    const startZ = coordinates[offset + 2] as number;
    const endZ = coordinates[offset + 5] as number;
    if (startZ >= stockTopZ && endZ >= stockTopZ) continue;
    grid.carveSegment(
      coordinates[offset] as number,
      coordinates[offset + 1] as number,
      startZ,
      coordinates[offset + 3] as number,
      coordinates[offset + 4] as number,
      endZ,
    );
  }

  // An untouched workpiece of known size is still worth showing; an estimated one does not exist.
  if (!options.stock && grid.lowestZ >= stockTopZ) return null;
  return {
    columnCount: grid.columnCount,
    rowCount: grid.rowCount,
    originX: grid.originX,
    originY: grid.originY,
    cellSize: grid.cellSize,
    heights: grid.heights,
    stockTopZ,
    stockBottomZ: options.stock?.bottomZ ?? null,
    lowestZ: grid.lowestZ,
  };
}
