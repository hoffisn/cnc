import { describe, expect, it } from 'vitest';
import { buildToolpath } from '@core/domain/toolpath/toolpath';
import { IDENTITY_SCALE, type ScaleTransform } from '@core/domain/transform/scaleTransform';
import { formatCoordinate, generateGCode } from '@core/domain/gcode/generator';
import { parseGCode } from '@core/domain/gcode/parser';

const SAMPLE_PROGRAM = `G21 G90
M3 S12000
G0 X0 Y0 Z5
G1 Z-1 F300
G1 X20 F800
G3 X30 Y10 I0 J10
G2 X40 Y20 R10
G18
G2 X50 Z-2 I5 K0
G17
M5
M30
`;

const CHORD_TOLERANCE = 0.01;

function roundTrip(scale: ScaleTransform = IDENTITY_SCALE) {
  const program = parseGCode(SAMPLE_PROGRAM);
  const generatedText = generateGCode(program, scale);
  const reparsedProgram = parseGCode(generatedText);
  return {
    generatedText,
    reparsedProgram,
    expectedPath: buildToolpath(program, scale, CHORD_TOLERANCE),
    actualPath: buildToolpath(reparsedProgram, IDENTITY_SCALE, CHORD_TOLERANCE),
  };
}

describe('formatCoordinate', () => {
  it('drops trailing zeros and negative zero', () => {
    expect(formatCoordinate(1.5)).toBe('1.5');
    expect(formatCoordinate(10)).toBe('10');
    expect(formatCoordinate(100)).toBe('100');
    expect(formatCoordinate(-0.00001)).toBe('0');
    expect(formatCoordinate(0)).toBe('0');
    expect(formatCoordinate(1.23456)).toBe('1.2346');
  });
});

describe('generateGCode', () => {
  it('reproduces the toolpath without any diagnostics when not scaled', () => {
    const { reparsedProgram, expectedPath, actualPath } = roundTrip();
    expect(reparsedProgram.diagnostics).toEqual([]);
    expect(actualPath.feedLength).toBeCloseTo(expectedPath.feedLength, 2);
    expect(actualPath.partBounds?.max.x).toBeCloseTo(expectedPath.partBounds?.max.x as number, 3);
  });

  it('preserves spindle commands and the program end in order', () => {
    const outputLines = roundTrip().generatedText.trim().split('\n');
    expect(outputLines).toContain('S12000 M3');
    expect(outputLines.at(-1)).toBe('M30');
    expect(outputLines.indexOf('M5')).toBeGreaterThan(outputLines.indexOf('S12000 M3'));
  });

  it('keeps arcs as arcs with a rescaled center under uniform scaling', () => {
    const { generatedText, reparsedProgram, expectedPath, actualPath } = roundTrip({ x: 2, y: 2, z: 2 });
    expect(generatedText).toMatch(/G3 X60 Y20 Z-2 I0 J20/);
    expect(reparsedProgram.diagnostics).toEqual([]);
    expect(actualPath.feedLength).toBeCloseTo(expectedPath.feedLength, 1);
  });

  it('replaces arcs with segments under non-uniform scaling, as G2/G3 cannot express an ellipse', () => {
    const generatedText = generateGCode(parseGCode('G0 X10\nG3 X-10 I-10 J0 F100\nM30'), { x: 3, y: 1, z: 1 });
    expect(generatedText).not.toMatch(/G[23]\s/);
    const path = buildToolpath(parseGCode(generatedText), IDENTITY_SCALE, CHORD_TOLERANCE);
    expect(path.partBounds?.max.x).toBeCloseTo(30, 3);
    expect(path.partBounds?.max.y).toBeCloseTo(10, 2);
  });

  it('keeps an XY arc as an arc when only Z is scaled', () => {
    const generatedText = generateGCode(parseGCode('G0 X10\nG3 X-10 Z-1 I-10 J0 F100'), { x: 1, y: 1, z: 5 });
    expect(generatedText).toMatch(/G3 X-10 Y0 Z-5 I-10 J0/);
  });

  it('survives a round trip of a ZX arc under uniform scaling', () => {
    const generatedText = generateGCode(parseGCode('G18\nG0 X10\nG2 X0 Z-10 I-10 K0 F100'), { x: 2, y: 2, z: 2 });
    expect(generatedText).toMatch(/G2 X0 Y0 Z-20 I-20 K0/);
    expect(parseGCode(generatedText).diagnostics).toEqual([]);
  });

  it('writes all axes on the first move and converts G91 inches to absolute millimeters', () => {
    const generatedText = generateGCode(parseGCode('G20 G91\nG0 X1\nG1 X1 F10'), IDENTITY_SCALE);
    expect(generatedText).toContain('G0 X25.4 Y0 Z0');
    expect(generatedText).toContain('G1 X50.8 F254');
  });
});
