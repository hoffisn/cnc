<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Axis, JOG_LABEL_MAX_LENGTH, JogDirection, JogUnit, type JogButton, type JogButtonDraft, type JogButtonFieldErrors } from '@rezets/core';
import { AXIS_LABELS, JOG_UNIT_LABELS, describeJogValidationError, formatJogAxis, formatJogDistance } from '@ui/presentation/messages';
import { useAppContext } from '@ui/presentation/appContext';
import ModalDialog from '@ui/presentation/components/ui/ModalDialog.vue';
import NumberField from '@ui/presentation/components/ui/NumberField.vue';
import SegmentedControl from '@ui/presentation/components/ui/SegmentedControl.vue';
import UiButton from '@ui/presentation/components/ui/UiButton.vue';
import { ButtonVariant } from '@ui/presentation/components/ui/buttonVariant';

const props = defineProps<{
  /** Button to edit; `null` creates a new one. */
  button: JogButton | null;
}>();
const emit = defineEmits<{ close: [] }>();

const { settingsService } = useAppContext();

const NEW_BUTTON_DEFAULTS: JogButtonDraft = {
  label: '',
  axis: Axis.Y,
  direction: JogDirection.Positive,
  distance: 1,
  unit: JogUnit.Meter,
  feedRate: 3000,
};

const draft = reactive<JogButtonDraft>({ ...NEW_BUTTON_DEFAULTS, ...props.button });
const fieldErrors = ref<JogButtonFieldErrors>({});

const AXIS_OPTIONS = Object.values(Axis).map((axis) => ({ value: axis, label: AXIS_LABELS[axis] }));
const DIRECTION_OPTIONS = [
  { value: JogDirection.Positive, label: 'Плюс' },
  { value: JogDirection.Negative, label: 'Минус' },
];
const UNIT_OPTIONS = Object.values(JogUnit).map((unit) => ({ value: unit, label: JOG_UNIT_LABELS[unit] }));

const previewText = computed(() => `${formatJogAxis(draft)}, ${formatJogDistance(draft)}`);

function save(): void {
  const result = settingsService.saveJogButton({ ...draft }, props.button?.id ?? null);
  if (result.ok) emit('close');
  else fieldErrors.value = result.error;
}

function remove(): void {
  if (props.button) settingsService.removeJogButton(props.button.id);
  emit('close');
}
</script>

<template>
  <ModalDialog :title="button ? 'Настройка кнопки' : 'Новая кнопка'" @close="emit('close')">
    <label class="field">
      <span class="field__label">Название</span>
      <input
        v-model="draft.label"
        class="field__input"
        :class="{ 'field__input--invalid': fieldErrors.label }"
        :maxlength="JOG_LABEL_MAX_LENGTH"
        placeholder="Например, Вперёд"
        data-testid="jog-label-input"
      />
      <span v-if="fieldErrors.label" class="field__error">{{ describeJogValidationError(fieldErrors.label) }}</span>
    </label>

    <div class="field-row">
      <div class="field">
        <span class="field__label">Ось</span>
        <SegmentedControl v-model="draft.axis" :options="AXIS_OPTIONS" />
      </div>
      <div class="field">
        <span class="field__label">Направление</span>
        <SegmentedControl v-model="draft.direction" :options="DIRECTION_OPTIONS" />
      </div>
    </div>

    <div class="field-row">
      <NumberField
        v-model="draft.distance"
        label="Расстояние"
        :error="describeJogValidationError(fieldErrors.distance)"
      />
      <div class="field">
        <span class="field__label">Единицы</span>
        <SegmentedControl v-model="draft.unit" :options="UNIT_OPTIONS" />
      </div>
    </div>

    <NumberField
      v-model="draft.feedRate"
      label="Скорость"
      suffix="мм/мин"
      :error="describeJogValidationError(fieldErrors.feedRate)"
    />

    <p class="preview">Кнопка переместит на: <strong class="numeric">{{ previewText }}</strong></p>

    <template #footer>
      <UiButton v-if="button" :variant="ButtonVariant.Ghost" class="delete-button" data-testid="jog-delete" @click="remove">
        Удалить
      </UiButton>
      <UiButton @click="emit('close')">Отмена</UiButton>
      <UiButton :variant="ButtonVariant.Primary" data-testid="jog-save" @click="save">Сохранить</UiButton>
    </template>
  </ModalDialog>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  align-items: start;
}

.field__label {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.field__input {
  height: 40px;
  padding: 0 12px;
  border: 1.5px solid transparent;
  border-radius: var(--radius-small);
  outline: 0;
  background: var(--color-surface-muted);
  font-weight: 550;
  user-select: text;
}

.field__input:focus {
  border-color: var(--color-text);
  background: var(--color-surface);
}

.field__input--invalid {
  border-color: var(--color-danger);
}

.field__error {
  color: var(--color-danger);
  font-size: 12px;
}

.preview {
  margin: 0;
  padding: 12px;
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
}

.preview strong {
  color: var(--color-text);
}

.delete-button {
  margin-right: auto;
  color: var(--color-danger);
}
</style>
