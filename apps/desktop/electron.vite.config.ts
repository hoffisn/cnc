import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'electron-vite';

const sharedAliases = {
  '@core': resolve(__dirname, '../../packages/core/src'),
  '@shared': resolve(__dirname, 'src/shared'),
};

export default defineConfig({
  main: {
    resolve: { alias: sharedAliases },
  },
  preload: {
    resolve: { alias: sharedAliases },
  },
  renderer: {
    resolve: {
      alias: { ...sharedAliases, '@': resolve(__dirname, 'src/renderer/src') },
    },
    server: {
      // "localhost" may resolve to IPv6 for the dev server and to IPv4 for the Electron window.
      host: '127.0.0.1',
    },
    plugins: [vue()],
  },
});
