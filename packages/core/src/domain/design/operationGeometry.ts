import {
  DesignOperationKind,
  ToolSide,
  type DesignOperation,
  type SheetPoint,
} from './designOperation';

/** Axis-aligned rectangle on the sheet. */
export interface SheetRectangle {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Draggable point that changes a drawn shape. */
export enum OperationHandleKind {
  Start = 'start',
  End = 'end',
  CornerLowerLeft = 'corner-lower-left',
  CornerLowerRight = 'corner-lower-right',
  CornerUpperLeft = 'corner-upper-left',
  CornerUpperRight = 'corner-upper-right',
  Radius = 'radius',
  GridExtent = 'grid-extent',
}

/** A handle and where it currently is. */
export interface OperationHandle {
  readonly kind: OperationHandleKind;
  readonly point: SheetPoint;
}

/** Size of a shape placed by a click instead of a drag, relative to the tool. */
const CLICK_SHAPE_SIZE_IN_TOOL_DIAMETERS = 8;
const DEFAULT_GRID_SIZE = 3;
const DEFAULT_GRID_SPACING_IN_TOOL_DIAMETERS = 5;
/** Drags shorter than this are clicks: a hand always trembles a little. */
const MIN_DRAG_DISTANCE_MM = 0.5;

const offsetPoint = (point: SheetPoint, deltaX: number, deltaY: number): SheetPoint => ({
  x: point.x + deltaX,
  y: point.y + deltaY,
});

/** Returns a copy of an operation shifted across the sheet. */
export function translateOperation<TOperation extends DesignOperation>(
  operation: TOperation,
  deltaX: number,
  deltaY: number,
): TOperation;
export function translateOperation(operation: DesignOperation, deltaX: number, deltaY: number): DesignOperation {
  switch (operation.kind) {
    case DesignOperationKind.Hole:
    case DesignOperationKind.CircleOutline:
    case DesignOperationKind.CirclePocket:
      return { ...operation, center: offsetPoint(operation.center, deltaX, deltaY) };
    case DesignOperationKind.HoleGrid:
      return { ...operation, origin: offsetPoint(operation.origin, deltaX, deltaY) };
    case DesignOperationKind.Slot:
      return {
        ...operation,
        start: offsetPoint(operation.start, deltaX, deltaY),
        end: offsetPoint(operation.end, deltaX, deltaY),
      };
    case DesignOperationKind.RectangleOutline:
    case DesignOperationKind.RectanglePocket:
      return { ...operation, corner: offsetPoint(operation.corner, deltaX, deltaY) };
  }
}

/** Radius of the outer edge of a cut along a circle, for the given tool side. */
function outerCutRadius(radius: number, toolSide: ToolSide, toolDiameter: number): number {
  switch (toolSide) {
    case ToolSide.OnLine:
      return radius + toolDiameter / 2;
    case ToolSide.Outside:
      return radius + toolDiameter;
    case ToolSide.Inside:
      return radius;
  }
}

const rectangleAround = (center: SheetPoint, radius: number): SheetRectangle => ({
  minX: center.x - radius,
  minY: center.y - radius,
  maxX: center.x + radius,
  maxY: center.y + radius,
});

const expandRectangle = (rectangle: SheetRectangle, margin: number): SheetRectangle => ({
  minX: rectangle.minX - margin,
  minY: rectangle.minY - margin,
  maxX: rectangle.maxX + margin,
  maxY: rectangle.maxY + margin,
});

/** Computes the area of material an operation touches, including the width of the tool. */
export function computeCutFootprint(operation: DesignOperation, toolDiameter: number): SheetRectangle {
  const toolRadius = toolDiameter / 2;
  switch (operation.kind) {
    case DesignOperationKind.Hole:
      return rectangleAround(operation.center, toolRadius);
    case DesignOperationKind.HoleGrid:
      return expandRectangle(
        {
          minX: operation.origin.x,
          minY: operation.origin.y,
          maxX: operation.origin.x + (operation.columnCount - 1) * operation.spacingXMm,
          maxY: operation.origin.y + (operation.rowCount - 1) * operation.spacingYMm,
        },
        toolRadius,
      );
    case DesignOperationKind.Slot:
      return expandRectangle(
        {
          minX: Math.min(operation.start.x, operation.end.x),
          minY: Math.min(operation.start.y, operation.end.y),
          maxX: Math.max(operation.start.x, operation.end.x),
          maxY: Math.max(operation.start.y, operation.end.y),
        },
        toolRadius,
      );
    case DesignOperationKind.RectangleOutline:
      return expandRectangle(
        {
          minX: operation.corner.x,
          minY: operation.corner.y,
          maxX: operation.corner.x + operation.widthMm,
          maxY: operation.corner.y + operation.heightMm,
        },
        outerCutRadius(0, operation.toolSide, toolDiameter),
      );
    case DesignOperationKind.CircleOutline:
      return rectangleAround(
        operation.center,
        outerCutRadius(operation.diameterMm / 2, operation.toolSide, toolDiameter),
      );
    case DesignOperationKind.RectanglePocket:
      return {
        minX: operation.corner.x,
        minY: operation.corner.y,
        maxX: operation.corner.x + operation.widthMm,
        maxY: operation.corner.y + operation.heightMm,
      };
    case DesignOperationKind.CirclePocket:
      return rectangleAround(operation.center, operation.diameterMm / 2);
  }
}

/** Lists the handles available for editing an operation on the drawing. */
export function listOperationHandles(operation: DesignOperation): OperationHandle[] {
  switch (operation.kind) {
    case DesignOperationKind.Hole:
      return [];
    case DesignOperationKind.HoleGrid:
      return [
        {
          kind: OperationHandleKind.GridExtent,
          point: {
            x: operation.origin.x + (operation.columnCount - 1) * operation.spacingXMm,
            y: operation.origin.y + (operation.rowCount - 1) * operation.spacingYMm,
          },
        },
      ];
    case DesignOperationKind.Slot:
      return [
        { kind: OperationHandleKind.Start, point: operation.start },
        { kind: OperationHandleKind.End, point: operation.end },
      ];
    case DesignOperationKind.RectangleOutline:
    case DesignOperationKind.RectanglePocket: {
      const { x, y } = operation.corner;
      const right = x + operation.widthMm;
      const top = y + operation.heightMm;
      return [
        { kind: OperationHandleKind.CornerLowerLeft, point: { x, y } },
        { kind: OperationHandleKind.CornerLowerRight, point: { x: right, y } },
        { kind: OperationHandleKind.CornerUpperLeft, point: { x, y: top } },
        { kind: OperationHandleKind.CornerUpperRight, point: { x: right, y: top } },
      ];
    }
    case DesignOperationKind.CircleOutline:
    case DesignOperationKind.CirclePocket:
      return [
        {
          kind: OperationHandleKind.Radius,
          point: { x: operation.center.x + operation.diameterMm / 2, y: operation.center.y },
        },
      ];
  }
}

const distanceBetweenPoints = (first: SheetPoint, second: SheetPoint): number =>
  Math.hypot(first.x - second.x, first.y - second.y);

/** The rectangle spanned by two opposite corners, in any order. */
const rectangleBetween = (first: SheetPoint, second: SheetPoint) => ({
  corner: { x: Math.min(first.x, second.x), y: Math.min(first.y, second.y) },
  widthMm: Math.abs(first.x - second.x),
  heightMm: Math.abs(first.y - second.y),
});

/** Corner staying in place while the given corner handle is dragged. */
function findOppositeCorner(
  handle: OperationHandleKind,
  corner: SheetPoint,
  widthMm: number,
  heightMm: number,
): SheetPoint {
  const isHandleOnRight =
    handle === OperationHandleKind.CornerLowerRight || handle === OperationHandleKind.CornerUpperRight;
  const isHandleOnTop =
    handle === OperationHandleKind.CornerUpperLeft || handle === OperationHandleKind.CornerUpperRight;
  return {
    x: isHandleOnRight ? corner.x : corner.x + widthMm,
    y: isHandleOnTop ? corner.y : corner.y + heightMm,
  };
}

/** Returns a copy of an operation with one of its handles moved to a new point. */
export function dragOperationHandle<TOperation extends DesignOperation>(
  operation: TOperation,
  handle: OperationHandleKind,
  point: SheetPoint,
): TOperation;
export function dragOperationHandle(
  operation: DesignOperation,
  handle: OperationHandleKind,
  point: SheetPoint,
): DesignOperation {
  switch (operation.kind) {
    case DesignOperationKind.Hole:
      return operation;
    case DesignOperationKind.HoleGrid: {
      const spanX = point.x - operation.origin.x;
      const spanY = point.y - operation.origin.y;
      return {
        ...operation,
        spacingXMm: operation.columnCount > 1 && spanX > 0 ? spanX / (operation.columnCount - 1) : operation.spacingXMm,
        spacingYMm: operation.rowCount > 1 && spanY > 0 ? spanY / (operation.rowCount - 1) : operation.spacingYMm,
      };
    }
    case DesignOperationKind.Slot:
      return handle === OperationHandleKind.Start ? { ...operation, start: point } : { ...operation, end: point };
    case DesignOperationKind.RectangleOutline:
    case DesignOperationKind.RectanglePocket:
      return {
        ...operation,
        ...rectangleBetween(findOppositeCorner(handle, operation.corner, operation.widthMm, operation.heightMm), point),
      };
    case DesignOperationKind.CircleOutline:
    case DesignOperationKind.CirclePocket:
      return { ...operation, diameterMm: distanceBetweenPoints(operation.center, point) * 2 };
  }
}

/** Parameters of drawing a new shape. */
export interface OperationDrawing {
  readonly kind: DesignOperationKind;
  readonly id: string;
  /** Where the pointer went down. */
  readonly start: SheetPoint;
  /** Where the pointer is now; equal to the start after a plain click. */
  readonly end: SheetPoint;
  readonly toolDiameterMm: number;
  readonly depthMm: number;
}

/**
 * Creates an operation from a gesture on the drawing.
 * A drag sets the size directly, and a plain click places a shape of a sensible default size.
 */
export function createOperationFromDrawing(drawing: OperationDrawing): DesignOperation {
  const { kind, id, start, end, toolDiameterMm, depthMm } = drawing;
  const defaultSize = toolDiameterMm * CLICK_SHAPE_SIZE_IN_TOOL_DIAMETERS;
  const dragDistance = distanceBetweenPoints(start, end);
  const isClick = dragDistance < MIN_DRAG_DISTANCE_MM;
  const rectangle = isClick
    ? { corner: start, widthMm: defaultSize, heightMm: defaultSize }
    : rectangleBetween(start, end);
  const diameterMm = isClick ? defaultSize : dragDistance * 2;

  switch (kind) {
    case DesignOperationKind.Hole:
      return { kind, id, depthMm, center: start };
    case DesignOperationKind.HoleGrid:
      return {
        kind,
        id,
        depthMm,
        origin: start,
        columnCount: DEFAULT_GRID_SIZE,
        rowCount: DEFAULT_GRID_SIZE,
        spacingXMm: isClick ? toolDiameterMm * DEFAULT_GRID_SPACING_IN_TOOL_DIAMETERS : Math.abs(end.x - start.x) / (DEFAULT_GRID_SIZE - 1),
        spacingYMm: isClick ? toolDiameterMm * DEFAULT_GRID_SPACING_IN_TOOL_DIAMETERS : Math.abs(end.y - start.y) / (DEFAULT_GRID_SIZE - 1),
      };
    case DesignOperationKind.Slot:
      return { kind, id, depthMm, start, end: isClick ? { x: start.x + defaultSize, y: start.y } : end };
    case DesignOperationKind.RectangleOutline:
      return { kind, id, depthMm, ...rectangle, toolSide: ToolSide.Outside };
    case DesignOperationKind.CircleOutline:
      return { kind, id, depthMm, center: start, diameterMm, toolSide: ToolSide.Outside };
    case DesignOperationKind.RectanglePocket:
      return { kind, id, depthMm, ...rectangle };
    case DesignOperationKind.CirclePocket:
      return { kind, id, depthMm, center: start, diameterMm };
  }
}
