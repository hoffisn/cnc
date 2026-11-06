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
import { decodeProgramBytes, type PlatformServices } from '@rezets/ui';
import type { DesktopBridge } from '@shared/desktopBridge';

/** Reaches the operating system through the bridge exposed by the preload script. */
function createProgramFileGateway(bridge: DesktopBridge): ProgramFileGateway {
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
function createSettingsRepository(bridge: DesktopBridge): SettingsRepository {
  return {
    load: () => bridge.loadSettings(),
    save: (settings) => bridge.saveSettings(settings),
  };
}

/** Stores the design project through the bridge. */
function createDesignProjectRepository(bridge: DesktopBridge): DesignProjectRepository {
  return {
    load: () => bridge.loadDesignProject(),
    save: (project) => bridge.saveDesignProject(project),
  };
}

/** Provides channels to controllers, physically owned by the main process. */
function createMachineLinkProvider(bridge: DesktopBridge): MachineLinkProvider {
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

/** Whole sheets need a finer grid than a single part for small holes to stay visible. */
const DESKTOP_RELIEF_QUALITY = { programResolution: 800, designResolution: 1100 };

/** Implements the interface's needs on top of Electron. */
export function createDesktopPlatform(bridge: DesktopBridge): PlatformServices {
  return {
    settingsRepository: createSettingsRepository(bridge),
    designProjectRepository: createDesignProjectRepository(bridge),
    programFileGateway: createProgramFileGateway(bridge),
    machineLinkProvider: createMachineLinkProvider(bridge),
    reliefQuality: DESKTOP_RELIEF_QUALITY,
  };
}
