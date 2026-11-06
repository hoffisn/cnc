import { formatCoordinate } from '@core/domain/gcode/generator';
import {
  areHoldingTabsActive,
  createCircleContour,
  createOutlineContour,
  createRectangleContour,
  lineTo,
  measureContour,
  placeTabGaps,
  splitContourAtTabs,
  type Contour,
  type ContourPiece,
  type ContourStep,
} from './designContours';
import {
  DesignOperationKind,
  type CircleOutlineOperation,
  type CirclePocketOperation,
  type DesignOperation,
  type HoleGridOperation,
  type RectangleOutlineOperation,
  type RectanglePocketOperation,
  type SheetPoint,
  type ShapeOperation,
  type SlotOperation,
  ShapeCut,
} from './designOperation';
import {
  isMoveInsidePocket,
  planShapeEngraving,
  planShapeOutline,
  planShapePocket,
  type ToolLine,
} from './shapeGeometry';
import type { DesignProject } from './designProject';
import { findZeroOnSheet, type WorkSurface } from './workSurface';

/** Distance between neighboring pocket passes, relative to the tool: leaves no ridges between them. */
const POCKET_STEP_OVER_IN_TOOL_DIAMETERS = 0.6;

/** Lists the cutting depths from the first pass to the final depth, as negative Z values. */
function listPassHeights(depthMm: number, depthPerPassMm: number): number[] {
  const passCount = Math.max(Math.ceil(depthMm / depthPerPassMm - 1e-9), 1);
  return Array.from({ length: passCount }, (_, passIndex) =>
    passIndex === passCount - 1 ? -depthMm : -(passIndex + 1) * depthPerPassMm,
  );
}

/** Contour through a list of points; a closed one returns to its start. */
function createPolylineContour(points: readonly SheetPoint[], isClosed: boolean): Contour {
  const [start = { x: 0, y: 0 }, ...rest] = points;
  const steps = rest.map((point) => lineTo(point.x, point.y));
  if (isClosed) steps.push(lineTo(start.x, start.y));
  return { start, steps };
}

