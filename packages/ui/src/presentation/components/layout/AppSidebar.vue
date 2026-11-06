<script setup lang="ts">
import type { Component } from 'vue';
import { Cog, Cpu, DraftingCompass, LayoutGrid } from '@lucide/vue';
import { useAppContext } from '@ui/presentation/appContext';
import { AppSection } from '@ui/presentation/navigation';
import BrandMark from './BrandMark.vue';

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
    <BrandMark class="sidebar__logo" :size="40" />
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
  flex-shrink: 0;
  margin-bottom: 16px;
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
