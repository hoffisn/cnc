import { startApplication } from '@rezets/ui';
import { createDesktopPlatform } from './desktopPlatform';

void startApplication(createDesktopPlatform(window.desktopBridge));
