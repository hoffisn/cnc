<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ChevronDown, ChevronUp, Maximize, MousePointer2, Redo2, Save, Send, Sparkles, Undo2 } from '@lucide/vue';
import { DesignOperationKind, formatCoordinate } from '@rezets/core';
import { useAppContext } from '@ui/presentation/appContext';
import { DesignerView } from '@ui/presentation/designerViewModel';
import { DESIGN_ISSUE_MESSAGES, OPERATION_KIND_LABELS, summarizeOperation } from '@ui/presentation/designMessages';
import { AppSection } from '@ui/presentation/navigation';
import DesignCanvas from '@ui/presentation/components/design/DesignCanvas.vue';
import OperationProperties from '@ui/presentation/components/design/OperationProperties.vue';
import { OPERATION_ICONS } from '@ui/presentation/components/design/operationIcons';
import SegmentedControl from '@ui/presentation/components/ui/SegmentedControl.vue';
import UiButton from '@ui/presentation/components/ui/UiButton.vue';
import { ButtonVariant } from '@ui/presentation/components/ui/buttonVariant';
import ViewportStage from '@ui/presentation/components/viewport/ViewportStage.vue';

const { designer, activeSection } = useAppContext();

const VIEW_OPTIONS = [
  { value: DesignerView.Drawing, label: 'Чертёж' },
  { value: DesignerView.Preview, label: '3D' },
];
const SNAP_OPTIONS = [
  { value: 0, label: 'Без привязки' },
  { value: 1, label: 'Шаг 1 мм' },
  { value: 5, label: 'Шаг 5 мм' },
  { value: 10, label: 'Шаг 10 мм' },
  { value: 50, label: 'Шаг 50 мм' },
];
const TOOLS = Object.values(DesignOperationKind);

const canvas = ref<InstanceType<typeof DesignCanvas> | null>(null);

const project = designer.project;
const operations = computed(() => project.value.operations);
const surface = computed(() => project.value.surface);
const surfaceIssues = computed(() => designer.issues.value.filter((issue) => issue.operationId === null));
const operationsWithIssues = computed(() => new Set(designer.issues.value.map((issue) => issue.operationId)));
const canSend = computed(() => operations.value.length > 0 && designer.issues.value.length === 0);

function toggleTool(tool: DesignOperationKind): void {
  designer.activeTool.value = designer.activeTool.value === tool ? null : tool;
}

function isEditingText(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function handleKeyDown(event: KeyboardEvent): void {
  if (isEditingText(event.target)) return;
  const isCommand = event.ctrlKey || event.metaKey;
  if (event.key === 'Escape') {
    designer.activeTool.value = null;
    designer.selectedOperationId.value = null;
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    designer.removeSelectedOperation();
  } else if (isCommand && event.code === 'KeyZ') {
    event.preventDefault();
    if (event.shiftKey) designer.redo();
    else designer.undo();
  } else if (isCommand && event.code === 'KeyY') {
    event.preventDefault();
    designer.redo();
  }
}

onMounted(() => window.addEventListener('keydown', handleKeyDown));
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeyDown));
</script>

