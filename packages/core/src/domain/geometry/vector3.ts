/** Linear machine axis. Values match the property names of {@link Vector3}. */
export enum Axis {
  X = 'x',
  Y = 'y',
  Z = 'z',
}

/** All machine axes in canonical order. */
export const ALL_AXES: readonly Axis[] = [Axis.X, Axis.Y, Axis.Z];

/** Point or displacement in millimeters. */
export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Program zero. */
export const ORIGIN: Vector3 = { x: 0, y: 0, z: 0 };

/** Euclidean distance between two points. */
export const distanceBetween = (start: Vector3, end: Vector3): number =>
  Math.hypot(start.x - end.x, start.y - end.y, start.z - end.z);

/**
 * Linearly interpolates between two points.
 *
 * @param fraction - Position along the line: `0` is `start`, `1` is `end`.
 */
export const interpolate = (start: Vector3, end: Vector3, fraction: number): Vector3 => ({
  x: start.x + (end.x - start.x) * fraction,
  y: start.y + (end.y - start.y) * fraction,
  z: start.z + (end.z - start.z) * fraction,
});
