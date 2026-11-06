import {
  DEFAULT_HOLDING_TABS,
  DesignOperationKind,
  ShapeCut,
  ToolSide,
  type DesignOperation,
  type SheetPath,
  type SheetPoint,
  type ShapeOperation,
} from './designOperation';
import { findPathsBounds, measureShapeCutMargin } from './shapeGeometry';

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
  /** A point of a freely drawn shape. */
  Vertex = 'vertex',
}

/** A handle and where it currently is. */
export interface OperationHandle {
  readonly kind: OperationHandleKind;
  readonly point: SheetPoint;
  /** Which point of which path a vertex handle moves. */
  readonly vertex?: { readonly pathIndex: number; readonly pointIndex: number };
}

/** Shapes with more points, such as imported drawings, are changed as a whole rather than point by point. */
export const MAX_EDITABLE_VERTICES = 64;

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

const mapShapePoints = (paths: readonly SheetPath[], transform: (point: SheetPoint) => SheetPoint): SheetPath[] =>
  paths.map((path) => ({ ...path, points: path.points.map(transform) }));

/** Scales a shape's paths about a fixed point, keeping their proportions. */
export function scaleShapePaths(paths: readonly SheetPath[], factor: number, anchor: SheetPoint): SheetPath[] {
  return mapShapePoints(paths, (point) => ({
    x: anchor.x + (point.x - anchor.x) * factor,
    y: anchor.y + (point.y - anchor.y) * factor,
  }));
}

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
    case DesignOperationKind.Shape:
      return { ...operation, paths: mapShapePoints(operation.paths, (point) => offsetPoint(point, deltaX, deltaY)) };
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
    case DesignOperationKind.Shape: {
      const bounds = findPathsBounds(operation.paths) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      return expandRectangle(bounds, measureShapeCutMargin(operation, toolDiameter));
    }
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
    case DesignOperationKind.Shape: {
      const vertexCount = operation.paths.reduce((total, path) => total + path.points.length, 0);
      if (vertexCount > MAX_EDITABLE_VERTICES) return [];
      return operation.paths.flatMap((path, pathIndex) =>
        path.points.map((point, pointIndex) => ({ kind: OperationHandleKind.Vertex, point, vertex: { pathIndex, pointIndex } })),
      );
    }
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
  handle: OperationHandle,
  point: SheetPoint,
): TOperation;
export function dragOperationHandle(operation: DesignOperation, draggedHandle: OperationHandle, point: SheetPoint): DesignOperation {
  const handle = draggedHandle.kind;
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
    case DesignOperationKind.Shape: {
      const { vertex } = draggedHandle;
      if (!vertex) return operation;
      return {
        ...operation,
        paths: operation.paths.map((path, pathIndex) =>
          pathIndex === vertex.pathIndex
            ? { ...path, points: path.points.map((existing, pointIndex) => (pointIndex === vertex.pointIndex ? point : existing)) }
            : path,
        ),
      };
    }
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
      return { kind, id, depthMm, ...rectangle, toolSide: ToolSide.Outside, tabs: DEFAULT_HOLDING_TABS };
    case DesignOperationKind.CircleOutline:
      return { kind, id, depthMm, center: start, diameterMm, toolSide: ToolSide.Outside, tabs: DEFAULT_HOLDING_TABS };
    case DesignOperationKind.RectanglePocket:
      return { kind, id, depthMm, ...rectangle };
    case DesignOperationKind.CirclePocket:
      return { kind, id, depthMm, center: start, diameterMm };
    case DesignOperationKind.Shape: {
      const { corner, widthMm, heightMm } = rectangle;
      return createShapeFromPoints({
        id,
        depthMm,
        isClosed: true,
        points: [corner, { x: corner.x + widthMm, y: corner.y }, { x: corner.x + widthMm, y: corner.y + heightMm }, { x: corner.x, y: corner.y + heightMm }],
      });
    }
  }
}

/** Parameters of a shape drawn point by point. */
export interface ShapeDrawing {
  readonly id: string;
  readonly points: readonly SheetPoint[];
  readonly isClosed: boolean;
  readonly depthMm: number;
}

/** Creates a shape from clicked points: a closed one is cut out along its outline, an open one engraved. */
export function createShapeFromPoints(drawing: ShapeDrawing): ShapeOperation {
  return {
    kind: DesignOperationKind.Shape,
    id: drawing.id,
    depthMm: drawing.depthMm,
    paths: [{ points: drawing.points, isClosed: drawing.isClosed, isSmooth: false }],
    cut: drawing.isClosed ? ShapeCut.Outline : ShapeCut.Engrave,
    toolSide: ToolSide.Outside,
    tabs: DEFAULT_HOLDING_TABS,
  };
}
