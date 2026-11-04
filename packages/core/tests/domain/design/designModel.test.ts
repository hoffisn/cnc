import { describe, expect, it } from 'vitest';
import { DesignOperationKind, ToolSide, type DesignOperation } from '@core/domain/design/designOperation';
import { EMPTY_DESIGN_PROJECT, parseDesignProject, type DesignProject } from '@core/domain/design/designProject';
import { DesignIssueCode, findDesignIssues } from '@core/domain/design/designRules';
import {
  OperationHandleKind,
  computeCutFootprint,
  createOperationFromDrawing,
  dragOperationHandle,
  listOperationHandles,
  translateOperation,
} from '@core/domain/design/operationGeometry';
import { DEFAULT_WORK_SURFACE, LengthUnit, ZeroOrigin } from '@core/domain/design/workSurface';

const pocket: DesignOperation = {
  kind: DesignOperationKind.RectanglePocket,
  id: 'pocket',
  depthMm: 5,
  corner: { x: 100, y: 100 },
  widthMm: 50,
  heightMm: 30,
};

const withOperations = (...operations: DesignOperation[]): DesignProject => ({ ...EMPTY_DESIGN_PROJECT, operations });
const issueCodes = (project: DesignProject): DesignIssueCode[] => findDesignIssues(project).map((issue) => issue.code);

describe('drawing shapes', () => {
  const drawing = { id: 'new', toolDiameterMm: 6, depthMm: 3 };

  it('takes the size from a drag in any direction', () => {
    const operation = createOperationFromDrawing({
      ...drawing,
      kind: DesignOperationKind.RectanglePocket,
      start: { x: 100, y: 80 },
      end: { x: 40, y: 120 },
    });
    expect(operation).toMatchObject({ corner: { x: 40, y: 80 }, widthMm: 60, heightMm: 40 });
  });

  it('takes a circle radius from the drag distance', () => {
    const operation = createOperationFromDrawing({
      ...drawing,
      kind: DesignOperationKind.CirclePocket,
      start: { x: 0, y: 0 },
      end: { x: 30, y: 40 },
    });
    expect(operation).toMatchObject({ center: { x: 0, y: 0 }, diameterMm: 100 });
  });

  it('places a usable default shape on a plain click', () => {
    const operation = createOperationFromDrawing({
      ...drawing,
      kind: DesignOperationKind.RectangleOutline,
      start: { x: 10, y: 10 },
      end: { x: 10, y: 10 },
    });
    expect(operation).toMatchObject({ widthMm: 48, heightMm: 48, toolSide: ToolSide.Outside });
  });
});

