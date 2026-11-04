import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@/assets/theme.css';
import { createApp } from 'vue';
import App from './App.vue';
import { createAppContext } from './createAppContext';
import { APP_CONTEXT_KEY } from '@/presentation/appContext';

void createAppContext().then((context) => {
  createApp(App).provide(APP_CONTEXT_KEY, context).mount('#app');
});
