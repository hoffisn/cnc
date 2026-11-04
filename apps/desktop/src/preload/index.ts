import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel, type DesktopBridge } from '@shared/desktopBridge';

const bridge: DesktopBridge = {
  openProgramFile: (location) => ipcRenderer.invoke(IpcChannel.OpenProgramFile, location),
  saveProgramFile: (suggestedFileName, text) => ipcRenderer.invoke(IpcChannel.SaveProgramFile, suggestedFileName, text),
  loadSettings: () => ipcRenderer.invoke(IpcChannel.LoadSettings),
  saveSettings: (settings) => ipcRenderer.invoke(IpcChannel.SaveSettings, settings),
  loadDesignProject: () => ipcRenderer.invoke(IpcChannel.LoadDesignProject),
  saveDesignProject: (project) => ipcRenderer.invoke(IpcChannel.SaveDesignProject, project),
  listSerialPorts: () => ipcRenderer.invoke(IpcChannel.ListSerialPorts),
  openMachineLink: (target) => ipcRenderer.invoke(IpcChannel.OpenMachineLink, target),
  writeMachineLink: (data) => ipcRenderer.send(IpcChannel.WriteMachineLink, data),
  closeMachineLink: () => ipcRenderer.send(IpcChannel.CloseMachineLink),
  onMachineLinkData(listener) {
    const handleData = (_event: IpcRendererEvent, chunk: string): void => listener(chunk);
    ipcRenderer.on(IpcChannel.MachineLinkData, handleData);
    return () => ipcRenderer.off(IpcChannel.MachineLinkData, handleData);
  },
  onMachineLinkClosed(listener) {
    const handleClosed = (): void => listener();
    ipcRenderer.on(IpcChannel.MachineLinkClosed, handleClosed);
    return () => ipcRenderer.off(IpcChannel.MachineLinkClosed, handleClosed);
  },
};

contextBridge.exposeInMainWorld('desktopBridge', bridge);
