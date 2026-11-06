<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight } from '@lucide/vue';
import {
  CUTTING_TOOL_PRESETS,
  LengthUnit,
  MILLIMETERS_PER_LENGTH_UNIT,
  StockMaterial,
  ZeroOrigin,
  findCuttingToolPreset,
  findDesignIssues,
  recommendCuttingParameters,
  type WorkSurface,
} from '@rezets/core';
import { useAppContext } from '@ui/presentation/appContext';
import {
  DESIGN_ISSUE_MESSAGES,
  LENGTH_UNIT_LABELS,
  STOCK_MATERIAL_LABELS,
  ZERO_ORIGIN_LABELS,
  describeToolPreset,
} from '@ui/presentation/designMessages';
import { AppSection } from '@ui/presentation/navigation';
import DesignCanvas from '@ui/presentation/components/design/DesignCanvas.vue';
import NumberField from '@ui/presentation/components/ui/NumberField.vue';
import SegmentedControl from '@ui/presentation/components/ui/SegmentedControl.vue';
import SelectField from '@ui/presentation/components/ui/SelectField.vue';
import UiButton from '@ui/presentation/components/ui/UiButton.vue';
import { ButtonVariant } from '@ui/presentation/components/ui/buttonVariant';

const { designer, activeSection } = useAppContext();

const UNIT_OPTIONS = Object.values(LengthUnit).map((unit) => ({ value: unit, label: LENGTH_UNIT_LABELS[unit] }));
const MATERIAL_OPTIONS: readonly { value: StockMaterial | null; label: string }[] = [
  { value: null, label: 'Не выбран' },
  ...Object.values(StockMaterial).map((material) => ({ value: material, label: STOCK_MATERIAL_LABELS[material] })),
];
const TOOL_OPTIONS: readonly { value: string | null; label: string }[] = [
  { value: null, label: 'Своя фреза' },
  ...CUTTING_TOOL_PRESETS.map((preset) => ({ value: preset.id, label: describeToolPreset(preset) })),
];

/** Numeric fields of the surface whose value must stay above zero. */
type PositiveSurfaceField =
  | 'tableWidthMm'
  | 'tableDepthMm'
  | 'sheetWidthMm'
  | 'sheetDepthMm'
  | 'sheetThicknessMm'
  | 'toolDiameterMm'
  | 'safeHeightMm'
  | 'feedRate'
  | 'plungeFeedRate'
  | 'depthPerPassMm'
  | 'spindleSpeedRpm';

const surface = computed(() => designer.project.value.surface);
const unitLabel = computed(() => LENGTH_UNIT_LABELS[surface.value.displayUnit]);
const millimetersPerUnit = computed(() => MILLIMETERS_PER_LENGTH_UNIT[surface.value.displayUnit]);

const toDisplayLength = (millimeters: number): number => millimeters / millimetersPerUnit.value;

const surfaceIssues = computed(() =>
  findDesignIssues({ ...designer.project.value, operations: [] }).map((issue) => DESIGN_ISSUE_MESSAGES[issue.code]),
);

function update(change: Partial<WorkSurface>): void {
  designer.updateSurface({ ...surface.value, ...change });
}

/** Applies a change, and fills in cutting parameters when both the material and a library cutter are known. */
function updateWithRecommendation(change: Partial<WorkSurface>): void {
  const next = { ...surface.value, ...change };
  const tool = findCuttingToolPreset(next.toolPresetId);
  if (tool && next.material) {
    designer.updateSurface({ ...next, ...recommendCuttingParameters(tool, next.material, next.spindleSpeedRpm) });
  } else {
    designer.updateSurface(next);
  }
}

function chooseTool(toolPresetId: string | null): void {
  const tool = findCuttingToolPreset(toolPresetId);
  updateWithRecommendation(tool ? { toolPresetId, toolDiameterMm: tool.diameterMm } : { toolPresetId });
}

const isRecommended = computed(() => surface.value.material !== null && surface.value.toolPresetId !== null);

