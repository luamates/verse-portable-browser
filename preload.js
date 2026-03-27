const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('verse', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximizeToggle: () => ipcRenderer.invoke('window:maximize-toggle'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),

  newTab: (url) => ipcRenderer.invoke('tab:new', url),
  activateTab: (id) => ipcRenderer.invoke('tab:activate', id),
  closeTab: (id) => ipcRenderer.invoke('tab:close', id),
  navigate: (input) => ipcRenderer.invoke('tab:navigate', input),
  reload: () => ipcRenderer.invoke('tab:reload'),
  stop: () => ipcRenderer.invoke('tab:stop'),
  goBack: () => ipcRenderer.invoke('tab:back'),
  goForward: () => ipcRenderer.invoke('tab:forward'),
  zoomIn: () => ipcRenderer.invoke('tab:zoom-in'),
  zoomOut: () => ipcRenderer.invoke('tab:zoom-out'),
  zoomReset: () => ipcRenderer.invoke('tab:zoom-reset'),

  startSession: (engineKey) => ipcRenderer.invoke('session:start', engineKey),
  goHome: () => ipcRenderer.invoke('session:go-home'),
  getSessionState: () => ipcRenderer.invoke('session:get-state'),
  setMenuOffset: (offset) => ipcRenderer.invoke('ui:set-menu-offset', offset),

  onState: (callback) => {
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on('browser-state', wrapped);
    return () => ipcRenderer.removeListener('browser-state', wrapped);
  }
});
