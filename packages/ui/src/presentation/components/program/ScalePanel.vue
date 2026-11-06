<script setup lang="ts">
import { computed } from 'vue';
import { Link, RotateCcw, Save, Unlink } from '@lucide/vue';
import { ALL_AXES, MAX_SCALE_FACTOR, MIN_SCALE_FACTOR, type Axis } from '@rezets/core';
import { AXIS_LABELS } from '@ui/presentation/messages';
import { useAppContext } from '@ui/presentation/appContext';
import NumberField from '@ui/presentation/components/ui/NumberField.vue';
import UiButton from '@ui/presentation/components/ui/UiButton.vue';
import { ButtonVariant } from '@ui/presentation/components/ui/buttonVariant';

const { workspace, machine } = useAppContext();

const PERCENT = 100;
/** The slider covers ×0.1…×10 on a log scale; the fields accept the full allowed range. */
const SLIDER_MIN_LOG = -1;
const SLIDER_MAX_LOG = 1;
const SLIDER_STEP_LOG = 0.005;
const SIZE_DECIMALS = 3;

const scaleRange = `${MIN_SCALE_FACTOR * PERCENT}…${MAX_SCALE_FACTOR * PERCENT}%`;

const axisRows = computed(() =>
  ALL_AXES.map((axis) => {
    const size = workspace.partSize.value?.[axis] ?? 0;
    const factor = workspace.scale.value[axis];
    return {
      axis,
      label: AXIS_LABELS[axis],
      sizeMm: Number(size.toFixed(SIZE_DECIMALS)),
      percent: Number((factor * PERCENT).toFixed(1)),
      sliderValue: Math.log10(factor),
      canStretch: size > 0,
    };
  }),
);

const canEdit = computed(() => !machine.isProgramActive.value);

function handleSliderInput(axis: Axis, event: Event): void {
  workspace.setAxisFactor(axis, 10 ** Number((event.target as HTMLInputElement).value));
}
</script>

<template>
  <div class="scale-panel">
    <div class="scale-panel__header">
      <div>
        <h3 class="scale-panel__title">Размеры фигуры</h3>
        <p class="scale-panel__subtitle">Растяжение попадёт и в 3D, и в G-код для станка</p>
      </div>
      <UiButton
        :variant="workspace.keepProportions.value ? ButtonVariant.Primary : ButtonVariant.Secondary"
        icon-only
        :title="workspace.keepProportions.value ? 'Пропорции сохраняются' : 'Оси меняются независимо'"
        data-testid="keep-proportions"
        @click="workspace.keepProportions.value = !workspace.keepProportions.value"
      >
        <Link v-if="workspace.keepProportions.value" :size="18" />
        <Unlink v-else :size="18" />
      </UiButton>
    </div>

    <div v-for="row in axisRows" :key="row.axis" class="axis-row">
      <div class="axis-row__fields">
        <span class="axis-row__label" :class="`axis-row__label--${row.axis}`">{{ row.label }}</span>
        <NumberField
          :model-value="row.sizeMm"
          suffix="мм"
          :disabled="!row.canStretch || !canEdit"
          :data-testid="`size-${row.axis}`"
          @update:model-value="workspace.setAxisSize(row.axis, $event)"
        />
        <NumberField
          :model-value="row.percent"
          suffix="%"
          :disabled="!row.canStretch || !canEdit"
          :data-testid="`percent-${row.axis}`"
          @update:model-value="workspace.setAxisFactor(row.axis, $event / PERCENT)"
        />
      </div>
      <input
        class="axis-row__slider"
        type="range"
        :min="SLIDER_MIN_LOG"
        :max="SLIDER_MAX_LOG"
        :step="SLIDER_STEP_LOG"
        :value="row.sliderValue"
        :disabled="!row.canStretch || !canEdit"
        :aria-label="`Растяжение по оси ${row.label}`"
        @input="handleSliderInput(row.axis, $event)"
      />
    </div>

    <p v-if="!workspace.isScaleUniformInAllAxes.value" class="scale-panel__note">
      Оси растянуты по-разному: окружности станут эллипсами, а при экспорте дуги заменятся короткими отрезками G1.
    </p>
    <p class="scale-panel__limits">Допустимый масштаб: {{ scaleRange }}. Точка привязки: ноль программы.</p>

    <div class="scale-panel__actions">
      <UiButton :disabled="!workspace.isScaled.value" data-testid="scale-reset" @click="workspace.resetScale()">
        <RotateCcw :size="16" /> Сбросить
      </UiButton>
      <UiButton :variant="ButtonVariant.Primary" @click="workspace.saveToDevice()">
        <Save :size="16" /> Сохранить G-код
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.scale-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  overflow-y: auto;
}

.scale-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.scale-panel__title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
}

.scale-panel__subtitle {
  margin: 2px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.axis-row__fields {
  display: grid;
  grid-template-columns: 18px 1fr 92px;
  align-items: center;
  gap: 8px;
}

.axis-row__label {
  font-weight: 700;
}

.axis-row__label--x {
  color: #e5484d;
}

.axis-row__label--y {
  color: #30a46c;
}

.axis-row__label--z {
  color: #3e63dd;
}

.axis-row__slider {
  width: calc(100% - 26px);
  margin: 8px 0 0 26px;
  accent-color: var(--color-text);
}

.scale-panel__note {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-small);
  background: var(--color-warning-soft);
  color: var(--color-warning);
  font-size: 13px;
}

.scale-panel__limits {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.scale-panel__actions {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px;
}
</style>
