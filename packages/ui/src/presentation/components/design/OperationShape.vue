<script setup lang="ts">
import { computed } from 'vue';
import {
  DesignOperationKind,
  ShapeCut,
  ToolSide,
  flattenSheetPath,
  planShapeOutline,
  type DesignOperation,
  type SheetPoint,
} from '@rezets/core';

const props = defineProps<{
  operation: DesignOperation;
  toolDiameterMm: number;
  /** Pixels per millimeter of the drawing. */
  scale: number;
  toScreenX: (x: number) => number;
  toScreenY: (y: number) => number;
  isSelected: boolean;
  hasIssue: boolean;
  /** Centers of the holding tabs on the tool path. */
  tabCenters?: readonly SheetPoint[];
}>();

/** A hole must stay visible and clickable however far the drawing is zoomed out. */
const MIN_HOLE_RADIUS_PX = 3;

const toolWidthPx = computed(() => props.toolDiameterMm * props.scale);
const toolRadiusPx = computed(() => toolWidthPx.value / 2);
const holeRadiusPx = computed(() => Math.max(toolRadiusPx.value, MIN_HOLE_RADIUS_PX));
/** A tab spans the cut; its marker stays visible when zoomed out. */
const tabMarkerSizePx = computed(() => Math.max(toolWidthPx.value * 1.4, 8));

const toolPathOffsetPx = (toolSide: ToolSide): number => {
  switch (toolSide) {
    case ToolSide.Outside:
      return toolRadiusPx.value;
    case ToolSide.OnLine:
      return 0;
    case ToolSide.Inside:
      return -toolRadiusPx.value;
  }
};

/** Screen rectangle of an operation with a corner and a size. */
const screenRectangle = computed(() => {
  const { operation } = props;
  if (operation.kind !== DesignOperationKind.RectangleOutline && operation.kind !== DesignOperationKind.RectanglePocket) {
    return null;
  }
  return {
    x: props.toScreenX(operation.corner.x),
    y: props.toScreenY(operation.corner.y + operation.heightMm),
    width: operation.widthMm * props.scale,
    height: operation.heightMm * props.scale,
  };
});

/** Screen circle of an operation with a center and a diameter. */
const screenCircle = computed(() => {
  const { operation } = props;
  if (operation.kind !== DesignOperationKind.CircleOutline && operation.kind !== DesignOperationKind.CirclePocket) {
    return null;
  }
  return {
    cx: props.toScreenX(operation.center.x),
    cy: props.toScreenY(operation.center.y),
    r: (operation.diameterMm / 2) * props.scale,
  };
});

