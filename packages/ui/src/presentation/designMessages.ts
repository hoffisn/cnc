import {
  DesignIssueCode,
  DesignOperationKind,
  LengthUnit,
  ShapeCut,
  StockMaterial,
  findPathsBounds,
  ToolSide,
  ZeroOrigin,
  formatCoordinate,
  type CuttingToolPreset,
  type DesignOperation,
} from '@rezets/core';

/** Operator-facing text of the designer. */

export const OPERATION_KIND_LABELS: Readonly<Record<DesignOperationKind, string>> = {
  [DesignOperationKind.Hole]: 'Отверстие',
  [DesignOperationKind.HoleGrid]: 'Ряд отверстий',
  [DesignOperationKind.Slot]: 'Линия, паз',
  [DesignOperationKind.RectangleOutline]: 'Контур прямоугольника',
  [DesignOperationKind.CircleOutline]: 'Контур круга',
  [DesignOperationKind.RectanglePocket]: 'Карман прямоугольный',
  [DesignOperationKind.CirclePocket]: 'Карман круглый',
  [DesignOperationKind.Shape]: 'Произвольный контур',
};

export const SHAPE_CUT_LABELS: Readonly<Record<ShapeCut, string>> = {
  [ShapeCut.Outline]: 'Контур',
  [ShapeCut.Pocket]: 'Карман',
  [ShapeCut.Engrave]: 'По линии',
};

export const TOOL_SIDE_LABELS: Readonly<Record<ToolSide, string>> = {
  [ToolSide.Outside]: 'Снаружи',
  [ToolSide.OnLine]: 'По линии',
  [ToolSide.Inside]: 'Внутри',
};

export const STOCK_MATERIAL_LABELS: Readonly<Record<StockMaterial, string>> = {
  [StockMaterial.Softwood]: 'Мягкая древесина (сосна, ель)',
  [StockMaterial.Hardwood]: 'Твёрдая древесина (дуб, бук)',
  [StockMaterial.Plywood]: 'Фанера',
  [StockMaterial.Mdf]: 'МДФ',
  [StockMaterial.Acrylic]: 'Акрил (оргстекло)',
  [StockMaterial.Hdpe]: 'Полиэтилен (HDPE)',
  [StockMaterial.Aluminum]: 'Алюминий',
};

/** Russian noun form for a count: one, a few (2–4) or many. */
function pluralize(count: number, one: string, few: string, many: string): string {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return many;
  if (lastDigit === 1) return one;
  return lastDigit >= 2 && lastDigit <= 4 ? few : many;
}

/** Name of a library cutter, such as «Ø 3,175 мм · 2 зуба». */
export function describeToolPreset(preset: CuttingToolPreset): string {
  const diameter = formatCoordinate(preset.diameterMm).replace('.', ',');
  return `Ø ${diameter} мм · ${preset.fluteCount} ${pluralize(preset.fluteCount, 'зуб', 'зуба', 'зубьев')}`;
}

export const LENGTH_UNIT_LABELS: Readonly<Record<LengthUnit, string>> = {
  [LengthUnit.Millimeter]: 'мм',
  [LengthUnit.Centimeter]: 'см',
  [LengthUnit.Meter]: 'м',
};

export const ZERO_ORIGIN_LABELS: Readonly<Record<ZeroOrigin, string>> = {
  [ZeroOrigin.SheetLowerLeft]: 'Левый нижний угол',
  [ZeroOrigin.SheetLowerRight]: 'Правый нижний угол',
  [ZeroOrigin.SheetUpperLeft]: 'Левый верхний угол',
  [ZeroOrigin.SheetUpperRight]: 'Правый верхний угол',
  [ZeroOrigin.SheetCenter]: 'Центр листа',
};

export const DESIGN_ISSUE_MESSAGES: Readonly<Record<DesignIssueCode, string>> = {
  [DesignIssueCode.SheetDoesNotFitTable]: 'Лист не помещается на стол',
  [DesignIssueCode.SafeHeightRequired]: 'Безопасная высота должна быть больше нуля',
  [DesignIssueCode.OperationOutsideSheet]: 'Рез выходит за край листа',
  [DesignIssueCode.DepthNotPositive]: 'Глубина должна быть больше нуля',
  [DesignIssueCode.DepthExceedsThickness]: 'Глубина больше толщины листа',
  [DesignIssueCode.ShapeSmallerThanTool]: 'Фигура меньше диаметра фрезы',
  [DesignIssueCode.ShapeSizeNotPositive]: 'Размер фигуры должен быть больше нуля',
  [DesignIssueCode.GridCountNotPositive]: 'В ряду должно быть хотя бы одно отверстие',
  [DesignIssueCode.TabSizeNotPositive]: 'Размер перемычки должен быть больше нуля',
  [DesignIssueCode.TabNotLowerThanCut]: 'Перемычка должна быть тоньше глубины реза',
  [DesignIssueCode.TabsDoNotFit]: 'Перемычки не помещаются на контуре: уменьшите их число или длину',
  [DesignIssueCode.ShapeNotClosed]: 'Для кармана контур должен быть замкнут',
};

const mm = formatCoordinate;

/** Builds the short description of an operation shown in the list: its position or size, and its depth. */
export function summarizeOperation(operation: DesignOperation): string {
  const depth = `глубина ${mm(operation.depthMm)} мм`;
  switch (operation.kind) {
    case DesignOperationKind.Hole:
      return `X ${mm(operation.center.x)}, Y ${mm(operation.center.y)}, ${depth}`;
    case DesignOperationKind.HoleGrid:
      return `${operation.columnCount} × ${operation.rowCount} шт., ${depth}`;
    case DesignOperationKind.Slot:
      return `${mm(Math.hypot(operation.end.x - operation.start.x, operation.end.y - operation.start.y))} мм, ${depth}`;
    case DesignOperationKind.RectangleOutline:
    case DesignOperationKind.RectanglePocket:
      return `${mm(operation.widthMm)} × ${mm(operation.heightMm)} мм, ${depth}`;
    case DesignOperationKind.CircleOutline:
    case DesignOperationKind.CirclePocket:
      return `Ø ${mm(operation.diameterMm)} мм, ${depth}`;
    case DesignOperationKind.Shape: {
      const bounds = findPathsBounds(operation.paths);
      const size = bounds ? `${mm(bounds.maxX - bounds.minX)} × ${mm(bounds.maxY - bounds.minY)} мм` : 'пусто';
      return `${SHAPE_CUT_LABELS[operation.cut]}, ${size}, ${depth}`;
    }
  }
}
