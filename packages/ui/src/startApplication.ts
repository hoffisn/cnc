import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@ui/assets/theme.css';
import { createApp } from 'vue';
import App from '@ui/App.vue';
import { createAppContext } from '@ui/createAppContext';
import type { PlatformServices } from '@ui/platform';
import { APP_CONTEXT_KEY } from '@ui/presentation/appContext';

/** Assembles the interface on top of a platform and shows it in the page's `#app` element. */
export async function startApplication(platform: PlatformServices): Promise<void> {
  const context = await createAppContext(platform);
  createApp(App).provide(APP_CONTEXT_KEY, context).mount('#app');
}
