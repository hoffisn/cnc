import { DesignOperationKind, type DesignOperation } from '@rezets/core';

/** One editable number of an operation. */
export interface OperationField {
  readonly key: string;
  readonly label: string;
  readonly suffix: string;
  readonly value: number;
  /** Returns the operation with this number changed. */
  readonly apply: (value: number) => DesignOperation;
}

const MM = 'мм';
const PIECES = 'шт.';
const MAX_GRID_COUNT = 100;

const clampGridCount = (value: number): number => Math.min(Math.max(Math.round(value), 1), MAX_GRID_COUNT);

/** Describes the numbers an engineer can type for an operation, in display order. */
export function describeOperationFields(operation: DesignOperation): OperationField[] {
  const depthField: OperationField = {
    key: 'depth',
    label: 'Глубина',
    suffix: MM,
    value: operation.depthMm,
    apply: (depthMm) => ({ ...operation, depthMm }),
  };

  switch (operation.kind) {
    case DesignOperationKind.Hole:
    case DesignOperationKind.CircleOutline:
    case DesignOperationKind.CirclePocket: {
      const { center } = operation;
      const positionFields: OperationField[] = [
        { key: 'x', label: 'X центра', suffix: MM, value: center.x, apply: (x) => ({ ...operation, center: { ...center, x } }) },
        { key: 'y', label: 'Y центра', suffix: MM, value: center.y, apply: (y) => ({ ...operation, center: { ...center, y } }) },
      ];
      if (operation.kind === DesignOperationKind.Hole) return [...positionFields, depthField];
      return [
        ...positionFields,
        {
          key: 'diameter',
          label: 'Диаметр',
          suffix: MM,
          value: operation.diameterMm,
          apply: (diameterMm) => ({ ...operation, diameterMm }),
        },
        depthField,
      ];
    }
    case DesignOperationKind.HoleGrid: {
      const { origin } = operation;
      return [
        { key: 'x', label: 'X первого', suffix: MM, value: origin.x, apply: (x) => ({ ...operation, origin: { ...origin, x } }) },
        { key: 'y', label: 'Y первого', suffix: MM, value: origin.y, apply: (y) => ({ ...operation, origin: { ...origin, y } }) },
        { key: 'columns', label: 'По X', suffix: PIECES, value: operation.columnCount, apply: (value) => ({ ...operation, columnCount: clampGridCount(value) }) },
        { key: 'rows', label: 'По Y', suffix: PIECES, value: operation.rowCount, apply: (value) => ({ ...operation, rowCount: clampGridCount(value) }) },
        { key: 'spacing-x', label: 'Шаг по X', suffix: MM, value: operation.spacingXMm, apply: (spacingXMm) => ({ ...operation, spacingXMm }) },
        { key: 'spacing-y', label: 'Шаг по Y', suffix: MM, value: operation.spacingYMm, apply: (spacingYMm) => ({ ...operation, spacingYMm }) },
        depthField,
      ];
    }
    case DesignOperationKind.Slot: {
      const { start, end } = operation;
      return [
        { key: 'start-x', label: 'X начала', suffix: MM, value: start.x, apply: (x) => ({ ...operation, start: { ...start, x } }) },
        { key: 'start-y', label: 'Y начала', suffix: MM, value: start.y, apply: (y) => ({ ...operation, start: { ...start, y } }) },
        { key: 'end-x', label: 'X конца', suffix: MM, value: end.x, apply: (x) => ({ ...operation, end: { ...end, x } }) },
        { key: 'end-y', label: 'Y конца', suffix: MM, value: end.y, apply: (y) => ({ ...operation, end: { ...end, y } }) },
        depthField,
      ];
    }
    case DesignOperationKind.RectangleOutline:
    case DesignOperationKind.RectanglePocket: {
      const { corner } = operation;
      return [
        { key: 'x', label: 'X угла', suffix: MM, value: corner.x, apply: (x) => ({ ...operation, corner: { ...corner, x } }) },
        { key: 'y', label: 'Y угла', suffix: MM, value: corner.y, apply: (y) => ({ ...operation, corner: { ...corner, y } }) },
        { key: 'width', label: 'Ширина', suffix: MM, value: operation.widthMm, apply: (widthMm) => ({ ...operation, widthMm }) },
        { key: 'height', label: 'Высота', suffix: MM, value: operation.heightMm, apply: (heightMm) => ({ ...operation, heightMm }) },
        depthField,
      ];
    }
  }
}
