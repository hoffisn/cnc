<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Home,
  Pencil,
  Plus,
  RotateCcw,
  Square,
} from '@lucide/vue';
import { Axis, JogDirection, type JogButton } from '@rezets/core';
import { formatJogAxis, formatJogDistance } from '@ui/presentation/messages';
import { useAppContext } from '@ui/presentation/appContext';
import UiButton from '@ui/presentation/components/ui/UiButton.vue';
import { ButtonVariant } from '@ui/presentation/components/ui/buttonVariant';
import JogButtonDialog from './JogButtonDialog.vue';

const { machine, settings, settingsService } = useAppContext();

const buttons = computed(() => settings.value.jogButtons);
const isEditing = ref(false);
const isDialogOpen = ref(false);
const editedButton = ref<JogButton | null>(null);

const DIRECTION_ICONS: Readonly<Record<Axis, Readonly<Record<JogDirection, Component>>>> = {
  [Axis.X]: { [JogDirection.Positive]: ArrowRight, [JogDirection.Negative]: ArrowLeft },
  [Axis.Y]: { [JogDirection.Positive]: ArrowUp, [JogDirection.Negative]: ArrowDown },
  [Axis.Z]: { [JogDirection.Positive]: ChevronsUp, [JogDirection.Negative]: ChevronsDown },
};

function openDialog(button: JogButton | null): void {
  editedButton.value = button;
  isDialogOpen.value = true;
}

function handleTileClick(button: JogButton): void {
  if (isEditing.value) openDialog(button);
  else machine.jog(button);
}

const isTileDisabled = computed(() => !isEditing.value && !machine.isIdle.value);
const canStopMotion = computed(() => !machine.isIdle.value && !machine.isAlarm.value && !machine.isProgramActive.value);
</script>

<template>
  <section class="card jog">
    <header class="jog__header">
      <h2 class="card-title">Перемещение</h2>
      <div class="jog__header-actions">
        <UiButton
          v-if="isEditing"
          :variant="ButtonVariant.Ghost"
          icon-only
          title="Вернуть кнопки по умолчанию"
          @click="settingsService.resetJogButtons()"
        >
          <RotateCcw :size="18" />
        </UiButton>
        <UiButton
          :variant="isEditing ? ButtonVariant.Primary : ButtonVariant.Ghost"
          icon-only
          :title="isEditing ? 'Готово' : 'Настроить кнопки'"
          data-testid="jog-edit-toggle"
          @click="isEditing = !isEditing"
        >
          <Check v-if="isEditing" :size="18" />
          <Pencil v-else :size="18" />
        </UiButton>
      </div>
    </header>

    <div class="jog__grid">
      <div v-for="button in buttons" :key="button.id" class="jog__tile-wrapper">
        <button
          type="button"
          class="jog__tile"
          :class="{ 'jog__tile--editing': isEditing }"
          :disabled="isTileDisabled"
          data-testid="jog-button"
          @click="handleTileClick(button)"
        >
          <component :is="DIRECTION_ICONS[button.axis][button.direction]" :size="20" class="jog__tile-icon" />
          <span class="jog__tile-label">{{ button.label }}</span>
          <span class="jog__tile-amount numeric">{{ formatJogDistance(button) }} · {{ formatJogAxis(button) }}</span>
        </button>
        <div v-if="isEditing" class="jog__reorder">
          <button type="button" title="Переместить раньше" @click="settingsService.moveJogButton(button.id, -1)">
            <ChevronLeft :size="14" />
          </button>
          <button type="button" title="Переместить позже" @click="settingsService.moveJogButton(button.id, 1)">
            <ChevronRight :size="14" />
          </button>
        </div>
      </div>

      <button v-if="isEditing" type="button" class="jog__tile jog__tile--add" data-testid="jog-add" @click="openDialog(null)">
        <Plus :size="20" />
        <span class="jog__tile-label">Новая кнопка</span>
      </button>
    </div>

    <p v-if="buttons.length === 0 && !isEditing" class="jog__empty">Кнопок нет. Нажмите на карандаш, чтобы добавить.</p>

    <footer class="jog__footer">
      <UiButton :disabled="!machine.isIdle.value" @click="machine.goHome()">
        <Home :size="18" /> В ноль
      </UiButton>
      <UiButton :disabled="!canStopMotion" @click="machine.stop()">
        <Square :size="16" /> Стоп
      </UiButton>
    </footer>

    <JogButtonDialog v-if="isDialogOpen" :button="editedButton" @close="isDialogOpen = false" />
  </section>
</template>

<style scoped>
.jog {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 16px;
}

.jog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.jog__header-actions {
  display: flex;
  gap: 4px;
}

.jog__grid {
  display: grid;
  flex: 1;
  grid-template-columns: 1fr 1fr;
  grid-auto-rows: min-content;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
}

.jog__tile-wrapper {
  position: relative;
  min-width: 0;
}

.jog__tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  min-height: 92px;
  padding: 12px;
  border: 0;
  border-radius: var(--radius-medium);
  background: var(--color-surface-muted);
  text-align: left;
  transition: background-color 120ms ease, transform 80ms ease;
}

.jog__tile:hover:not(:disabled) {
  background: var(--color-accent);
}

.jog__tile:active:not(:disabled) {
  transform: scale(0.97);
}

.jog__tile:disabled {
  opacity: 0.45;
}

.jog__tile--editing {
  outline: 1.5px dashed var(--color-text-tertiary);
  outline-offset: -1.5px;
}

.jog__tile--add {
  justify-content: center;
  align-items: center;
  gap: 4px;
  background: transparent;
  outline: 1.5px dashed var(--color-border);
  outline-offset: -1.5px;
  color: var(--color-text-secondary);
}

.jog__tile-icon {
  margin-bottom: 8px;
}

.jog__tile-label {
  max-width: 100%;
  overflow: hidden;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.jog__tile-amount {
  color: var(--color-text-secondary);
  font-size: 12.5px;
  white-space: nowrap;
}

.jog__tile:hover:not(:disabled) .jog__tile-amount {
  color: var(--color-accent-text);
}

.jog__reorder {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 2px;
}

.jog__reorder button {
  display: flex;
  padding: 4px;
  border: 0;
  border-radius: 6px;
  background: var(--color-surface);
}

.jog__reorder button:hover {
  background: var(--color-surface-hover);
}

.jog__empty {
  margin: 8px 0;
  color: var(--color-text-secondary);
}

.jog__footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 12px;
}
</style>
