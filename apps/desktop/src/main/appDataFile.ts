import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';

/** JSON files the application keeps in the user's data folder. */
export enum AppDataFile {
  Settings = 'settings.json',
  DesignProject = 'design-project.json',
}

const resolvePath = (file: AppDataFile): string => join(app.getPath('userData'), file);

const isFileMissing = (cause: unknown): boolean => (cause as NodeJS.ErrnoException).code === 'ENOENT';

/**
 * Reads a stored file. The content is untrusted and validated by the core.
 *
 * @returns The parsed value; `null` when never saved; an empty object when the file is corrupted,
 * which the core reports to the operator as recovered data.
 */
export async function loadAppDataFile(file: AppDataFile): Promise<unknown> {
  let fileContent: string;
  try {
    fileContent = await readFile(resolvePath(file), 'utf8');
  } catch (cause) {
    if (isFileMissing(cause)) return null;
    throw cause;
  }
  try {
    return JSON.parse(fileContent) as unknown;
  } catch {
    return {};
  }
}

/** Writes a file atomically, so a power loss on the shop floor cannot leave it half-written. */
export async function saveAppDataFile(file: AppDataFile, content: unknown): Promise<void> {
  const targetPath = resolvePath(file);
  const temporaryPath = `${targetPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(content, null, 2), 'utf8');
  try {
    await rename(temporaryPath, targetPath);
  } catch (cause) {
    await unlink(temporaryPath).catch(() => {});
    throw cause;
  }
}