describe('editing shapes', () => {
  it('moves a shape without changing its size', () => {
    expect(translateOperation(pocket, 10, -20)).toMatchObject({ corner: { x: 110, y: 80 }, widthMm: 50, heightMm: 30 });
  });

  it('moves both ends of a slot', () => {
    const slot: DesignOperation = { kind: DesignOperationKind.Slot, id: 's', depthMm: 1, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    expect(translateOperation(slot, 5, 5)).toMatchObject({ start: { x: 5, y: 5 }, end: { x: 15, y: 5 } });
  });

  it('keeps the opposite corner in place while resizing', () => {
    const resized = dragOperationHandle(pocket, OperationHandleKind.CornerUpperRight, { x: 200, y: 200 });
    expect(resized).toMatchObject({ corner: { x: 100, y: 100 }, widthMm: 100, heightMm: 100 });
    const fromLowerLeft = dragOperationHandle(pocket, OperationHandleKind.CornerLowerLeft, { x: 90, y: 90 });
    expect(fromLowerLeft).toMatchObject({ corner: { x: 90, y: 90 }, widthMm: 60, heightMm: 40 });
  });

  it('survives dragging a corner across the opposite one', () => {
    const flipped = dragOperationHandle(pocket, OperationHandleKind.CornerUpperRight, { x: 60, y: 60 });
    expect(flipped).toMatchObject({ corner: { x: 60, y: 60 }, widthMm: 40, heightMm: 40 });
  });

  it('places handles where dragging them is consistent', () => {
    const handles = listOperationHandles(pocket);
    expect(handles).toHaveLength(4);
    for (const handle of handles) expect(dragOperationHandle(pocket, handle.kind, handle.point)).toEqual(pocket);
  });
});

describe('design rules', () => {
  it('accept a valid project', () => {
    expect(findDesignIssues(withOperations(pocket))).toEqual([]);
  });

  it('reject shapes whose cut leaves the sheet, counting the tool width', () => {
    const onEdge: DesignOperation = { kind: DesignOperationKind.Hole, id: 'h', depthMm: 3, center: { x: 2, y: 100 } };
    expect(findDesignIssues(withOperations(onEdge))).toEqual([{ code: DesignIssueCode.OperationOutsideSheet, operationId: 'h' }]);
    expect(issueCodes(withOperations({ ...onEdge, center: { x: 3, y: 100 } }))).toEqual([]);
  });

  it('count the cut on the outer side of an outside contour', () => {
    const outline: DesignOperation = { kind: DesignOperationKind.RectangleOutline, id: 'r', depthMm: 3, corner: { x: 4, y: 100 }, widthMm: 50, heightMm: 50, toolSide: ToolSide.Outside };
    expect(computeCutFootprint(outline, 6).minX).toBe(-2);
    expect(issueCodes(withOperations(outline))).toEqual([DesignIssueCode.OperationOutsideSheet]);
    expect(issueCodes(withOperations({ ...outline, toolSide: ToolSide.Inside }))).toEqual([]);
  });

  it('reject cutting deeper than the sheet and non-positive depth', () => {
    expect(issueCodes(withOperations({ ...pocket, depthMm: 18.5 }))).toEqual([DesignIssueCode.DepthExceedsThickness]);
    expect(issueCodes(withOperations({ ...pocket, depthMm: 18 }))).toEqual([]);
    expect(issueCodes(withOperations({ ...pocket, depthMm: 0 }))).toEqual([DesignIssueCode.DepthNotPositive]);
  });

  it('reject pockets the tool does not fit into', () => {
    expect(issueCodes(withOperations({ ...pocket, widthMm: 5 }))).toEqual([DesignIssueCode.ShapeSmallerThanTool]);
  });

  it('reject a sheet that does not fit the table', () => {
    const project = { ...EMPTY_DESIGN_PROJECT, surface: { ...DEFAULT_WORK_SURFACE, sheetWidthMm: 5000 } };
    expect(issueCodes(project)).toEqual([DesignIssueCode.SheetDoesNotFitTable]);
  });
});

describe('parseDesignProject', () => {
  it('starts empty when nothing was stored', () => {
    expect(parseDesignProject(null)).toEqual({ project: EMPTY_DESIGN_PROJECT, wasRecovered: false });
  });

  it('reads a saved project without loss', () => {
    const project: DesignProject = {
      ...EMPTY_DESIGN_PROJECT,
      surface: { ...DEFAULT_WORK_SURFACE, zeroOrigin: ZeroOrigin.SheetCenter, displayUnit: LengthUnit.Meter },
      operations: [
        pocket,
        { kind: DesignOperationKind.Hole, id: 'a', depthMm: 1, center: { x: 1, y: 2 } },
        { kind: DesignOperationKind.HoleGrid, id: 'b', depthMm: 1, origin: { x: 1, y: 2 }, columnCount: 2, rowCount: 2, spacingXMm: 5, spacingYMm: 5 },
        { kind: DesignOperationKind.Slot, id: 'c', depthMm: 1, start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
        { kind: DesignOperationKind.RectangleOutline, id: 'd', depthMm: 1, corner: { x: 0, y: 0 }, widthMm: 9, heightMm: 9, toolSide: ToolSide.Inside },
        { kind: DesignOperationKind.CircleOutline, id: 'e', depthMm: 1, center: { x: 0, y: 0 }, diameterMm: 9, toolSide: ToolSide.OnLine },
        { kind: DesignOperationKind.CirclePocket, id: 'f', depthMm: 1, center: { x: 0, y: 0 }, diameterMm: 9 },
      ],
    };
    expect(parseDesignProject(JSON.parse(JSON.stringify(project)))).toEqual({ project, wasRecovered: false });
  });

  it('drops damaged operations and keeps the rest', () => {
    const { project, wasRecovered } = parseDesignProject({
      surface: DEFAULT_WORK_SURFACE,
      operations: [pocket, { id: 'x', kind: 'unknown', depthMm: 1 }, { ...pocket }, { kind: DesignOperationKind.Hole, id: 'y', depthMm: 1 }],
    });
    expect(wasRecovered).toBe(true);
    expect(project.operations).toEqual([pocket]);
  });

  it('replaces damaged surface fields and keeps good ones', () => {
    const { project, wasRecovered } = parseDesignProject({
      surface: { ...DEFAULT_WORK_SURFACE, sheetWidthMm: -1, sheetDepthMm: 777, zeroOrigin: 'nowhere' },
      operations: [],
    });
    expect(wasRecovered).toBe(true);
    expect(project.surface.sheetWidthMm).toBe(DEFAULT_WORK_SURFACE.sheetWidthMm);
    expect(project.surface.sheetDepthMm).toBe(777);
    expect(project.surface.zeroOrigin).toBe(DEFAULT_WORK_SURFACE.zeroOrigin);
  });
});
