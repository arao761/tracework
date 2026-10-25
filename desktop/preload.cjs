const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'traceworkDesktop',
  Object.freeze({
    copyText: (value) => ipcRenderer.invoke('tracework:copy', value),
    getStatus: () => ipcRenderer.invoke('tracework:status'),
    updateSettings: (value) => ipcRenderer.invoke('tracework:settings', value),
    chooseDirectory: (initial) => ipcRenderer.invoke('tracework:directory', initial),
    importWorkspace: () => ipcRenderer.invoke('tracework:import-workspace'),
    openDataFolder: () => ipcRenderer.invoke('tracework:open-data'),
    checkUpdates: () => ipcRenderer.invoke('tracework:updates'),
  }),
);
