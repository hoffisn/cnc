<script setup lang="ts">
import { ref, watch } from 'vue';
import { formatCoordinate } from '@rezets/core';

const props = withDefaults(
  defineProps<{
    modelValue: number;
    label?: string;
    suffix?: string;
    disabled?: boolean;
    /** Validation message shown under the field. */
    error?: string;
  }>(),
  { label: '', suffix: '', disabled: false, error: '' },
);

const emit = defineEmits<{ 'update:modelValue': [value: number] }>();

const inputText = ref(formatCoordinate(props.modelValue));
const isEditing = ref(false);

/** An outside change must not overwrite what the operator is typing right now. */
watch(
  () => props.modelValue,
  (value) => {
    if (!isEditing.value) inputText.value = formatCoordinate(value);
  },
);

/** Applies the typed value; both decimal separators are accepted, as Russian keyboards produce a comma. */
function commit(): void {
  isEditing.value = false;
  const parsedValue = Number(inputText.value.trim().replace(',', '.'));
  if (inputText.value.trim() !== '' && Number.isFinite(parsedValue)) emit('update:modelValue', parsedValue);
  inputText.value = formatCoordinate(props.modelValue);
}
</script>

<template>
  <label class="number-field" :class="{ 'number-field--invalid': error }">
    <span v-if="label" class="number-field__label">{{ label }}</span>
    <span class="number-field__box">
      <input
        v-model="inputText"
        class="number-field__input numeric"
        type="text"
        inputmode="decimal"
        :disabled="disabled"
        @focus="isEditing = true"
        @blur="commit"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <span v-if="suffix" class="number-field__suffix">{{ suffix }}</span>
    </span>
    <span v-if="error" class="number-field__error">{{ error }}</span>
  </label>
</template>

<style scoped>
.number-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.number-field__label {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.number-field__box {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 12px;
  border: 1.5px solid transparent;
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
  transition: border-color 120ms ease, background-color 120ms ease;
}

.number-field__box:focus-within {
  border-color: var(--color-text);
  background: var(--color-surface);
}

.number-field--invalid .number-field__box {
  border-color: var(--color-danger);
}

.number-field__input {
  flex: 1;
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-weight: 550;
  user-select: text;
}

.number-field__input:disabled {
  color: var(--color-text-tertiary);
}

.number-field__suffix {
  margin-left: 6px;
  color: var(--color-text-tertiary);
}

.number-field__error {
  color: var(--color-danger);
  font-size: 12px;
}
</style>
