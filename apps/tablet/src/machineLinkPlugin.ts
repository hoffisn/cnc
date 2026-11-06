import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { MachineLinkTarget, SerialPortInfo } from '@rezets/core';

/** Fired for each chunk received from the controller; text is Latin-1, one character per byte. */
export interface MachineLinkDataEvent {
  readonly chunk: string;
}

/**
 * Native side of the machine link: USB and TCP in Android code.
 * Lives outside the WebView because a web page has no access to USB devices.
 */
export interface MachineLinkPlugin {
  listPorts(): Promise<{ ports: SerialPortInfo[] }>;
  open(target: MachineLinkTarget): Promise<void>;
  write(options: { data: string }): Promise<void>;
  close(): Promise<void>;
  addListener(eventName: 'data', listener: (event: MachineLinkDataEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'closed', listener: () => void): Promise<PluginListenerHandle>;
}

export const machineLinkPlugin = registerPlugin<MachineLinkPlugin>('MachineLink');
