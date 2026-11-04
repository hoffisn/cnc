/** Program file loaded from a storage device. */
export interface ProgramFile {
  readonly fileName: string;
  readonly text: string;
}

/** Where the operator wants to pick a program from. */
export enum ProgramFileLocation {
  AnyFolder = 'any-folder',
  RemovableDrive = 'removable-drive',
}

/** Discriminator of {@link OpenProgramResult}. */
export enum OpenProgramStatus {
  Opened = 'opened',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

/** Discriminator of {@link SaveProgramResult}. */
export enum SaveProgramStatus {
  Saved = 'saved',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

/** Outcome of asking the operator for a program file. */
export type OpenProgramResult =
  | {
      readonly status: OpenProgramStatus.Opened;
      readonly file: ProgramFile;
      /** A removable drive was requested but not found, so a regular folder was offered. */
      readonly isRemovableDriveMissing: boolean;
    }
  | { readonly status: OpenProgramStatus.Cancelled; readonly isRemovableDriveMissing: boolean }
  | { readonly status: OpenProgramStatus.Failed; readonly failureReason: string };

/** Outcome of saving a program file. */
export type SaveProgramResult =
  | { readonly status: SaveProgramStatus.Saved; readonly fileName: string }
  | { readonly status: SaveProgramStatus.Cancelled }
  | { readonly status: SaveProgramStatus.Failed; readonly failureReason: string };

/** Output port for loading and saving program files. */
export interface ProgramFileGateway {
  open(location: ProgramFileLocation): Promise<OpenProgramResult>;
  save(suggestedFileName: string, text: string): Promise<SaveProgramResult>;
}
