<script setup lang="ts">
import { X } from '@lucide/vue';
import { useAppContext } from '@ui/presentation/appContext';

const { notifications } = useAppContext();
const items = notifications.notifications;
</script>

<template>
  <TransitionGroup name="notification" tag="div" class="notification-stack" aria-live="polite">
    <div
      v-for="notification in items"
      :key="notification.id"
      class="notification"
      :class="`notification--${notification.tone}`"
    >
      <span class="notification__message">{{ notification.message }}</span>
      <button type="button" class="notification__close" title="Закрыть" @click="notifications.dismiss(notification.id)">
        <X :size="16" />
      </button>
    </div>
  </TransitionGroup>
</template>

<style scoped>
.notification-stack {
  position: fixed;
  top: 12px;
  left: 50%;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  transform: translateX(-50%);
  pointer-events: none;
}

.notification {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 560px;
  padding: 12px 12px 12px 16px;
  border-radius: var(--radius-medium);
  font-weight: 500;
  box-shadow: var(--shadow-floating);
  pointer-events: auto;
}

.notification--info {
  background: var(--color-text);
  color: #fff;
}

.notification--success {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.notification--warning {
  background: var(--color-warning-soft);
  color: var(--color-warning);
}

.notification--error {
  background: var(--color-danger);
  color: #fff;
}

.notification__close {
  display: flex;
  padding: 2px;
  border: 0;
  background: transparent;
  color: inherit;
  opacity: 0.7;
}

.notification__close:hover {
  opacity: 1;
}

.notification-enter-active,
.notification-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.notification-enter-from,
.notification-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
