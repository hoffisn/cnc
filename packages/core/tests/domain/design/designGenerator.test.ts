import { describe, expect, it } from 'vitest';
import { generateDesignGCode } from '@core/domain/design/designGenerator';
import { DesignOperationKind, ToolSide, type DesignOperation } from '@core/domain/design/designOperation';
import { EMPTY_DESIGN_PROJECT, type DesignProject } from '@core/domain/design/designProject';
import { DEFAULT_WORK_SURFACE, ZeroOrigin, type WorkSurface } from '@core/domain/design/workSurface';
import { parseGCode } from '@core/domain/gcode/parser';
import { buildToolpath } from '@core/domain/toolpath/toolpath';
import { IDENTITY_SCALE } from '@core/domain/transform/scaleTransform';

const CHORD_TOLERANCE = 0.001;
const TOOL_RADIUS = DEFAULT_WORK_SURFACE.toolDiameterMm / 2;

function project(operations: readonly DesignOperation[], surface: Partial<WorkSurface> = {}): DesignProject {
  return { ...EMPTY_DESIGN_PROJECT, surface: { ...DEFAULT_WORK_SURFACE, ...surface }, operations };
}

function cut(designProject: DesignProject) {
  const text = generateDesignGCode(designProject);
  const program = parseGCode(text);
  return { text, program, path: buildToolpath(program, IDENTITY_SCALE, CHORD_TOLERANCE) };
}

const rectangleOutline = (toolSide: ToolSide): DesignOperation => ({
  kind: DesignOperationKind.RectangleOutline,
  id: 'rectangle',
  depthMm: 6,
  corner: { x: 100, y: 100 },
  widthMm: 200,
  heightMm: 100,
  toolSide,
});

