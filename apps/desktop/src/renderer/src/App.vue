<script setup lang="ts">
import { computed, ref } from 'vue';
import { decodeProgramBytes } from '@/infrastructure/desktopAdapters';
import { useAppContext } from '@/presentation/appContext';
import { AppSection } from '@/presentation/navigation';
import AppHeader from '@/presentation/components/layout/AppHeader.vue';
import AppSidebar from '@/presentation/components/layout/AppSidebar.vue';
import DesignerSection from '@/presentation/components/sections/DesignerSection.vue';
import MachineSection from '@/presentation/components/sections/MachineSection.vue';
import SettingsSection from '@/presentation/components/sections/SettingsSection.vue';
import WorkSurfaceSection from '@/presentation/components/sections/WorkSurfaceSection.vue';
import NotificationStack from '@/presentation/components/ui/NotificationStack.vue';

const { workspace, machine, activeSection } = useAppContext();

const isDraggingFile = ref(false);
const canReplaceProgram = computed(() => !machine.isProgramActive.value);

async function handleDrop(event: DragEvent): Promise<void> {
  isDraggingFile.value = false;
  const file = event.dataTransfer?.files[0];
  if (!file || !canReplaceProgram.value) return;
  workspace.loadFile({ fileName: file.name, text: decodeProgramBytes(new Uint8Array(await file.arrayBuffer())) });
  activeSection.value = AppSection.Machine;
}
</script>

<template>
  <div
    class="app"
    @dragover.prevent="isDraggingFile = true"
    @dragleave.self="isDraggingFile = false"
    @drop.prevent="handleDrop"
  >
    <AppSidebar />
    <div class="app__content">
      <AppHeader />
      <WorkSurfaceSection v-if="activeSection === AppSection.WorkSurface" />
      <DesignerSection v-else-if="activeSection === AppSection.Designer" />
      <MachineSection v-else-if="activeSection === AppSection.Machine" />
      <SettingsSection v-else />
    </div>

    <div v-if="isDraggingFile" class="app__drop-hint">Отпустите файл, чтобы загрузить программу</div>
    <NotificationStack />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100%;
}

.app__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.app__drop-hint {
  position: fixed;
  inset: 12px;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--color-text);
  border-radius: var(--radius-large);
  background: rgb(255 221 45 / 88%);
  font-size: 24px;
  font-weight: 650;
  pointer-events: none;
}
</style>
