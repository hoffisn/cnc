<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import {
  createOperationFromDrawing,
  dragOperationHandle,
  findZeroOnSheet,
  formatCoordinate,
  listOperationHandles,
  locateOperationTabs,
  translateOperation,
  type DesignIssue,
  type DesignOperation,
  type DesignOperationKind,
  type OperationHandle,
  type OperationHandleKind,
  type SheetPoint,
  type WorkSurface,
} from '@rezets/core';
import OperationShape from './OperationShape.vue';

const props = withDefaults(
  defineProps<{
    surface: WorkSurface;
    operations: readonly DesignOperation[];
    issues?: readonly DesignIssue[];
    selectedOperationId?: string | null;
    /** Shape being drawn; `null` means selecting and moving. */
    activeTool?: DesignOperationKind | null;
    snapStepMm?: number;
    /** Shows the drawing without allowing edits, while still allowing zoom and pan. */
    isReadOnly?: boolean;
  }>(),
  { issues: () => [], selectedOperationId: null, activeTool: null, snapStepMm: 0, isReadOnly: false },
);

const emit = defineEmits<{
  selectOperation: [operationId: string | null];
  drawOperation: [kind: DesignOperationKind, start: SheetPoint, end: SheetPoint];
  updateOperation: [operation: DesignOperation];
}>();

/** What a pointer drag is currently doing. */
enum CanvasGesture {
  None = 'none',
  Panning = 'panning',
  Drawing = 'drawing',
  MovingOperation = 'moving-operation',
  DraggingHandle = 'dragging-handle',
  /** Two fingers on a touch screen: zooming and moving the drawing. */
  Pinching = 'pinching',
}

const FIT_PADDING_PX = 56;
const MIN_SCALE = 0.02;
const MAX_SCALE = 60;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const PINCH_FINGER_COUNT = 2;
const MIN_GRID_CELL_PX = 24;
const MIN_RULER_LABEL_SPACING_PX = 72;
const ZERO_MARKER_LENGTH_PX = 34;
const PRIMARY_BUTTON = 0;

const svgElement = ref<SVGSVGElement | null>(null);
const viewWidth = ref(0);
const viewHeight = ref(0);
const scale = ref(1);
const panX = ref(0);
const panY = ref(0);
const cursor = shallowRef<SheetPoint | null>(null);

const gesture = ref(CanvasGesture.None);
const gestureStart = shallowRef<SheetPoint>({ x: 0, y: 0 });
const gestureCurrent = shallowRef<SheetPoint>({ x: 0, y: 0 });
const panStartScreen = shallowRef({ x: 0, y: 0, panX: 0, panY: 0 });
/** The operation as it looks mid-drag; the project changes only when the drag ends, as one undo step. */
const previewOperation = shallowRef<DesignOperation | null>(null);
let draggedOperation: DesignOperation | null = null;
let draggedHandle: OperationHandleKind | null = null;

/** Screen positions of the fingers or pointers currently down, by pointer. */
const activePointers = new Map<number, { x: number; y: number }>();
let pinchPreviousDistance = 0;
let pinchPreviousMiddle = { x: 0, y: 0 };

const toScreenX = (x: number): number => panX.value + x * scale.value;
const toScreenY = (y: number): number => panY.value - y * scale.value;

function toSheetPoint(event: PointerEvent | WheelEvent): SheetPoint {
  const bounds = svgElement.value?.getBoundingClientRect();
  return {
    x: (event.clientX - (bounds?.left ?? 0) - panX.value) / scale.value,
    y: (panY.value - (event.clientY - (bounds?.top ?? 0))) / scale.value,
  };
}

const snapValue = (value: number): number =>
  props.snapStepMm > 0 ? Math.round(value / props.snapStepMm) * props.snapStepMm : value;

const snapPoint = (point: SheetPoint): SheetPoint => ({ x: snapValue(point.x), y: snapValue(point.y) });