/** A field left at zero would make the design meaningless, so such input is simply not applied. */
function setPositive(field: PositiveSurfaceField, value: number): void {
  if (value <= 0) return;
  if (field === 'toolDiameterMm') update({ toolDiameterMm: value, toolPresetId: null });
  else if (field === 'spindleSpeedRpm') updateWithRecommendation({ spindleSpeedRpm: value });
  else update({ [field]: value });
}

const setPositiveLength = (field: PositiveSurfaceField, value: number): void =>
  setPositive(field, value * millimetersPerUnit.value);

function setSheetOffset(field: 'sheetOffsetXMm' | 'sheetOffsetYMm', value: number): void {
  if (value >= 0) update({ [field]: value * millimetersPerUnit.value });
}

/** Positions of the zero choices on the miniature sheet, as CSS percentages. */
const ZERO_CHOICES: readonly { readonly origin: ZeroOrigin; readonly left: string; readonly top: string }[] = [
  { origin: ZeroOrigin.SheetUpperLeft, left: '0%', top: '0%' },
  { origin: ZeroOrigin.SheetUpperRight, left: '100%', top: '0%' },
  { origin: ZeroOrigin.SheetCenter, left: '50%', top: '50%' },
  { origin: ZeroOrigin.SheetLowerLeft, left: '0%', top: '100%' },
  { origin: ZeroOrigin.SheetLowerRight, left: '100%', top: '100%' },
];
</script>

<template>
  <div class="surface">
    <section class="card surface__form">
      <div class="group">
        <div class="group__header">
          <h2 class="card-title">Единицы</h2>
          <SegmentedControl
            :model-value="surface.displayUnit"
            :options="UNIT_OPTIONS"
            data-testid="surface-unit"
            @update:model-value="update({ displayUnit: $event })"
          />
        </div>
      </div>

      <div class="group">
        <h2 class="card-title">Стол станка</h2>
        <div class="group__fields">
          <NumberField :model-value="toDisplayLength(surface.tableWidthMm)" label="Ширина" :suffix="unitLabel" data-testid="table-width" @update:model-value="setPositiveLength('tableWidthMm', $event)" />
          <NumberField :model-value="toDisplayLength(surface.tableDepthMm)" label="Глубина" :suffix="unitLabel" data-testid="table-depth" @update:model-value="setPositiveLength('tableDepthMm', $event)" />
        </div>
      </div>

      <div class="group">
        <h2 class="card-title">Лист на столе</h2>
        <div class="group__fields">
          <NumberField :model-value="toDisplayLength(surface.sheetWidthMm)" label="Ширина" :suffix="unitLabel" data-testid="sheet-width" @update:model-value="setPositiveLength('sheetWidthMm', $event)" />
          <NumberField :model-value="toDisplayLength(surface.sheetDepthMm)" label="Глубина" :suffix="unitLabel" data-testid="sheet-depth" @update:model-value="setPositiveLength('sheetDepthMm', $event)" />
          <NumberField :model-value="surface.sheetThicknessMm" label="Толщина" suffix="мм" data-testid="sheet-thickness" @update:model-value="setPositive('sheetThicknessMm', $event)" />
          <span />
          <NumberField :model-value="toDisplayLength(surface.sheetOffsetXMm)" label="Отступ от левого края стола" :suffix="unitLabel" @update:model-value="setSheetOffset('sheetOffsetXMm', $event)" />
          <NumberField :model-value="toDisplayLength(surface.sheetOffsetYMm)" label="Отступ от переднего края стола" :suffix="unitLabel" @update:model-value="setSheetOffset('sheetOffsetYMm', $event)" />
        </div>
      </div>

      <div class="group">
        <h2 class="card-title">Нулевая позиция фрезы</h2>
        <div class="zero">
          <div class="zero__sheet">
            <button
              v-for="choice in ZERO_CHOICES"
              :key="choice.origin"
              type="button"
              class="zero__point"
              :class="{ 'zero__point--active': surface.zeroOrigin === choice.origin }"
              :style="{ left: choice.left, top: choice.top }"
              :title="ZERO_ORIGIN_LABELS[choice.origin]"
              :data-testid="`zero-${choice.origin}`"
              @click="update({ zeroOrigin: choice.origin })"
            />
          </div>
          <p class="zero__caption">
            <strong>{{ ZERO_ORIGIN_LABELS[surface.zeroOrigin] }}</strong><br />
            Сюда оператор выставляет фрезу перед запуском, касаясь верха листа.
          </p>
        </div>
      </div>

      <div class="group">
        <h2 class="card-title">Фреза и режимы</h2>
        <div class="group__fields">
          <SelectField class="group__wide" :model-value="surface.material" :options="MATERIAL_OPTIONS" label="Материал" data-testid="stock-material" @update:model-value="updateWithRecommendation({ material: $event })" />
          <SelectField class="group__wide" :model-value="surface.toolPresetId" :options="TOOL_OPTIONS" label="Фреза" data-testid="tool-preset" @update:model-value="chooseTool" />
          <NumberField :model-value="surface.toolDiameterMm" label="Диаметр фрезы" suffix="мм" data-testid="tool-diameter" @update:model-value="setPositive('toolDiameterMm', $event)" />
          <NumberField :model-value="surface.depthPerPassMm" label="Глубина за проход" suffix="мм" @update:model-value="setPositive('depthPerPassMm', $event)" />
          <NumberField :model-value="surface.feedRate" label="Скорость резания" suffix="мм/мин" @update:model-value="setPositive('feedRate', $event)" />
          <NumberField :model-value="surface.plungeFeedRate" label="Скорость врезания" suffix="мм/мин" @update:model-value="setPositive('plungeFeedRate', $event)" />
          <NumberField :model-value="surface.safeHeightMm" label="Безопасная высота" suffix="мм" @update:model-value="setPositive('safeHeightMm', $event)" />
          <NumberField :model-value="surface.spindleSpeedRpm" label="Обороты шпинделя" suffix="об/мин" @update:model-value="setPositive('spindleSpeedRpm', $event)" />
        </div>
        <p class="group__hint" data-testid="cutting-hint">
          {{
            isRecommended
              ? 'Режимы подобраны под материал, фрезу и обороты. Их можно поправить вручную.'
              : 'Выберите материал и фрезу, и скорости с глубиной прохода подберутся сами.'
          }}
        </p>
      </div>

      <ul v-if="surfaceIssues.length > 0" class="surface__issues" data-testid="surface-form-issues">
        <li v-for="issue in surfaceIssues" :key="issue">{{ issue }}</li>
      </ul>

      <UiButton :variant="ButtonVariant.Primary" class="surface__next" data-testid="go-to-designer" @click="activeSection = AppSection.Designer">
        Перейти в конструктор <ArrowRight :size="18" />
      </UiButton>
    </section>

    <DesignCanvas :surface="surface" :operations="designer.project.value.operations" is-read-only />
  </div>
