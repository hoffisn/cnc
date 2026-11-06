<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Maximize } from '@lucide/vue';
import { boundsSize, formatCoordinate, type Bounds, type Relief, type Toolpath } from '@rezets/core';
import { ToolpathViewport } from '@ui/viewport/toolpathViewport';
import { CameraPreset, ViewportMode } from '@ui/viewport/viewportTypes';
import { useAppContext } from '@ui/presentation/appContext';
import SegmentedControl from '@ui/presentation/components/ui/SegmentedControl.vue';
import UiButton from '@ui/presentation/components/ui/UiButton.vue';

const props = withDefaults(
  defineProps<{
    toolpath: Toolpath;
    relief: Relief | null;
    /** Source line whose moves are highlighted. */
    highlightedLine?: number | null;
    /** What the camera frames; by default, the toolpath. */
    framedBounds?: Bounds | null;
    /** The camera reframes when this value changes, and only then: stretching must let the operator see the change. */
    frameKey?: unknown;
  }>(),
  { highlightedLine: null, framedBounds: null, frameKey: undefined },
);

const { machine } = useAppContext();

const MODE_OPTIONS = [
  { value: ViewportMode.Part, label: 'Деталь' },
  { value: ViewportMode.Toolpath, label: 'Траектория' },
];

const CAMERA_PRESET_LABELS: readonly { readonly preset: CameraPreset; readonly label: string; readonly title: string }[] = [
  { preset: CameraPreset.Isometric, label: '3D', title: 'Изометрия' },
  { preset: CameraPreset.Top, label: 'Сверху', title: 'Вид сверху' },
  { preset: CameraPreset.Front, label: 'Спереди', title: 'Вид спереди' },
  { preset: CameraPreset.Right, label: 'Справа', title: 'Вид справа' },
];

const containerElement = ref<HTMLElement | null>(null);
const mode = ref(ViewportMode.Part);
let viewport: ToolpathViewport | null = null;

/** A program may cut nothing, such as a flat contour: then the only thing to show is the trajectory. */
const isPartAvailable = computed(() => props.relief !== null);
const isProgramEmpty = computed(() => props.toolpath.segmentCount === 0 && props.relief === null);

const partSizeText = computed(() => {
  const { partBounds } = props.toolpath;
  if (!partBounds) return null;
  const size = boundsSize(partBounds);
  return `${formatCoordinate(size.x)} × ${formatCoordinate(size.y)} × ${formatCoordinate(size.z)} мм`;
});

onMounted(() => {
  if (!containerElement.value) return;
  const activeViewport = new ToolpathViewport(containerElement.value);
  viewport = activeViewport;

  activeViewport.setMode(mode.value);
  activeViewport.setFramedBounds(props.framedBounds);
  activeViewport.setToolpath(props.toolpath);
  activeViewport.setRelief(props.relief);
  activeViewport.setToolPosition(machine.state.value.position);
  activeViewport.setHighlightedLine(props.highlightedLine);
  activeViewport.applyCameraPreset(CameraPreset.Isometric);

  watch(
    () => props.toolpath,
    (toolpath) => {
      activeViewport.setToolpath(toolpath);
      activeViewport.setHighlightedLine(props.highlightedLine);
    },
  );
  watch(
    () => props.relief,
    (relief) => activeViewport.setRelief(relief),
  );
  watch(
    () => props.frameKey,
    () => {
      activeViewport.setFramedBounds(props.framedBounds);
      activeViewport.fitToFigure();
    },
    { flush: 'post' },
  );
  watch(mode, (selectedMode) => activeViewport.setMode(selectedMode));
  watch(
    () => machine.state.value.position,
    (position) => activeViewport.setToolPosition(position),
  );
  watch(
    () => machine.state.value.programProgress?.segmentIndex ?? -1,
    (segmentIndex) => activeViewport.setCompletedSegment(segmentIndex),
  );
  watch(
    () => props.highlightedLine,
    (line) => activeViewport.setHighlightedLine(line),
  );
});
onBeforeUnmount(() => viewport?.dispose());
</script>

<template>
  <section class="stage">
    <div ref="containerElement" class="stage__canvas" data-testid="viewport" />

    <div class="stage__overlay stage__overlay--top-left">
      <SegmentedControl v-model="mode" :options="MODE_OPTIONS" class="stage__floating" :disabled="!isPartAvailable" />
    </div>

    <div class="stage__overlay stage__overlay--top-right stage__floating stage__presets">
      <button
        v-for="item in CAMERA_PRESET_LABELS"
        :key="item.preset"
        type="button"
        class="stage__preset"
        :title="item.title"
        @click="viewport?.applyCameraPreset(item.preset)"
      >
        {{ item.label }}
      </button>
      <UiButton icon-only title="Показать фигуру целиком" class="stage__fit" @click="viewport?.fitToFigure()">
        <Maximize :size="16" />
      </UiButton>
    </div>

    <div v-if="partSizeText" class="stage__overlay stage__overlay--bottom-left stage__floating stage__info">
      <span class="stage__info-label">Размер фигуры</span>
      <span class="numeric" data-testid="part-size">{{ partSizeText }}</span>
    </div>

    <p v-if="!isPartAvailable && !isProgramEmpty && mode === ViewportMode.Part" class="stage__overlay stage__overlay--bottom-right stage__floating stage__hint">
      Программа не снимает материал: показана траектория
    </p>

    <div v-if="isProgramEmpty" class="stage__empty">
      <p class="stage__empty-title">Здесь появится фигура</p>
      <p class="stage__empty-text">Напишите G-код справа или перетащите файл в окно</p>
    </div>
  </section>
</template>

<style scoped>
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--radius-large);
  background: #eef0f3;
}

.stage__canvas {
  position: absolute;
  inset: 0;
}

.stage__canvas :deep(canvas) {
  display: block;
}

.stage__overlay {
  position: absolute;
}

.stage__overlay--top-left {
  top: 12px;
  left: 12px;
}

.stage__overlay--top-right {
  top: 12px;
  right: 12px;
}

.stage__overlay--bottom-left {
  bottom: 12px;
  left: 12px;
}

.stage__overlay--bottom-right {
  right: 12px;
  bottom: 12px;
}

.stage__floating {
  background: var(--color-surface);
  box-shadow: 0 2px 10px rgb(28 28 30 / 8%);
}

.stage__presets {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-small);
}

.stage__preset {
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-weight: 550;
}

.stage__preset:hover {
  background: var(--color-surface-muted);
}

.stage__fit {
  width: 32px;
  height: 32px;
  background: transparent;
}

.stage__info {
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  border-radius: var(--radius-small);
  font-weight: 600;
}

.stage__info-label {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
}

.stage__hint {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--radius-small);
  color: var(--color-text-secondary);
  font-size: 13px;
}

.stage__empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.stage__empty-title {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 650;
}

.stage__empty-text {
  margin: 0;
  color: var(--color-text-secondary);
}
</style>
