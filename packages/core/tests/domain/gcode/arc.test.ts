import { describe, expect, it } from 'vitest';
import { computeArcSweep, tessellateArc } from '@core/domain/gcode/arc';
import { ArcPlane, ProgramStepKind, type ArcMove } from '@core/domain/gcode/program';

const quarterCircle: ArcMove = {
  kind: ProgramStepKind.ArcMove,
  isClockwise: false,
  plane: ArcPlane.XY,
  start: { x: 10, y: 0, z: 0 },
  end: { x: 0, y: 10, z: 0 },
  center: { x: 0, y: 0, z: 0 },
  feedRate: 100,
  sourceLine: 1,
};

describe('computeArcSweep', () => {
  it('is 90° for a counter-clockwise quarter circle', () => {
    expect(computeArcSweep(quarterCircle)).toBeCloseTo(Math.PI / 2);
  });

  it('is 270° for the same points clockwise', () => {
    expect(computeArcSweep({ ...quarterCircle, isClockwise: true })).toBeCloseTo((3 * Math.PI) / 2);
  });

  it('is a full circle when the ends coincide', () => {
    expect(computeArcSweep({ ...quarterCircle, end: quarterCircle.start })).toBeCloseTo(2 * Math.PI);
  });
});

describe('tessellateArc', () => {
  it('ends exactly at the arc end and keeps the radius', () => {
    const points = tessellateArc(quarterCircle, 0.01);
    expect(points.at(-1)).toEqual(quarterCircle.end);
    for (const point of points) expect(Math.hypot(point.x, point.y)).toBeCloseTo(10, 6);
  });

  it('respects the chord tolerance', () => {
    const chordTolerance = 0.01;
    let segmentStart = quarterCircle.start;
    for (const segmentEnd of tessellateArc(quarterCircle, chordTolerance)) {
      const chordMiddleRadius = Math.hypot((segmentEnd.x + segmentStart.x) / 2, (segmentEnd.y + segmentStart.y) / 2);
      expect(10 - chordMiddleRadius).toBeLessThanOrEqual(chordTolerance + 1e-9);
      segmentStart = segmentEnd;
    }
  });

  it('travels in the commanded direction', () => {
    const [firstPoint] = tessellateArc({ ...quarterCircle, isClockwise: true }, 0.01);
    expect(firstPoint?.y).toBeLessThan(0);
  });

  it('advances the normal axis evenly along a helix', () => {
    const points = tessellateArc({ ...quarterCircle, end: { x: 0, y: 10, z: -4 } }, 0.5);
    expect(points.at(-1)?.z).toBe(-4);
    const heights = points.map((point) => point.z);
    expect(heights).toEqual([...heights].sort((first, second) => second - first));
  });

  it('G2 in the ZX plane is clockwise when viewed from +Y', () => {
    const arc: ArcMove = {
      ...quarterCircle,
      plane: ArcPlane.ZX,
      isClockwise: true,
      start: { x: 10, y: 0, z: 0 },
      end: { x: 0, y: 0, z: 10 },
    };
    for (const point of tessellateArc(arc, 0.01)) {
      expect(point.y).toBe(0);
      expect(point.x).toBeGreaterThanOrEqual(-1e-9);
      expect(point.z).toBeGreaterThanOrEqual(-1e-9);
    }
  });
});
