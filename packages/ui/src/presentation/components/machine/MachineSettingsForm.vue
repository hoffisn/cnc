<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { ALL_AXES, type Axis, type MachineSettings } from '@rezets/core';
import { useAppContext } from '@ui/presentation/appContext';
import { AXIS_LABELS } from '@ui/presentation/messages';
import { NotificationTone } from '@ui/presentation/notificationCenter';
import NumberField from '@ui/presentation/components/ui/NumberField.vue';
import UiButton from '@ui/presentation/components/ui/UiButton.vue';
import { ButtonVariant } from '@ui/presentation/components/ui/buttonVariant';

const { settings, settingsService, notifications } = useAppContext();

const createDraft = (machine: MachineSettings) => ({
  stepSizeMm: machine.stepSizeMm,
  rapidFeedRate: machine.rapidFeedRate,
  defaultFeedRate: machine.defaultFeedRate,
  toolDiameter: machine.toolDiameter,
  limits: {
    x: { ...machine.travelLimits.x },
    y: { ...machine.travelLimits.y },
    z: { ...machine.travelLimits.z },
  },
});

const draft = reactive(createDraft(settings.value.machine));

watch(
  () => settings.value.machine,
  (machine) => Object.assign(draft, createDraft(machine)),
);

const POSITIVE_ERROR = 'Должно быть больше нуля';
const positiveError = (value: number): string => (value > 0 ? '' : POSITIVE_ERROR);
const limitError = (axis: Axis): string =>
  draft.limits[axis].min < draft.limits[axis].max ? '' : 'Минимум должен быть меньше максимума';

const isValid = computed(
  () =>
    draft.stepSizeMm > 0 &&
    draft.rapidFeedRate > 0 &&
    draft.defaultFeedRate > 0 &&
    draft.toolDiameter > 0 &&
    ALL_AXES.every((axis) => limitError(axis) === ''),
);

function save(): void {
  settingsService.updateMachineSettings({
    stepSizeMm: draft.stepSizeMm,
    rapidFeedRate: draft.rapidFeedRate,
    defaultFeedRate: draft.defaultFeedRate,
    toolDiameter: draft.toolDiameter,
    travelLimits: {
      x: { ...draft.limits.x },
      y: { ...draft.limits.y },
      z: { ...draft.limits.z },
    },
  });
  notifications.show(NotificationTone.Success, 'Настройки станка сохранены');
}
</script>

<template>
  <section class="card form">
    <h2 class="card-title">Параметры станка</h2>

    <div class="form__grid">
      <NumberField v-model="draft.stepSizeMm" label="Размер шага" suffix="мм" :error="positiveError(draft.stepSizeMm)" />
      <NumberField v-model="draft.toolDiameter" label="Фреза для 3D по G-коду" suffix="мм" :error="positiveError(draft.toolDiameter)" />
      <NumberField v-model="draft.rapidFeedRate" label="Ускоренный ход" suffix="мм/мин" :error="positiveError(draft.rapidFeedRate)" />
      <NumberField v-model="draft.defaultFeedRate" label="Подача по умолчанию" suffix="мм/мин" :error="positiveError(draft.defaultFeedRate)" />
    </div>

    <h3 class="form__subtitle">Пределы перемещений</h3>
    <div v-for="axis in ALL_AXES" :key="axis" class="form__limit">
      <span class="form__axis">{{ AXIS_LABELS[axis] }}</span>
      <NumberField v-model="draft.limits[axis].min" suffix="мм" />
      <NumberField v-model="draft.limits[axis].max" suffix="мм" />
      <span v-if="limitError(axis)" class="form__limit-error">{{ limitError(axis) }}</span>
    </div>

    <UiButton :variant="ButtonVariant.Primary" :disabled="!isValid" data-testid="machine-settings-save" @click="save">Сохранить</UiButton>
  </section>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
}

.form__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.form__subtitle {
  margin: 4px 0 0;
  font-size: 15px;
  font-weight: 650;
}

.form__limit {
  display: grid;
  grid-template-columns: 20px 1fr 1fr;
  align-items: center;
  gap: 12px;
}

.form__axis {
  font-weight: 700;
}

.form__limit-error {
  grid-column: 2 / -1;
  color: var(--color-danger);
  font-size: 12px;
}
</style>
