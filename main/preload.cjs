const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cleo", {
  // já existente:
  scheduleMeeting: async (payload, options) =>
    ipcRenderer.invoke("cleo:schedule", { payload, options }),
  deleteEvent: async (payload, options) =>
    ipcRenderer.invoke('cleo:delete-event', { payload, options }),
  ffmpeg: {
    processVideo: async (payload) => ipcRenderer.invoke('ffmpeg:process', payload),
    generateCommand: async (payload) => ipcRenderer.invoke('openai:ffmpeg-command', payload),
  },
  openai: {
    ffmpegCommand: async (payload) => ipcRenderer.invoke('openai:ffmpeg-command', payload),
  },

  // novo — permite ouvir respostas do main:
  receive: (channel, callback) => {
    const validChannels = ["chat:reply"]; // só libera esse canal
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, data) => callback(data));
    }
  },

  // abrir URL no navegador padrão
  openExternal: async (url) => ipcRenderer.invoke("cleo:openExternal", url),

  // histórico
  history: {
    load: async () => ipcRenderer.invoke('cleo:history-load'),
    append: async (entry, options) => ipcRenderer.invoke('cleo:history-append', { entry, options }),
    clear: async () => ipcRenderer.invoke('cleo:history-clear'),
    path: async () => ipcRenderer.invoke('cleo:history-path')
  },
  // Controle do ChatEK (Mattermost) via BrowserView
  chatek: {
    show: async (url) => ipcRenderer.invoke('chatek:show', { url }),
    hide: async () => ipcRenderer.invoke('chatek:hide'),
    setSidebarWidth: async (width) => ipcRenderer.invoke('chatek:setSidebarWidth', { width })
  }
});