/** Frames the table and the sheet in the available space. */
function fitToView(): void {
  if (viewWidth.value === 0 || viewHeight.value === 0) return;
  const { surface } = props;
  const minX = Math.min(-surface.sheetOffsetXMm, 0);
  const minY = Math.min(-surface.sheetOffsetYMm, 0);
  const maxX = Math.max(surface.tableWidthMm - surface.sheetOffsetXMm, surface.sheetWidthMm);
  const maxY = Math.max(surface.tableDepthMm - surface.sheetOffsetYMm, surface.sheetDepthMm);

  const fittedScale = Math.min(
    (viewWidth.value - FIT_PADDING_PX * 2) / (maxX - minX),
    (viewHeight.value - FIT_PADDING_PX * 2) / (maxY - minY),
  );
  scale.value = Math.min(Math.max(fittedScale, MIN_SCALE), MAX_SCALE);
  panX.value = (viewWidth.value - (minX + maxX) * scale.value) / 2;
  panY.value = (viewHeight.value + (minY + maxY) * scale.value) / 2;
}

defineExpose({ fitToView });

const resizeObserver = new ResizeObserver(([entry]) => {
  if (!entry) return;
  const isFirstLayout = viewWidth.value === 0;
  viewWidth.value = entry.contentRect.width;
  viewHeight.value = entry.contentRect.height;
  if (isFirstLayout) fitToView();
});

onMounted(() => {
  if (svgElement.value) resizeObserver.observe(svgElement.value);
});
onBeforeUnmount(() => resizeObserver.disconnect());

watch(
  () => [
    props.surface.tableWidthMm,
    props.surface.tableDepthMm,
    props.surface.sheetWidthMm,
    props.surface.sheetDepthMm,
    props.surface.sheetOffsetXMm,
    props.surface.sheetOffsetYMm,
  ],
  fitToView,
);

/** Rounds up to the nearest 1, 2 or 5 times a power of ten. */
function roundUpToNiceStep(minimumStep: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(minimumStep));
  for (const multiplier of [1, 2, 5, 10]) {
    if (multiplier * magnitude >= minimumStep) return multiplier * magnitude;
  }
  return 10 * magnitude;
}

const gridStep = computed(() => roundUpToNiceStep(MIN_GRID_CELL_PX / scale.value));
const rulerStep = computed(() => roundUpToNiceStep(MIN_RULER_LABEL_SPACING_PX / scale.value));

/** Lists multiples of a step from zero up to a limit, including the limit itself only if it is a multiple. */
function listMultiples(step: number, limit: number): number[] {
  const count = Math.floor(limit / step + 1e-9);
  return Array.from({ length: count + 1 }, (_, index) => index * step);
}

const gridLinesX = computed(() => listMultiples(gridStep.value, props.surface.sheetWidthMm));
const gridLinesY = computed(() => listMultiples(gridStep.value, props.surface.sheetDepthMm));
const rulerLabelsX = computed(() => listMultiples(rulerStep.value, props.surface.sheetWidthMm));
const rulerLabelsY = computed(() => listMultiples(rulerStep.value, props.surface.sheetDepthMm));

const sheetRectangle = computed(() => ({
  x: toScreenX(0),
  y: toScreenY(props.surface.sheetDepthMm),
  width: props.surface.sheetWidthMm * scale.value,
  height: props.surface.sheetDepthMm * scale.value,
}));

const tableRectangle = computed(() => ({
  x: toScreenX(-props.surface.sheetOffsetXMm),
  y: toScreenY(props.surface.tableDepthMm - props.surface.sheetOffsetYMm),
  width: props.surface.tableWidthMm * scale.value,
  height: props.surface.tableDepthMm * scale.value,
}));

const zeroMarker = computed(() => {
  const zero = findZeroOnSheet(props.surface);
  return { x: toScreenX(zero.x), y: toScreenY(zero.y) };
});

const operationsWithIssues = computed(() => new Set(props.issues.map((issue) => issue.operationId)));

