import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import { OpenProgramStatus, ProgramFileLocation, SaveProgramStatus, type SaveProgramResult } from '@rezets/core';
import type { PickedProgramFile } from '@shared/desktopBridge';
import { findRemovableDrives } from './removableDrives';

const MAX_PROGRAM_FILE_BYTES = 64 * 1024 * 1024;

const GCODE_FILE_FILTERS = [
  { name: 'G-код', extensions: ['nc', 'gcode', 'ngc', 'tap', 'cnc', 'txt'] },
  { name: 'Все файлы', extensions: ['*'] },
];

const describeFailure = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** Lets the operator pick a program file, starting on a removable drive when one was requested and found. */
export async function pickProgramFile(window: BrowserWindow, location: ProgramFileLocation): Promise<PickedProgramFile> {
  try {
    const removableDrives = location === ProgramFileLocation.RemovableDrive ? await findRemovableDrives() : [];
    const isRemovableDriveMissing = location === ProgramFileLocation.RemovableDrive && removableDrives.length === 0;

    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: 'Открыть программу',
      properties: ['openFile'],
      filters: GCODE_FILE_FILTERS,
      ...(removableDrives[0] && { defaultPath: removableDrives[0] }),
    });
    const filePath = filePaths[0];
    if (canceled || !filePath) return { status: OpenProgramStatus.Cancelled, isRemovableDriveMissing };

    const { size } = await stat(filePath);
    if (size > MAX_PROGRAM_FILE_BYTES) {
      return { status: OpenProgramStatus.Failed, failureReason: 'файл больше 64 МБ' };
    }
    return {
      status: OpenProgramStatus.Opened,
      fileName: basename(filePath),
      bytes: await readFile(filePath),
      isRemovableDriveMissing,
    };
  } catch (cause) {
    return { status: OpenProgramStatus.Failed, failureReason: describeFailure(cause) };
  }
}

/** Saves a program to a file the operator picks in a native dialog. */
export async function saveProgramFile(
  window: BrowserWindow,
  suggestedFileName: string,
  text: string,
): Promise<SaveProgramResult> {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: 'Сохранить программу',
      defaultPath: suggestedFileName,
      filters: GCODE_FILE_FILTERS,
    });
    if (canceled || !filePath) return { status: SaveProgramStatus.Cancelled };

    await writeFile(filePath, text, 'utf8');
    return { status: SaveProgramStatus.Saved, fileName: basename(filePath) };
  } catch (cause) {
    return { status: SaveProgramStatus.Failed, failureReason: describeFailure(cause) };
  }
}
