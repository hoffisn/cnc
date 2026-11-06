import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial } from 'three';
import type { Relief } from '@rezets/core';

const STOCK_TOP_COLOR = new Color('#e4e7ec');
const CUT_SHALLOW_COLOR = new Color('#d6dae0');
const CUT_DEEP_COLOR = new Color('#a3acb9');
const STOCK_SIDE_COLOR = new Color('#b4bac4');

/** Stock thickness under the deepest cut, relative to the depth of cut. */
const BASE_THICKNESS_IN_CUT_DEPTHS = 0.35;
const MIN_BASE_THICKNESS_IN_CELLS = 3;

/** Heights closer to the stock top than this fraction of the cell are treated as uncut. */
const UNCUT_EPSILON = 1e-4;

/** Distances below this, in millimeters, mean the grid lies on the edge of the stock. */
const OUTLINE_EPSILON = 1e-6;

/** Growing arrays for a mesh whose final size is known up front. */
interface MeshBuffers {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
}

function addVertex(buffers: MeshBuffers, x: number, y: number, z: number, nx: number, ny: number, nz: number, color: Color): number {
  const vertex = buffers.vertexCount;
  buffers.positions.set([x, y, z], vertex * 3);
  buffers.normals.set([nx, ny, nz], vertex * 3);
  buffers.colors.set([color.r, color.g, color.b], vertex * 3);
  buffers.vertexCount += 1;
  return vertex;
}

/** Adds a quad given its vertices in counter-clockwise order as seen from outside. */
function addQuad(buffers: MeshBuffers, a: number, b: number, c: number, d: number): void {
  buffers.indices.set([a, b, c, a, c, d], buffers.indexCount);
  buffers.indexCount += 6;
}

/** Adds the machined surface as a smooth-shaded grid. */
function addTopSurface(buffers: MeshBuffers, relief: Relief): void {
  const { columnCount, rowCount, originX, originY, cellSize, heights, stockTopZ, lowestZ } = relief;
  const depthRange = Math.max(stockTopZ - lowestZ, UNCUT_EPSILON);
  const heightAt = (column: number, row: number): number =>
    heights[Math.min(Math.max(row, 0), rowCount - 1) * columnCount + Math.min(Math.max(column, 0), columnCount - 1)] as number;
  const color = new Color();

  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const height = heightAt(column, row);
      const slopeX = (heightAt(column + 1, row) - heightAt(column - 1, row)) / (2 * cellSize);
      const slopeY = (heightAt(column, row + 1) - heightAt(column, row - 1)) / (2 * cellSize);
      const normalScale = 1 / Math.hypot(slopeX, slopeY, 1);

      const depth = stockTopZ - height;
      if (depth <= UNCUT_EPSILON) color.copy(STOCK_TOP_COLOR);
      else color.lerpColors(CUT_SHALLOW_COLOR, CUT_DEEP_COLOR, depth / depthRange);

      addVertex(
        buffers,
        originX + column * cellSize,
        originY + row * cellSize,
        height,
        -slopeX * normalScale,
        -slopeY * normalScale,
        normalScale,
        color,
      );
    }
  }

  for (let row = 0; row < rowCount - 1; row += 1) {
    for (let column = 0; column < columnCount - 1; column += 1) {
      const corner = row * columnCount + column;
      addQuad(buffers, corner, corner + 1, corner + columnCount + 1, corner + columnCount);
    }
  }
}

/** Top of a point on the outline of the stock. */
interface OutlinePoint {
  readonly x: number;
  readonly y: number;
  readonly topZ: number;
}

/** Adds an uncut rectangle of the stock top. */
function addFlatTop(buffers: MeshBuffers, z: number, minX: number, minY: number, maxX: number, maxY: number): void {
  if (maxX - minX <= OUTLINE_EPSILON || maxY - minY <= OUTLINE_EPSILON) return;
  addQuad(
    buffers,
    addVertex(buffers, minX, minY, z, 0, 0, 1, STOCK_TOP_COLOR),
    addVertex(buffers, maxX, minY, z, 0, 0, 1, STOCK_TOP_COLOR),
    addVertex(buffers, maxX, maxY, z, 0, 0, 1, STOCK_TOP_COLOR),
    addVertex(buffers, minX, maxY, z, 0, 0, 1, STOCK_TOP_COLOR),
  );
}

