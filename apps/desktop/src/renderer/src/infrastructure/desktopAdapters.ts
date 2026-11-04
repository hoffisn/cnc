import {
  OpenProgramStatus,
  err,
  ok,
  type DesignProjectRepository,
  type MachineLink,
  type MachineLinkProvider,
  type OpenProgramResult,
  type ProgramFileGateway,
  type SettingsRepository,
} from '@rezets/core';
import type { DesktopBridge } from '@shared/desktopBridge';

/**
 * Decodes a program file. Modern files are UTF-8, but controllers and older CAM systems on
 * Russian-language machines still write comments in Windows-1251.
 */
export function decodeProgramBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

/** Reaches the operating system through the bridge exposed by the preload script. */
export function createProgramFileGateway(bridge: DesktopBridge): ProgramFileGateway {
  return {
    async open(location): Promise<OpenProgramResult> {
      const picked = await bridge.openProgramFile(location);
      if (picked.status !== OpenProgramStatus.Opened) return picked;
      return {
        status: OpenProgramStatus.Opened,
        file: { fileName: picked.fileName, text: decodeProgramBytes(picked.bytes) },
        isRemovableDriveMissing: picked.isRemovableDriveMissing,
      };
    },
    save: (suggestedFileName, text) => bridge.saveProgramFile(suggestedFileName, text),
  };
}

/** Stores settings through the bridge. */
export function createSettingsRepository(bridge: DesktopBridge): SettingsRepository {
  return {
    load: () => bridge.loadSettings(),
    save: (settings) => bridge.saveSettings(settings),
  };
}

/** Stores the design project through the bridge. */
export function createDesignProjectRepository(bridge: DesktopBridge): DesignProjectRepository {
  return {
    load: () => bridge.loadDesignProject(),
    save: (project) => bridge.saveDesignProject(project),
  };
}

/** Provides channels to controllers, physically owned by the main process. */
export function createMachineLinkProvider(bridge: DesktopBridge): MachineLinkProvider {
  return {
    listSerialPorts: () => bridge.listSerialPorts(),
    async open(target) {
      const opening = await bridge.openMachineLink(target);
      if (!opening.ok) return err(opening.error);

      let unsubscribeData = (): void => {};
      let unsubscribeClosed = (): void => {};
      const link: MachineLink = {
        write: (data) => bridge.writeMachineLink(data),
        onData(listener) {
          unsubscribeData();
          unsubscribeData = bridge.onMachineLinkData(listener);
        },
        onClosed(listener) {
          unsubscribeClosed();
          unsubscribeClosed = bridge.onMachineLinkClosed(listener);
        },
        close() {
          unsubscribeData();
          unsubscribeClosed();
          bridge.closeMachineLink();
        },
      };
      return ok(link);
    },
  };
}
