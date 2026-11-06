<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { X } from '@lucide/vue';
import UiButton from './UiButton.vue';
import { ButtonVariant } from './buttonVariant';

defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();

const dialogElement = ref<HTMLDialogElement | null>(null);

/** The native dialog brings focus trapping and the Escape key for free. */
onMounted(() => dialogElement.value?.showModal());
</script>

<template>
  <dialog ref="dialogElement" class="modal" @cancel.prevent="emit('close')">
    <header class="modal__header">
      <h2 class="modal__title">{{ title }}</h2>
      <UiButton :variant="ButtonVariant.Ghost" icon-only title="Закрыть" @click="emit('close')">
        <X :size="20" />
      </UiButton>
    </header>
    <div class="modal__body">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="modal__footer">
      <slot name="footer" />
    </footer>
  </dialog>
</template>

<style scoped>
.modal {
  width: 480px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
  padding: 0;
  border: 0;
  border-radius: var(--radius-large);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-dialog);
}

.modal[open] {
  display: flex;
  flex-direction: column;
}

.modal::backdrop {
  background: rgb(28 28 30 / 45%);
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 16px 8px 24px;
}

.modal__title {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.015em;
}

.modal__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 24px 24px;
  overflow-y: auto;
}

.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 24px 24px;
}
</style>
