import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const runProcess = promisify(execFile);

/** `DriveType=2` is "removable disk" in the Win32_LogicalDisk WMI class. */
const WINDOWS_REMOVABLE_DRIVES_QUERY =
  'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2" | Select-Object -ExpandProperty DeviceID';

async function listSubdirectories(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
}

async function findWindowsDrives(): Promise<string[]> {
  const { stdout } = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_REMOVABLE_DRIVES_QUERY], {
    windowsHide: true,
  });
  return stdout
    .split(/\r?\n/)
    .map((deviceId) => deviceId.trim())
    .filter((deviceId) => deviceId.length > 0)
    .map((deviceId) => `${deviceId}\\`);
}

async function findLinuxDrives(): Promise<string[]> {
  const { username } = userInfo();
  const mountPoints = await Promise.all([listSubdirectories(`/media/${username}`), listSubdirectories(`/run/media/${username}`)]);
  return mountPoints.flat();
}

/** @returns Root folders of the connected removable drives, in the order the system lists them. */
export function findRemovableDrives(): Promise<string[]> {
  switch (process.platform) {
    case 'win32':
      return findWindowsDrives();
    case 'darwin':
      return listSubdirectories('/Volumes');
    default:
      return findLinuxDrives();
  }
}
