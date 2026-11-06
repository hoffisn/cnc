import {
  DesignOperationKind,
  ToolSide,
  type CircleOutlineOperation,
  type DesignOperation,
  type HoldingTabs,
  type RectangleOutlineOperation,
  type SheetPoint,
} from './designOperation';
import type { WorkSurface } from './workSurface';

/**
 * Part of a closed cut.
 * Outside cuts run clockwise and inside cuts counter-clockwise: both are climb milling,
 * which gives a cleaner edge on the part with a regular right-hand spindle.
 */
export type ContourStep =
  | { readonly isArc: false; readonly end: SheetPoint }
  | { readonly isArc: true; readonly end: SheetPoint; readonly center: SheetPoint; readonly isClockwise: boolean };

/** Closed tool path along an outline. */
export interface Contour {
  readonly start: SheetPoint;
  readonly steps: readonly ContourStep[];
}

/** Piece of a contour either over a holding tab or between tabs. */
export interface ContourPiece {
  readonly step: ContourStep;
  readonly isOnTab: boolean;
}

const FULL_TURN = 2 * Math.PI;
/** Depths closer than this count as cutting through the sheet. */
const THROUGH_CUT_TOLERANCE_MM = 1e-6;
const LENGTH_EPSILON = 1e-9;

export const lineTo = (x: number, y: number): ContourStep => ({ isArc: false, end: { x, y } });

/** Plain rectangle starting at its lower left corner, counter-clockwise. */
export function createRectangleContour(minX: number, minY: number, maxX: number, maxY: number): Contour {
  return {
    start: { x: minX, y: minY },
    steps: [lineTo(maxX, minY), lineTo(maxX, maxY), lineTo(minX, maxY), lineTo(minX, minY)],
  };
}

