import { areHoldingTabsActive, createOutlineContour, measureContour, placeTabGaps } from './designContours';
import { DesignOperationKind, ShapeCut, ToolSide, type DesignOperation, type ShapeOperation } from './designOperation';
import { hasClosedArea, isUsablePath, planShapeOutline, planShapePocket } from './shapeGeometry';
import type { DesignProject } from './designProject';
import { computeCutFootprint } from './operationGeometry';
import type { WorkSurface } from './workSurface';

/** Reason a project must not be sent to a machine. */
export enum DesignIssueCode {
  SheetDoesNotFitTable = 'sheet-does-not-fit-table',
  SafeHeightRequired = 'safe-height-required',
  OperationOutsideSheet = 'operation-outside-sheet',
  DepthNotPositive = 'depth-not-positive',
  DepthExceedsThickness = 'depth-exceeds-thickness',
  ShapeSmallerThanTool = 'shape-smaller-than-tool',
  ShapeSizeNotPositive = 'shape-size-not-positive',
  GridCountNotPositive = 'grid-count-not-positive',
  TabSizeNotPositive = 'tab-size-not-positive',
  TabNotLowerThanCut = 'tab-not-lower-than-cut',
  TabsDoNotFit = 'tabs-do-not-fit',
  ShapeNotClosed = 'shape-not-closed',
}

/** Problem found in a project. */
export interface DesignIssue {
  readonly code: DesignIssueCode;
  /** Operation at fault; `null` when the problem is in the work surface. */
  readonly operationId: string | null;
}

/** Rounding of coordinates must not turn a shape touching the sheet's edge into a violation. */
const EDGE_TOLERANCE_MM = 1e-6;

/** A shape needs usable lines, an area for a pocket, and room for the tool where it runs inside. */
function checkFreeShape(operation: ShapeOperation, toolDiameterMm: number): DesignIssueCode | null {
  if (!operation.paths.some(isUsablePath)) return DesignIssueCode.ShapeSizeNotPositive;
  const toolRadius = toolDiameterMm / 2;
  switch (operation.cut) {
    case ShapeCut.Engrave:
      return null;
    case ShapeCut.Pocket:
      if (!hasClosedArea(operation.paths)) return DesignIssueCode.ShapeNotClosed;
      return planShapePocket(operation, toolRadius, toolDiameterMm).length === 0 ? DesignIssueCode.ShapeSmallerThanTool : null;
    case ShapeCut.Outline:
      if (operation.toolSide !== ToolSide.Inside || !hasClosedArea(operation.paths)) return null;
      return planShapeOutline(operation, toolRadius).some((line) => line.isClosed) ? null : DesignIssueCode.ShapeSmallerThanTool;
  }
}

function checkShapeSize(operation: DesignOperation, toolDiameterMm: number): DesignIssueCode | null {
  const isSmallerThanTool = (size: number): boolean => size + EDGE_TOLERANCE_MM < toolDiameterMm;
  switch (operation.kind) {
    case DesignOperationKind.Hole:
      return null;
    case DesignOperationKind.HoleGrid:
      if (operation.columnCount < 1 || operation.rowCount < 1) return DesignIssueCode.GridCountNotPositive;
      return operation.spacingXMm > 0 && operation.spacingYMm > 0 ? null : DesignIssueCode.ShapeSizeNotPositive;
    case DesignOperationKind.Slot:
      return operation.start.x === operation.end.x && operation.start.y === operation.end.y
        ? DesignIssueCode.ShapeSizeNotPositive
        : null;
    case DesignOperationKind.RectangleOutline:
      if (operation.widthMm <= 0 || operation.heightMm <= 0) return DesignIssueCode.ShapeSizeNotPositive;
      return operation.toolSide === ToolSide.Inside &&
        (isSmallerThanTool(operation.widthMm) || isSmallerThanTool(operation.heightMm))
        ? DesignIssueCode.ShapeSmallerThanTool
        : null;
    case DesignOperationKind.RectanglePocket:
      if (operation.widthMm <= 0 || operation.heightMm <= 0) return DesignIssueCode.ShapeSizeNotPositive;
      return isSmallerThanTool(operation.widthMm) || isSmallerThanTool(operation.heightMm)
        ? DesignIssueCode.ShapeSmallerThanTool
        : null;
    case DesignOperationKind.CircleOutline:
      if (operation.diameterMm <= 0) return DesignIssueCode.ShapeSizeNotPositive;
      return operation.toolSide === ToolSide.Inside && isSmallerThanTool(operation.diameterMm)
        ? DesignIssueCode.ShapeSmallerThanTool
        : null;
    case DesignOperationKind.CirclePocket:
      if (operation.diameterMm <= 0) return DesignIssueCode.ShapeSizeNotPositive;
      return isSmallerThanTool(operation.diameterMm) ? DesignIssueCode.ShapeSmallerThanTool : null;
    case DesignOperationKind.Shape:
      return checkFreeShape(operation, toolDiameterMm);
  }
}

