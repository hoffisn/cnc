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

/** Adds one flat side wall running along a list of grid nodes. */
function addSideWall(
  buffers: MeshBuffers,
  relief: Relief,
  baseZ: number,
  nodes: readonly (readonly [number, number])[],
  normalX: number,
  normalY: number,
): void {
  const { columnCount, originX, originY, cellSize, heights } = relief;
  let previousTop = -1;
  let previousBottom = -1;
  nodes.forEach(([column, row], nodeIndex) => {
    const x = originX + column * cellSize;
    const y = originY + row * cellSize;
    const top = addVertex(buffers, x, y, heights[row * columnCount + column] as number, normalX, normalY, 0, STOCK_SIDE_COLOR);
    const bottom = addVertex(buffers, x, y, baseZ, normalX, normalY, 0, STOCK_SIDE_COLOR);
    if (nodeIndex > 0) addQuad(buffers, previousBottom, bottom, top, previousTop);
    previousTop = top;
    previousBottom = bottom;
  });
}

/** Closes the bottom of the stock. */
function addBottom(buffers: MeshBuffers, relief: Relief, baseZ: number): void {
  const { columnCount, rowCount, originX, originY, cellSize } = relief;
  const maxX = originX + (columnCount - 1) * cellSize;
  const maxY = originY + (rowCount - 1) * cellSize;
  const corners = [
    addVertex(buffers, originX, originY, baseZ, 0, 0, -1, STOCK_SIDE_COLOR),
    addVertex(buffers, originX, maxY, baseZ, 0, 0, -1, STOCK_SIDE_COLOR),
    addVertex(buffers, maxX, maxY, baseZ, 0, 0, -1, STOCK_SIDE_COLOR),
    addVertex(buffers, maxX, originY, baseZ, 0, 0, -1, STOCK_SIDE_COLOR),
  ] as const;
  addQuad(buffers, corners[0], corners[1], corners[2], corners[3]);
}

/** Height of the bottom of the solid drawn for a relief. */
export function computeReliefBaseZ(relief: Relief): number {
  const { cellSize, stockTopZ, stockBottomZ, lowestZ } = relief;
  if (stockBottomZ !== null && stockBottomZ < lowestZ) return stockBottomZ;
  return lowestZ - Math.max((stockTopZ - lowestZ) * BASE_THICKNESS_IN_CUT_DEPTHS, cellSize * MIN_BASE_THICKNESS_IN_CELLS);
}

/** Builds a closed solid: the machined surface, four walls and a bottom. */
function buildReliefGeometry(relief: Relief): BufferGeometry {
  const { columnCount, rowCount } = relief;
  const baseZ = computeReliefBaseZ(relief);

  const wallVertexCount = (columnCount + rowCount) * 4;
  const vertexCapacity = columnCount * rowCount + wallVertexCount + 4;
  const quadCapacity = (columnCount - 1) * (rowCount - 1) + (columnCount + rowCount) * 2 + 1;
  const buffers: MeshBuffers = {
    positions: new Float32Array(vertexCapacity * 3),
    normals: new Float32Array(vertexCapacity * 3),
    colors: new Float32Array(vertexCapacity * 3),
    indices: new Uint32Array(quadCapacity * 6),
    vertexCount: 0,
    indexCount: 0,
  };

  addTopSurface(buffers, relief);

  const lastColumn = columnCount - 1;
  const lastRow = rowCount - 1;
  const alongColumns = (row: number, reversed: boolean): (readonly [number, number])[] => {
    const nodes = Array.from({ length: columnCount }, (_, column) => [column, row] as const);
    return reversed ? nodes.reverse() : nodes;
  };
  const alongRows = (column: number, reversed: boolean): (readonly [number, number])[] => {
    const nodes = Array.from({ length: rowCount }, (_, row) => [column, row] as const);
    return reversed ? nodes.reverse() : nodes;
  };
  addSideWall(buffers, relief, baseZ, alongColumns(0, false), 0, -1);
  addSideWall(buffers, relief, baseZ, alongRows(lastColumn, false), 1, 0);
  addSideWall(buffers, relief, baseZ, alongColumns(lastRow, true), 0, 1);
  addSideWall(buffers, relief, baseZ, alongRows(0, true), -1, 0);
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
