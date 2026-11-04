import type { Vector3 } from '@core/domain/geometry/vector3';
import { err, ok, type Result } from '@core/domain/shared/result';
import { DiagnosticCode, type DiagnosticDetails } from './diagnostics';
import { ArcPlane, type ArcMove } from './program';

/** Allowed difference between start and end radii: the larger of the two limits applies. */
const RADIUS_TOLERANCE_MM = 0.005;
const RADIUS_TOLERANCE_RATIO = 0.001;
/** Distances below this are treated as coincident points, in millimeters. */
const COINCIDENCE_EPSILON_MM = 1e-6;
/** Sweeps below this are treated as zero, which means a full circle, in radians. */
const ZERO_SWEEP_EPSILON_RAD = 1e-9;
/** Upper bound of one arc's polyline, protecting the renderer from absurdly fine tolerances. */
const MAX_SEGMENTS_PER_ARC = 1440;
const FULL_TURN_RAD = Math.PI * 2;
const QUARTER_TURNS_PER_CIRCLE = 4;

const positiveModulo = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;

/** Point expressed in a plane's own coordinates. */
export interface PlanePoint {
  /** First in-plane axis. */
  readonly first: number;
  /** Second in-plane axis. */
  readonly second: number;
  /** Axis normal to the plane. */
  readonly normal: number;
}

/** Reason why arc parameters do not describe a valid arc. */
export interface ArcCenterFailure {
  readonly code: DiagnosticCode;
  readonly details: DiagnosticDetails;
}

/** Outcome of resolving an arc center. */
export type ArcCenterResult = Result<Vector3, ArcCenterFailure>;

/** Projects a point into the coordinates of an arc plane. */
export function toPlanePoint(point: Vector3, plane: ArcPlane): PlanePoint {
  switch (plane) {
    case ArcPlane.XY:
      return { first: point.x, second: point.y, normal: point.z };
    case ArcPlane.ZX:
      return { first: point.z, second: point.x, normal: point.y };
    case ArcPlane.YZ:
      return { first: point.y, second: point.z, normal: point.x };
  }
}

/** Converts plane coordinates back to a 3D point. */
export function fromPlanePoint(point: PlanePoint, plane: ArcPlane): Vector3 {
  switch (plane) {
    case ArcPlane.XY:
      return { x: point.first, y: point.second, z: point.normal };
    case ArcPlane.ZX:
      return { x: point.second, y: point.normal, z: point.first };
    case ArcPlane.YZ:
      return { x: point.normal, y: point.first, z: point.second };
  }
}

const planarDistance = (start: PlanePoint, end: PlanePoint): number =>
  Math.hypot(start.first - end.first, start.second - end.second);

const radiusToleranceFor = (radiusMm: number): number =>
  Math.max(RADIUS_TOLERANCE_MM, radiusMm * RADIUS_TOLERANCE_RATIO);

/**
 * Validates an explicitly given center (`I`/`J`/`K` format):
 * both arc ends must lie on the same circle within tolerance.
 */
export function validateArcCenter(start: Vector3, end: Vector3, center: Vector3, plane: ArcPlane): ArcCenterResult {
  const planeCenter = toPlanePoint(center, plane);
  const startRadiusMm = planarDistance(toPlanePoint(start, plane), planeCenter);
  const endRadiusMm = planarDistance(toPlanePoint(end, plane), planeCenter);

  if (startRadiusMm < COINCIDENCE_EPSILON_MM) {
    return err({ code: DiagnosticCode.ArcZeroRadius, details: {} });
  }
  if (Math.abs(startRadiusMm - endRadiusMm) > radiusToleranceFor(startRadiusMm)) {
    return err({ code: DiagnosticCode.ArcRadiusMismatch, details: { startRadiusMm, endRadiusMm } });
  }
  return ok(center);
}

/**
 * Computes an arc center from its radius (`R` format).
 *
 * @param signedRadiusMm - Per RS274, a positive radius selects the arc up to 180°,
 * a negative one selects the arc over 180°.
 */
export function computeArcCenterFromRadius(
  start: Vector3,
  end: Vector3,
  signedRadiusMm: number,
  isClockwise: boolean,
  plane: ArcPlane,
): ArcCenterResult {
  const planeStart = toPlanePoint(start, plane);
  const planeEnd = toPlanePoint(end, plane);
  const deltaFirst = planeEnd.first - planeStart.first;
  const deltaSecond = planeEnd.second - planeStart.second;
  const chordLength = Math.hypot(deltaFirst, deltaSecond);
  const radiusMm = Math.abs(signedRadiusMm);

  if (radiusMm < COINCIDENCE_EPSILON_MM) {
    return err({ code: DiagnosticCode.ArcZeroRadius, details: {} });
  }
  if (chordLength < COINCIDENCE_EPSILON_MM) {
    return err({ code: DiagnosticCode.ArcFullCircleByRadius, details: {} });
  }

  const halfChordMm = chordLength / 2;
  if (halfChordMm - radiusMm > radiusToleranceFor(radiusMm)) {
    return err({ code: DiagnosticCode.ArcRadiusTooSmall, details: { radiusMm, halfChordMm } });
  }

  const centerOffset = Math.sqrt(Math.max(radiusMm * radiusMm - halfChordMm * halfChordMm, 0));
  // The center of a minor clockwise arc lies to the right of the travel direction; each flip inverts the side.
  const sideOfTravel = (isClockwise ? -1 : 1) * (signedRadiusMm < 0 ? -1 : 1);
  const center: PlanePoint = {
    first: planeStart.first + deltaFirst / 2 + (sideOfTravel * centerOffset * -deltaSecond) / chordLength,
    second: planeStart.second + deltaSecond / 2 + (sideOfTravel * centerOffset * deltaFirst) / chordLength,
    normal: planeStart.normal,
  };
  return ok(fromPlanePoint(center, plane));
}

