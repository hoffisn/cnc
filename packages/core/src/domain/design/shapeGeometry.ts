import {
  EndType,
  FillRule,
  JoinType,
  PointInPolygonResult,
  inflatePathsD,
  isPositiveD,
  pointInPolygonD,
  ramerDouglasPeuckerD,
  unionD,
  type PathD,
  type PathsD,
} from 'clipper2-ts';
import { ShapeCut, ToolSide, type SheetPath, type SheetPoint } from './designOperation';
import type { SheetRectangle } from './operationGeometry';

/** What the shape geometry needs to know about an operation, whatever produced its paths. */
export interface ShapeCutSpec {
  readonly paths: readonly SheetPath[];
  readonly cut: ShapeCut;
  readonly toolSide: ToolSide;
}

/** Line the tool center follows. */
export interface ToolLine {
  readonly points: readonly SheetPoint[];
  readonly isClosed: boolean;
}

/** Longest straight piece used when a curve is turned into segments. */
const CURVE_SEGMENT_LENGTH_MM = 0.5;
const MIN_CURVE_SEGMENTS = 4;
const MAX_CURVE_SEGMENTS = 64;
/** Coordinates are kept to a micrometer: far finer than any machine moves. */
const CLIPPER_DECIMAL_PRECISION = 3;
/** Largest gap between a rounded corner of an offset and the true arc. */
const ARC_TOLERANCE_MM = 0.01;
/** Points closer than this to a straight line through their neighbors are dropped. */
const SIMPLIFY_TOLERANCE_MM = 0.002;
const MITER_LIMIT = 2;
/** Spacing of the checks that a move between pocket rings stays inside the pocket. */
const LINK_SAMPLE_STEP_MM = 0.5;
const DISTANCE_EPSILON = 1e-9;

const toSheetPoint = ({ x, y }: { x: number; y: number }): SheetPoint => ({ x, y });

/** Point on a centripetal Catmull–Rom span between `p1` and `p2`: a smooth curve without loops or cusps. */
function catmullRomPoint(p0: SheetPoint, p1: SheetPoint, p2: SheetPoint, p3: SheetPoint, fraction: number): SheetPoint {
  const knot = (from: SheetPoint, to: SheetPoint): number => Math.max(Math.sqrt(Math.hypot(to.x - from.x, to.y - from.y)), DISTANCE_EPSILON);
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * fraction;
  const mix = (a: SheetPoint, b: SheetPoint, ta: number, tb: number): SheetPoint => {
    const weight = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * weight, y: a.y + (b.y - a.y) * weight };
  };
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

/** Turns a path into the points the tool passes through: smooth paths become many short segments. */
export function flattenSheetPath(path: SheetPath): SheetPoint[] {
  const { points, isClosed } = path;
  if (!path.isSmooth || points.length < 3) return [...points];
  const count = points.length;
  const at = (index: number): SheetPoint =>
    (isClosed ? points[((index % count) + count) % count] : points[Math.min(Math.max(index, 0), count - 1)]) as SheetPoint;
  const spanCount = isClosed ? count : count - 1;
  const flattened: SheetPoint[] = [at(0)];
  for (let span = 0; span < spanCount; span += 1) {
    const p1 = at(span);
    const p2 = at(span + 1);
    const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const segments = Math.min(Math.max(Math.ceil(length / CURVE_SEGMENT_LENGTH_MM), MIN_CURVE_SEGMENTS), MAX_CURVE_SEGMENTS);
    for (let segment = 1; segment <= segments; segment += 1) {
      flattened.push(catmullRomPoint(at(span - 1), p1, p2, at(span + 2), segment / segments));
    }
  }
  if (isClosed) flattened.pop();
  return flattened;
}

/** Drops points lying closer than the tolerance to a straight line through their neighbors. */
export function simplifyLine(points: readonly SheetPoint[], toleranceMm: number): SheetPoint[] {
  return points.length < 3 ? [...points] : ramerDouglasPeuckerD(points as PathD, toleranceMm).map(toSheetPoint);
}

/** Whether a path has enough points to mean anything. */
export const isUsablePath = (path: SheetPath): boolean => path.points.length >= (path.isClosed ? 3 : 2);

/** The area bounded by the closed paths; a path inside another one cuts a hole in it. */
function findRegion(paths: readonly SheetPath[]): PathsD {
  const closed = paths.filter((path) => path.isClosed && isUsablePath(path)).map(flattenSheetPath);
  return closed.length === 0 ? [] : unionD(closed, FillRule.EvenOdd);
}

function offsetRegion(region: PathsD, distance: number): PathsD {
  if (distance === 0) return region;
  return inflatePathsD(region, distance, JoinType.Round, EndType.Polygon, MITER_LIMIT, CLIPPER_DECIMAL_PRECISION, ARC_TOLERANCE_MM);
}

