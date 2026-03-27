const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('verseSplash', {
  onStartFade: (callback) => {
    const wrapped = () => callback();
    ipcRenderer.on('start-fade-out', wrapped);
    return () => ipcRenderer.removeListener('start-fade-out', wrapped);
  }
});
