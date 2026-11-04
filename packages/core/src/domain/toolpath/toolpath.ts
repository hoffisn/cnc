import { BoundsAccumulator, type Bounds } from '@core/domain/geometry/bounds';
import type { Vector3 } from '@core/domain/geometry/vector3';
import { findArcExtremePoints, tessellateArc } from '@core/domain/gcode/arc';
import { ProgramStepKind, type GCodeProgram } from '@core/domain/gcode/program';
import { applyScale, type ScaleTransform } from '@core/domain/transform/scaleTransform';

/** Purpose of a toolpath segment. Numeric to fit a compact typed array. */
export enum SegmentKind {
  /** Non-cutting traverse. */
  Rapid = 0,
  /** Cutting move. */
  Feed = 1,
}

/** Coordinates stored per segment in {@link Toolpath.segmentCoordinates}. */
export const COORDINATES_PER_SEGMENT = 6;

const MIN_BUFFER_CAPACITY = 16;

/**
 * Tool trajectory as a flat list of straight segments.
 * Stored as typed arrays because programs reach millions of segments,
 * where an array of objects would be too heavy for both memory and the garbage collector.
 */
export interface Toolpath {
  readonly segmentCount: number;
  /** {@link COORDINATES_PER_SEGMENT} values per segment: start XYZ, then end XYZ. */
  readonly segmentCoordinates: Float64Array;
  readonly segmentKinds: Uint8Array;
  /** One-based source line of each segment. */
  readonly segmentSourceLines: Uint32Array;
  /** Feed rate of each segment in mm/min; `0` means a rapid or a feed rate the program never set. */
  readonly segmentFeedRates: Float32Array;
  /** Extents of all moves including rapids; `null` when there are none. */
  readonly travelBounds: Bounds | null;
  /** Extents of cutting moves, i.e. the size of the figure; `null` when there are none. */
  readonly partBounds: Bounds | null;
  readonly feedLength: number;
  readonly rapidLength: number;
}

/** Growable storage for segment data. */
class SegmentBuffer {
  private capacity: number;
  private coordinates: Float64Array;
  private kinds: Uint8Array;
  private sourceLines: Uint32Array;
  private feedRates: Float32Array;
  segmentCount = 0;

  constructor(expectedSegmentCount: number) {
    this.capacity = Math.max(expectedSegmentCount, MIN_BUFFER_CAPACITY);
    this.coordinates = new Float64Array(this.capacity * COORDINATES_PER_SEGMENT);
    this.kinds = new Uint8Array(this.capacity);
    this.sourceLines = new Uint32Array(this.capacity);
    this.feedRates = new Float32Array(this.capacity);
  }

  append(start: Vector3, end: Vector3, kind: SegmentKind, sourceLine: number, feedRate: number): void {
    if (this.segmentCount === this.capacity) this.doubleCapacity();
    const offset = this.segmentCount * COORDINATES_PER_SEGMENT;
    this.coordinates[offset] = start.x;
    this.coordinates[offset + 1] = start.y;
    this.coordinates[offset + 2] = start.z;
    this.coordinates[offset + 3] = end.x;
    this.coordinates[offset + 4] = end.y;
    this.coordinates[offset + 5] = end.z;
    this.kinds[this.segmentCount] = kind;
    this.sourceLines[this.segmentCount] = sourceLine;
    this.feedRates[this.segmentCount] = feedRate;
    this.segmentCount += 1;
  }

  /** Views over the occupied part of the storage. */
  toSegmentArrays(): Pick<Toolpath, 'segmentCoordinates' | 'segmentKinds' | 'segmentSourceLines' | 'segmentFeedRates'> {
    return {
      segmentCoordinates: this.coordinates.subarray(0, this.segmentCount * COORDINATES_PER_SEGMENT),
      segmentKinds: this.kinds.subarray(0, this.segmentCount),
      segmentSourceLines: this.sourceLines.subarray(0, this.segmentCount),
      segmentFeedRates: this.feedRates.subarray(0, this.segmentCount),
    };
  }

  private doubleCapacity(): void {
    this.capacity *= 2;
    const coordinates = new Float64Array(this.capacity * COORDINATES_PER_SEGMENT);
    coordinates.set(this.coordinates);
    this.coordinates = coordinates;
    const kinds = new Uint8Array(this.capacity);
    kinds.set(this.kinds);
    this.kinds = kinds;
    const sourceLines = new Uint32Array(this.capacity);
    sourceLines.set(this.sourceLines);
    this.sourceLines = sourceLines;
    const feedRates = new Float32Array(this.capacity);
    feedRates.set(this.feedRates);
    this.feedRates = feedRates;
  }
}

