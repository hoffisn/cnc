import { formatCoordinate } from '@core/domain/gcode/generator';
import {
  DesignOperationKind,
  ToolSide,
  type CircleOutlineOperation,
  type CirclePocketOperation,
  type DesignOperation,
  type HoleGridOperation,
  type RectangleOutlineOperation,
  type RectanglePocketOperation,
  type SheetPoint,
  type SlotOperation,
} from './designOperation';
import type { DesignProject } from './designProject';
import { findZeroOnSheet, type WorkSurface } from './workSurface';

/** Distance between neighboring pocket passes, relative to the tool: leaves no ridges between them. */
const POCKET_STEP_OVER_IN_TOOL_DIAMETERS = 0.6;

/**
 * Part of a closed cut.
 * Outside cuts run clockwise and inside cuts counter-clockwise: both are climb milling,
 * which gives a cleaner edge on the part with a regular right-hand spindle.
 */
type ContourStep =
  | { readonly isArc: false; readonly end: SheetPoint }
  | { readonly isArc: true; readonly end: SheetPoint; readonly center: SheetPoint; readonly isClockwise: boolean };

/** Closed tool path along an outline. */
interface Contour {
  readonly start: SheetPoint;
  readonly steps: readonly ContourStep[];
}

/** Lists the cutting depths from the first pass to the final depth, as negative Z values. */
function listPassHeights(depthMm: number, depthPerPassMm: number): number[] {
  const passCount = Math.max(Math.ceil(depthMm / depthPerPassMm - 1e-9), 1);
  return Array.from({ length: passCount }, (_, passIndex) =>
    passIndex === passCount - 1 ? -depthMm : -(passIndex + 1) * depthPerPassMm,
  );
}

const lineTo = (x: number, y: number): ContourStep => ({ isArc: false, end: { x, y } });

/** Plain rectangle starting at its lower left corner, counter-clockwise. */
function createRectangleContour(minX: number, minY: number, maxX: number, maxY: number): Contour {
  return {
    start: { x: minX, y: minY },
    steps: [lineTo(maxX, minY), lineTo(maxX, maxY), lineTo(minX, maxY), lineTo(minX, minY)],
  };
}

/** Clockwise path around a rectangle at a distance, with rounded corners that keep the part's corners sharp. */
function createOutsetRectangleContour(minX: number, minY: number, maxX: number, maxY: number, offset: number): Contour {
  const arc = (endX: number, endY: number, centerX: number, centerY: number): ContourStep => ({
    isArc: true,
    end: { x: endX, y: endY },
    center: { x: centerX, y: centerY },
    isClockwise: true,
  });
  return {
    start: { x: minX - offset, y: minY },
    steps: [
      lineTo(minX - offset, maxY),
      arc(minX, maxY + offset, minX, maxY),
      lineTo(maxX, maxY + offset),
      arc(maxX + offset, maxY, maxX, maxY),
      lineTo(maxX + offset, minY),
      arc(maxX, minY - offset, maxX, minY),
      lineTo(minX, minY - offset),
      arc(minX - offset, minY, minX, minY),
    ],
  };
}

function createCircleContour(center: SheetPoint, radius: number, isClockwise: boolean): Contour {
  const start = { x: center.x + radius, y: center.y };
  return { start, steps: [{ isArc: true, end: start, center, isClockwise }] };
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
    for (const step of contour.steps) {
      if (step.isArc) {
        const centerOffsetX = formatCoordinate(step.center.x - this.position.x);
        const centerOffsetY = formatCoordinate(step.center.y - this.position.y);
        this.lines.push(
          `${step.isClockwise ? 'G2' : 'G3'} X${this.programX(step.end.x)} Y${this.programY(step.end.y)} ` +
            `I${centerOffsetX} J${centerOffsetY}${this.feedWord(this.surface.feedRate)}`,
        );
        this.position = step.end;
      } else {
        this.cutTo(step.end);
      }
    }
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
        this.cutContourInPasses(this.createRectangleOutlineContour(operation), operation.depthMm);
        break;
      case DesignOperationKind.CircleOutline:
        this.cutContourInPasses(this.createCircleOutlineContour(operation), operation.depthMm);
        break;
      case DesignOperationKind.RectanglePocket:
        this.cutRectanglePocket(operation);
        break;
      case DesignOperationKind.CirclePocket:
        this.cutCirclePocket(operation);
        break;
    }
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

  private createRectangleOutlineContour(operation: RectangleOutlineOperation): Contour {
    const minX = operation.corner.x;
    const minY = operation.corner.y;
    const maxX = minX + operation.widthMm;
    const maxY = minY + operation.heightMm;
    switch (operation.toolSide) {
      case ToolSide.OnLine:
        return createRectangleContour(minX, minY, maxX, maxY);
      case ToolSide.Inside:
        return createRectangleContour(
          minX + this.toolRadius,
          minY + this.toolRadius,
          maxX - this.toolRadius,
          maxY - this.toolRadius,
        );
      case ToolSide.Outside:
        return createOutsetRectangleContour(minX, minY, maxX, maxY, this.toolRadius);
    }
  }

  private createCircleOutlineContour(operation: CircleOutlineOperation): Contour {
    const radius = operation.diameterMm / 2;
    switch (operation.toolSide) {
      case ToolSide.OnLine:
        return createCircleContour(operation.center, radius, false);
      case ToolSide.Inside:
        return createCircleContour(operation.center, radius - this.toolRadius, false);
      case ToolSide.Outside:
        return createCircleContour(operation.center, radius + this.toolRadius, true);
    }
  }

  private cutContourInPasses(contour: Contour, depthMm: number): void {
    this.writer.rapidTo(contour.start);
    for (const height of listPassHeights(depthMm, this.surface.depthPerPassMm)) {
      this.writer.plungeTo(height);
      this.writer.followContour(contour);
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
