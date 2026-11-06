<script setup lang="ts">
import { computed } from 'vue';
import { Pause, Play, Square } from '@lucide/vue';
import { MachineStatus } from '@rezets/core';
import { useAppContext } from '@ui/presentation/appContext';
import SegmentedControl from '@ui/presentation/components/ui/SegmentedControl.vue';
import UiButton from '@ui/presentation/components/ui/UiButton.vue';
import { ButtonVariant } from '@ui/presentation/components/ui/buttonVariant';

const { machine, workspace } = useAppContext();

const isPaused = computed(() => machine.state.value.status === MachineStatus.ProgramPaused);
const isRunning = computed(() => machine.state.value.status === MachineStatus.RunningProgram);
const progress = computed(() => machine.state.value.programProgress);
const completedPercent = computed(() => Math.round((progress.value?.completedFraction ?? 0) * 100));

const speedOptions = computed(() =>
  machine.speedOptions.value.map((multiplier) => ({
    value: multiplier,
    label: machine.isSimulator.value ? `×${multiplier}` : `${multiplier * 100}%`,
  })),
);

const canStart = computed(() => machine.isIdle.value && workspace.errorCount.value === 0);

const programSummary = computed(() => {
  const { errorCount, toolpath } = workspace;
  if (errorCount.value > 0) return 'Запуск недоступен: в программе есть ошибки';
  const lengthInMeters = (toolpath.value.feedLength + toolpath.value.rapidLength) / 1000;
  return `Путь ${lengthInMeters.toFixed(2)} м`;
});

function handlePrimaryAction(): void {
  if (isRunning.value) machine.pauseProgram();
  else if (isPaused.value) machine.resumeProgram();
  else machine.startProgram(workspace.program.value, workspace.toolpath.value, workspace.scale.value);
}
</script>

<template>
  <section class="card run-bar">
    <UiButton
      class="run-bar__primary"
      :variant="ButtonVariant.Primary"
      :disabled="!canStart && !isRunning && !isPaused"
      data-testid="run-primary"
      @click="handlePrimaryAction"
    >
      <Pause v-if="isRunning" :size="18" />
      <Play v-else :size="18" />
      {{ isRunning ? 'Пауза' : isPaused ? 'Продолжить' : 'Запустить' }}
    </UiButton>
    <UiButton :disabled="!machine.isProgramActive.value" data-testid="run-stop" @click="machine.stop()">
      <Square :size="16" /> Стоп
    </UiButton>

    <div class="run-bar__progress">
      <div class="run-bar__caption">
        <span v-if="progress" class="numeric" data-testid="run-caption">Строка {{ progress.sourceLine }}</span>
        <span v-else class="run-bar__summary">{{ programSummary }}</span>
        <span v-if="progress" class="numeric">{{ completedPercent }}%</span>
      </div>
      <div class="run-bar__track">
        <div class="run-bar__fill" :style="{ width: `${completedPercent}%` }" />
      </div>
    </div>

    <div class="run-bar__speed">
      <span class="run-bar__speed-label">{{ machine.isSimulator.value ? 'Скорость' : 'Подача' }}</span>
      <SegmentedControl
        :model-value="machine.speedMultiplier.value"
        :options="speedOptions"
        @update:model-value="machine.setSpeedMultiplier($event)"
      />
    </div>
  </section>
</template>

<style scoped>
.run-bar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  padding: 12px;
}

.run-bar__primary {
  min-width: 144px;
}

.run-bar__progress {
  flex: 1;
  min-width: 0;
  margin: 0 12px;
}

.run-bar__caption {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 550;
}

.run-bar__summary {
  overflow: hidden;
  color: var(--color-text-secondary);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-bar__track {
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--color-surface-muted);
}

.run-bar__fill {
  height: 100%;
  border-radius: 3px;
  background: var(--color-accent);
  transition: width 200ms linear;
}

.run-bar__speed {
  display: flex;
  align-items: center;
  gap: 10px;
}

@media (max-width: 1360px) {
  .run-bar__speed-label {
    display: none;
  }

  .run-bar__primary {
    min-width: 128px;
  }
}

.run-bar__speed-label {
  color: var(--color-text-secondary);
  font-size: 13px;
  white-space: nowrap;
}
</style>
