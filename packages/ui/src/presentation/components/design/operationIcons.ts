import type { Component } from 'vue';
import { Circle, CircleDot, Disc, Grip, Minus, PenTool, RectangleHorizontal, Square } from '@lucide/vue';
import { DesignOperationKind } from '@rezets/core';

/** Icon of each kind of operation, shared by the palette and the list. */
export const OPERATION_ICONS: Readonly<Record<DesignOperationKind, Component>> = {
  [DesignOperationKind.Hole]: CircleDot,
  [DesignOperationKind.HoleGrid]: Grip,
  [DesignOperationKind.Slot]: Minus,
  [DesignOperationKind.RectangleOutline]: Square,
  [DesignOperationKind.CircleOutline]: Circle,
  [DesignOperationKind.RectanglePocket]: RectangleHorizontal,
  [DesignOperationKind.CirclePocket]: Disc,
  [DesignOperationKind.Shape]: PenTool,
};
