import { ALL_AXES, type Axis, type Vector3 } from '@core/domain/geometry/vector3';

/** Smallest allowed scale factor of an axis. */
export const MIN_SCALE_FACTOR = 0.01;
/** Largest allowed scale factor of an axis. */
export const MAX_SCALE_FACTOR = 100;

/**
 * Per-axis stretch of a figure.
 * The anchor is program zero: the part stays where it is relative to the workpiece zero,
 * and the stock top (`Z0`) does not move.
 */
export interface ScaleTransform {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Transform that leaves a figure unchanged. */
export const IDENTITY_SCALE: ScaleTransform = { x: 1, y: 1, z: 1 };

/** Tells whether the transform leaves a figure unchanged. */
export const isIdentityScale = (scale: ScaleTransform): boolean => scale.x === 1 && scale.y === 1 && scale.z === 1;

/** Applies a transform to a point. */
export const applyScale = (point: Vector3, scale: ScaleTransform): Vector3 => ({
  x: point.x * scale.x,
  y: point.y * scale.y,
  z: point.z * scale.z,
});

const clampFactor = (factor: number): number => Math.min(Math.max(factor, MIN_SCALE_FACTOR), MAX_SCALE_FACTOR);

/**
 * Changes the scale factor of one axis.
 * Invalid values leave the transform unchanged, so a half-typed input cannot break the figure.
 *
 * @param keepProportions - Multiply the other axes by the same ratio. If any axis would exceed
 * the allowed range, the ratio itself is limited so that proportions always survive.
 */
export function setAxisScaleFactor(
  current: ScaleTransform,
  axis: Axis,
  factor: number,
  keepProportions: boolean,
): ScaleTransform {
  if (!Number.isFinite(factor) || factor <= 0) return current;
  const clampedFactor = clampFactor(factor);
  if (!keepProportions) return { ...current, [axis]: clampedFactor };

  let ratio = clampedFactor / current[axis];
  for (const otherAxis of ALL_AXES) {
    ratio = Math.min(ratio, MAX_SCALE_FACTOR / current[otherAxis]);
    ratio = Math.max(ratio, MIN_SCALE_FACTOR / current[otherAxis]);
  }
  return { x: current.x * ratio, y: current.y * ratio, z: current.z * ratio };
}

/**
 * Stretches an axis to reach a target size.
 * A figure with zero size along the axis cannot be stretched and stays unchanged.
 *
 * @param unscaledSize - Size of the figure along the axis before any scaling, in millimeters.
 * @param targetSize - Desired size, in millimeters.
 */
export function setAxisTargetSize(
  current: ScaleTransform,
  axis: Axis,
  unscaledSize: number,
  targetSize: number,
  keepProportions: boolean,
): ScaleTransform {
  if (unscaledSize <= 0 || !Number.isFinite(targetSize) || targetSize <= 0) return current;
  return setAxisScaleFactor(current, axis, targetSize / unscaledSize, keepProportions);
}
