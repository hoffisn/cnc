import { describe, expect, it } from 'vitest';
import { DiagnosticCode, DiagnosticSeverity } from '@core/domain/gcode/diagnostics';
import { parseGCode } from '@core/domain/gcode/parser';
import { ArcPlane, ProgramStepKind, type ArcMove, type LinearMove, type MotionStep } from '@core/domain/gcode/program';

const motionsOf = (source: string): MotionStep[] =>
  parseGCode(source).steps.filter((step): step is MotionStep => step.kind !== ProgramStepKind.Auxiliary);
const diagnosticCodesOf = (source: string): DiagnosticCode[] =>
  parseGCode(source).diagnostics.map((diagnostic) => diagnostic.code);

describe('parseGCode: linear motion', () => {
  it('reads compact, lower-case notation with leading zeros', () => {
    const [move] = motionsOf('g01x10Y-5.5z.5 f100') as LinearMove[];
    expect(move).toMatchObject({ isRapid: false, end: { x: 10, y: -5.5, z: 0.5 }, feedRate: 100, sourceLine: 1 });
  });

  it('keeps motion mode and feed rate modal across lines', () => {
    const moves = motionsOf('G1 X1 F200\nY2\nG0 X5\nZ9') as LinearMove[];
    expect(moves.map((move) => move.isRapid)).toEqual([false, false, true, true]);
    expect(moves[1]).toMatchObject({ end: { x: 1, y: 2, z: 0 }, feedRate: 200 });
    expect(moves[2]?.feedRate).toBeNull();
  });

  it('accumulates increments in G91 and returns to absolute in G90', () => {
    expect(motionsOf('G1 X10 F1\nG91\nX5\nX5\nG90\nX1').map((move) => move.end.x)).toEqual([10, 15, 20, 1]);
  });

  it('converts inches to millimeters, including the feed rate', () => {
    const [move] = motionsOf('G20 G1 X1 F10') as LinearMove[];
    expect(move?.end.x).toBeCloseTo(25.4);
    expect(move?.feedRate).toBeCloseTo(254);
  });

  it('applies modes before motion regardless of word order in a block', () => {
    expect(motionsOf('G1 X1 F1 G20')[0]?.end.x).toBeCloseTo(25.4);
    expect(motionsOf('G1 X10 F1\nX5 G91')[1]?.end.x).toBe(15);
  });

  it('skips zero-length moves', () => {
    expect(motionsOf('G1 X0 Y0 F100')).toHaveLength(0);
  });

  it('honors the G92 offset and clears it with G92.1', () => {
    expect(motionsOf('G0 X10\nG92 X0\nG0 X5\nG92.1\nG0 X5').map((move) => move.end.x)).toEqual([10, 15, 5]);
  });

  it('G28 returns only the named axes via the intermediate point', () => {
    const moves = motionsOf('G0 X10 Y20 Z30\nG28 Z40');
    expect(moves.at(-1)?.end).toEqual({ x: 10, y: 20, z: 0 });
    expect(moves.at(-2)?.end).toEqual({ x: 10, y: 20, z: 40 });
  });

  it('bare G28 returns all axes', () => {
    expect(motionsOf('G0 X10 Y20 Z30\nG28').at(-1)?.end).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('parseGCode: comments and auxiliary commands', () => {
  it('ignores comments, block numbers, percent signs and checksums', () => {
    const moves = motionsOf('%\nN10 (start) G0 X1 ; end X99\nN20 G0 X2*55\n/G0 X3\nO1000');
    expect(moves.map((move) => move.end.x)).toEqual([1, 2, 3]);
    expect(diagnosticCodesOf('%\n(comment)\n; another')).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    expect(motionsOf('G0 X1\r\nG0 X2\r\n').map((move) => move.end.x)).toEqual([1, 2]);
  });

  it('warns about an unterminated comment', () => {
    expect(diagnosticCodesOf('G0 X1 (no bracket')).toEqual([DiagnosticCode.UnterminatedComment]);
  });

  it('orders spindle commands before the motion of a block and M30 after it', () => {
    const { steps } = parseGCode('M3 S1000 G1 X1 F10 M30');
    expect(steps.map((step) => step.kind)).toEqual([
      ProgramStepKind.Auxiliary,
      ProgramStepKind.LinearMove,
      ProgramStepKind.Auxiliary,
    ]);
    expect(steps[0]).toMatchObject({ commandText: 'S1000 M3' });
    expect(steps[2]).toMatchObject({ commandText: 'M30' });
  });

  it('does not treat dwell parameters as motion', () => {
    const { steps } = parseGCode('G1 X1 F10\nG4 P2\nG4 S1 X5');
    expect(steps.filter((step) => step.kind !== ProgramStepKind.Auxiliary)).toHaveLength(1);
    expect(steps[1]).toMatchObject({ commandText: 'G4 P2' });
  });

  it('stops at M30 and warns once about the code after it', () => {
    const program = parseGCode('G0 X1\nM30\nG0 X2\nG0 X3');
    expect(program.steps.filter((step) => step.kind !== ProgramStepKind.Auxiliary)).toHaveLength(1);
    expect(program.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([DiagnosticCode.CodeAfterProgramEnd]);
  });
});

describe('parseGCode: diagnostics', () => {
  it('points at the line and column of an error', () => {
    const [diagnostic] = parseGCode('G0 X1\nG1 X F100').diagnostics;
    expect(diagnostic).toMatchObject({
      severity: DiagnosticSeverity.Error,
      code: DiagnosticCode.MissingNumber,
      line: 2,
      column: 4,
      details: { character: 'X' },
    });
  });

  it('survives garbage with a single error per line', () => {
    expect(diagnosticCodesOf('@@@ !!!')).toEqual([DiagnosticCode.UnexpectedCharacter]);
    expect(diagnosticCodesOf('')).toEqual([]);
  });

  it('reports coordinates without a motion mode', () => {
    expect(diagnosticCodesOf('X10')).toEqual([DiagnosticCode.MissingMotionMode]);
  });

  it('warns once about a missing feed rate', () => {
    expect(diagnosticCodesOf('G1 X1\nG1 X2')).toEqual([DiagnosticCode.MissingFeedRate]);
  });

  it('warns about unsupported commands and axes', () => {
    const [unsupported] = parseGCode('G38.2 Z-5').diagnostics;
    expect(unsupported).toMatchObject({ code: DiagnosticCode.UnsupportedCommand, details: { word: 'G38.2' } });
    expect(diagnosticCodesOf('G0 A90')).toContain(DiagnosticCode.UnsupportedAxis);
  });

  it('warns about cutter compensation because the preview does not model it', () => {
    expect(diagnosticCodesOf('G41 D1')).toContain(DiagnosticCode.CutterCompensationIgnored);
  });

  it('rejects a non-positive feed rate', () => {
    expect(diagnosticCodesOf('G1 X1 F0')).toContain(DiagnosticCode.InvalidFeedRate);
  });
});

describe('parseGCode: arcs', () => {
  it('computes the center from I/J relative to the start', () => {
    const [arc] = motionsOf('G0 X10\nG3 X0 Y10 I-10 J0 F100').slice(1) as ArcMove[];
    expect(arc).toMatchObject({ kind: ProgramStepKind.ArcMove, isClockwise: false, center: { x: 0, y: 0, z: 0 } });
  });

  it('reads absolute I/J in G90.1', () => {
    const [arc] = motionsOf('G90.1\nG0 X10\nG3 X0 Y10 I0 J0 F100').slice(1) as ArcMove[];
    expect(arc?.center).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('treats coinciding ends as a full circle', () => {
    expect(motionsOf('G0 X10\nG2 I-10 F100')[1]?.kind).toBe(ProgramStepKind.ArcMove);
    expect(diagnosticCodesOf('G0 X10\nG2 I-10 F100')).toEqual([]);
  });

  it('selects the minor arc for a positive R and the major arc for a negative R', () => {
    const [minorArc] = motionsOf('G0 X1\nG3 X0 Y1 R1 F100').slice(1) as ArcMove[];
    expect(minorArc?.center.x).toBeCloseTo(0);
    expect(minorArc?.center.y).toBeCloseTo(0);
    const [majorArc] = motionsOf('G0 X1\nG3 X0 Y1 R-1 F100').slice(1) as ArcMove[];
    expect(majorArc?.center.x).toBeCloseTo(1);
    expect(majorArc?.center.y).toBeCloseTo(1);
  });

  it('places a minor G2 center on the other side of the chord', () => {
    const [arc] = motionsOf('G0 X1\nG2 X0 Y1 R1 F100').slice(1) as ArcMove[];
    expect(arc?.center.x).toBeCloseTo(1);
    expect(arc?.center.y).toBeCloseTo(1);
  });

  it('honors the G18 plane, where the center is given by I and K', () => {
    const [arc] = motionsOf('G18\nG0 X10\nG2 X0 Z-10 I-10 K0 F100').slice(1) as ArcMove[];
    expect(arc).toMatchObject({ plane: ArcPlane.ZX, center: { x: 0, y: 0, z: 0 } });
  });

  it('keeps tracking the position after an invalid arc', () => {
    const source = 'G0 X10\nG2 X0 Y50 I-10 J0 F100\nG1 X1';
    expect(diagnosticCodesOf(source)).toEqual([DiagnosticCode.ArcRadiusMismatch]);
    const moves = motionsOf(source);
    expect(moves[1]).toMatchObject({ kind: ProgramStepKind.LinearMove, end: { x: 0, y: 50, z: 0 } });
    expect(moves[2]?.start).toEqual({ x: 0, y: 50, z: 0 });
  });

  it('reports invalid radius parameters', () => {
    expect(diagnosticCodesOf('G0 X10\nG2 X0 R1 F1')).toEqual([DiagnosticCode.ArcRadiusTooSmall]);
    expect(diagnosticCodesOf('G0 X10\nG2 X10 R5 F1')).toEqual([DiagnosticCode.ArcFullCircleByRadius]);
    expect(diagnosticCodesOf('G2 X10 F1')).toEqual([DiagnosticCode.ArcMissingParameters]);
    expect(diagnosticCodesOf('G0 X10\nG2 X0 I-5 R5 F1')).toEqual([DiagnosticCode.ArcRadiusAndCenterConflict]);
  });
});

describe('parseGCode: drill cycles', () => {
  it('expands G81 into approach, plunge and retract, repeating for new coordinates', () => {
    const moves = motionsOf('G0 Z10\nG81 X5 Y5 Z-3 R2 F100\nX10\nG80\nG0 Z20') as LinearMove[];
    const plunges = moves.filter((move) => !move.isRapid).map((move) => [move.end.x, move.end.z]);
    expect(plunges).toEqual([[5, -3], [10, -3]]);
    expect(moves.at(-1)?.end.z).toBe(20);
  });

  it('retracts to the R plane in G99', () => {
    const moves = motionsOf('G0 Z10\nG99 G81 X5 Z-3 R2 F100') as LinearMove[];
    expect(moves.at(-1)?.end.z).toBe(2);
  });

  it('reports a cycle without depth or retract plane', () => {
    expect(diagnosticCodesOf('G81 X5 F100')).toEqual([DiagnosticCode.DrillCycleMissingParameters]);
  });
});
