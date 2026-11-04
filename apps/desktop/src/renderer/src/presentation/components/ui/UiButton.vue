<script setup lang="ts">
import { ButtonVariant } from './buttonVariant';

withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    disabled?: boolean;
    /** Square button holding only an icon; `title` must then describe it. */
    iconOnly?: boolean;
  }>(),
  { variant: ButtonVariant.Secondary, disabled: false, iconOnly: false },
);
</script>

<template>
  <button
    type="button"
    class="ui-button"
    :class="[`ui-button--${variant}`, { 'ui-button--icon-only': iconOnly }]"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped>
.ui-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--radius-small);
  font-weight: 550;
  white-space: nowrap;
  transition: background-color 120ms ease, transform 80ms ease;
}

.ui-button:active:not(:disabled) {
  transform: scale(0.98);
}

.ui-button:disabled {
  opacity: 0.45;
}

.ui-button--icon-only {
  width: 40px;
  padding: 0;
}

.ui-button--primary {
  background: var(--color-accent);
  color: var(--color-accent-text);
}

.ui-button--primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.ui-button--secondary {
  background: var(--color-surface-muted);
}

.ui-button--secondary:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.ui-button--ghost {
  background: transparent;
}

.ui-button--ghost:hover:not(:disabled) {
  background: var(--color-surface-muted);
}

.ui-button--danger {
  background: var(--color-danger);
  color: #fff;
}

.ui-button--danger:hover:not(:disabled) {
  background: var(--color-danger-hover);
}
</style>
