<script setup lang="ts" generic="TValue extends string | number">
defineProps<{
  modelValue: TValue;
  options: readonly { readonly value: TValue; readonly label: string }[];
  disabled?: boolean;
}>();

defineEmits<{ 'update:modelValue': [value: TValue] }>();
</script>

<template>
  <div class="segmented" role="radiogroup">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      class="segmented__option"
      :class="{ 'segmented__option--active': option.value === modelValue }"
      :aria-checked="option.value === modelValue"
      :disabled="disabled"
      @click="$emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
}

.segmented__option {
  flex: 1;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-secondary);
  font-weight: 550;
  white-space: nowrap;
  transition: background-color 120ms ease, color 120ms ease;
}

.segmented__option:hover:not(:disabled) {
  color: var(--color-text);
}

.segmented__option--active {
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: 0 1px 3px rgb(28 28 30 / 14%);
}

.segmented__option:disabled {
  opacity: 0.5;
}
</style>
