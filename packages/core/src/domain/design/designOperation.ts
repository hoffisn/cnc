/** Point on the sheet, in millimeters from its lower left corner. */
export interface SheetPoint {
  readonly x: number;
  readonly y: number;
}

/** Discriminator of {@link DesignOperation}. */
export enum DesignOperationKind {
  Hole = 'hole',
  HoleGrid = 'hole-grid',
  Slot = 'slot',
  RectangleOutline = 'rectangle-outline',
  CircleOutline = 'circle-outline',
  RectanglePocket = 'rectangle-pocket',
  CirclePocket = 'circle-pocket',
}

/** Which side of a drawn outline the tool runs on. */
export enum ToolSide {
  /** The tool's center follows the line. */
  OnLine = 'on-line',
  /** The part stays inside the line, as when cutting a part out of a sheet. */
  Outside = 'outside',
  /** The material inside the line is removed, as when cutting an opening. */
  Inside = 'inside',
}

interface OperationBase {
  readonly id: string;
  /** How deep to cut below the sheet's top, in millimeters. */
  readonly depthMm: number;
}

/** A single hole as wide as the tool. */
export interface HoleOperation extends OperationBase {
  readonly kind: DesignOperationKind.Hole;
  readonly center: SheetPoint;
}

/** Holes in a regular grid. */
export interface HoleGridOperation extends OperationBase {
  readonly kind: DesignOperationKind.HoleGrid;
  /** Lower left hole of the grid. */
  readonly origin: SheetPoint;
  readonly columnCount: number;
  readonly rowCount: number;
  readonly spacingXMm: number;
  readonly spacingYMm: number;
}

/** Straight groove between two points. */
export interface SlotOperation extends OperationBase {
  readonly kind: DesignOperationKind.Slot;
  readonly start: SheetPoint;
  readonly end: SheetPoint;
}

/** Cut along the edge of a rectangle. */
export interface RectangleOutlineOperation extends OperationBase {
  readonly kind: DesignOperationKind.RectangleOutline;
  /** Lower left corner. */
  readonly corner: SheetPoint;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly toolSide: ToolSide;
}

/** Cut along the edge of a circle. */
export interface CircleOutlineOperation extends OperationBase {
  readonly kind: DesignOperationKind.CircleOutline;
  readonly center: SheetPoint;
  readonly diameterMm: number;
  readonly toolSide: ToolSide;
}

/** Rectangular recess with all material inside removed. */
export interface RectanglePocketOperation extends OperationBase {
  readonly kind: DesignOperationKind.RectanglePocket;
  /** Lower left corner. */
  readonly corner: SheetPoint;
  readonly widthMm: number;
  readonly heightMm: number;
}

/** Round recess with all material inside removed. */
export interface CirclePocketOperation extends OperationBase {
  readonly kind: DesignOperationKind.CirclePocket;
  readonly center: SheetPoint;
  readonly diameterMm: number;
}

/** One thing an engineer asks the machine to do to the sheet. */
export type DesignOperation =
  | HoleOperation
  | HoleGridOperation
  | SlotOperation
  | RectangleOutlineOperation
  | CircleOutlineOperation
  | RectanglePocketOperation
  | CirclePocketOperation;
