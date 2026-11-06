import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { bootScreenPlugin } from '../../packages/ui/tooling/bootScreenPlugin';

export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../../packages/core/src', import.meta.url)),
      '@ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)),
    },
  },
  server: { host: '127.0.0.1' },
  plugins: [vue(), bootScreenPlugin()],
});
