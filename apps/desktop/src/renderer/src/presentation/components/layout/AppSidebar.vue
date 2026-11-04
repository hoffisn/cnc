<script setup lang="ts">
import type { Component } from 'vue';
import { Cog, Cpu, DraftingCompass, LayoutGrid } from '@lucide/vue';
import { useAppContext } from '@/presentation/appContext';
import { AppSection } from '@/presentation/navigation';

const { activeSection } = useAppContext();

const NAVIGATION_ITEMS: readonly { readonly section: AppSection; readonly label: string; readonly icon: Component }[] = [
  { section: AppSection.WorkSurface, label: 'Поверхность', icon: LayoutGrid },
  { section: AppSection.Designer, label: 'Конструктор', icon: DraftingCompass },
  { section: AppSection.Machine, label: 'Станок', icon: Cpu },
  { section: AppSection.Settings, label: 'Настройки', icon: Cog },
];
</script>

<template>
  <nav class="sidebar">
    <span class="sidebar__logo" aria-label="Резец">Р</span>
    <button
      v-for="item in NAVIGATION_ITEMS"
      :key="item.section"
      type="button"
      class="sidebar__item"
      :class="{ 'sidebar__item--active': activeSection === item.section }"
      :data-testid="`nav-${item.section}`"
      @click="activeSection = item.section"
    >
      <component :is="item.icon" :size="22" />
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  width: 92px;
  padding: 14px 8px;
  background: var(--color-text);
}

.sidebar__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-bottom: 16px;
  border-radius: 12px;
  background: var(--color-accent);
  color: var(--color-accent-text);
  font-size: 22px;
  font-weight: 800;
}

.sidebar__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 10px 2px;
  border: 0;
  border-radius: var(--radius-medium);
  background: transparent;
  color: #a7abb3;
  font-size: 11.5px;
  font-weight: 550;
  transition: background-color 120ms ease, color 120ms ease;
}

.sidebar__item:hover {
  background: rgb(255 255 255 / 8%);
  color: #fff;
}

.sidebar__item--active,
.sidebar__item--active:hover {
  background: rgb(255 255 255 / 14%);
  color: var(--color-accent);
}

.sidebar__item:focus-visible {
  outline-color: #fff;
}
</style>