<template>
  <div class="designer">
    <aside class="card designer__tools">
      <section class="tools">
        <h2 class="card-title">Что добавить</h2>
        <div class="tools__grid">
          <button
            type="button"
            class="tools__item"
            :class="{ 'tools__item--active': designer.activeTool.value === null }"
            data-testid="tool-select"
            @click="designer.activeTool.value = null"
          >
            <MousePointer2 :size="18" />
            <span>Выбор</span>
          </button>
          <button
            v-for="tool in TOOLS"
            :key="tool"
            type="button"
            class="tools__item"
            :class="{ 'tools__item--active': designer.activeTool.value === tool }"
            :data-testid="`tool-${tool}`"
            @click="toggleTool(tool)"
          >
            <component :is="OPERATION_ICONS[tool]" :size="18" />
            <span>{{ OPERATION_KIND_LABELS[tool] }}</span>
          </button>
        </div>
      </section>

      <section class="operations">
        <h2 class="card-title">Операции <span class="operations__count numeric">{{ operations.length }}</span></h2>
        <ol v-if="operations.length > 0" class="operations__list" data-testid="operations-list">
          <li
            v-for="operation in operations"
            :key="operation.id"
            class="operations__item"
            :class="{
              'operations__item--selected': operation.id === designer.selectedOperationId.value,
              'operations__item--issue': operationsWithIssues.has(operation.id),
            }"
            data-testid="operation-item"
            @click="designer.selectedOperationId.value = operation.id"
          >
            <component :is="OPERATION_ICONS[operation.kind]" :size="16" class="operations__icon" />
            <span class="operations__text">
              <span class="operations__name">{{ OPERATION_KIND_LABELS[operation.kind] }}</span>
              <span class="operations__summary numeric">{{ summarizeOperation(operation) }}</span>
            </span>
            <span class="operations__order">
              <button type="button" title="Вырезать раньше" @click.stop="designer.reorderOperation(operation.id, -1)">
                <ChevronUp :size="14" />
              </button>
              <button type="button" title="Вырезать позже" @click.stop="designer.reorderOperation(operation.id, 1)">
                <ChevronDown :size="14" />
              </button>
            </span>
          </li>
        </ol>
        <div v-else class="operations__empty">
          <p>Выберите фигуру выше и нарисуйте её на листе: нажмите и потяните по листу.</p>
          <UiButton data-testid="add-example" @click="designer.addExample()">
            <Sparkles :size="16" /> Добавить пример
          </UiButton>
        </div>
      </section>
    </aside>

    <div class="designer__center">
      <div class="card designer__toolbar">
        <SegmentedControl v-model="designer.view.value" :options="VIEW_OPTIONS" data-testid="designer-view" />
        <select
          v-if="designer.view.value === DesignerView.Drawing"
          v-model="designer.snapStepMm.value"
          class="designer__snap"
          aria-label="Привязка к сетке"
          data-testid="snap-select"
        >
          <option v-for="option in SNAP_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
        <div class="designer__spacer" />
        <UiButton :variant="ButtonVariant.Ghost" icon-only title="Отменить (Ctrl+Z)" :disabled="!designer.canUndo.value" data-testid="undo" @click="designer.undo()">
          <Undo2 :size="18" />
        </UiButton>
        <UiButton :variant="ButtonVariant.Ghost" icon-only title="Повторить (Ctrl+Y)" :disabled="!designer.canRedo.value" data-testid="redo" @click="designer.redo()">
          <Redo2 :size="18" />
        </UiButton>
        <UiButton
          v-if="designer.view.value === DesignerView.Drawing"
          :variant="ButtonVariant.Ghost"
          icon-only
          title="Показать весь стол"
          @click="canvas?.fitToView()"
        >
          <Maximize :size="16" />
        </UiButton>
      </div>

      <DesignCanvas
        v-if="designer.view.value === DesignerView.Drawing"
        ref="canvas"
        :surface="surface"
        :operations="operations"
        :issues="designer.issues.value"
        :selected-operation-id="designer.selectedOperationId.value"
        :active-tool="designer.activeTool.value"
        :snap-step-mm="designer.snapStepMm.value"
        @select-operation="designer.selectedOperationId.value = $event"
        @draw-operation="(kind, start, end) => designer.drawOperation(kind, start, end)"
        @update-operation="designer.updateOperation($event)"
      />
      <ViewportStage
        v-else
        :toolpath="designer.toolpath.value"
        :relief="designer.relief.value"
        :framed-bounds="designer.sheetBounds.value"
        :frame-key="surface"
      />
    </div>

    <aside class="card designer__side">
      <OperationProperties v-if="designer.selectedOperation.value" :operation="designer.selectedOperation.value" />
      <div v-else class="surface-summary">
        <h2 class="card-title">Рабочая поверхность</h2>
        <dl class="surface-summary__rows numeric">
          <div><dt>Лист</dt><dd>{{ formatCoordinate(surface.sheetWidthMm) }} × {{ formatCoordinate(surface.sheetDepthMm) }} × {{ formatCoordinate(surface.sheetThicknessMm) }} мм</dd></div>
          <div><dt>Фреза</dt><dd>Ø {{ formatCoordinate(surface.toolDiameterMm) }} мм</dd></div>
          <div><dt>Проход</dt><dd>до {{ formatCoordinate(surface.depthPerPassMm) }} мм</dd></div>
        </dl>
        <UiButton data-testid="edit-surface" @click="activeSection = AppSection.WorkSurface">Изменить</UiButton>
        <p class="surface-summary__hint">Нажмите на фигуру, чтобы изменить размеры. Масштаб меняется колесом мыши или двумя пальцами, а перетаскивание пустого места двигает чертёж.</p>
      </div>

      <div class="designer__output">
        <ul v-if="surfaceIssues.length > 0" class="designer__issues" data-testid="surface-issues">
          <li v-for="issue in surfaceIssues" :key="issue.code">{{ DESIGN_ISSUE_MESSAGES[issue.code] }}</li>
        </ul>
        <p v-if="designer.issues.value.length > 0" class="designer__blocked" data-testid="design-blocked">
          Есть проблемы: {{ designer.issues.value.length }}. Их нужно исправить перед запуском.
        </p>
        <UiButton :disabled="!canSend" data-testid="save-design-gcode" @click="designer.saveGCode()">
          <Save :size="16" /> Сохранить G-код
        </UiButton>
        <UiButton :variant="ButtonVariant.Primary" :disabled="!canSend" data-testid="send-to-machine" @click="designer.sendToMachine()">
          <Send :size="16" /> На станок
        </UiButton>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.designer {
  display: grid;
  flex: 1;
  grid-template-columns: 264px minmax(0, 1fr) 296px;
  gap: 12px;
  min-height: 0;
  padding: 12px;
}

