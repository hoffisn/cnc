import { describe, expect, it } from 'vitest';
import { parseGCode } from '@core/domain/gcode/parser';
import { IDENTITY_SCALE } from '@core/domain/transform/scaleTransform';
import { computeRelief, type Relief } from '@core/domain/toolpath/relief';
import { SegmentKind, buildToolpath, findLastSegmentUpToLine } from '@core/domain/toolpath/toolpath';

const CHORD_TOLERANCE = 0.01;
const buildPath = (source: string, scale = IDENTITY_SCALE) => buildToolpath(parseGCode(source), scale, CHORD_TOLERANCE);

describe('buildToolpath', () => {
  it('separates rapids from cuts and sizes the part by cuts only', () => {
    const path = buildPath('G0 X100 Z50\nG1 X110 F100');
    expect(path.segmentCount).toBe(2);
    expect([...path.segmentKinds]).toEqual([SegmentKind.Rapid, SegmentKind.Feed]);
    expect(path.partBounds?.min.x).toBe(100);
    expect(path.partBounds?.max.x).toBe(110);
    expect(path.travelBounds?.min.x).toBe(0);
    expect(path.feedLength).toBeCloseTo(10);
  });

  it('does not count the plunge above the stock as part of the figure', () => {
    const { partBounds } = buildPath('G0 Z5\nG1 Z-18 F100\nG1 X10');
    expect(partBounds?.max.z).toBe(0);
    expect(partBounds?.min.z).toBe(-18);
  });

  it('scales each axis independently', () => {
    const path = buildPath('G1 X10 Y10 Z-1 F100', { x: 2, y: 3, z: 4 });
    expect(path.partBounds?.max.x).toBe(20);
    expect(path.partBounds?.max.y).toBe(30);
    expect(path.partBounds?.min.z).toBe(-4);
  });

  it('turns a circle into an ellipse under non-uniform scaling', () => {
    const path = buildPath('G0 X10\nG3 I-10 F100', { x: 2, y: 1, z: 1 });
    expect(path.partBounds?.max.x).toBeCloseTo(20, 3);
    expect(path.partBounds?.min.x).toBeCloseTo(-20, 3);
    expect(path.partBounds?.max.y).toBeCloseTo(10, 2);
  });

  it('sizes arcs by their true extremes, not by the polyline vertices', () => {
    const fullCircle = buildPath('G0 X45\nG3 I-45 J0 F100').partBounds;
    expect(fullCircle?.max.y).toBeCloseTo(45, 9);
    expect(fullCircle?.min.y).toBeCloseTo(-45, 9);
    expect(fullCircle?.min.x).toBeCloseTo(-45, 9);

    const quarterArc = buildPath('G0 X10\nG3 X0 Y10 I-10 J0 F100').partBounds;
    expect(quarterArc?.min.x).toBeCloseTo(0, 9);
    expect(quarterArc?.min.y).toBeCloseTo(0, 9);
    expect(quarterArc?.max.x).toBeCloseTo(10, 9);
    expect(quarterArc?.max.y).toBeCloseTo(10, 9);

    const clockwiseAcrossTop = buildPath('G0 X-10\nG2 X10 I10 J0 F100').partBounds;
    expect(clockwiseAcrossTop?.max.y).toBeCloseTo(10, 9);
    expect(clockwiseAcrossTop?.min.y).toBeCloseTo(0, 9);
  });

  it('subdivides arcs finer the more they are stretched', () => {
    const unscaledCount = buildPath('G0 X10\nG3 I-10 F100').segmentCount;
    const stretchedCount = buildPath('G0 X10\nG3 I-10 F100', { x: 50, y: 50, z: 50 }).segmentCount;
    expect(stretchedCount).toBeGreaterThan(unscaledCount);
  });

  it('gives an empty toolpath for a program without motion', () => {
    const path = buildPath('; comment only');
    expect(path.segmentCount).toBe(0);
    expect(path.travelBounds).toBeNull();
    expect(path.partBounds).toBeNull();
  });

  it('grows past the initial buffer capacity', () => {
    const path = buildPath('G0 X10\nG3 I-10 F100\nG3 I-10');
    expect(path.segmentCount).toBeGreaterThan(16);
    expect(path.segmentCoordinates.length).toBe(path.segmentCount * 6);
  });
});