/** SVG path data through sheet points; closed lines return to their start. */
function toSvgPath(lines: readonly { points: readonly SheetPoint[]; isClosed: boolean }[]): string {
  return lines
    .map(({ points, isClosed }) => {
      const commands = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${props.toScreenX(point.x)} ${props.toScreenY(point.y)}`);
      return commands.join(' ') + (isClosed ? ' Z' : '');
    })
    .join(' ');
}

/** The drawn lines of a free shape and, for an outline, the path of the tool along them. */
const freeShape = computed(() => {
  const { operation } = props;
  if (operation.kind !== DesignOperationKind.Shape) return null;
  const drawn = toSvgPath(operation.paths.map((path) => ({ points: flattenSheetPath(path), isClosed: path.isClosed })));
  const toolPath =
    operation.cut === ShapeCut.Outline ? toSvgPath(planShapeOutline(operation, props.toolDiameterMm / 2)) : drawn;
  return { drawn, toolPath, cut: operation.cut };
});

const gridHoles = computed(() => {
  const { operation } = props;
  if (operation.kind !== DesignOperationKind.HoleGrid) return [];
  const holes: { key: string; cx: number; cy: number }[] = [];
  for (let row = 0; row < operation.rowCount; row += 1) {
    for (let column = 0; column < operation.columnCount; column += 1) {
      holes.push({
        key: `${column}-${row}`,
        cx: props.toScreenX(operation.origin.x + column * operation.spacingXMm),
        cy: props.toScreenY(operation.origin.y + row * operation.spacingYMm),
      });
    }
  }
  return holes;
});
</script>

<template>
  <g class="shape" :class="{ 'shape--selected': isSelected, 'shape--issue': hasIssue }" :data-testid="`shape-${operation.kind}`">
    <template v-if="operation.kind === DesignOperationKind.Hole">
      <circle class="shape__cut" :cx="toScreenX(operation.center.x)" :cy="toScreenY(operation.center.y)" :r="holeRadiusPx" />
    </template>

    <template v-else-if="operation.kind === DesignOperationKind.HoleGrid">
      <circle v-for="hole in gridHoles" :key="hole.key" class="shape__cut" :cx="hole.cx" :cy="hole.cy" :r="holeRadiusPx" />
    </template>

    <template v-else-if="operation.kind === DesignOperationKind.Slot">
      <line
        class="shape__kerf"
        :x1="toScreenX(operation.start.x)"
        :y1="toScreenY(operation.start.y)"
        :x2="toScreenX(operation.end.x)"
        :y2="toScreenY(operation.end.y)"
        :stroke-width="Math.max(toolWidthPx, 6)"
        stroke-linecap="round"
      />
      <line
        class="shape__line"
        :x1="toScreenX(operation.start.x)"
        :y1="toScreenY(operation.start.y)"
        :x2="toScreenX(operation.end.x)"
        :y2="toScreenY(operation.end.y)"
      />
    </template>

    <template v-else-if="operation.kind === DesignOperationKind.RectangleOutline && screenRectangle">
      <rect
        class="shape__kerf"
        :x="screenRectangle.x - toolPathOffsetPx(operation.toolSide)"
        :y="screenRectangle.y - toolPathOffsetPx(operation.toolSide)"
        :width="Math.max(screenRectangle.width + toolPathOffsetPx(operation.toolSide) * 2, 0)"
        :height="Math.max(screenRectangle.height + toolPathOffsetPx(operation.toolSide) * 2, 0)"
        :stroke-width="toolWidthPx"
      />
      <rect class="shape__line" fill="transparent" v-bind="screenRectangle" />
    </template>

    <template v-else-if="operation.kind === DesignOperationKind.CircleOutline && screenCircle">
      <circle
        class="shape__kerf"
        :cx="screenCircle.cx"
        :cy="screenCircle.cy"
        :r="Math.max(screenCircle.r + toolPathOffsetPx(operation.toolSide), 0)"
        :stroke-width="toolWidthPx"
      />
      <circle class="shape__line" fill="transparent" v-bind="screenCircle" />
    </template>

    <rect v-else-if="operation.kind === DesignOperationKind.RectanglePocket && screenRectangle" class="shape__cut" v-bind="screenRectangle" />
    <circle v-else-if="operation.kind === DesignOperationKind.CirclePocket && screenCircle" class="shape__cut" v-bind="screenCircle" />

    <template v-else-if="freeShape">
      <path v-if="freeShape.cut === ShapeCut.Pocket" class="shape__cut" fill-rule="evenodd" :d="freeShape.drawn" />
      <template v-else>
        <path class="shape__kerf" :d="freeShape.toolPath" :stroke-width="Math.max(toolWidthPx, 2)" stroke-linecap="round" stroke-linejoin="round" />
        <path class="shape__line shape__hit" fill-rule="evenodd" :d="freeShape.drawn" />
      </template>
    </template>

    <rect
      v-for="(tab, index) in tabCenters ?? []"
      :key="`tab-${index}`"
      class="shape__tab"
      :x="toScreenX(tab.x) - tabMarkerSizePx / 2"
      :y="toScreenY(tab.y) - tabMarkerSizePx / 2"
      :width="tabMarkerSizePx"
      :height="tabMarkerSizePx"
      rx="2"
    />
  </g>
</template>

<style scoped>
.shape {
  --shape-color: #2b3a55;
  cursor: move;
}

.shape--selected {
  --shape-color: #d99a00;
}

.shape--issue {
  --shape-color: #e5383b;
}

.shape__cut {
  fill: color-mix(in srgb, var(--shape-color) 32%, transparent);
  stroke: var(--shape-color);
  stroke-width: 1.5;
}

.shape__kerf {
  fill: none;
  stroke: color-mix(in srgb, var(--shape-color) 24%, transparent);
}

.shape__tab {
  fill: #fff;
  stroke: var(--shape-color);
  stroke-width: 1.5;
}

.shape__hit {
  fill: transparent;
}

.shape__line {
  stroke: var(--shape-color);
  stroke-width: 1.5;
}
</style>
