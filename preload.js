const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('tasks:load'),
  info: () => ipcRenderer.invoke('app:info'),
  save: (data) => ipcRenderer.send('tasks:save', data),
  archive: (tasks) => ipcRenderer.send('tasks:archive', tasks),
  hide: () => ipcRenderer.send('window:hide'),
  resize: (height) => ipcRenderer.send('window:resize', height),
  onShown: (cb) => ipcRenderer.on('window:shown', () => cb()),
});
