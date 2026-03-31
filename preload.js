const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('usb', {
  // Window
  minimize: ()       => ipcRenderer.send('window-minimize'),
  close:    ()       => ipcRenderer.send('window-close'),
  navigate: (page)   => ipcRenderer.invoke('navigate', page),

  // Setup
  getSetupStatus: ()      => ipcRenderer.invoke('get-setup-status'),
  saveSetup:      (data)  => ipcRenderer.invoke('save-setup', data),

  // Openclaw
  startOpenclaw:    ()    => ipcRenderer.invoke('start-openclaw'),
  stopOpenclaw:     ()    => ipcRenderer.invoke('stop-openclaw'),
  getOpenclawStatus: ()   => ipcRenderer.invoke('get-openclaw-status'),
  repairConfig:     ()    => ipcRenderer.invoke('repair-config'),
  preflightCheck:   ()    => ipcRenderer.invoke('preflight-check'),
  killPort:         (port) => ipcRenderer.invoke('kill-port', port),

  // Config
  updateApiKey: (key, provider, opts) => ipcRenderer.invoke('update-api-key', { key, provider, ...opts }),
  validateApiKey: (key, provider, baseUrl) => ipcRenderer.invoke('validate-api-key', { key, provider, baseUrl }),
  getVersion:   ()    => ipcRenderer.invoke('get-version'),

  // WeChat ClawBot
  getWeixinStatus:      () => ipcRenderer.invoke('get-weixin-status'),
  installWeixinPlugin:  () => ipcRenderer.invoke('install-weixin-plugin'),
  loginWeixinChannel:   () => ipcRenderer.invoke('login-weixin-channel'),
  onWeixinLoginOutput: (cb) => {
    ipcRenderer.removeAllListeners('weixin-login-output')
    ipcRenderer.on('weixin-login-output', (_, msg) => cb(msg))
  },
  onWeixinLoginDone: (cb) => {
    ipcRenderer.removeAllListeners('weixin-login-done')
    ipcRenderer.on('weixin-login-done', (_, code) => cb(code))
  },
  updateWeixinPlugin: () => ipcRenderer.invoke('update-weixin-plugin'),

  onWeixinUpdateOutput: (cb) => {
    ipcRenderer.removeAllListeners('weixin-update-output')
    ipcRenderer.on('weixin-update-output', (_, msg) => cb(msg))
  },
  onWeixinUpdateDone: (cb) => {
    ipcRenderer.removeAllListeners('weixin-update-done')
    ipcRenderer.on('weixin-update-done', (_, code) => cb(code))
  },

  // Support
  getLicenseInfo: () => ipcRenderer.invoke('get-license-info'),

  // Pet
  showPet: () => ipcRenderer.invoke('show-pet'),
  hidePet: () => ipcRenderer.invoke('hide-pet'),

  // Utils
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openUiWindow:  ()    => ipcRenderer.invoke('open-ui-window'),

  // Events
  onUsbRemoved: (cb) => {
    ipcRenderer.removeAllListeners('usb-removed')
    ipcRenderer.on('usb-removed', cb)
  },
  onOpenclawLog:   (cb) => {
    ipcRenderer.removeAllListeners('openclaw-log')
    ipcRenderer.on('openclaw-log', (_, msg) => cb(msg))
  },
  onOpenclawStopped: (cb) => {
    ipcRenderer.removeAllListeners('openclaw-stopped')
    ipcRenderer.on('openclaw-stopped', (_, code) => cb(code))
  },
  onNetworkRetry: (cb) => {
    ipcRenderer.removeAllListeners('openclaw-network-retry')
    ipcRenderer.on('openclaw-network-retry', () => cb())
  },
  onAutoRestart: (cb) => {
    ipcRenderer.removeAllListeners('openclaw-auto-restart')
    ipcRenderer.on('openclaw-auto-restart', () => cb())
  }
})
