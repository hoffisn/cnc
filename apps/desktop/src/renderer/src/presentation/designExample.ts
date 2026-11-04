import { DesignOperationKind, ToolSide, type DesignOperation, type WorkSurface } from '@rezets/core';

/** Margin between the part and the sheet's edge, relative to the sheet's smaller side. */
const PART_MARGIN_RATIO = 0.1;
const POCKET_DEPTH_RATIO = 0.4;
const SLOT_DEPTH_RATIO = 0.25;

/** Builds a mounting plate fitted to the sheet: a ready demonstration of every kind of cut. */
export function createExampleOperations(surface: WorkSurface, generateId: () => string): DesignOperation[] {
  const { sheetWidthMm, sheetDepthMm, sheetThicknessMm, toolDiameterMm } = surface;
  const margin = Math.min(sheetWidthMm, sheetDepthMm) * PART_MARGIN_RATIO;
  const partWidth = sheetWidthMm - margin * 2;
  const partHeight = sheetDepthMm - margin * 2;
  const holeInset = partHeight * 0.12;
  const pocketDepth = sheetThicknessMm * POCKET_DEPTH_RATIO;
  const slotDepth = sheetThicknessMm * SLOT_DEPTH_RATIO;
  const centerY = sheetDepthMm / 2;

  return [
    {
      kind: DesignOperationKind.HoleGrid,
      id: generateId(),
      depthMm: sheetThicknessMm,
      origin: { x: margin + holeInset, y: margin + holeInset },
      columnCount: 2,
      rowCount: 2,
      spacingXMm: partWidth - holeInset * 2,
      spacingYMm: partHeight - holeInset * 2,
    },
    {
      kind: DesignOperationKind.RectanglePocket,
      id: generateId(),
      depthMm: pocketDepth,
      corner: { x: margin + partWidth * 0.18, y: margin + partHeight * 0.26 },
      widthMm: partWidth * 0.3,
      heightMm: partHeight * 0.48,
    },
    {
      kind: DesignOperationKind.CirclePocket,
      id: generateId(),
      depthMm: pocketDepth,
      center: { x: margin + partWidth * 0.7, y: centerY },
      diameterMm: Math.max(partHeight * 0.42, toolDiameterMm),
    },
    {
      kind: DesignOperationKind.Slot,
      id: generateId(),
      depthMm: slotDepth,
      start: { x: margin + partWidth * 0.3, y: margin + partHeight * 0.88 },
      end: { x: margin + partWidth * 0.7, y: margin + partHeight * 0.88 },
    },
    {
      kind: DesignOperationKind.RectangleOutline,
      id: generateId(),
      depthMm: sheetThicknessMm,
      corner: { x: margin, y: margin },
      widthMm: partWidth,
      heightMm: partHeight,
      toolSide: ToolSide.Outside,
    },
  ];
}