@media (max-width: 1360px) {
  .designer {
    grid-template-columns: 232px minmax(0, 1fr) 240px;
  }

}

.designer__tools {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.tools {
  padding: 16px 12px 12px;
}

.tools .card-title {
  padding: 0 4px;
}

/* One tool per row: names like «Контур прямоугольника» never break inside a word. */
.tools__grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}

.tools__item {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 40px;
  padding: 8px 12px;
  border: 0;
  border-radius: var(--radius-medium);
  background: var(--color-surface-muted);
  font-size: 12.5px;
  font-weight: 550;
  line-height: 1.25;
  text-align: left;
  transition: background-color 120ms ease;
}

.tools__item:hover {
  background: var(--color-surface-hover);
}

.tools__item--active,
.tools__item--active:hover {
  background: var(--color-accent);
}

/* Low screens keep room for the list of operations below the tools. */
@media (max-height: 700px) {
  .tools {
    padding: 12px 10px 8px;
  }

  .tools__grid {
    gap: 2px;
    margin-top: 6px;
  }

  .tools__item {
    min-height: 32px;
    padding: 6px 10px;
  }
}

.operations {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 12px;
  border-top: 1px solid var(--color-border);
}

.operations .card-title {
  padding: 0 4px;
}

.operations__count {
  color: var(--color-text-tertiary);
  font-weight: 550;
}

.operations__list {
  flex: 1;
  min-height: 0;
  margin: 8px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.operations__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: var(--radius-small);
  cursor: pointer;
}

.operations__item:hover {
  background: var(--color-surface-muted);
}

.operations__item--selected,
.operations__item--selected:hover {
  background: #fff6c8;
}

.operations__item--issue .operations__icon,
.operations__item--issue .operations__summary {
  color: var(--color-danger);
}

.operations__icon {
  flex-shrink: 0;
}

.operations__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.operations__name,
.operations__summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operations__name {
  font-size: 13px;
  font-weight: 600;
}

.operations__summary {
  color: var(--color-text-secondary);
  font-size: 11.5px;
}

.operations__order {
  display: flex;
  flex-direction: column;
}

.operations__order button {
  display: flex;
  padding: 1px 3px;
  border: 0;
  border-radius: 4px;
  background: transparent;
}

.operations__order button:hover {
  background: var(--color-surface-hover);
}

.operations__empty {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 4px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.operations__empty p {
  margin: 0;
}

.designer__center {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}

.designer__toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: var(--radius-medium);
}

.designer__snap {
  height: 38px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
  font-weight: 550;
}

.designer__spacer {
  flex: 1;
}

.designer__side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.designer__side > :first-child {
  flex: 1;
}

.surface-summary {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
}

.surface-summary__rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}

.surface-summary__rows div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.surface-summary__rows dt {
  color: var(--color-text-secondary);
}

.surface-summary__rows dd {
  margin: 0;
  font-weight: 600;
  text-align: right;
}

.surface-summary__hint {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.designer__output {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--color-border);
}

.designer__issues {
  margin: 0;
  padding: 0;
  color: var(--color-danger);
  font-size: 13px;
  list-style: none;
}

.designer__blocked {
  margin: 0;
  color: var(--color-danger);
  font-size: 13px;
  font-weight: 550;
}
</style>
