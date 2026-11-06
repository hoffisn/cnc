<script setup lang="ts">
import { computed } from 'vue';
import { Copy, Trash2 } from '@lucide/vue';
import {
  DesignOperationKind,
  MAX_EDITABLE_VERTICES,
  ShapeCut,
  ToolSide,
  areHoldingTabsActive,
  type DesignOperation,
} from '@rezets/core';
import { useAppContext } from '@ui/presentation/appContext';
import { DESIGN_ISSUE_MESSAGES, OPERATION_KIND_LABELS, SHAPE_CUT_LABELS, TOOL_SIDE_LABELS } from '@ui/presentation/designMessages';
import { describeOperationFields, describeTabFields } from '@ui/presentation/operationFields';
import NumberField from '@ui/presentation/components/ui/NumberField.vue';
import SegmentedControl from '@ui/presentation/components/ui/SegmentedControl.vue';
import UiButton from '@ui/presentation/components/ui/UiButton.vue';

const props = defineProps<{ operation: DesignOperation }>();

const { designer } = useAppContext();

const TOOL_SIDE_OPTIONS = Object.values(ToolSide).map((side) => ({ value: side, label: TOOL_SIDE_LABELS[side] }));
const SHAPE_CUT_OPTIONS = Object.values(ShapeCut).map((cut) => ({ value: cut, label: SHAPE_CUT_LABELS[cut] }));

const shape = computed(() => (props.operation.kind === DesignOperationKind.Shape ? props.operation : null));
/** Smoothing is offered for shapes drawn point by point, not for dense imported drawings. */
const canSmooth = computed(() => {
  const vertexCount = shape.value?.paths.reduce((total, path) => total + path.points.length, 0) ?? 0;
  return vertexCount > 0 && vertexCount <= MAX_EDITABLE_VERTICES;
});
const isSmooth = computed(() => shape.value?.paths.every((path) => path.isSmooth) ?? false);

function setShapeCut(cut: ShapeCut): void {
  if (shape.value) designer.updateOperation({ ...shape.value, cut });
}

function setSmooth(event: Event): void {
  const isChecked = (event.target as HTMLInputElement).checked;
  if (shape.value) {
    designer.updateOperation({ ...shape.value, paths: shape.value.paths.map((path) => ({ ...path, isSmooth: isChecked })) });
  }
}

const fields = computed(() => describeOperationFields(props.operation));
const tabFields = computed(() => describeTabFields(props.operation));
const surface = computed(() => designer.project.value.surface);
const areTabsLeft = computed(() => {
  const { operation } = props;
  return 'tabs' in operation && areHoldingTabsActive(operation.tabs, operation.depthMm, surface.value);
});
const issues = computed(() => designer.issues.value.filter((issue) => issue.operationId === props.operation.id));

const toolSide = computed(() => {
  const { operation } = props;
  if (operation.kind === DesignOperationKind.Shape) return operation.cut === ShapeCut.Outline ? operation.toolSide : null;
  return operation.kind === DesignOperationKind.RectangleOutline || operation.kind === DesignOperationKind.CircleOutline
    ? operation.toolSide
    : null;
});

function setToolSide(value: ToolSide): void {
  const { operation } = props;
  if (
    operation.kind === DesignOperationKind.RectangleOutline ||
    operation.kind === DesignOperationKind.CircleOutline ||
    operation.kind === DesignOperationKind.Shape
  ) {
    designer.updateOperation({ ...operation, toolSide: value });
  }
}
</script>

<template>
  <div class="properties">
    <h3 class="properties__title">{{ OPERATION_KIND_LABELS[operation.kind] }}</h3>

    <div class="properties__fields">
      <NumberField
        v-for="field in fields"
        :key="`${operation.id}-${field.key}`"
        :label="field.label"
        :suffix="field.suffix"
        :model-value="field.value"
        :data-testid="`field-${field.key}`"
        @update:model-value="designer.updateOperation(field.apply($event))"
      />
    </div>

    <div v-if="shape" class="properties__side">
      <span class="properties__label">Что сделать</span>
      <SegmentedControl :model-value="shape.cut" :options="SHAPE_CUT_OPTIONS" data-testid="shape-cut" @update:model-value="setShapeCut" />
      <label v-if="canSmooth" class="properties__check">
        <input type="checkbox" :checked="isSmooth" data-testid="shape-smooth" @change="setSmooth" />
        Сгладить в кривую
      </label>
    </div>

    <div v-if="toolSide" class="properties__side">
      <span class="properties__label">Где идёт фреза</span>
      <SegmentedControl :model-value="toolSide" :options="TOOL_SIDE_OPTIONS" data-testid="tool-side" @update:model-value="setToolSide" />
      <p class="properties__hint">«Снаружи» сохраняет размер детали, «Внутри» — размер отверстия.</p>
    </div>

    <section v-if="tabFields.length > 0" class="properties__group" data-testid="holding-tabs">
      <span class="properties__label">Перемычки</span>
      <div class="properties__fields">
        <NumberField
          v-for="field in tabFields"
          :key="`${operation.id}-${field.key}`"
          :label="field.label"
          :suffix="field.suffix"
          :model-value="field.value"
          :data-testid="`field-${field.key}`"
          @update:model-value="designer.updateOperation(field.apply($event))"
        />
      </div>
      <p class="properties__hint">
        {{
          areTabsLeft
            ? 'Деталь останется на перемычках, чтобы фреза её не сорвала. Потом их срезают ножом.'
            : 'Перемычки оставляются, только когда контур прорезает лист насквозь.'
        }}
      </p>
    </section>

    <ul v-if="issues.length > 0" class="properties__issues" data-testid="operation-issues">
      <li v-for="issue in issues" :key="issue.code">{{ DESIGN_ISSUE_MESSAGES[issue.code] }}</li>
    </ul>

    <p class="properties__hint">Координаты отсчитываются от левого нижнего угла листа.</p>

    <div class="properties__actions">
      <UiButton data-testid="operation-duplicate" @click="designer.duplicateSelectedOperation()">
        <Copy :size="16" /> Копия
      </UiButton>
      <UiButton data-testid="operation-delete" @click="designer.removeSelectedOperation()">
        <Trash2 :size="16" /> Удалить
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.properties {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  padding: 16px;
  overflow-y: auto;
}

.properties__title {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.properties__fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.properties__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.properties__side {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Options share the panel's width, so all three stay visible in a narrow side panel. */
.properties__side :deep(.segmented) {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
}

.properties__side :deep(.segmented__option) {
  min-width: 0;
  padding: 0 4px;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.properties__check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 13px;
  cursor: pointer;
}

.properties__check input {
  width: 18px;
  height: 18px;
  accent-color: #1c1c1e;
}

.properties__label {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.properties__hint {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.properties__issues {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-small);
  background: var(--color-danger-soft);
  color: var(--color-danger);
  font-size: 13px;
  list-style: none;
}

.properties__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
</style>