/** The same closed ring, starting at its point nearest to a position, so the tool travels as little as possible. */
function startRingNear(ring: ToolLine, position: SheetPoint): ToolLine {
  let nearestIndex = 0;
  let nearestDistance = Infinity;
  ring.points.forEach((point, index) => {
    const distance = Math.hypot(point.x - position.x, point.y - position.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return { ...ring, points: [...ring.points.slice(nearestIndex), ...ring.points.slice(0, nearestIndex)] };
}

/** Writes G-code with coordinates converted from the sheet to the chosen zero position. */
class DesignGCodeWriter {
  private readonly lines: string[] = [];
  private readonly zero: SheetPoint;
  private currentFeedRate: number | null = null;
  private position: SheetPoint = { x: 0, y: 0 };

  constructor(private readonly surface: WorkSurface) {
    this.zero = findZeroOnSheet(surface);
  }

  comment(text: string): void {
    this.lines.push(`(${text})`);
  }

  command(text: string): void {
    this.lines.push(text);
  }

  retract(): void {
    this.lines.push(`G0 Z${formatCoordinate(this.surface.safeHeightMm)}`);
  }

  /** Moves above a point. The tool must already be at a safe height. */
  rapidTo(point: SheetPoint): void {
    this.lines.push(`G0 X${this.programX(point.x)} Y${this.programY(point.y)}`);
    this.position = point;
  }

  plungeTo(height: number): void {
    this.lines.push(`G1 Z${formatCoordinate(height)}${this.feedWord(this.surface.plungeFeedRate)}`);
  }

  /** Cuts in a straight line; a move to where the tool already is writes nothing. */
  cutTo(point: SheetPoint): void {
    const targetX = this.programX(point.x);
    const targetY = this.programY(point.y);
    if (targetX === this.programX(this.position.x) && targetY === this.programY(this.position.y)) return;
    this.lines.push(`G1 X${targetX} Y${targetY}${this.feedWord(this.surface.feedRate)}`);
    this.position = point;
  }

  /** Follows a contour once, assuming the tool is at its start. */
  followContour(contour: Contour): void {
    for (const step of contour.steps) this.followStep(step);
  }

  followStep(step: ContourStep): void {
    if (!step.isArc) {
      this.cutTo(step.end);
      return;
    }
    const centerOffsetX = formatCoordinate(step.center.x - this.position.x);
    const centerOffsetY = formatCoordinate(step.center.y - this.position.y);
    this.lines.push(
      `${step.isClockwise ? 'G2' : 'G3'} X${this.programX(step.end.x)} Y${this.programY(step.end.y)} ` +
        `I${centerOffsetX} J${centerOffsetY}${this.feedWord(this.surface.feedRate)}`,
    );
    this.position = step.end;
  }

  get currentPosition(): SheetPoint {
    return this.position;
  }

  toText(): string {
    return `${this.lines.join('\n')}\n`;
  }

  private programX(sheetX: number): string {
    return formatCoordinate(sheetX - this.zero.x);
  }

  private programY(sheetY: number): string {
    return formatCoordinate(sheetY - this.zero.y);
  }

  private feedWord(feedRate: number): string {
    if (feedRate === this.currentFeedRate) return '';
    this.currentFeedRate = feedRate;
    return ` F${formatCoordinate(feedRate)}`;
  }
}

/** Generates the G-code of one kind of operation at a time, leaving the tool at a safe height after each. */
class OperationGenerator {
  private readonly toolRadius: number;

  constructor(
    private readonly writer: DesignGCodeWriter,
    private readonly surface: WorkSurface,
  ) {
    this.toolRadius = surface.toolDiameterMm / 2;
  }

  generate(operation: DesignOperation): void {
    switch (operation.kind) {
      case DesignOperationKind.Hole:
        this.drillHole(operation.center, operation.depthMm);
        break;
      case DesignOperationKind.HoleGrid:
        this.drillGrid(operation);
        break;
      case DesignOperationKind.Slot:
        this.cutSlot(operation);
        break;
      case DesignOperationKind.RectangleOutline:
      case DesignOperationKind.CircleOutline:
        this.cutOutline(operation);
        break;
      case DesignOperationKind.RectanglePocket:
        this.cutRectanglePocket(operation);
        break;
      case DesignOperationKind.CirclePocket:
        this.cutCirclePocket(operation);
        break;
      case DesignOperationKind.Shape:
        this.cutShape(operation);
        break;
    }
  }

  private cutShape(operation: ShapeOperation): void {
    switch (operation.cut) {
      case ShapeCut.Outline:
        for (const line of planShapeOutline(operation, this.toolRadius)) this.cutToolLine(line, operation.depthMm, operation);
        break;
      case ShapeCut.Engrave:
        for (const line of planShapeEngraving(operation)) this.cutToolLine(line, operation.depthMm, null);
        break;
      case ShapeCut.Pocket:
        this.cutShapePocket(planShapePocket(operation, this.toolRadius, this.surface.toolDiameterMm * POCKET_STEP_OVER_IN_TOOL_DIAMETERS), operation.depthMm);
        break;
    }
  }

  /** Cuts one line of a shape; closed outlines of a through cut keep holding tabs where they fit. */
  private cutToolLine(line: ToolLine, depthMm: number, outline: ShapeOperation | null): void {
    if (!line.isClosed) {
      this.cutOpenLine(line.points, depthMm);
      return;
    }
    const contour = createPolylineContour(line.points, true);
    if (outline && areHoldingTabsActive(outline.tabs, depthMm, this.surface)) {
      const gaps = placeTabGaps(measureContour(contour), outline.tabs, this.surface.toolDiameterMm);
      if (gaps.length > 0) {
        this.cutContourInPasses(contour, depthMm, { pieces: splitContourAtTabs(contour, gaps), topZ: -depthMm + outline.tabs.heightMm });
        return;
      }
    }
    this.cutContourInPasses(contour, depthMm);
  }

  /** Cuts back and forth along an open line, so the tool never has to leave the groove between passes. */
  private cutOpenLine(points: readonly SheetPoint[], depthMm: number): void {
    const [start] = points;
    if (!start) return;
    const reversed = [...points].reverse();
    this.writer.rapidTo(start);
    listPassHeights(depthMm, this.surface.depthPerPassMm).forEach((height, passIndex) => {
      this.writer.plungeTo(height);
      for (const point of (passIndex % 2 === 0 ? points : reversed).slice(1)) this.writer.cutTo(point);
    });
    this.writer.retract();
  }

  /**
   * Clears a pocket level by level from the middle outward, so the last ring finishes the wall.
   * The tool stays down between rings when the straight move cannot touch a wall, and lifts otherwise.
   */
  private cutShapePocket(levels: readonly ToolLine[][], depthMm: number): void {
    const [wallLevel] = levels;
    if (!wallLevel) return;
    const rings = [...levels].reverse().flat();
    let isDown = false;
    for (const height of listPassHeights(depthMm, this.surface.depthPerPassMm)) {
      rings.forEach((ring, ringIndex) => {
        const started = startRingNear(ring, this.writer.currentPosition);
        const [start] = started.points;
        if (!start) return;
        if (isDown && isMoveInsidePocket(this.writer.currentPosition, start, wallLevel)) {
          this.writer.cutTo(start);
          if (ringIndex === 0) this.writer.plungeTo(height);
        } else {
          if (isDown) this.writer.retract();
          this.writer.rapidTo(start);
          this.writer.plungeTo(height);
          isDown = true;
        }
        this.writer.followContour(createPolylineContour(started.points, true));
      });
    }
    this.writer.retract();
  }

  private drillHole(center: SheetPoint, depthMm: number): void {
    this.writer.rapidTo(center);
    this.writer.plungeTo(-depthMm);
    this.writer.retract();
  }

  /** Walks the rows in a serpentine, which minimizes idle travel. */
  private drillGrid(operation: HoleGridOperation): void {
    for (let row = 0; row < operation.rowCount; row += 1) {
      for (let step = 0; step < operation.columnCount; step += 1) {
        const column = row % 2 === 0 ? step : operation.columnCount - 1 - step;
        this.drillHole(
          { x: operation.origin.x + column * operation.spacingXMm, y: operation.origin.y + row * operation.spacingYMm },
          operation.depthMm,
        );
      }
    }
  }

  /** Cuts back and forth, so the tool never has to leave the groove between passes. */
  private cutSlot(operation: SlotOperation): void {
    this.writer.rapidTo(operation.start);
    listPassHeights(operation.depthMm, this.surface.depthPerPassMm).forEach((height, passIndex) => {
      this.writer.plungeTo(height);
      this.writer.cutTo(passIndex % 2 === 0 ? operation.end : operation.start);
    });
    this.writer.retract();
  }

  private cutOutline(operation: RectangleOutlineOperation | CircleOutlineOperation): void {
    const contour = createOutlineContour(operation, this.toolRadius);
    const { tabs, depthMm } = operation;
    if (!areHoldingTabsActive(tabs, depthMm, this.surface)) {
      this.cutContourInPasses(contour, depthMm);
      return;
    }
    const gaps = placeTabGaps(measureContour(contour), tabs, this.surface.toolDiameterMm);
    this.cutContourInPasses(contour, depthMm, { pieces: splitContourAtTabs(contour, gaps), topZ: -depthMm + tabs.heightMm });
  }

  /**
   * Cuts a contour pass by pass. Passes below the top of the tabs lift over them,
   * so the part stays attached by thin bridges once the sheet is cut through.
   */
  private cutContourInPasses(
    contour: Contour,
    depthMm: number,
    tabs?: { readonly pieces: readonly ContourPiece[]; readonly topZ: number },
  ): void {
    this.writer.rapidTo(contour.start);
    for (const height of listPassHeights(depthMm, this.surface.depthPerPassMm)) {
      this.writer.plungeTo(height);
      if (!tabs || height >= tabs.topZ) {
        this.writer.followContour(contour);
        continue;
      }
      let isLifted = false;
      for (const piece of tabs.pieces) {
        if (piece.isOnTab !== isLifted) {
          this.writer.plungeTo(piece.isOnTab ? tabs.topZ : height);
          isLifted = piece.isOnTab;
        }
        this.writer.followStep(piece.step);
      }
    }
    this.writer.retract();
  }

  /** Lists insets from the wall inward; the last one reaches the middle, so no island remains. */
  private listPocketInsets(halfOfSmallerSide: number): number[] {
    const stepOver = this.surface.toolDiameterMm * POCKET_STEP_OVER_IN_TOOL_DIAMETERS;
    const insets: number[] = [];
    for (let inset = 0; inset < halfOfSmallerSide; inset += stepOver) insets.push(inset);
    insets.push(halfOfSmallerSide);
    return insets;
  }

  /** Clears from the middle outward, so the tool cuts into open space and ends along the clean wall. */
  private cutRectanglePocket(operation: RectanglePocketOperation): void {
    const minX = operation.corner.x + this.toolRadius;
    const minY = operation.corner.y + this.toolRadius;
    const maxX = operation.corner.x + operation.widthMm - this.toolRadius;
    const maxY = operation.corner.y + operation.heightMm - this.toolRadius;
    const insets = this.listPocketInsets(Math.min(maxX - minX, maxY - minY) / 2).reverse();
    const rings = insets.map((inset) => createRectangleContour(minX + inset, minY + inset, maxX - inset, maxY - inset));
    this.cutPocketRings(rings, operation.depthMm);
  }

  private cutCirclePocket(operation: CirclePocketOperation): void {
    const outerRadius = operation.diameterMm / 2 - this.toolRadius;
    const insets = this.listPocketInsets(outerRadius).reverse();
    const rings = insets
      .map((inset) => outerRadius - inset)
      .filter((radius) => radius > 0)
      .map((radius) => createCircleContour(operation.center, radius, false));
    if (rings.length === 0) {
      this.drillHole(operation.center, operation.depthMm);
      return;
    }
    this.writer.rapidTo(operation.center);
    listPassHeights(operation.depthMm, this.surface.depthPerPassMm).forEach((height, passIndex) => {
      if (passIndex > 0) this.writer.cutTo(operation.center);
      this.writer.plungeTo(height);
      for (const ring of rings) {
        this.writer.cutTo(ring.start);
        this.writer.followContour(ring);
      }
    });
    this.writer.retract();
  }

  private cutPocketRings(rings: readonly Contour[], depthMm: number): void {
    const [innermostRing] = rings;
    if (!innermostRing) return;
    this.writer.rapidTo(innermostRing.start);
    listPassHeights(depthMm, this.surface.depthPerPassMm).forEach((height, passIndex) => {
      if (passIndex > 0) this.writer.cutTo(innermostRing.start);
      this.writer.plungeTo(height);
      for (const ring of rings) {
        this.writer.cutTo(ring.start);
        this.writer.followContour(ring);
      }
    });
    this.writer.retract();
  }
}

/**
 * Turns a project into a complete G-code program.
 * The sheet's top is `Z0`, so the operator only has to touch the tool off the sheet at the chosen zero.
 */
export function generateDesignGCode(project: DesignProject): string {
  const { surface, operations } = project;
  const writer = new DesignGCodeWriter(surface);
  const generator = new OperationGenerator(writer, surface);

  writer.comment('REZETS DESIGN');
  writer.comment(
    `SHEET ${formatCoordinate(surface.sheetWidthMm)} X ${formatCoordinate(surface.sheetDepthMm)} X ` +
      `${formatCoordinate(surface.sheetThicknessMm)} TOOL D${formatCoordinate(surface.toolDiameterMm)}`,
  );
  writer.command('G21 G90 G17');
  writer.retract();
  writer.command(`M3 S${formatCoordinate(surface.spindleSpeedRpm)}`);

  operations.forEach((operation, operationIndex) => {
    writer.comment(`OPERATION ${operationIndex + 1} ${operation.kind.toUpperCase()}`);
    generator.generate(operation);
  });

  writer.command('M5');
  writer.command('G0 X0 Y0');
  writer.command('M30');
  return writer.toText();
}