/**
 * Computes the angle an arc travels.
 *
 * @returns Sweep in radians within `(0, 2π]`; coinciding ends mean a full circle.
 */
export function computeArcSweep(arc: ArcMove): number {
  const start = toPlanePoint(arc.start, arc.plane);
  const end = toPlanePoint(arc.end, arc.plane);
  const center = toPlanePoint(arc.center, arc.plane);
  const startAngle = Math.atan2(start.second - center.second, start.first - center.first);
  const endAngle = Math.atan2(end.second - center.second, end.first - center.first);
  let sweep = arc.isClockwise ? startAngle - endAngle : endAngle - startAngle;
  while (sweep <= ZERO_SWEEP_EPSILON_RAD) sweep += FULL_TURN_RAD;
  return sweep;
}

/**
 * Finds where an arc reaches its extremes along the in-plane axes.
 * A polyline's vertices generally miss those points, so sizing a figure by them alone would
 * report a circle of 90 mm as 89.96 mm and make any size entered by the operator inexact.
 *
 * @returns Points at every multiple of 90° the arc passes through.
 */
export function findArcExtremePoints(arc: ArcMove): Vector3[] {
  const start = toPlanePoint(arc.start, arc.plane);
  const end = toPlanePoint(arc.end, arc.plane);
  const center = toPlanePoint(arc.center, arc.plane);
  const startRadius = planarDistance(start, center);
  const endRadius = planarDistance(end, center);
  const startAngle = Math.atan2(start.second - center.second, start.first - center.first);
  const sweep = computeArcSweep(arc);
  const rotationSign = arc.isClockwise ? -1 : 1;

  const points: Vector3[] = [];
  for (let quarterIndex = 0; quarterIndex < QUARTER_TURNS_PER_CIRCLE; quarterIndex += 1) {
    const cardinalAngle = (quarterIndex * FULL_TURN_RAD) / QUARTER_TURNS_PER_CIRCLE;
    const traveledAngle = positiveModulo(rotationSign * (cardinalAngle - startAngle), FULL_TURN_RAD);
    if (traveledAngle > sweep) continue;

    const fraction = traveledAngle / sweep;
    const radius = startRadius + (endRadius - startRadius) * fraction;
    points.push(
      fromPlanePoint(
        {
          first: center.first + radius * Math.cos(cardinalAngle),
          second: center.second + radius * Math.sin(cardinalAngle),
          normal: start.normal + (end.normal - start.normal) * fraction,
        },
        arc.plane,
      ),
    );
  }
  return points;
}

/**
 * Approximates an arc with a polyline.
 * The radius blends from start to end, which absorbs rounding in the source program and
 * guarantees the last point is exactly `arc.end`.
 *
 * @param chordTolerance - Maximum distance between the arc and the polyline, in millimeters.
 * @returns Polyline points excluding the start point.
 */
export function tessellateArc(arc: ArcMove, chordTolerance: number): Vector3[] {
  const start = toPlanePoint(arc.start, arc.plane);
  const end = toPlanePoint(arc.end, arc.plane);
  const center = toPlanePoint(arc.center, arc.plane);
  const startRadius = planarDistance(start, center);
  const endRadius = planarDistance(end, center);
  const startAngle = Math.atan2(start.second - center.second, start.first - center.first);
  const sweep = computeArcSweep(arc);
  const rotationSign = arc.isClockwise ? -1 : 1;

  const sagittaRatio = Math.min(Math.max(chordTolerance, COINCIDENCE_EPSILON_MM) / Math.max(startRadius, endRadius), 1);
  const maxAngleStep = 2 * Math.acos(1 - sagittaRatio);
  const segmentCount = Math.min(Math.max(Math.ceil(sweep / maxAngleStep), 1), MAX_SEGMENTS_PER_ARC);

  const points: Vector3[] = [];
  for (let segmentIndex = 1; segmentIndex < segmentCount; segmentIndex += 1) {
    const fraction = segmentIndex / segmentCount;
    const angle = startAngle + rotationSign * sweep * fraction;
    const radius = startRadius + (endRadius - startRadius) * fraction;
    points.push(
      fromPlanePoint(
        {
          first: center.first + radius * Math.cos(angle),
          second: center.second + radius * Math.sin(angle),
          normal: start.normal + (end.normal - start.normal) * fraction,
        },
        arc.plane,
      ),
    );
  }
  points.push(arc.end);
  return points;
}
