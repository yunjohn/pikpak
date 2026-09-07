const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('viewerProgress', {
  get: fileId => ipcRenderer.invoke('viewer:progress-get', fileId),
  set: payload => ipcRenderer.invoke('viewer:progress-set', payload)
});
contextBridge.exposeInMainWorld('viewerPlayback', {
  setPlaying: value => ipcRenderer.invoke('viewer:playing', Boolean(value))
});
contextBridge.exposeInMainWorld('viewerPayload', {
  get: token => ipcRenderer.invoke('viewer:payload-get', token),
  chooseSubtitle: () => ipcRenderer.invoke('viewer:subtitle-choose'),
  decodeSubtitle: bytes => ipcRenderer.invoke('viewer:subtitle-decode', bytes),
  resolveMedia: fileId => ipcRenderer.invoke('viewer:media-resolve', String(fileId || '')),
  refreshMedia: fileId => ipcRenderer.invoke('viewer:media-refresh', String(fileId || '')),
  capture: payload => ipcRenderer.invoke('viewer:capture', payload)
});