const drawnPreview = computed<DesignOperation | null>(() => {
  if (gesture.value !== CanvasGesture.Drawing || !props.activeTool) return null;
  return createOperationFromDrawing({
    kind: props.activeTool,
    id: 'drawing-preview',
    start: gestureStart.value,
    end: gestureCurrent.value,
    toolDiameterMm: props.surface.toolDiameterMm,
    depthMm: props.surface.depthPerPassMm,
  });
});

const displayedOperations = computed<readonly DesignOperation[]>(() => {
  const preview = previewOperation.value;
  const operations = preview
    ? props.operations.map((operation) => (operation.id === preview.id ? preview : operation))
    : props.operations;
  return drawnPreview.value ? [...operations, drawnPreview.value] : operations;
});

const selectedHandles = computed<OperationHandle[]>(() => {
  if (props.isReadOnly) return [];
  const selected = displayedOperations.value.find((operation) => operation.id === props.selectedOperationId);
  return selected ? listOperationHandles(selected) : [];
});

const cursorStyle = computed(() => {
  if (gesture.value === CanvasGesture.Panning) return 'grabbing';
  return props.activeTool ? 'crosshair' : 'default';
});

function measurePinch(): { distance: number; middle: { x: number; y: number } } {
  const [first, second] = [...activePointers.values()];
  if (!first || !second) return { distance: 0, middle: { x: 0, y: 0 } };
  return {
    distance: Math.hypot(first.x - second.x, first.y - second.y),
    middle: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
  };
}

/** A second finger turns whatever the first one was doing into a pinch, discarding the unfinished edit. */
function trackPointerDown(event: PointerEvent): void {
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size !== PINCH_FINGER_COUNT) return;
  event.stopPropagation();
  previewOperation.value = null;
  draggedOperation = null;
  draggedHandle = null;
  const { distance, middle } = measurePinch();
  pinchPreviousDistance = distance;
  pinchPreviousMiddle = middle;
  beginGesture(CanvasGesture.Pinching, event);
}

function zoomAround(screenX: number, screenY: number, nextScale: number): void {
  const clampedScale = Math.min(Math.max(nextScale, MIN_SCALE), MAX_SCALE);
  const sheetX = (screenX - panX.value) / scale.value;
  const sheetY = (panY.value - screenY) / scale.value;
  panX.value = screenX - sheetX * clampedScale;
  panY.value = screenY + sheetY * clampedScale;
  scale.value = clampedScale;
}

function updatePinch(): void {
  const { distance, middle } = measurePinch();
  if (pinchPreviousDistance === 0 || distance === 0) return;
  const bounds = svgElement.value?.getBoundingClientRect();
  panX.value += middle.x - pinchPreviousMiddle.x;
  panY.value += middle.y - pinchPreviousMiddle.y;
  zoomAround(middle.x - (bounds?.left ?? 0), middle.y - (bounds?.top ?? 0), (scale.value * distance) / pinchPreviousDistance);
  pinchPreviousDistance = distance;
  pinchPreviousMiddle = middle;
}

function beginGesture(kind: CanvasGesture, event: PointerEvent): void {
  gesture.value = kind;
  svgElement.value?.setPointerCapture(event.pointerId);
}

function handleCanvasPointerDown(event: PointerEvent): void {
  if (event.button === PRIMARY_BUTTON && props.activeTool && !props.isReadOnly) {
    const start = snapPoint(toSheetPoint(event));
    gestureStart.value = start;
    gestureCurrent.value = start;
    beginGesture(CanvasGesture.Drawing, event);
    return;
  }
  if (event.button === PRIMARY_BUTTON && !props.isReadOnly) emit('selectOperation', null);
  panStartScreen.value = { x: event.clientX, y: event.clientY, panX: panX.value, panY: panY.value };
  beginGesture(CanvasGesture.Panning, event);
}

function handleShapePointerDown(operation: DesignOperation, event: PointerEvent): void {
  if (props.isReadOnly || props.activeTool || event.button !== PRIMARY_BUTTON) return;
  event.stopPropagation();
  emit('selectOperation', operation.id);
  draggedOperation = operation;
  gestureStart.value = toSheetPoint(event);
  beginGesture(CanvasGesture.MovingOperation, event);
}

