<script setup lang="ts">
import { computed } from 'vue';
import { ALL_AXES } from '@rezets/core';
import { AXIS_LABELS } from '@ui/presentation/messages';
import { useAppContext } from '@ui/presentation/appContext';

const { machine } = useAppContext();

const POSITION_DECIMALS = 3;

const axisRows = computed(() =>
  ALL_AXES.map((axis) => ({
    axis,
    label: AXIS_LABELS[axis],
    value: machine.state.value.position[axis].toFixed(POSITION_DECIMALS),
  })),
);
</script>

<template>
  <section class="card readout">
    <h2 class="card-title">Положение</h2>
    <dl class="readout__rows">
      <div v-for="row in axisRows" :key="row.axis" class="readout__row">
        <dt class="readout__axis" :class="`readout__axis--${row.axis}`">{{ row.label }}</dt>
        <dd class="readout__value numeric">{{ row.value }}<span class="readout__unit">мм</span></dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.readout {
  padding: 16px;
}

.readout__rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 10px 0 0;
}

.readout__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 12px;
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
}

.readout__axis {
  font-weight: 700;
}

.readout__axis--x {
  color: #e5484d;
}

.readout__axis--y {
  color: #30a46c;
}

.readout__axis--z {
  color: #3e63dd;
}

.readout__value {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 600;
}

.readout__unit {
  margin-left: 6px;
  color: var(--color-text-tertiary);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
}
</style>