describe('generateDesignGCode', () => {
  it('always produces a program the parser accepts without any diagnostics', () => {
    const everyKind: DesignOperation[] = [
      { kind: DesignOperationKind.Hole, id: 'a', depthMm: 5, center: { x: 50, y: 50 } },
      { kind: DesignOperationKind.HoleGrid, id: 'b', depthMm: 5, origin: { x: 100, y: 50 }, columnCount: 3, rowCount: 2, spacingXMm: 20, spacingYMm: 20 },
      { kind: DesignOperationKind.Slot, id: 'c', depthMm: 7, start: { x: 200, y: 50 }, end: { x: 300, y: 90 } },
      rectangleOutline(ToolSide.Outside),
      rectangleOutline(ToolSide.Inside),
      rectangleOutline(ToolSide.OnLine),
      { kind: DesignOperationKind.CircleOutline, id: 'd', depthMm: 6, center: { x: 500, y: 300 }, diameterMm: 80, toolSide: ToolSide.Outside },
      { kind: DesignOperationKind.CircleOutline, id: 'e', depthMm: 6, center: { x: 700, y: 300 }, diameterMm: 80, toolSide: ToolSide.Inside },
      { kind: DesignOperationKind.RectanglePocket, id: 'f', depthMm: 6, corner: { x: 500, y: 50 }, widthMm: 100, heightMm: 50 },
      { kind: DesignOperationKind.CirclePocket, id: 'g', depthMm: 6, center: { x: 800, y: 100 }, diameterMm: 60 },
    ];
    expect(cut(project(everyKind)).program.diagnostics).toEqual([]);
  });

  it('starts with the spindle on at a safe height and ends with it off at zero', () => {
    const lines = cut(project([])).text.trim().split('\n');
    expect(lines.indexOf('G0 Z5')).toBeLessThan(lines.indexOf('M3 S18000'));
    expect(lines.slice(-3)).toEqual(['M5', 'G0 X0 Y0', 'M30']);
  });

  it('drills a hole with a rapid approach and a slow plunge', () => {
    const { text } = cut(project([{ kind: DesignOperationKind.Hole, id: 'a', depthMm: 5, center: { x: 50, y: 40 } }]));
    expect(text).toContain('G0 X50 Y40\nG1 Z-5 F400\nG0 Z5');
  });

  it('drills every hole of a grid', () => {
    const grid: DesignOperation = { kind: DesignOperationKind.HoleGrid, id: 'a', depthMm: 5, origin: { x: 10, y: 10 }, columnCount: 3, rowCount: 2, spacingXMm: 20, spacingYMm: 30 };
    const { text, path } = cut(project([grid]));
    expect(text.match(/G1 Z-5/g)).toHaveLength(6);
    expect(path.partBounds?.max.x).toBe(50);
    expect(path.partBounds?.max.y).toBe(40);
  });

  it('reaches the full depth in passes no deeper than allowed', () => {
    const { text } = cut(project([{ kind: DesignOperationKind.Slot, id: 'a', depthMm: 7, start: { x: 10, y: 10 }, end: { x: 50, y: 10 } }]));
    expect(text.match(/G1 Z-[\d.]+/g)).toEqual(['G1 Z-3', 'G1 Z-6', 'G1 Z-7']);
  });

  it('does not add a needless pass when the depth is an exact multiple', () => {
    const { text } = cut(project([{ kind: DesignOperationKind.Slot, id: 'a', depthMm: 6, start: { x: 10, y: 10 }, end: { x: 50, y: 10 } }]));
    expect(text.match(/G1 Z-[\d.]+/g)).toEqual(['G1 Z-3', 'G1 Z-6']);
  });

  it('offsets an outside rectangle by the tool radius, leaving the part at its exact size', () => {
    const { partBounds } = cut(project([rectangleOutline(ToolSide.Outside)])).path;
    expect(partBounds?.min.x).toBeCloseTo(100 - TOOL_RADIUS, 6);
    expect(partBounds?.max.x).toBeCloseTo(300 + TOOL_RADIUS, 6);
    expect(partBounds?.min.y).toBeCloseTo(100 - TOOL_RADIUS, 6);
    expect(partBounds?.max.y).toBeCloseTo(200 + TOOL_RADIUS, 6);
  });

  it('offsets an inside rectangle inward and keeps a line cut on the line', () => {
    const inside = cut(project([rectangleOutline(ToolSide.Inside)])).path.partBounds;
    expect(inside?.min.x).toBeCloseTo(100 + TOOL_RADIUS, 6);
    expect(inside?.max.x).toBeCloseTo(300 - TOOL_RADIUS, 6);
    const onLine = cut(project([rectangleOutline(ToolSide.OnLine)])).path.partBounds;
    expect(onLine?.min.x).toBeCloseTo(100, 6);
    expect(onLine?.max.x).toBeCloseTo(300, 6);
  });

  it('offsets circles by the tool radius', () => {
    const circle = (toolSide: ToolSide): DesignOperation => ({ kind: DesignOperationKind.CircleOutline, id: 'a', depthMm: 3, center: { x: 100, y: 100 }, diameterMm: 80, toolSide });
    expect(cut(project([circle(ToolSide.Outside)])).path.partBounds?.max.x).toBeCloseTo(140 + TOOL_RADIUS, 6);
    expect(cut(project([circle(ToolSide.Inside)])).path.partBounds?.max.x).toBeCloseTo(140 - TOOL_RADIUS, 6);
  });

  it('keeps a pocket within its walls and clears its middle', () => {
    const { path } = cut(project([{ kind: DesignOperationKind.RectanglePocket, id: 'a', depthMm: 3, corner: { x: 100, y: 100 }, widthMm: 60, heightMm: 40 }]));
    expect(path.partBounds?.min.x).toBeCloseTo(100 + TOOL_RADIUS, 6);
    expect(path.partBounds?.max.x).toBeCloseTo(160 - TOOL_RADIUS, 6);
    expect(path.partBounds?.max.y).toBeCloseTo(140 - TOOL_RADIUS, 6);
    expect(path.feedLength).toBeGreaterThan(2 * (54 + 34));
  });

  it('writes no moves to where the tool already is', () => {
    const { text } = cut(project([{ kind: DesignOperationKind.RectanglePocket, id: 'a', depthMm: 3, corner: { x: 100, y: 100 }, widthMm: 60, heightMm: 40 }]));
    const moves = text.split('\n').filter((line) => /^G[01] X/.test(line)).map((line) => line.replace(/^G\d /, '').replace(/ F[\d.]+$/, ''));
    moves.forEach((move, index) => expect(move).not.toBe(moves[index - 1]));
  });

  it('drills when a round pocket is exactly as wide as the tool', () => {
    const { text, program } = cut(project([{ kind: DesignOperationKind.CirclePocket, id: 'a', depthMm: 6, center: { x: 50, y: 50 }, diameterMm: 6 }]));
    expect(program.diagnostics).toEqual([]);
    expect(text).not.toMatch(/G[23] /);
  });

  it('expresses coordinates relative to the chosen zero', () => {
    const hole: DesignOperation = { kind: DesignOperationKind.Hole, id: 'a', depthMm: 3, center: { x: 500, y: 300 } };
    expect(cut(project([hole], { zeroOrigin: ZeroOrigin.SheetLowerLeft })).text).toContain('G0 X500 Y300');
    expect(cut(project([hole], { zeroOrigin: ZeroOrigin.SheetCenter })).text).toContain('G0 X0 Y0\nG1 Z-3');
    expect(cut(project([hole], { zeroOrigin: ZeroOrigin.SheetUpperRight })).text).toContain('G0 X-500 Y-300');
  });
});
