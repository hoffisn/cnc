<script setup lang="ts" generic="TValue extends string | number | null">
import { ChevronDown } from '@lucide/vue';

const props = defineProps<{
  modelValue: TValue;
  options: readonly { readonly value: TValue; readonly label: string }[];
  label?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: TValue] }>();

/** Native options carry strings, so the chosen one is found back by its position. */
function handleChange(event: Event): void {
  const option = props.options[(event.target as HTMLSelectElement).selectedIndex];
  if (option) emit('update:modelValue', option.value);
}
</script>

<template>
  <label class="select-field">
    <span v-if="label" class="select-field__label">{{ label }}</span>
    <span class="select-field__box">
      <select class="select-field__select" @change="handleChange">
        <option v-for="option in options" :key="String(option.value)" :selected="option.value === modelValue">
          {{ option.label }}
        </option>
      </select>
      <ChevronDown :size="16" class="select-field__chevron" />
    </span>
  </label>
</template>

<style scoped>
.select-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.select-field__label {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.select-field__box {
  position: relative;
  display: flex;
  align-items: center;
}

.select-field__select {
  width: 100%;
  min-width: 0;
  height: 40px;
  padding: 0 32px 0 12px;
  overflow: hidden;
  border: 1.5px solid transparent;
  border-radius: var(--radius-small);
  outline: 0;
  background: var(--color-surface-muted);
  color: var(--color-text);
  font-weight: 550;
  text-overflow: ellipsis;
  appearance: none;
}

.select-field__select:focus {
  border-color: var(--color-text);
  background: var(--color-surface);
}

.select-field__chevron {
  position: absolute;
  right: 10px;
  color: var(--color-text-tertiary);
  pointer-events: none;
}
</style>
