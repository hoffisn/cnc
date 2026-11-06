import { areHoldingTabsActive, createOutlineContour, measureContour, placeTabGaps } from './designContours';
import { DesignOperationKind, ToolSide, type DesignOperation } from './designOperation';
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
}

/** Problem found in a project. */
export interface DesignIssue {
  readonly code: DesignIssueCode;
  /** Operation at fault; `null` when the problem is in the work surface. */
  readonly operationId: string | null;
}

/** Rounding of coordinates must not turn a shape touching the sheet's edge into a violation. */
const EDGE_TOLERANCE_MM = 1e-6;

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
  }
}

/** Checks holding tabs where they take effect, on outlines cut through the sheet. */
function checkHoldingTabs(operation: DesignOperation, surface: WorkSurface): DesignIssueCode | null {
  if (operation.kind !== DesignOperationKind.RectangleOutline && operation.kind !== DesignOperationKind.CircleOutline) {
    return null;
  }
  const { tabs } = operation;
  if (!areHoldingTabsActive(tabs, operation.depthMm, surface)) return null;
  if (tabs.widthMm <= 0 || tabs.heightMm <= 0) return DesignIssueCode.TabSizeNotPositive;
  if (tabs.heightMm >= operation.depthMm) return DesignIssueCode.TabNotLowerThanCut;
  const contour = createOutlineContour(operation, surface.toolDiameterMm / 2);
  return placeTabGaps(measureContour(contour), tabs, surface.toolDiameterMm).length === 0
    ? DesignIssueCode.TabsDoNotFit
    : null;
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
