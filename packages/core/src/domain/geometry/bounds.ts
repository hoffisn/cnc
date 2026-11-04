import type { Vector3 } from './vector3';

/** Axis-aligned bounding box. */
export interface Bounds {
  readonly min: Vector3;
  readonly max: Vector3;
}

/** Edge lengths of a bounding box. */
export const boundsSize = (bounds: Bounds): Vector3 => ({
  x: bounds.max.x - bounds.min.x,
  y: bounds.max.y - bounds.min.y,
  z: bounds.max.z - bounds.min.z,
});

/** Geometric center of a bounding box. */
export const boundsCenter = (bounds: Bounds): Vector3 => ({
  x: (bounds.min.x + bounds.max.x) / 2,
  y: (bounds.min.y + bounds.max.y) / 2,
  z: (bounds.min.z + bounds.max.z) / 2,
});

/**
 * Incrementally accumulates a bounding box.
 * Deliberately mutable: hundreds of thousands of points pass through it per program,
 * so allocating an immutable box for each of them would be wasteful.
 */
export class BoundsAccumulator {
  private minX = Infinity;
  private minY = Infinity;
  private minZ = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  private maxZ = -Infinity;

  /** Extends the box to contain the given point. */
  include(x: number, y: number, z: number): void {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (z < this.minZ) this.minZ = z;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
    if (z > this.maxZ) this.maxZ = z;
  }

  /** @returns The accumulated box, or `null` when no points were included. */
  toBounds(): Bounds | null {
    if (this.minX === Infinity) return null;
    return {
      min: { x: this.minX, y: this.minY, z: this.minZ },
      max: { x: this.maxX, y: this.maxY, z: this.maxZ },
    };
  }
}
