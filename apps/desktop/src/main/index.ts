import { app } from 'electron';
import { registerIpcHandlers } from './ipcHandlers';
import { createMainWindow } from './mainWindow';

/** Entry point of the main process, the only part of the application with operating system access. */
void app.whenReady().then(() => {
  registerIpcHandlers(createMainWindow());
});

app.on('window-all-closed', () => {
  app.quit();
});
