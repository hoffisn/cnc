import { join } from 'node:path';
import { BrowserWindow, Menu } from 'electron';

const WINDOW_BACKGROUND_COLOR = '#f2f3f5';

/**
 * Creates the application window with the renderer fully isolated from Node.js.
 * Navigation and pop-ups are blocked: the application has a single local page.
 */
export function createMainWindow(): BrowserWindow {
  Menu.setApplicationMenu(null);

  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    title: 'Резец',
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return window;
}
