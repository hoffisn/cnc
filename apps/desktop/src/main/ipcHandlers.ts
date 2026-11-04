import { ipcMain, type BrowserWindow } from 'electron';
import { MachineLinkKind, ProgramFileLocation, type MachineLinkTarget } from '@rezets/core';
import { IpcChannel } from '@shared/desktopBridge';
import { MachineLinkHost } from './machineLinkHost';
import { pickProgramFile, saveProgramFile } from './programFiles';
import { AppDataFile, loadAppDataFile, saveAppDataFile } from './appDataFile';

const MAX_TCP_PORT = 65535;

const isProgramFileLocation = (value: unknown): value is ProgramFileLocation =>
  value === ProgramFileLocation.AnyFolder || value === ProgramFileLocation.RemovableDrive;

/** Anything crossing IPC is checked at runtime: the static types end at the process boundary. */
function isMachineLinkTarget(value: unknown): value is MachineLinkTarget {
  if (typeof value !== 'object' || value === null) return false;
  const target = value as Partial<Record<string, unknown>>;
  if (target.kind === MachineLinkKind.Serial) {
    return typeof target.portPath === 'string' && target.portPath.length > 0 && Number.isInteger(target.baudRate);
  }
  if (target.kind === MachineLinkKind.Tcp) {
    const { port } = target;
    return (
      typeof target.host === 'string' &&
      target.host.length > 0 &&
      typeof port === 'number' &&
      Number.isInteger(port) &&
      port > 0 &&
      port <= MAX_TCP_PORT
    );
  }
  return false;
}

/** Connects the renderer's requests to the operating system services of the main process. */
export function registerIpcHandlers(window: BrowserWindow): void {
  const linkHost = new MachineLinkHost({
    onData(chunk) {
      if (!window.isDestroyed()) window.webContents.send(IpcChannel.MachineLinkData, chunk);
    },
    onClosed() {
      if (!window.isDestroyed()) window.webContents.send(IpcChannel.MachineLinkClosed);
    },
  });
  window.once('closed', () => linkHost.close());

  ipcMain.handle(IpcChannel.OpenProgramFile, (_event, location: unknown) => {
    if (!isProgramFileLocation(location)) throw new TypeError('Invalid program file location');
    return pickProgramFile(window, location);
  });

  ipcMain.handle(IpcChannel.SaveProgramFile, (_event, suggestedFileName: unknown, text: unknown) => {
    if (typeof suggestedFileName !== 'string' || typeof text !== 'string') {
      throw new TypeError('Invalid program file content');
    }
    return saveProgramFile(window, suggestedFileName, text);
  });

  ipcMain.handle(IpcChannel.LoadSettings, () => loadAppDataFile(AppDataFile.Settings));
  ipcMain.handle(IpcChannel.SaveSettings, (_event, settings: unknown) => saveAppDataFile(AppDataFile.Settings, settings));
  ipcMain.handle(IpcChannel.LoadDesignProject, () => loadAppDataFile(AppDataFile.DesignProject));
  ipcMain.handle(IpcChannel.SaveDesignProject, (_event, project: unknown) => saveAppDataFile(AppDataFile.DesignProject, project));

  ipcMain.handle(IpcChannel.ListSerialPorts, () => linkHost.listSerialPorts());
  ipcMain.handle(IpcChannel.OpenMachineLink, (_event, target: unknown) => {
    if (!isMachineLinkTarget(target)) throw new TypeError('Invalid machine link target');
    return linkHost.open(target);
  });
  ipcMain.on(IpcChannel.WriteMachineLink, (_event, data: unknown) => {
    if (typeof data === 'string') linkHost.write(data);
  });
  ipcMain.on(IpcChannel.CloseMachineLink, () => linkHost.close());
}