/** Clockwise path around a rectangle at a distance, with rounded corners that keep the part's corners sharp. */
export function createOutsetRectangleContour(minX: number, minY: number, maxX: number, maxY: number, offset: number): Contour {
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

export function createCircleContour(center: SheetPoint, radius: number, isClockwise: boolean): Contour {
  const start = { x: center.x + radius, y: center.y };
  return { start, steps: [{ isArc: true, end: start, center, isClockwise }] };
}

/** Builds the tool path along a drawn outline, shifted to the side the tool runs on. */
export function createOutlineContour(operation: RectangleOutlineOperation | CircleOutlineOperation, toolRadius: number): Contour {
  if (operation.kind === DesignOperationKind.CircleOutline) {
    const radius = operation.diameterMm / 2;
    switch (operation.toolSide) {
      case ToolSide.OnLine:
        return createCircleContour(operation.center, radius, false);
      case ToolSide.Inside:
        return createCircleContour(operation.center, radius - toolRadius, false);
      case ToolSide.Outside:
        return createCircleContour(operation.center, radius + toolRadius, true);
    }
  }
  const minX = operation.corner.x;
  const minY = operation.corner.y;
  const maxX = minX + operation.widthMm;
  const maxY = minY + operation.heightMm;
  switch (operation.toolSide) {
    case ToolSide.OnLine:
      return createRectangleContour(minX, minY, maxX, maxY);
    case ToolSide.Inside:
      return createRectangleContour(minX + toolRadius, minY + toolRadius, maxX - toolRadius, maxY - toolRadius);
    case ToolSide.Outside:
      return createOutsetRectangleContour(minX, minY, maxX, maxY, toolRadius);
  }
}

/** Angle an arc turns through, always positive; an arc ending where it starts is a full circle. */
function measureSweep(from: SheetPoint, step: Extract<ContourStep, { isArc: true }>): number {
  const startAngle = Math.atan2(from.y - step.center.y, from.x - step.center.x);
  const endAngle = Math.atan2(step.end.y - step.center.y, step.end.x - step.center.x);
  const signedSweep = step.isClockwise ? startAngle - endAngle : endAngle - startAngle;
  const sweep = ((signedSweep % FULL_TURN) + FULL_TURN) % FULL_TURN;
  return sweep < LENGTH_EPSILON ? FULL_TURN : sweep;
}

function measureStep(from: SheetPoint, step: ContourStep): number {
  if (!step.isArc) return Math.hypot(step.end.x - from.x, step.end.y - from.y);
  const radius = Math.hypot(from.x - step.center.x, from.y - step.center.y);
  return radius * measureSweep(from, step);
}

/** Point a given distance along a step from its start. */
function pointAlongStep(from: SheetPoint, step: ContourStep, distance: number): SheetPoint {
  const length = measureStep(from, step);
  if (length < LENGTH_EPSILON) return step.end;
  if (!step.isArc) {
    const fraction = distance / length;
    return { x: from.x + (step.end.x - from.x) * fraction, y: from.y + (step.end.y - from.y) * fraction };
  }
  const radius = Math.hypot(from.x - step.center.x, from.y - step.center.y);
  const angle =
    Math.atan2(from.y - step.center.y, from.x - step.center.x) + ((step.isClockwise ? -1 : 1) * distance) / radius;
  return { x: step.center.x + radius * Math.cos(angle), y: step.center.y + radius * Math.sin(angle) };
}

/** Same kind of step, ending at another point: an arc keeps its center and direction. */
const withEnd = (step: ContourStep, end: SheetPoint): ContourStep => ({ ...step, end });

export function measureContour(contour: Contour): number {
  let length = 0;
  let position = contour.start;
  for (const step of contour.steps) {
    length += measureStep(position, step);
    position = step.end;
  }
  return length;
}

/** Whether tabs are left at all: only a cut through the whole sheet would free the part. */
export function areHoldingTabsActive(tabs: HoldingTabs, depthMm: number, surface: WorkSurface): boolean {
  return tabs.count > 0 && depthMm >= surface.sheetThicknessMm - THROUGH_CUT_TOLERANCE_MM;
}

/** Length of tool path lifted over each tab: the tab itself plus the tool on both sides of it. */
export const measureTabGap = (tabs: HoldingTabs, toolDiameterMm: number): number => tabs.widthMm + toolDiameterMm;

/**
 * Spreads tabs evenly along a contour, away from its start where the tool plunges.
 *
 * @returns Distances along the contour where each lifted gap starts and ends; empty when the tabs do not fit.
 */
export function placeTabGaps(contourLength: number, tabs: HoldingTabs, toolDiameterMm: number): { start: number; end: number }[] {
  const gap = measureTabGap(tabs, toolDiameterMm);
  const spacing = contourLength / tabs.count;
  if (tabs.count <= 0 || gap >= spacing) return [];
  return Array.from({ length: tabs.count }, (_, index) => {
    const center = spacing * (index + 0.5);
    return { start: center - gap / 2, end: center + gap / 2 };
  });
}

/** Centers of the tabs on the tool path, for showing them on the drawing. */
export function locateTabCenters(contour: Contour, tabs: HoldingTabs, toolDiameterMm: number): SheetPoint[] {
  const gaps = placeTabGaps(measureContour(contour), tabs, toolDiameterMm);
  return gaps.map((gap) => pointAlongContour(contour, (gap.start + gap.end) / 2));
}

/** Where the tabs of an outline are, on its tool path; empty when it has none or they are not left. */
export function locateOperationTabs(operation: DesignOperation, surface: WorkSurface): SheetPoint[] {
  if (operation.kind !== DesignOperationKind.RectangleOutline && operation.kind !== DesignOperationKind.CircleOutline) {
    return [];
  }
  if (!areHoldingTabsActive(operation.tabs, operation.depthMm, surface)) return [];
  const contour = createOutlineContour(operation, surface.toolDiameterMm / 2);
  return locateTabCenters(contour, operation.tabs, surface.toolDiameterMm);
}

function pointAlongContour(contour: Contour, distance: number): SheetPoint {
  let travelled = 0;
  let position = contour.start;
  for (const step of contour.steps) {
    const length = measureStep(position, step);
    if (travelled + length >= distance) return pointAlongStep(position, step, distance - travelled);
    travelled += length;
    position = step.end;
  }
  return position;
}

/** Cuts a contour into pieces at the edges of the tab gaps, marking the pieces over a tab. */
export function splitContourAtTabs(contour: Contour, gaps: readonly { start: number; end: number }[]): ContourPiece[] {
  const boundaries = gaps.flatMap((gap) => [gap.start, gap.end]).sort((first, second) => first - second);
  const isOnTab = (distance: number): boolean => gaps.some((gap) => distance > gap.start && distance < gap.end);
  const pieces: ContourPiece[] = [];
  let travelled = 0;
  let position = contour.start;

  for (const step of contour.steps) {
    const length = measureStep(position, step);
    const stepStart = travelled;
    const cuts = boundaries
      .filter((boundary) => boundary > stepStart + LENGTH_EPSILON && boundary < stepStart + length - LENGTH_EPSILON)
      .map((boundary) => boundary - stepStart);
    let pieceStart = 0;
    for (const cut of [...cuts, length]) {
      const end = cut === length ? step.end : pointAlongStep(position, step, cut);
      pieces.push({ step: withEnd(step, end), isOnTab: isOnTab(stepStart + (pieceStart + cut) / 2) });
      pieceStart = cut;
    }
    travelled += length;
    position = step.end;
  }
  return pieces;
}