/**
 * Fills the stock top between the grid and the outline.
 * The strips are split at every grid node on their shared edge, so the flat top and the grid
 * meet without T-junctions, which would show as flickering cracks.
 */
function addUncutStock(buffers: MeshBuffers, relief: Relief, gridMaxX: number, gridMaxY: number): void {
  const { stockOutline: outline, originX, originY, cellSize, columnCount, rowCount, stockTopZ } = relief;
  for (let column = 0; column < columnCount - 1; column += 1) {
    const left = originX + column * cellSize;
    const right = left + cellSize;
    addFlatTop(buffers, stockTopZ, left, outline.minY, right, originY);
    addFlatTop(buffers, stockTopZ, left, gridMaxY, right, outline.maxY);
  }
  const rowEdges = [outline.minY, ...Array.from({ length: rowCount }, (_, row) => originY + row * cellSize), outline.maxY];
  for (let edge = 0; edge < rowEdges.length - 1; edge += 1) {
    const bottom = rowEdges[edge] as number;
    const top = rowEdges[edge + 1] as number;
    addFlatTop(buffers, stockTopZ, outline.minX, bottom, originX, top);
    addFlatTop(buffers, stockTopZ, gridMaxX, bottom, outline.maxX, top);
  }
}

/** Adds one flat side wall running along a list of outline points. */
function addSideWall(
  buffers: MeshBuffers,
  baseZ: number,
  points: readonly OutlinePoint[],
  normalX: number,
  normalY: number,
): void {
  let previousTop = -1;
  let previousBottom = -1;
  points.forEach(({ x, y, topZ }, pointIndex) => {
    const top = addVertex(buffers, x, y, topZ, normalX, normalY, 0, STOCK_SIDE_COLOR);
    const bottom = addVertex(buffers, x, y, baseZ, normalX, normalY, 0, STOCK_SIDE_COLOR);
    if (pointIndex > 0) addQuad(buffers, previousBottom, bottom, top, previousTop);
    previousTop = top;
    previousBottom = bottom;
  });
}

/** Adds the four walls; where the grid reaches the edge of the stock, the wall follows the cut. */
function addSideWalls(buffers: MeshBuffers, relief: Relief, baseZ: number, gridMaxX: number, gridMaxY: number): void {
  const { stockOutline: outline, originX, originY, cellSize, columnCount, rowCount, heights, stockTopZ } = relief;
  const lastColumn = columnCount - 1;
  const lastRow = rowCount - 1;
  const gridRow = (row: number): OutlinePoint[] =>
    Array.from({ length: columnCount }, (_, column) => ({
      x: originX + column * cellSize,
      y: originY + row * cellSize,
      topZ: heights[row * columnCount + column] as number,
    }));
  const gridColumn = (column: number): OutlinePoint[] =>
    Array.from({ length: rowCount }, (_, row) => ({
      x: originX + column * cellSize,
      y: originY + row * cellSize,
      topZ: heights[row * columnCount + column] as number,
    }));
  const corner = (x: number, y: number): OutlinePoint => ({ x, y, topZ: stockTopZ });
  const touches = (gridEdge: number, outlineEdge: number): boolean => Math.abs(gridEdge - outlineEdge) <= OUTLINE_EPSILON;

  const front = touches(originY, outline.minY) ? gridRow(0) : [];
  const right = touches(gridMaxX, outline.maxX) ? gridColumn(lastColumn) : [];
  const back = touches(gridMaxY, outline.maxY) ? gridRow(lastRow).reverse() : [];
  const left = touches(originX, outline.minX) ? gridColumn(0).reverse() : [];

  addSideWall(buffers, baseZ, [corner(outline.minX, outline.minY), ...front, corner(outline.maxX, outline.minY)], 0, -1);
  addSideWall(buffers, baseZ, [corner(outline.maxX, outline.minY), ...right, corner(outline.maxX, outline.maxY)], 1, 0);
  addSideWall(buffers, baseZ, [corner(outline.maxX, outline.maxY), ...back, corner(outline.minX, outline.maxY)], 0, 1);
  addSideWall(buffers, baseZ, [corner(outline.minX, outline.maxY), ...left, corner(outline.minX, outline.minY)], -1, 0);
}