</template>

<style scoped>
.surface {
  display: grid;
  flex: 1;
  grid-template-columns: 440px minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  padding: 12px;
}

@media (max-width: 1360px) {
  .surface {
    grid-template-columns: 380px minmax(0, 1fr);
  }
}

.surface__form {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
  padding: 20px;
  overflow-y: auto;
}

.group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.group__fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  align-items: end;
  margin-top: 12px;
}

.group__wide {
  grid-column: 1 / -1;
}

.group__hint {
  margin: 10px 0 0;
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.zero {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-top: 16px;
  padding: 0 10px;
}

.zero__sheet {
  position: relative;
  flex-shrink: 0;
  width: 110px;
  height: 70px;
  border: 1.5px solid #9aa0ab;
  border-radius: 2px;
  background: var(--color-surface-muted);
}

.zero__point {
  position: absolute;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 2px solid #9aa0ab;
  border-radius: 50%;
  background: #fff;
  transform: translate(-50%, -50%);
}

.zero__point:hover {
  border-color: var(--color-text);
}

.zero__point--active {
  border-color: var(--color-text);
  background: var(--color-accent);
}

.zero__caption {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.zero__caption strong {
  color: var(--color-text);
}

.surface__issues {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-small);
  background: var(--color-danger-soft);
  color: var(--color-danger);
  list-style: none;
}

.surface__next {
  position: sticky;
  bottom: 0;
  z-index: 1;
  flex-shrink: 0;
  height: 48px;
  box-shadow: 0 -8px 16px 4px var(--color-surface);
}
</style>
