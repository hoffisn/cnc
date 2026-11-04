/// <reference types="vite/client" />

import type { DesktopBridge } from '@shared/desktopBridge';

declare global {
  interface Window {
    /** Operating system access, exposed by the preload script. */
    readonly desktopBridge: DesktopBridge;
  }
}
