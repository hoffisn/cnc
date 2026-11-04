<script setup lang="ts">
import { computed, ref } from 'vue';
import { FolderOpen, Save, Usb } from '@lucide/vue';
import { ProgramFileLocation } from '@rezets/core';
import { useAppContext } from '@/presentation/appContext';
import { SAMPLE_PROGRAMS } from '@/presentation/samplePrograms';
import SegmentedControl from '@/presentation/components/ui/SegmentedControl.vue';
import UiButton from '@/presentation/components/ui/UiButton.vue';
import DiagnosticsList from './DiagnosticsList.vue';
import GCodeEditor from './GCodeEditor.vue';
import ScalePanel from './ScalePanel.vue';

const { workspace, machine } = useAppContext();

/** Sections of the right-hand panel. */
enum ProgramPanelTab {
  Code = 'code',
  Dimensions = 'dimensions',
}

const TAB_OPTIONS = [
  { value: ProgramPanelTab.Code, label: 'G-код' },
  { value: ProgramPanelTab.Dimensions, label: 'Размеры' },
];

const activeTab = ref(ProgramPanelTab.Code);
const editor = ref<InstanceType<typeof GCodeEditor> | null>(null);

const executingLine = computed(() => machine.state.value.programProgress?.sourceLine ?? null);
const lineCountText = computed(() => `${workspace.program.value.lineCount} строк`);

function loadSample(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const sample = SAMPLE_PROGRAMS.find((candidate) => candidate.id === select.value);
  if (sample) workspace.loadFile({ fileName: sample.fileName, text: sample.source });
  select.value = '';
}
</script>

<template>
  <section class="card program-panel">
    <header class="program-panel__header">
      <SegmentedControl v-model="activeTab" :options="TAB_OPTIONS" class="program-panel__tabs" data-testid="program-tabs" />
    </header>

    <template v-if="activeTab === ProgramPanelTab.Code">
      <div class="program-panel__toolbar">
        <UiButton title="Открыть файл" data-testid="open-file" @click="workspace.openFromDevice(ProgramFileLocation.AnyFolder)">
          <FolderOpen :size="16" /> Файл
        </UiButton>
        <UiButton title="Открыть файл с флешки" data-testid="open-usb" @click="workspace.openFromDevice(ProgramFileLocation.RemovableDrive)">
          <Usb :size="16" /> Флешка
        </UiButton>
        <select class="program-panel__samples" aria-label="Примеры программ" data-testid="sample-select" value="" @change="loadSample">
          <option value="" disabled hidden>Примеры</option>
          <option v-for="sample in SAMPLE_PROGRAMS" :key="sample.id" :value="sample.id">{{ sample.title }}</option>
        </select>
        <UiButton icon-only title="Сохранить G-код" @click="workspace.saveToDevice()">
          <Save :size="16" />
        </UiButton>
      </div>

      <GCodeEditor
        ref="editor"
        :model-value="workspace.sourceText.value"
        :diagnostics="workspace.program.value.diagnostics"
        :executing-line="executingLine"
        :is-read-only="machine.isProgramActive.value"
        @update:model-value="workspace.editSource($event)"
        @caret-line-change="workspace.focusedLine.value = $event"
      />

      <DiagnosticsList :diagnostics="workspace.program.value.diagnostics" @select="editor?.revealLine($event)" />

      <footer class="program-panel__status numeric">
        <span>{{ lineCountText }}</span>
        <span v-if="workspace.errorCount.value > 0" class="program-panel__errors">Ошибок: {{ workspace.errorCount.value }}</span>
        <span v-if="workspace.warningCount.value > 0" class="program-panel__warnings">Предупреждений: {{ workspace.warningCount.value }}</span>
      </footer>
    </template>

    <ScalePanel v-else />
  </section>
</template>

<style scoped>
.program-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.program-panel__header {
  padding: 12px 12px 0;
}

.program-panel__tabs {
  display: flex;
}

.program-panel__toolbar {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
}

.program-panel__toolbar :deep(.ui-button) {
  padding: 0 10px;
}

.program-panel__toolbar :deep(.ui-button--icon-only) {
  padding: 0;
}

.program-panel__samples {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
  font-weight: 550;
}

.program-panel__status {
  display: flex;
  flex-shrink: 0;
  gap: 12px;
  padding: 8px 14px;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: 12px;
}

.program-panel__errors {
  color: var(--color-danger);
  font-weight: 600;
}

.program-panel__warnings {
  color: var(--color-warning);
  font-weight: 600;
}
</style>