/** Checks holding tabs where they take effect, on outlines cut through the sheet. */
function checkHoldingTabs(operation: DesignOperation, surface: WorkSurface): DesignIssueCode | null {
  const isShapeOutline = operation.kind === DesignOperationKind.Shape && operation.cut === ShapeCut.Outline;
  if (operation.kind !== DesignOperationKind.RectangleOutline && operation.kind !== DesignOperationKind.CircleOutline && !isShapeOutline) {
    return null;
  }
  const { tabs } = operation;
  if (!areHoldingTabsActive(tabs, operation.depthMm, surface)) return null;
  if (tabs.widthMm <= 0 || tabs.heightMm <= 0) return DesignIssueCode.TabSizeNotPositive;
  if (tabs.heightMm >= operation.depthMm) return DesignIssueCode.TabNotLowerThanCut;
  const toolRadius = surface.toolDiameterMm / 2;
  const contourLengths =
    operation.kind === DesignOperationKind.Shape
      ? planShapeOutline(operation, toolRadius)
          .filter((line) => line.isClosed)
          .map((line) => measurePolyline(line.points))
      : [measureContour(createOutlineContour(operation, toolRadius))];
  return contourLengths.some((length) => placeTabGaps(length, tabs, surface.toolDiameterMm).length > 0)
    ? null
    : DesignIssueCode.TabsDoNotFit;
}

/** Length of a closed polyline, including the return to its start. */
function measurePolyline(points: readonly { x: number; y: number }[]): number {
  return points.reduce((length, point, index) => {
    const next = points[(index + 1) % points.length] ?? point;
    return length + Math.hypot(next.x - point.x, next.y - point.y);
  }, 0);
}

function isInsideSheet(operation: DesignOperation, surface: WorkSurface): boolean {
  const footprint = computeCutFootprint(operation, surface.toolDiameterMm);
  return (
    footprint.minX >= -EDGE_TOLERANCE_MM &&
    footprint.minY >= -EDGE_TOLERANCE_MM &&
    footprint.maxX <= surface.sheetWidthMm + EDGE_TOLERANCE_MM &&
    footprint.maxY <= surface.sheetDepthMm + EDGE_TOLERANCE_MM
  );
}

function checkOperation(operation: DesignOperation, surface: WorkSurface): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const report = (code: DesignIssueCode): void => {
    issues.push({ code, operationId: operation.id });
  };

  if (operation.depthMm <= 0) report(DesignIssueCode.DepthNotPositive);
  else if (operation.depthMm > surface.sheetThicknessMm + EDGE_TOLERANCE_MM) report(DesignIssueCode.DepthExceedsThickness);

  const sizeIssue = checkShapeSize(operation, surface.toolDiameterMm);
  if (sizeIssue) report(sizeIssue);
  else if (!isInsideSheet(operation, surface)) report(DesignIssueCode.OperationOutsideSheet);

  const tabIssue = sizeIssue ? null : checkHoldingTabs(operation, surface);
  if (tabIssue) report(tabIssue);

  return issues;
}

/** Finds everything that makes a project unsafe to run: an empty result means it may go to a machine. */
export function findDesignIssues(project: DesignProject): DesignIssue[] {
  const { surface, operations } = project;
  const issues: DesignIssue[] = [];

  const reachesX = surface.sheetOffsetXMm + surface.sheetWidthMm;
  const reachesY = surface.sheetOffsetYMm + surface.sheetDepthMm;
  if (reachesX > surface.tableWidthMm + EDGE_TOLERANCE_MM || reachesY > surface.tableDepthMm + EDGE_TOLERANCE_MM) {
    issues.push({ code: DesignIssueCode.SheetDoesNotFitTable, operationId: null });
  }
  if (surface.safeHeightMm <= 0) {
    issues.push({ code: DesignIssueCode.SafeHeightRequired, operationId: null });
  }

  for (const operation of operations) issues.push(...checkOperation(operation, surface));
  return issues;
}
