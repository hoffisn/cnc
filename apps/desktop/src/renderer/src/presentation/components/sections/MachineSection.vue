<script setup lang="ts">
import { useAppContext } from '@/presentation/appContext';
import JogPanel from '@/presentation/components/machine/JogPanel.vue';
import PositionReadout from '@/presentation/components/machine/PositionReadout.vue';
import RunControlBar from '@/presentation/components/machine/RunControlBar.vue';
import ProgramPanel from '@/presentation/components/program/ProgramPanel.vue';
import ViewportStage from '@/presentation/components/viewport/ViewportStage.vue';

const { workspace } = useAppContext();
</script>

<template>
  <div class="machine">
    <aside class="machine__column">
      <PositionReadout />
      <JogPanel />
    </aside>
    <div class="machine__column">
      <ViewportStage
        :toolpath="workspace.toolpath.value"
        :relief="workspace.relief.value"
        :highlighted-line="workspace.focusedLine.value"
        :frame-key="workspace.program.value"
      />
      <RunControlBar />
    </div>
    <ProgramPanel />
  </div>
</template>

<style scoped>
.machine {
  display: grid;
  flex: 1;
  grid-template-columns: 280px minmax(0, 1fr) 390px;
  gap: 12px;
  min-height: 0;
  padding: 12px;
}

.machine__column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}
</style>
