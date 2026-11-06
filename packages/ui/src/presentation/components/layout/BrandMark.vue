<script setup lang="ts">
import { BRAND_MARK } from '@ui/presentation/brandMark';

defineProps<{ size: number }>();
</script>

<template>
  <svg :width="size" :height="size" :viewBox="BRAND_MARK.viewBox" role="img" aria-label="Резец">
    <rect width="48" height="48" :rx="BRAND_MARK.cornerRadius" :fill="BRAND_MARK.backgroundColor" />
    <path
      :d="BRAND_MARK.toolpath"
      fill="none"
      :stroke="BRAND_MARK.foregroundColor"
      :stroke-width="BRAND_MARK.toolpathWidth"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <circle
      :cx="BRAND_MARK.cutter.centerX"
      :cy="BRAND_MARK.cutter.centerY"
      :r="BRAND_MARK.cutter.radius"
      :fill="BRAND_MARK.foregroundColor"
    />
  </svg>
</template>
