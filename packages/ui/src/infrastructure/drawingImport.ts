import DxfParser, {
  type IArcEntity,
  type ICircleEntity,
  type IEllipseEntity,
  type IEntity,
  type ILineEntity,
  type ILwpolylineEntity,
  type IPolylineEntity,
  type ISplineEntity,
} from 'dxf-parser';
import { err, ok, simplifyLine, type Result, type SheetPath, type SheetPoint } from '@rezets/core';

/** File formats a drawing can be imported from. */
export enum DrawingFormat {
  Svg = 'svg',
  Dxf = 'dxf',
}

/** Why a drawing could not be imported. */
export enum DrawingImportFailure {
  UnknownFormat = 'unknown-format',
  Unreadable = 'unreadable',
  /** The file holds no lines the machine could follow. */
  NoLines = 'no-lines',
}

/** Largest gap between a curve and the straight segments that replace it. */
const CHORD_TOLERANCE_MM = 0.01;
/** Distance between points read along an SVG curve. */
const SVG_SAMPLE_STEP_MM = 0.2;
/** Limit that keeps a huge drawing from freezing the interface. */
const MAX_SVG_SAMPLES_PER_ELEMENT = 20_000;
/** Ends of lines closer than this are joined, as drawings are rarely exact. */
const JOIN_TOLERANCE_MM = 0.01;
const SIMPLIFY_TOLERANCE_MM = 0.01;
const MIN_ARC_SEGMENTS = 8;
const FULL_TURN = 2 * Math.PI;

/** Millimeters per unit of SVG lengths, as defined by CSS. */
const SVG_UNIT_MILLIMETERS: Readonly<Record<string, number>> = {
  mm: 1,
  cm: 10,
  in: 25.4,
  pt: 25.4 / 72,
  pc: 25.4 / 6,
  px: 25.4 / 96,
  '': 25.4 / 96,
};

/** Millimeters per drawing unit, by the code of DXF's `$INSUNITS` header variable. */
const DXF_UNIT_MILLIMETERS: Readonly<Record<number, number>> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };

/** Elements that are only referenced from elsewhere and are not drawn where they stand. */
const NON_RENDERED_CONTAINERS = 'defs, clipPath, mask, symbol, marker, pattern';
const SVG_SHAPES = 'path, rect, circle, ellipse, line, polyline, polygon';
const CLOSED_SVG_SHAPES = new Set(['rect', 'circle', 'ellipse', 'polygon']);

export function detectDrawingFormat(fileName: string): DrawingFormat | null {
  const extension = fileName.toLowerCase().split('.').pop();
  if (extension === 'svg') return DrawingFormat.Svg;
  if (extension === 'dxf') return DrawingFormat.Dxf;
  return null;
}

/**
 * Reads the lines of a drawing in millimeters, with Y pointing up as on the sheet.
 * Where the drawing lands on the sheet is decided by the caller.
 */
export function importDrawing(fileName: string, text: string): Result<SheetPath[], DrawingImportFailure> {
  const format = detectDrawingFormat(fileName);
  if (!format) return err(DrawingImportFailure.UnknownFormat);
  const paths = format === DrawingFormat.Svg ? readSvg(text) : readDxf(text);
  if (!paths) return err(DrawingImportFailure.Unreadable);
  const usable = paths
    .map((path) => ({ ...path, points: path.isSmooth ? path.points : simplifyLine(path.points, SIMPLIFY_TOLERANCE_MM) }))
    .filter((path) => path.points.length >= (path.isClosed ? 3 : 2));
  return usable.length > 0 ? ok(usable) : err(DrawingImportFailure.NoLines);
}

const distance = (first: SheetPoint, second: SheetPoint): number => Math.hypot(first.x - second.x, first.y - second.y);

/** Number of straight segments that keep an arc within the chord tolerance. */
function countArcSegments(radius: number, sweep: number): number {
  if (radius <= CHORD_TOLERANCE_MM) return MIN_ARC_SEGMENTS;
  const stepAngle = 2 * Math.acos(1 - CHORD_TOLERANCE_MM / radius);
  return Math.max(Math.ceil(Math.abs(sweep) / stepAngle), MIN_ARC_SEGMENTS);
}