function handleHandlePointerDown(handle: OperationHandle, event: PointerEvent): void {
  event.stopPropagation();
  draggedOperation = props.operations.find((operation) => operation.id === props.selectedOperationId) ?? null;
  draggedHandle = handle.kind;
  beginGesture(CanvasGesture.DraggingHandle, event);
}

function handlePointerMove(event: PointerEvent): void {
  if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const point = toSheetPoint(event);
  cursor.value = point;

  switch (gesture.value) {
    case CanvasGesture.Panning:
      panX.value = panStartScreen.value.panX + event.clientX - panStartScreen.value.x;
      panY.value = panStartScreen.value.panY + event.clientY - panStartScreen.value.y;
      break;
    case CanvasGesture.Drawing:
      gestureCurrent.value = snapPoint(point);
      break;
    case CanvasGesture.MovingOperation:
      if (draggedOperation) {
        previewOperation.value = translateOperation(
          draggedOperation,
          snapValue(point.x - gestureStart.value.x),
          snapValue(point.y - gestureStart.value.y),
        );
      }
      break;
    case CanvasGesture.DraggingHandle:
      if (draggedOperation && draggedHandle) {
        previewOperation.value = dragOperationHandle(draggedOperation, draggedHandle, snapPoint(point));
      }
      break;
    case CanvasGesture.Pinching:
      updatePinch();
      break;
    case CanvasGesture.None:
      break;
  }
}

function handlePointerUp(event: PointerEvent): void {
  activePointers.delete(event.pointerId);
  if (gesture.value === CanvasGesture.Drawing && props.activeTool) {
    emit('drawOperation', props.activeTool, gestureStart.value, gestureCurrent.value);
  } else if (previewOperation.value) {
    emit('updateOperation', previewOperation.value);
  }
  gesture.value = CanvasGesture.None;
  previewOperation.value = null;
  draggedOperation = null;
  draggedHandle = null;
}

/** Zooms around the pointer, so the point under it stays in place. */
function handleWheel(event: WheelEvent): void {
  const bounds = svgElement.value?.getBoundingClientRect();
  zoomAround(
    event.clientX - (bounds?.left ?? 0),
    event.clientY - (bounds?.top ?? 0),
    scale.value * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY),
  );
}
</script>

