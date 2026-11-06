import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import {
  OpenProgramStatus,
  SaveProgramStatus,
  err,
  ok,
  type DesignProjectRepository,
  type MachineLink,
  type MachineLinkProvider,
  type OpenProgramResult,
  type ProgramFileGateway,
  type SaveProgramResult,
  type SettingsRepository,
} from '@rezets/core';
import { decodeProgramBytes, type PlatformServices } from '@rezets/ui';
import { machineLinkPlugin } from './machineLinkPlugin';

/** Keys of the values stored on the device. */
enum StorageKey {
  Settings = 'settings',
  DesignProject = 'design-project',
}

const MAX_PROGRAM_FILE_BYTES = 64 * 1024 * 1024;
const SAVED_PROGRAMS_FOLDER = 'Rezets';
const GCODE_FILE_EXTENSIONS = '.nc,.gcode,.ngc,.tap,.cnc,.txt';

/** A tablet carves a coarser grid than a desktop, so that 3D stays fluid on a modest processor. */
const TABLET_RELIEF_QUALITY = { programResolution: 260, designResolution: 360 };

const describeFailure = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/**
 * Reads a stored value. The content is untrusted and validated by the core.
 *
 * @returns The parsed value; `null` when never saved; an empty object when corrupted,
 * which the core reports to the operator as recovered data.
 */
async function loadStoredValue(key: StorageKey): Promise<unknown> {
  const { value } = await Preferences.get({ key });
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

const saveStoredValue = (key: StorageKey, content: unknown): Promise<void> =>
  Preferences.set({ key, value: JSON.stringify(content) });

function createSettingsRepository(): SettingsRepository {
  return {
    load: () => loadStoredValue(StorageKey.Settings),
    save: (settings) => saveStoredValue(StorageKey.Settings, settings),
  };
}

function createDesignProjectRepository(): DesignProjectRepository {
  return {
    load: () => loadStoredValue(StorageKey.DesignProject),
    save: (project) => saveStoredValue(StorageKey.DesignProject, project),
  };
}

/**
 * Lets the operator pick a file in the Android file picker, which also shows USB drives.
 *
 * @returns The chosen file, or `null` when the picker was dismissed.
 */
function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = GCODE_FILE_EXTENSIONS;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

function createProgramFileGateway(): ProgramFileGateway {
  return {
    async open(): Promise<OpenProgramResult> {
      try {
        const file = await pickFile();
        if (!file) return { status: OpenProgramStatus.Cancelled, isRemovableDriveMissing: false };
        if (file.size > MAX_PROGRAM_FILE_BYTES) {
          return { status: OpenProgramStatus.Failed, failureReason: 'файл больше 64 МБ' };
        }
        const text = decodeProgramBytes(new Uint8Array(await file.arrayBuffer()));
        return { status: OpenProgramStatus.Opened, file: { fileName: file.name, text }, isRemovableDriveMissing: false };
      } catch (cause) {
        return { status: OpenProgramStatus.Failed, failureReason: describeFailure(cause) };
      }
    },
    async save(suggestedFileName, text): Promise<SaveProgramResult> {
      try {
        await Filesystem.requestPermissions();
        const path = `${SAVED_PROGRAMS_FOLDER}/${suggestedFileName}`;
        await Filesystem.writeFile({ path, data: text, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
        return { status: SaveProgramStatus.Saved, fileName: `Документы/${path}` };
      } catch (cause) {
        return { status: SaveProgramStatus.Failed, failureReason: describeFailure(cause) };
      }
    },
  };
}

function createMachineLinkProvider(): MachineLinkProvider {
  return {
    async listSerialPorts() {
      const { ports } = await machineLinkPlugin.listPorts();
      return ports;
    },
    async open(target) {
      try {
        await machineLinkPlugin.open(target);
      } catch (cause) {
        return err(describeFailure(cause));
      }
      const subscriptions: Promise<{ remove: () => Promise<void> }>[] = [];
      const link: MachineLink = {
        write(data) {
          // A failed write closes the channel natively, which arrives as the "closed" event.
          void machineLinkPlugin.write({ data }).catch(() => {});
        },
        onData(listener) {
          subscriptions.push(machineLinkPlugin.addListener('data', ({ chunk }) => listener(chunk)));
        },
        onClosed(listener) {
          subscriptions.push(machineLinkPlugin.addListener('closed', listener));
        },
        close() {
          for (const subscription of subscriptions) void subscription.then((handle) => handle.remove());
          void machineLinkPlugin.close().catch(() => {});
        },
      };
      return ok(link);
    },
  };
}

/** Implements the interface's needs on top of Capacitor and Android. */
export function createTabletPlatform(): PlatformServices {
  return {
    settingsRepository: createSettingsRepository(),
    designProjectRepository: createDesignProjectRepository(),
    programFileGateway: createProgramFileGateway(),
    machineLinkProvider: createMachineLinkProvider(),
    reliefQuality: TABLET_RELIEF_QUALITY,
  };
}
