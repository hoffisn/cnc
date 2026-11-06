<script setup lang="ts">
import { computed } from 'vue';
import { FileCode2, OctagonX, Plug, ShieldCheck } from '@lucide/vue';
import { MachineStatus } from '@rezets/core';
import { useAppContext } from '@ui/presentation/appContext';
import { MACHINE_STATUS_LABELS } from '@ui/presentation/messages';
import { AppSection } from '@ui/presentation/navigation';
import UiButton from '@ui/presentation/components/ui/UiButton.vue';
import { ButtonVariant } from '@ui/presentation/components/ui/buttonVariant';

const { machine, workspace, activeSection } = useAppContext();

const SECTION_TITLES: Readonly<Record<AppSection, string>> = {
  [AppSection.WorkSurface]: 'Рабочая поверхность',
  [AppSection.Designer]: 'Конструктор',
  [AppSection.Machine]: 'Станок',
  [AppSection.Settings]: 'Настройки',
};

const status = computed(() => machine.state.value.status);
const statusLabel = computed(() => MACHINE_STATUS_LABELS[status.value]);
const isBusy = computed(() => status.value !== MachineStatus.Idle && status.value !== MachineStatus.Alarm);
</script>

<template>
  <header class="header">
    <h1 class="header__title" data-testid="section-title">{{ SECTION_TITLES[activeSection] }}</h1>

    <div v-if="activeSection === AppSection.Machine && workspace.fileName.value" class="header__file">
      <FileCode2 :size="16" />
      <span class="header__file-name" data-testid="program-file-name">{{ workspace.fileName.value }}</span>
    </div>

    <div class="header__spacer" />

    <div
      class="header__status"
      :class="{ 'header__status--busy': isBusy, 'header__status--alarm': machine.isAlarm.value }"
      data-testid="machine-status"
    >
      <span class="header__status-dot" />
      {{ statusLabel }}
    </div>

    <UiButton v-if="machine.isAlarm.value" :variant="ButtonVariant.Primary" data-testid="clear-alarm" @click="machine.clearAlarm()">
      <ShieldCheck :size="18" /> Снять аварию
    </UiButton>

    <UiButton data-testid="open-connection" @click="activeSection = AppSection.Settings">
      <Plug :size="18" /> {{ machine.connectionLabel.value }}
    </UiButton>

    <UiButton
      :variant="ButtonVariant.Danger"
      class="header__emergency"
      title="Программная аварийная остановка. Не заменяет аппаратную кнопку на станке."
      data-testid="emergency-stop"
      @click="machine.emergencyStop()"
    >
      <OctagonX :size="20" /> Аварийный стоп
    </UiButton>
  </header>
</template>

<style scoped>
.header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  height: 64px;
  padding: 0 12px 0 20px;
  background: var(--color-surface);
}

.header__title {
  margin: 0 12px 0 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.header__file {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
}

.header__file-name {
  overflow: hidden;
  color: var(--color-text);
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header__spacer {
  flex: 1;
}

.header__status {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 14px;
  border-radius: var(--radius-small);
  background: var(--color-success-soft);
  color: var(--color-success);
  font-weight: 600;
  white-space: nowrap;
}

.header__status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentcolor;
}

.header__status--busy {
  background: var(--color-info-soft);
  color: #3155c4;
}

.header__status--busy .header__status-dot {
  animation: status-pulse 1s ease-in-out infinite;
}

.header__status--alarm {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.header__emergency {
  margin-left: 8px;
  font-weight: 650;
}

@keyframes status-pulse {
  50% {
    opacity: 0.25;
  }
}
</style>