/** Points along an arc, both ends included; a positive sweep runs counter-clockwise. */
function sampleArc(center: SheetPoint, radius: number, startAngle: number, sweep: number): SheetPoint[] {
  const segments = countArcSegments(radius, sweep);
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = startAngle + (sweep * index) / segments;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

// ---------------------------------------------------------------- SVG

/** Reads a CSS length such as `210mm` in millimeters; `null` for percentages and other relative values. */
function parseSvgLengthMm(value: string | null): number | null {
  const match = value?.trim().match(/^([\d.eE+-]+)\s*([a-z]*)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unitMm = SVG_UNIT_MILLIMETERS[match[2] ?? ''];
  return Number.isFinite(amount) && amount > 0 && unitMm !== undefined ? amount * unitMm : null;
}

/**
 * Millimeters per user unit: the document's real width over its view box width.
 * Without a view box, user units are CSS pixels whatever the document's size.
 */
function measureSvgUserUnit(root: SVGSVGElement): number {
  const widthMm = parseSvgLengthMm(root.getAttribute('width'));
  const viewBox = root.viewBox.baseVal;
  const pixelMm = SVG_UNIT_MILLIMETERS.px as number;
  return widthMm !== null && viewBox && viewBox.width > 0 ? widthMm / viewBox.width : pixelMm;
}

/**
 * Makes one rendered pixel of the root equal one user unit, so measured positions need no
 * view box scaling or alignment; returns the view box origin to add back.
 */
function flattenSvgViewport(root: SVGSVGElement): SheetPoint {
  const viewBox = root.viewBox.baseVal;
  if (!viewBox || viewBox.width <= 0 || viewBox.height <= 0) return { x: 0, y: 0 };
  root.setAttribute('width', String(viewBox.width));
  root.setAttribute('height', String(viewBox.height));
  root.setAttribute('preserveAspectRatio', 'none');
  return { x: viewBox.x, y: viewBox.y };
}

/** Splits samples where the line jumps, as a path with several subpaths does between them. */
function splitAtJumps(points: readonly SheetPoint[], jumpLength: number): SheetPoint[][] {
  const runs: SheetPoint[][] = [];
  let current: SheetPoint[] = [];
  for (const point of points) {
    const previous = current[current.length - 1];
    if (previous && distance(previous, point) > jumpLength) {
      runs.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/**
 * Reads SVG through the browser itself, which knows every curve command and transform.
 * The document is rendered off screen just long enough to measure its shapes.
 */
function readSvg(text: string): SheetPath[] | null {
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const source = parsed.documentElement;
  if (parsed.querySelector('parsererror') || source.nodeName.toLowerCase() !== 'svg') return null;

  const root = document.importNode(source, true) as unknown as SVGSVGElement;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none';
  host.appendChild(root);
  document.body.appendChild(host);
  try {
    const userUnitMm = measureSvgUserUnit(root);
    const viewBoxOrigin = flattenSvgViewport(root);
    const rootToScreen = root.getScreenCTM();
    if (!rootToScreen) return null;
    const screenToRoot = rootToScreen.inverse();
    const paths: SheetPath[] = [];

    for (const element of root.querySelectorAll<SVGGeometryElement>(SVG_SHAPES)) {
      if (element.closest(NON_RENDERED_CONTAINERS)) continue;
      const elementToScreen = element.getScreenCTM();
      const length = element.getTotalLength();
      if (!elementToScreen || !(length > 0)) continue;
      const toRoot = screenToRoot.multiply(elementToScreen);
      const elementScale = Math.hypot(toRoot.a, toRoot.b) * userUnitMm;
      const sampleCount = Math.min(Math.ceil((length * elementScale) / SVG_SAMPLE_STEP_MM), MAX_SVG_SAMPLES_PER_ELEMENT);
      const samples: SheetPoint[] = [];
      for (let index = 0; index <= sampleCount; index += 1) {
        const local = element.getPointAtLength((length * index) / sampleCount).matrixTransform(toRoot);
        samples.push({ x: (viewBoxOrigin.x + local.x) * userUnitMm, y: -(viewBoxOrigin.y + local.y) * userUnitMm });
      }
      const sampleSpacing = (length * elementScale) / sampleCount;
      const isClosedShape = CLOSED_SVG_SHAPES.has(element.tagName.toLowerCase());
      for (const run of splitAtJumps(samples, sampleSpacing * 3)) {
        const first = run[0];
        const last = run[run.length - 1];
        const isClosed = isClosedShape || (first !== undefined && last !== undefined && run.length > 2 && distance(first, last) <= sampleSpacing * 1.5);
        paths.push({ points: isClosed ? run.slice(0, -1) : run, isClosed, isSmooth: false });
      }
    }
    return paths;
  } finally {
    host.remove();
  }
}

// ---------------------------------------------------------------- DXF

/** Points of a polyline, with arcs where a vertex has a bulge: the tangent of a quarter of the arc's angle. */
function samplePolyline(vertices: readonly { x: number; y: number; bulge?: number }[], isClosed: boolean): SheetPoint[] {
  const points: SheetPoint[] = [];
  const count = vertices.length;
  const segmentCount = isClosed ? count : count - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const from = vertices[index] as { x: number; y: number; bulge?: number };
    const to = vertices[(index + 1) % count] as { x: number; y: number };
    const bulge = from.bulge ?? 0;
    if (Math.abs(bulge) < 1e-9) {
      points.push({ x: from.x, y: from.y });
      continue;
    }
    const sweep = 4 * Math.atan(bulge);
    const chord = distance(from, to);
    const radius = chord / (2 * Math.sin(Math.abs(sweep) / 2));
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const centerDistance = Math.sqrt(Math.max(radius * radius - (chord / 2) ** 2, 0));
    const direction = Math.sign(bulge) * (Math.abs(sweep) > Math.PI ? -1 : 1);
    const center = {
      x: middle.x - (direction * centerDistance * (to.y - from.y)) / chord,
      y: middle.y + (direction * centerDistance * (to.x - from.x)) / chord,
    };
    const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
    points.push(...sampleArc(center, radius, startAngle, sweep).slice(0, -1));
  }
  if (!isClosed) {
    const last = vertices[count - 1];
    if (last) points.push({ x: last.x, y: last.y });
  }
  return points;
}

/** Point of a B-spline found by de Boor's algorithm. */
function evaluateBSpline(controlPoints: readonly SheetPoint[], knots: readonly number[], degree: number, parameter: number): SheetPoint {
  let span = degree;
  while (span < controlPoints.length - 1 && parameter >= (knots[span + 1] as number)) span += 1;
  const points = Array.from({ length: degree + 1 }, (_, index) => ({ ...(controlPoints[span - degree + index] as SheetPoint) }));
  for (let level = 1; level <= degree; level += 1) {
    for (let index = degree; index >= level; index -= 1) {
      const knotIndex = span - degree + index;
      const low = knots[knotIndex] as number;
      const high = knots[knotIndex + degree + 1 - level] as number;
      const weight = high === low ? 0 : (parameter - low) / (high - low);
      const previous = points[index - 1] as SheetPoint;
      const current = points[index] as SheetPoint;
      points[index] = { x: previous.x + (current.x - previous.x) * weight, y: previous.y + (current.y - previous.y) * weight };
    }
  }
  return points[degree] as SheetPoint;
}

function sampleSpline(entity: ISplineEntity): SheetPath | null {
  const isClosed = entity.closed;
  const controlPoints = entity.controlPoints ?? [];
  const degree = entity.degreeOfSplineCurve;
  const knots = entity.knotValues ?? [];
  if (controlPoints.length > degree && knots.length === controlPoints.length + degree + 1) {
    const first = knots[degree] as number;
    const last = knots[controlPoints.length] as number;
    const segments = Math.max(controlPoints.length * 16, 32);
    const points = Array.from({ length: segments + 1 }, (_, index) =>
      evaluateBSpline(controlPoints, knots, degree, first + ((last - first) * index) / segments),
    );
    return { points: isClosed ? points.slice(0, -1) : points, isClosed, isSmooth: false };
  }
  const fitPoints = entity.fitPoints ?? [];
  if (fitPoints.length >= 2) return { points: fitPoints.map(({ x, y }) => ({ x, y })), isClosed, isSmooth: true };
  return null;
}

/** Turns one entity into lines; entities that draw nothing to cut, such as text and dimensions, give none. */
function readDxfEntity(entity: IEntity): SheetPath[] {
  switch (entity.type) {
    case 'LINE': {
      const [start, end] = (entity as ILineEntity).vertices;
      return start && end ? [{ points: [start, end].map(({ x, y }) => ({ x, y })), isClosed: false, isSmooth: false }] : [];
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const polyline = entity as ILwpolylineEntity | IPolylineEntity;
      return [{ points: samplePolyline(polyline.vertices, polyline.shape), isClosed: polyline.shape, isSmooth: false }];
    }
    case 'CIRCLE': {
      const { center, radius } = entity as ICircleEntity;
      return [{ points: sampleArc(center, radius, 0, FULL_TURN).slice(0, -1), isClosed: true, isSmooth: false }];
    }
    case 'ARC': {
      const { center, radius, startAngle, endAngle } = entity as IArcEntity;
      const sweep = (((endAngle - startAngle) % FULL_TURN) + FULL_TURN) % FULL_TURN || FULL_TURN;
      return [{ points: sampleArc(center, radius, startAngle, sweep), isClosed: false, isSmooth: false }];
    }
    case 'ELLIPSE': {
      const { center, majorAxisEndPoint: major, axisRatio, startAngle, endAngle } = entity as IEllipseEntity;
      const sweep = (((endAngle - startAngle) % FULL_TURN) + FULL_TURN) % FULL_TURN || FULL_TURN;
      const isClosed = Math.abs(sweep - FULL_TURN) < 1e-9;
      const radius = Math.hypot(major.x, major.y);
      const segments = countArcSegments(radius, sweep);
      const points = Array.from({ length: segments + 1 }, (_, index) => {
        const parameter = startAngle + (sweep * index) / segments;
        return {
          x: center.x + major.x * Math.cos(parameter) - major.y * axisRatio * Math.sin(parameter),
          y: center.y + major.y * Math.cos(parameter) + major.x * axisRatio * Math.sin(parameter),
        };
      });
      return [{ points: isClosed ? points.slice(0, -1) : points, isClosed, isSmooth: false }];
    }
    case 'SPLINE': {
      const spline = sampleSpline(entity as ISplineEntity);
      return spline ? [spline] : [];
    }
    default:
      return [];
  }
}

/**
 * Joins open lines that continue one another into longer ones, as a part drawn from separate lines and arcs
 * must become one closed outline to be cut out or cleared.
 */
function joinOpenLines(paths: readonly SheetPath[]): SheetPath[] {
  const joined: SheetPath[] = paths.filter((path) => path.isClosed || path.isSmooth);
  const pieces = paths.filter((path) => !path.isClosed && !path.isSmooth).map((path) => [...path.points]);
  while (pieces.length > 0) {
    let chain = pieces.pop() as SheetPoint[];
    let hasGrown = true;
    while (hasGrown) {
      hasGrown = false;
      for (let index = 0; index < pieces.length; index += 1) {
        const piece = pieces[index] as SheetPoint[];
        const chainStart = chain[0] as SheetPoint;
        const chainEnd = chain[chain.length - 1] as SheetPoint;
        const pieceStart = piece[0] as SheetPoint;
        const pieceEnd = piece[piece.length - 1] as SheetPoint;
        let grown: SheetPoint[] | null = null;
        if (distance(chainEnd, pieceStart) <= JOIN_TOLERANCE_MM) grown = [...chain, ...piece.slice(1)];
        else if (distance(chainEnd, pieceEnd) <= JOIN_TOLERANCE_MM) grown = [...chain, ...[...piece].reverse().slice(1)];
        else if (distance(chainStart, pieceEnd) <= JOIN_TOLERANCE_MM) grown = [...piece, ...chain.slice(1)];
        else if (distance(chainStart, pieceStart) <= JOIN_TOLERANCE_MM) grown = [...[...piece].reverse(), ...chain.slice(1)];
        if (grown) {
          chain = grown;
          pieces.splice(index, 1);
          hasGrown = true;
          break;
        }
      }
    }
    const first = chain[0] as SheetPoint;
    const last = chain[chain.length - 1] as SheetPoint;
    const isClosed = chain.length > 3 && distance(first, last) <= JOIN_TOLERANCE_MM;
    joined.push({ points: isClosed ? chain.slice(0, -1) : chain, isClosed, isSmooth: false });
  }
  return joined;
}

function readDxf(text: string): SheetPath[] | null {
  let drawing;
  try {
    drawing = new DxfParser().parseSync(text);
  } catch {
    return null;
  }
  if (!drawing) return null;
  const unitCode = drawing.header.$INSUNITS;
  const unitMm = typeof unitCode === 'number' ? (DXF_UNIT_MILLIMETERS[unitCode] ?? 1) : 1;
  const paths = drawing.entities.filter((entity) => !entity.inPaperSpace).flatMap(readDxfEntity);
  const scaled = paths.map((path) => ({ ...path, points: path.points.map(({ x, y }) => ({ x: x * unitMm, y: y * unitMm })) }));
  return joinOpenLines(scaled);
}