/**
 * A plunge starts in the air above the stock, but that height is not part of the figure:
 * when a program cuts below `Z0`, the figure ends at `Z0`.
 */
function excludeApproachAboveStock(bounds: Bounds | null): Bounds | null {
  if (!bounds || bounds.min.z >= 0 || bounds.max.z <= 0) return bounds;
  return { min: bounds.min, max: { ...bounds.max, z: 0 } };
}

/**
 * Flattens a program into a toolpath with scaling applied.
 * Arcs are subdivided before scaling, so a non-uniformly scaled circle correctly becomes an ellipse.
 *
 * @param chordTolerance - Maximum deviation of the final, scaled figure from a true arc, in millimeters.
 */
export function buildToolpath(program: GCodeProgram, scale: ScaleTransform, chordTolerance: number): Toolpath {
  const buffer = new SegmentBuffer(program.steps.length);
  const travelBounds = new BoundsAccumulator();
  const partBounds = new BoundsAccumulator();
  let feedLength = 0;
  let rapidLength = 0;

  // Stretching magnifies the deviation, so the source arc must be subdivided proportionally finer.
  const sourceChordTolerance = chordTolerance / Math.max(scale.x, scale.y, scale.z);

  const appendSegment = (start: Vector3, end: Vector3, isRapid: boolean, sourceLine: number, feedRate: number | null): void => {
    const scaledStart = applyScale(start, scale);
    const scaledEnd = applyScale(end, scale);
    buffer.append(scaledStart, scaledEnd, isRapid ? SegmentKind.Rapid : SegmentKind.Feed, sourceLine, feedRate ?? 0);
    travelBounds.include(scaledStart.x, scaledStart.y, scaledStart.z);
    travelBounds.include(scaledEnd.x, scaledEnd.y, scaledEnd.z);

    const segmentLength = Math.hypot(scaledEnd.x - scaledStart.x, scaledEnd.y - scaledStart.y, scaledEnd.z - scaledStart.z);
    if (isRapid) {
      rapidLength += segmentLength;
    } else {
      feedLength += segmentLength;
      partBounds.include(scaledStart.x, scaledStart.y, scaledStart.z);
      partBounds.include(scaledEnd.x, scaledEnd.y, scaledEnd.z);
    }
  };

  for (const step of program.steps) {
    if (step.kind === ProgramStepKind.LinearMove) {
      appendSegment(step.start, step.end, step.isRapid, step.sourceLine, step.feedRate);
    } else if (step.kind === ProgramStepKind.ArcMove) {
      let segmentStart = step.start;
      for (const segmentEnd of tessellateArc(step, sourceChordTolerance)) {
        appendSegment(segmentStart, segmentEnd, false, step.sourceLine, step.feedRate);
        segmentStart = segmentEnd;
      }
      for (const extremePoint of findArcExtremePoints(step)) {
        const { x, y, z } = applyScale(extremePoint, scale);
        travelBounds.include(x, y, z);
        partBounds.include(x, y, z);
      }
    }
  }

  return {
    segmentCount: buffer.segmentCount,
    ...buffer.toSegmentArrays(),
    travelBounds: travelBounds.toBounds(),
    partBounds: excludeApproachAboveStock(partBounds.toBounds()),
    feedLength,
    rapidLength,
  };
}

/**
 * Finds the segment the machine has reached when execution is at a given source line.
 * Source lines never decrease along a toolpath, which allows a binary search.
 *
 * @returns Index of the last segment at or before the line, or `-1` when there is none.
 */
export function findLastSegmentUpToLine(toolpath: Toolpath, sourceLine: number): number {
  let lowIndex = 0;
  let highIndex = toolpath.segmentCount - 1;
  let foundIndex = -1;
  while (lowIndex <= highIndex) {
    const middleIndex = (lowIndex + highIndex) >> 1;
    if ((toolpath.segmentSourceLines[middleIndex] ?? 0) <= sourceLine) {
      foundIndex = middleIndex;
      lowIndex = middleIndex + 1;
    } else {
      highIndex = middleIndex - 1;
    }
  }
  return foundIndex;
}
