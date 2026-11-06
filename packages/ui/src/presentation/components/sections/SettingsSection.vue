<script setup lang="ts">
import ConnectionForm from '@ui/presentation/components/machine/ConnectionForm.vue';
import MachineSettingsForm from '@ui/presentation/components/machine/MachineSettingsForm.vue';
</script>

<template>
  <div class="settings">
    <ConnectionForm />
    <MachineSettingsForm />
  </div>
</template>

<style scoped>
.settings {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(2, minmax(0, 520px));
  gap: 12px;
  align-content: start;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
}
</style>