/** Closes the bottom of the stock. */
function addBottom(buffers: MeshBuffers, relief: Relief, baseZ: number): void {
  const { minX, minY, maxX, maxY } = relief.stockOutline;
  const corners = [
    addVertex(buffers, minX, minY, baseZ, 0, 0, -1, STOCK_SIDE_COLOR),
    addVertex(buffers, minX, maxY, baseZ, 0, 0, -1, STOCK_SIDE_COLOR),
    addVertex(buffers, maxX, maxY, baseZ, 0, 0, -1, STOCK_SIDE_COLOR),
    addVertex(buffers, maxX, minY, baseZ, 0, 0, -1, STOCK_SIDE_COLOR),
  ] as const;
  addQuad(buffers, corners[0], corners[1], corners[2], corners[3]);
}

/** Height of the bottom of the solid drawn for a relief. */
export function computeReliefBaseZ(relief: Relief): number {
  const { cellSize, stockTopZ, stockBottomZ, lowestZ } = relief;
  if (stockBottomZ !== null && stockBottomZ < lowestZ) return stockBottomZ;
  return lowestZ - Math.max((stockTopZ - lowestZ) * BASE_THICKNESS_IN_CUT_DEPTHS, cellSize * MIN_BASE_THICKNESS_IN_CELLS);
}

/** Builds a closed solid: the machined surface, the uncut stock around it, four walls and a bottom. */
function buildReliefGeometry(relief: Relief): BufferGeometry {
  const { columnCount, rowCount, originX, originY, cellSize } = relief;
  const baseZ = computeReliefBaseZ(relief);
  const gridMaxX = originX + (columnCount - 1) * cellSize;
  const gridMaxY = originY + (rowCount - 1) * cellSize;

  const flatQuadCapacity = 2 * columnCount + 2 * (rowCount + 1);
  const wallPointCapacity = 2 * (columnCount + rowCount) + 8;
  const vertexCapacity = columnCount * rowCount + flatQuadCapacity * 4 + wallPointCapacity * 2 + 4;
  const quadCapacity = (columnCount - 1) * (rowCount - 1) + flatQuadCapacity + wallPointCapacity + 1;
  const buffers: MeshBuffers = {
    positions: new Float32Array(vertexCapacity * 3),
    normals: new Float32Array(vertexCapacity * 3),
    colors: new Float32Array(vertexCapacity * 3),
    indices: new Uint32Array(quadCapacity * 6),
    vertexCount: 0,
    indexCount: 0,
  };

  addTopSurface(buffers, relief);
  addUncutStock(buffers, relief, gridMaxX, gridMaxY);
  addSideWalls(buffers, relief, baseZ, gridMaxX, gridMaxY);
  addBottom(buffers, relief, baseZ);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(buffers.positions.subarray(0, buffers.vertexCount * 3), 3));
  geometry.setAttribute('normal', new BufferAttribute(buffers.normals.subarray(0, buffers.vertexCount * 3), 3));
  geometry.setAttribute('color', new BufferAttribute(buffers.colors.subarray(0, buffers.vertexCount * 3), 3));
  geometry.setIndex(new BufferAttribute(buffers.indices.subarray(0, buffers.indexCount), 1));
  return geometry;
}

/** Draws the predicted machined part. */
export class ReliefMesh {
  readonly mesh: Mesh<BufferGeometry, MeshStandardMaterial>;

  constructor() {
    this.mesh = new Mesh(
      new BufferGeometry(),
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.08 }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Replaces the shown part; `null` hides it. */
  setRelief(relief: Relief | null): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = relief ? buildReliefGeometry(relief) : new BufferGeometry();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
