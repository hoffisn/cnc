import type {
  AppSettings,
  DesignProject,
  MachineLinkTarget,
  OpenProgramStatus,
  ProgramFileLocation,
  Result,
  SaveProgramResult,
  SerialPortInfo,
} from '@rezets/core';

/** Names of the IPC channels between the main process and the renderer. */
export enum IpcChannel {
  OpenProgramFile = 'program-file:open',
  SaveProgramFile = 'program-file:save',
  LoadSettings = 'settings:load',
  SaveSettings = 'settings:save',
  LoadDesignProject = 'design-project:load',
  SaveDesignProject = 'design-project:save',
  ListSerialPorts = 'machine-link:list-serial-ports',
  OpenMachineLink = 'machine-link:open',
  WriteMachineLink = 'machine-link:write',
  CloseMachineLink = 'machine-link:close',
  MachineLinkData = 'machine-link:data',
  MachineLinkClosed = 'machine-link:closed',
}

/**
 * Raw program file as read by the main process.
 * Decoding happens in the renderer, which has the full set of browser text decoders.
 */
export type PickedProgramFile =
  | {
      readonly status: OpenProgramStatus.Opened;
      readonly fileName: string;
      readonly bytes: Uint8Array;
      readonly isRemovableDriveMissing: boolean;
    }
  | { readonly status: OpenProgramStatus.Cancelled; readonly isRemovableDriveMissing: boolean }
  | { readonly status: OpenProgramStatus.Failed; readonly failureReason: string };

/**
 * Everything the renderer may ask of the operating system.
 * Deliberately narrow: the renderer never handles file paths, so a compromised page
 * could only write to a file the operator personally picked in a native dialog.
 */
export interface DesktopBridge {
  openProgramFile(location: ProgramFileLocation): Promise<PickedProgramFile>;
  saveProgramFile(suggestedFileName: string, text: string): Promise<SaveProgramResult>;
  loadSettings(): Promise<unknown>;
  saveSettings(settings: AppSettings): Promise<void>;
  loadDesignProject(): Promise<unknown>;
  saveDesignProject(project: DesignProject): Promise<void>;
  listSerialPorts(): Promise<readonly SerialPortInfo[]>;
  openMachineLink(target: MachineLinkTarget): Promise<Result<void, string>>;
  writeMachineLink(data: string): void;
  closeMachineLink(): void;
  /** @returns Function that cancels the subscription. */
  onMachineLinkData(listener: (chunk: string) => void): () => void;
  /** @returns Function that cancels the subscription. */
  onMachineLinkClosed(listener: () => void): () => void;
}
