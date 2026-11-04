<script setup lang="ts">
import { computed } from 'vue';
import { CircleAlert, TriangleAlert } from '@lucide/vue';
import { DiagnosticSeverity, type Diagnostic } from '@rezets/core';
import { describeDiagnostic } from '@/presentation/messages';

const props = defineProps<{ diagnostics: readonly Diagnostic[] }>();
defineEmits<{ select: [line: number] }>();

/** A broken file can produce thousands of entries, and the first ones are what matters. */
const MAX_VISIBLE_DIAGNOSTICS = 100;

const visibleDiagnostics = computed(() => props.diagnostics.slice(0, MAX_VISIBLE_DIAGNOSTICS));
const hiddenCount = computed(() => Math.max(props.diagnostics.length - MAX_VISIBLE_DIAGNOSTICS, 0));
</script>

<template>
  <ul v-if="diagnostics.length > 0" class="diagnostics" data-testid="diagnostics">
    <li v-for="diagnostic in visibleDiagnostics" :key="`${diagnostic.line}:${diagnostic.column}:${diagnostic.code}`">
      <button type="button" class="diagnostics__item" @click="$emit('select', diagnostic.line)">
        <CircleAlert v-if="diagnostic.severity === DiagnosticSeverity.Error" :size="16" class="diagnostics__icon--error" />
        <TriangleAlert v-else :size="16" class="diagnostics__icon--warning" />
        <span class="diagnostics__line numeric">{{ diagnostic.line }}</span>
        <span>{{ describeDiagnostic(diagnostic) }}</span>
      </button>
    </li>
    <li v-if="hiddenCount > 0" class="diagnostics__more">И ещё {{ hiddenCount }}</li>
  </ul>
</template>

<style scoped>
.diagnostics {
  flex-shrink: 0;
  max-height: 140px;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  border-top: 1px solid var(--color-border);
  list-style: none;
  font-size: 13px;
}

.diagnostics__item {
  display: flex;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
}

.diagnostics__item:hover {
  background: var(--color-surface-muted);
}

.diagnostics__item svg {
  flex-shrink: 0;
  margin-top: 1px;
}

.diagnostics__icon--error {
  color: var(--color-danger);
}

.diagnostics__icon--warning {
  color: var(--color-warning);
}

.diagnostics__line {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
}

.diagnostics__more {
  padding: 6px 8px;
  color: var(--color-text-secondary);
}
</style>
