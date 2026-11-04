import type { Bounds } from '@core/domain/geometry/bounds';
import { ALL_AXES, Axis, type Vector3 } from '@core/domain/geometry/vector3';

/** Allowed travel range of one axis, in millimeters. */
export interface AxisTravelLimit {
  readonly min: number;
  readonly max: number;
}

/** Software travel limits of all axes. */
export type TravelLimits = Readonly<Record<Axis, AxisTravelLimit>>;

/** Machine parameters the operator can configure. */
export interface MachineSettings {
  /** Millimeters in one step, for jog buttons configured in steps. */
  readonly stepSizeMm: number;
  readonly travelLimits: TravelLimits;
  /** Speed of rapid moves, in mm/min. */
  readonly rapidFeedRate: number;
  /** Feed rate used when a program does not set one, in mm/min. */
  readonly defaultFeedRate: number;
  /** Cutter diameter used to predict the machined part, in millimeters. */
  readonly toolDiameter: number;
}

/** Factory defaults: wide limits so a demo is not rejected before the real machine is configured. */
export const DEFAULT_MACHINE_SETTINGS: MachineSettings = {
  stepSizeMm: 1,
  travelLimits: {
    [Axis.X]: { min: -10000, max: 10000 },
    [Axis.Y]: { min: -10000, max: 10000 },
    [Axis.Z]: { min: -500, max: 500 },
  },
  rapidFeedRate: 12000,
  defaultFeedRate: 2000,
  toolDiameter: 6,
};

/** Evidence of a coordinate lying outside the machine's travel. */
export interface TravelLimitViolation {
  readonly axis: Axis;
  readonly value: number;
  readonly limit: AxisTravelLimit;
}

/** @returns The first violated axis limit, or `null` when the point is reachable. */
export function findPointViolation(point: Vector3, limits: TravelLimits): TravelLimitViolation | null {
  for (const axis of ALL_AXES) {
    const limit = limits[axis];
    const value = point[axis];
    if (value < limit.min || value > limit.max) return { axis, value, limit };
  }
  return null;
}

/** @returns The first violated axis limit, or `null` when the entire box is reachable. */
export function findBoundsViolation(bounds: Bounds, limits: TravelLimits): TravelLimitViolation | null {
  return findPointViolation(bounds.min, limits) ?? findPointViolation(bounds.max, limits);
}