<template>
  <div class="canvas">
    <svg
      ref="svgElement"
      class="canvas__svg"
      data-testid="design-canvas"
      :style="{ cursor: cursorStyle }"
      @pointerdown.capture="trackPointerDown"
      @pointerdown="handleCanvasPointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerUp"
      @pointerleave="cursor = null"
      @wheel.prevent="handleWheel"
      @contextmenu.prevent
    >
      <rect class="canvas__table" v-bind="tableRectangle" rx="6" />
      <rect class="canvas__sheet" v-bind="sheetRectangle" />

      <g class="canvas__grid">
        <line
          v-for="x in gridLinesX"
          :key="`grid-x-${x}`"
          :x1="toScreenX(x)"
          :x2="toScreenX(x)"
          :y1="sheetRectangle.y"
          :y2="sheetRectangle.y + sheetRectangle.height"
        />
        <line
          v-for="y in gridLinesY"
          :key="`grid-y-${y}`"
          :y1="toScreenY(y)"
          :y2="toScreenY(y)"
          :x1="sheetRectangle.x"
          :x2="sheetRectangle.x + sheetRectangle.width"
        />
      </g>

      <g class="canvas__rulers numeric">
        <text v-for="x in rulerLabelsX" :key="`ruler-x-${x}`" :x="toScreenX(x)" :y="toScreenY(0) + 16" text-anchor="middle">
          {{ formatCoordinate(x) }}
        </text>
        <text v-for="y in rulerLabelsY" :key="`ruler-y-${y}`" :x="toScreenX(0) - 8" :y="toScreenY(y) + 4" text-anchor="end">
          {{ formatCoordinate(y) }}
        </text>
      </g>

      <OperationShape
        v-for="operation in displayedOperations"
        :key="operation.id"
        :operation="operation"
        :tool-diameter-mm="surface.toolDiameterMm"
        :scale="scale"
        :to-screen-x="toScreenX"
        :to-screen-y="toScreenY"
        :is-selected="operation.id === selectedOperationId"
        :has-issue="operationsWithIssues.has(operation.id)"
        :tab-centers="locateOperationTabs(operation, surface)"
        @pointerdown="handleShapePointerDown(operation, $event)"
      />

      <g class="canvas__zero" :transform="`translate(${zeroMarker.x} ${zeroMarker.y})`" data-testid="zero-marker">
        <line :x2="ZERO_MARKER_LENGTH_PX" class="canvas__zero-x" />
        <line :y2="-ZERO_MARKER_LENGTH_PX" class="canvas__zero-y" />
        <circle r="5" class="canvas__zero-point" />
        <text :x="ZERO_MARKER_LENGTH_PX + 4" y="4" class="canvas__zero-x-label">X</text>
        <text x="-4" :y="-ZERO_MARKER_LENGTH_PX - 4" class="canvas__zero-y-label">Y</text>
      </g>

      <g v-for="handle in selectedHandles" :key="handle.kind" @pointerdown="handleHandlePointerDown(handle, $event)">
        <!-- A fingertip is much larger than the visible point. -->
        <circle class="canvas__handle-target" :cx="toScreenX(handle.point.x)" :cy="toScreenY(handle.point.y)" r="20" />
        <circle
          class="canvas__handle"
          :cx="toScreenX(handle.point.x)"
          :cy="toScreenY(handle.point.y)"
          r="6"
          :data-testid="`handle-${handle.kind}`"
        />
      </g>
    </svg>

    <div class="canvas__legend numeric">
      <span>Лист {{ formatCoordinate(surface.sheetWidthMm) }} × {{ formatCoordinate(surface.sheetDepthMm) }} мм</span>
      <span v-if="cursor" data-testid="canvas-cursor">X {{ formatCoordinate(snapPoint(cursor).x) }} · Y {{ formatCoordinate(snapPoint(cursor).y) }}</span>
    </div>
  </div>
</template>

<style scoped>
.canvas {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--radius-large);
  background: #e6e8ec;
}

.canvas__svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.canvas__table {
  fill: #d4d8df;
  stroke: #c1c6cf;
}

.canvas__sheet {
  fill: #fff;
  stroke: #9aa0ab;
  stroke-width: 1.5;
  filter: drop-shadow(0 2px 6px rgb(28 28 30 / 14%));
}

.canvas__grid line {
  stroke: #edeff2;
  pointer-events: none;
}

.canvas__rulers text {
  fill: var(--color-text-secondary);
  font-size: 11px;
  pointer-events: none;
}

.canvas__zero {
  pointer-events: none;
}

.canvas__zero line {
  stroke-width: 2;
}

.canvas__zero-x {
  stroke: #e5484d;
}

.canvas__zero-y {
  stroke: #30a46c;
}

.canvas__zero-point {
  fill: var(--color-accent);
  stroke: var(--color-text);
  stroke-width: 1.5;
}

.canvas__zero-x-label {
  fill: #e5484d;
  font-size: 12px;
  font-weight: 700;
}

.canvas__zero-y-label {
  fill: #30a46c;
  font-size: 12px;
  font-weight: 700;
}

.canvas__handle {
  fill: #fff;
  stroke: #d99a00;
  stroke-width: 2;
  pointer-events: none;
}

.canvas__handle-target {
  fill: transparent;
  cursor: grab;
}

.canvas__legend {
  position: absolute;
  bottom: 10px;
  left: 12px;
  display: flex;
  gap: 16px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgb(255 255 255 / 88%);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
  pointer-events: none;
}
</style>
