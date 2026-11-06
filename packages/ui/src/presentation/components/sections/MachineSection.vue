<script setup lang="ts">
import { useAppContext } from '@ui/presentation/appContext';
import JogPanel from '@ui/presentation/components/machine/JogPanel.vue';
import PositionReadout from '@ui/presentation/components/machine/PositionReadout.vue';
import RunControlBar from '@ui/presentation/components/machine/RunControlBar.vue';
import ProgramPanel from '@ui/presentation/components/program/ProgramPanel.vue';
import ViewportStage from '@ui/presentation/components/viewport/ViewportStage.vue';

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

@media (max-width: 1360px) {
  .machine {
    grid-template-columns: 220px minmax(0, 1fr) 320px;
  }
}

@media (max-width: 1100px) {
  .machine {
    grid-template-columns: 208px minmax(0, 1fr) 272px;
  }
}

.machine__column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}
</style>
