import {
  DesignIssueCode,
  DesignOperationKind,
  LengthUnit,
  ToolSide,
  ZeroOrigin,
  formatCoordinate,
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
};

export const TOOL_SIDE_LABELS: Readonly<Record<ToolSide, string>> = {
  [ToolSide.Outside]: 'Снаружи',
  [ToolSide.OnLine]: 'По линии',
  [ToolSide.Inside]: 'Внутри',
};

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
  }
}