const toToolLine = (path: PathD): ToolLine => ({
  points: ramerDouglasPeuckerD(path, SIMPLIFY_TOLERANCE_MM).map(toSheetPoint),
  isClosed: true,
});

/**
 * Closed rings come out of the clipping library counter-clockwise around areas and clockwise around holes.
 * When the material to keep is the area itself, they are reversed: climb milling keeps the material on the right.
 */
function orientRings(rings: PathsD, isMaterialInside: boolean): ToolLine[] {
  return rings.map((ring) => toToolLine(isMaterialInside ? [...ring].reverse() : ring));
}

/** Open lines of a shape, followed as drawn. */
function listOpenLines(paths: readonly SheetPath[]): ToolLine[] {
  return paths
    .filter((path) => !path.isClosed && isUsablePath(path))
    .map((path) => ({ points: flattenSheetPath(path), isClosed: false }));
}

/** Lines the tool follows to cut a shape along its edge, on the chosen side of it. */
export function planShapeOutline(spec: ShapeCutSpec, toolRadius: number): ToolLine[] {
  const region = findRegion(spec.paths);
  switch (spec.toolSide) {
    case ToolSide.Outside:
      return [...orientRings(offsetRegion(region, toolRadius), true), ...listOpenLines(spec.paths)];
    case ToolSide.Inside:
      return [...orientRings(offsetRegion(region, -toolRadius), false), ...listOpenLines(spec.paths)];
    case ToolSide.OnLine:
      return planShapeEngraving(spec);
  }
}

/** Lines the tool follows to engrave a shape: its own paths, without any offset. */
export function planShapeEngraving(spec: ShapeCutSpec): ToolLine[] {
  return spec.paths.filter(isUsablePath).map((path) => ({ points: flattenSheetPath(path), isClosed: path.isClosed }));
}

/**
 * Rings that clear a pocket, from the wall inward: each level is the previous one shrunk by the step over.
 * Every level may hold several rings when the shape narrows into separate parts.
 */
export function planShapePocket(spec: ShapeCutSpec, toolRadius: number, stepOverMm: number): ToolLine[][] {
  const region = findRegion(spec.paths);
  const levels: ToolLine[][] = [];
  for (let inset = toolRadius; ; inset += stepOverMm) {
    const rings = offsetRegion(region, -inset);
    if (rings.length === 0) break;
    levels.push(orientRings(rings, false));
  }
  return levels;
}

/** Whether a point lies in the area bounded by rings, counting holes by the rings' direction. */
function isInsideRings(point: SheetPoint, rings: readonly ToolLine[]): boolean {
  let winding = 0;
  for (const ring of rings) {
    const path = ring.points as PathD;
    if (pointInPolygonD(point, path, CLIPPER_DECIMAL_PRECISION) !== PointInPolygonResult.IsOutside) {
      winding += isPositiveD(path) ? 1 : -1;
    }
  }
  return winding > 0;
}

/**
 * Whether the tool can move straight between two points at cutting depth without touching the walls:
 * the whole move must stay within the area its center may reach, bounded by the outermost pocket level.
 */
export function isMoveInsidePocket(from: SheetPoint, to: SheetPoint, wallLevel: readonly ToolLine[]): boolean {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const samples = Math.max(Math.ceil(length / LINK_SAMPLE_STEP_MM), 1);
  for (let sample = 0; sample <= samples; sample += 1) {
    const fraction = sample / samples;
    if (!isInsideRings({ x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction }, wallLevel)) {
      return false;
    }
  }
  return true;
}

/** Whether the shape bounds an area at all, as an outline or a pocket needs. */
export const hasClosedArea = (paths: readonly SheetPath[]): boolean => findRegion(paths).length > 0;

/** Bounds of everything the paths draw. */
export function findPathsBounds(paths: readonly SheetPath[]): SheetRectangle | null {
  let bounds: SheetRectangle | null = null;
  for (const path of paths) {
    for (const { x, y } of flattenSheetPath(path)) {
      bounds = bounds
        ? { minX: Math.min(bounds.minX, x), minY: Math.min(bounds.minY, y), maxX: Math.max(bounds.maxX, x), maxY: Math.max(bounds.maxY, y) }
        : { minX: x, minY: y, maxX: x, maxY: y };
    }
  }
  return bounds;
}

/** How far the cut reaches beyond the drawn lines, for the given cut. */
export function measureShapeCutMargin(spec: ShapeCutSpec, toolDiameter: number): number {
  switch (spec.cut) {
    case ShapeCut.Pocket:
      return 0;
    case ShapeCut.Engrave:
      return toolDiameter / 2;
    case ShapeCut.Outline:
      switch (spec.toolSide) {
        case ToolSide.Outside:
          return toolDiameter;
        case ToolSide.OnLine:
          return toolDiameter / 2;
        case ToolSide.Inside:
          return listOpenLines(spec.paths).length > 0 ? toolDiameter / 2 : 0;
      }
  }
}