describe('findLastSegmentUpToLine', () => {
  it('finds the last segment of a line, or the preceding one for a line without motion', () => {
    const path = buildPath('G0 X1\nG0 X2\n; empty\nG0 X3');
    expect(findLastSegmentUpToLine(path, 2)).toBe(1);
    expect(findLastSegmentUpToLine(path, 3)).toBe(1);
    expect(findLastSegmentUpToLine(path, 4)).toBe(2);
    expect(findLastSegmentUpToLine(path, 0)).toBe(-1);
  });
});

describe('computeRelief', () => {
  const reliefOptions = { toolDiameter: 4, maxResolution: 200 };

  const heightAt = (relief: Relief, x: number, y: number): number | undefined => {
    const column = Math.round((x - relief.originX) / relief.cellSize);
    const row = Math.round((y - relief.originY) / relief.cellSize);
    return relief.heights[row * relief.columnCount + column];
  };

  const computeOrFail = (source: string): Relief => {
    const relief = computeRelief(buildPath(source), reliefOptions);
    if (!relief) throw new Error('a relief was expected');
    return relief;
  };

  it('cuts a slot as wide as the tool down to the programmed depth', () => {
    const relief = computeOrFail('G0 Z5\nG0 X0 Y0\nG1 Z-2 F100\nG1 X40');
    expect(relief.stockTopZ).toBe(0);
    expect(relief.lowestZ).toBeCloseTo(-2);
    expect(heightAt(relief, 20, 0)).toBeCloseTo(-2);
    expect(heightAt(relief, 20, 1.5)).toBeCloseTo(-2);
    expect(heightAt(relief, 20, 2.5)).toBe(0);
  });

  it('accounts for the lowest point under the tool on a ramp', () => {
    const relief = computeOrFail('G0 Z0\nG1 X20 Z-2 F100');
    // At x=10 the tool axis is at -1, but its leading edge at x=12 is already at -1.2.
    expect(heightAt(relief, 10, 0)).toBeCloseTo(-1.2, 1);
  });

  it('makes a round hole on a vertical plunge', () => {
    const relief = computeOrFail('G0 X10 Y10 Z5\nG1 Z-3 F100');
    expect(heightAt(relief, 10, 10)).toBeCloseTo(-3);
    expect(heightAt(relief, 11.9, 10)).toBeCloseTo(-3);
    expect(heightAt(relief, 12.5, 10)).toBe(0);
  });

  it('never cuts along rapids', () => {
    const relief = computeOrFail('G0 Z-5\nG0 X50\nG1 Y1 Z-1 F100\nG0 Z5');
    expect(relief.lowestZ).toBeCloseTo(-5);
    expect(relief.originX).toBeGreaterThan(40);
  });

  it('removes no material for a flat contour at one height', () => {
    expect(computeRelief(buildPath('G0 Z0\nG1 X10 F100\nG1 Y10'), reliefOptions)).toBeNull();
  });

  it('returns null without cuts or with a zero-diameter tool', () => {
    expect(computeRelief(buildPath('G0 X10'), reliefOptions)).toBeNull();
    expect(computeRelief(buildPath('G1 Z-1 F1'), { toolDiameter: 0, maxResolution: 200 })).toBeNull();
  });

  it('uses the highest cutting point as stock top when Z zero is on the table', () => {
    const relief = computeOrFail('G0 X0 Y0 Z12\nG1 Z10 F100\nG1 X30');
    expect(relief.stockTopZ).toBe(12);
    expect(relief.lowestZ).toBeCloseTo(10);
  });
});
