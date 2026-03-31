const { app, BrowserWindow, ipcMain, shell, dialog, screen } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const net = require('net')

// ─── 模块导入 ──────────────────────────────────────────────────────────────
const {
  usbRoot, dataDir, setupFile, configDir,
  tempCacheDir, tempOpenclawDir, tempVersionFile,
  getNodePath, getOpenclawMjs, getZipVersion, ensureDirs,
  buildOpenclawEnv,
  backupSetup, restoreSetup
} = require('./src/paths')

const {
  applyProviderConfig, buildOpenclawConfig, applyFreshGatewayToken,
  sanitizeConfig
} = require('./src/config')

const { translateLog } = require('./src/log-translate')
const { getVolSerial, verifyLicense } = require('./src/license')

const APP_VERSION = require('./package.json').version

// ─── 全局状态 ──────────────────────────────────────────────────────────────
let mainWindow
let petWindow = null
let openclawProc = null
let usbMonitorTimer = null
let currentGatewayToken = null   // fresh random token for each gateway run
let weixinLoginProc = null
let weixinUpdateProc = null

// 日志回调：向 UI 推送消息
const sendLog = (msg) => mainWindow?.webContents.send('openclaw-log', msg)

// ─── Window ────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 760,
    minHeight: 520,
    resizable: true,
    frame: false,
    backgroundColor: '#0f0f23',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const isSetup = fs.existsSync(setupFile)
  mainWindow.loadFile(isSetup ? 'launcher.html' : 'setup.html')
  mainWindow.once('ready-to-show', () => mainWindow.show())
}

app.whenReady().then(async () => {
  if (!await verifyLicense()) return
  await extractOpenclawIfNeeded()
  createWindow()
  startUsbMonitor()
})

// ─── 首次解压 ──────────────────────────────────────────────────────────────

async function extractOpenclawIfNeeded() {
  if (!app.isPackaged) return

  const openclawZip = path.join(usbRoot, 'openclaw.zip')
  const mjs         = path.join(tempOpenclawDir, 'openclaw.mjs')

  if (!fs.existsSync(openclawZip)) return

  // 版本校验：zip 未变化且缓存完整则跳过解压
  const currentVersion = getZipVersion(openclawZip)
  const fileOk = (f) => { try { return fs.statSync(f).size > 0 } catch { return false } }
  try {
    const cachedVersion = fs.readFileSync(tempVersionFile, 'utf8').trim()
    const hasEntry = fileOk(path.join(tempOpenclawDir, 'dist', 'entry.js'))
      || fileOk(path.join(tempOpenclawDir, 'dist', 'entry.mjs'))
    const hasCritical = fileOk(mjs) && fileOk(path.join(tempOpenclawDir, 'package.json')) && hasEntry
    if (cachedVersion === currentVersion && hasCritical) {
      purgeBrokenPlugins()
      patchPluginSdkRootAlias()
      return
    }
  } catch {}

  // 清理旧缓存
  try { fs.rmSync(tempCacheDir, { recursive: true, force: true }) } catch {}
  fs.mkdirSync(tempCacheDir, { recursive: true })

  // 显示解压进度窗口
  const splash = new BrowserWindow({
    width: 460, height: 230,
    frame: false, resizable: false, center: true,
    backgroundColor: '#0f0f23',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  splash.loadURL(`data:text/html;charset=utf-8,<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:%230f0f23;color:%23c0c0e0;font-family:'Microsoft YaHei',sans-serif;
       display:flex;flex-direction:column;align-items:center;justify-content:center;
       height:100vh;gap:12px;text-align:center;padding:0 36px;}
  h3{font-size:15px;font-weight:600;}
  .bar-wrap{width:360px;height:8px;background:%231a1a2e;border-radius:4px;overflow:hidden;}
  .bar-fill{height:100%;width:0%;background:linear-gradient(90deg,%23667eea,%23764ba2);
            border-radius:4px;transition:width 0.2s ease;}
  .pct{font-size:13px;font-weight:600;color:%23667eea;}
  .tip{font-size:11px;color:%23666688;line-height:1.7;}
</style></head><body>
  <h3>首次运行，正在准备 OpenClaw...</h3>
  <div class="bar-wrap"><div class="bar-fill" id="bar"></div></div>
  <div class="pct" id="pct">0%</div>
  <div class="tip">仅首次启动需要，约 30-60 秒<br>请勿关闭程序或拔出 U 盘</div>
  <script>
    function updateProgress(p){
      document.getElementById('bar').style.width = p + '%';
      document.getElementById('pct').textContent = p + '%';
    }
  </script>
</body></html>`)

  await new Promise(resolve => {
    splash.webContents.once('did-finish-load', resolve)
    setTimeout(resolve, 3000)
  })

  // 用 yauzl 解压到本机 TEMP，实时推送进度（5分钟超时兜底）
  let ok = false
  try {
    const extractPromise = new Promise((resolve) => {
      const yauzl = require('yauzl')
      yauzl.open(openclawZip, { lazyEntries: true }, (err, zipfile) => {
        if (err) return resolve(false)
        const total = zipfile.entryCount
        let done = 0
        let lastPct = -1
        let lastPushTime = 0

        const pushProgress = () => {
          const pct = Math.round((done / total) * 100)
          const now = Date.now()
          if (pct === lastPct || now - lastPushTime < 300) return
          lastPct = pct
          lastPushTime = now
          try { splash.webContents.executeJavaScript(`updateProgress(${pct})`) } catch {}
        }

        zipfile.readEntry()

        zipfile.on('entry', (entry) => {
          done++
          pushProgress()
          // 标准化路径分隔符（Windows ZipFile.CreateFromDirectory 用反斜杠，yauzl 不识别）
          const entryName = entry.fileName.replace(/\\/g, '/')
          const dest = path.join(tempOpenclawDir, entryName)
          if (/\/$/.test(entryName)) {
            fs.mkdirSync(dest, { recursive: true })
            zipfile.readEntry()
          } else {
            fs.mkdirSync(path.dirname(dest), { recursive: true })
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) return resolve(false)
              const ws = fs.createWriteStream(dest)
              readStream.pipe(ws)
              ws.on('close', () => zipfile.readEntry())
              ws.on('error', () => resolve(false))
            })
          }
        })

        zipfile.on('end', () => resolve(true))
        zipfile.on('error', () => resolve(false))
      })
    })
    const timeoutPromise = new Promise(r => setTimeout(() => r(false), 5 * 60 * 1000))
    ok = await Promise.race([extractPromise, timeoutPromise])
  } catch (e) {
    ok = false
  }

  splash.close()

  // 解压后校验关键文件完整性
  const extractComplete = ok && fs.existsSync(mjs)
    && fs.existsSync(path.join(tempOpenclawDir, 'package.json'))
    && (fs.existsSync(path.join(tempOpenclawDir, 'dist', 'entry.js'))
        || fs.existsSync(path.join(tempOpenclawDir, 'dist', 'entry.mjs')))

  if (!extractComplete) {
    try { fs.rmSync(tempCacheDir, { recursive: true, force: true }) } catch {}
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: '程序准备失败',
      message: '程序文件准备失败，无法启动',
      detail: '可能原因：\n'
        + '1. 杀毒软件拦截了文件解压（最常见）\n'
        + '2. 本机磁盘空间不足（需要约 1.5 GB 临时空间）\n'
        + '3. U 盘文件损坏\n\n'
        + '建议：先将杀毒软件临时关闭或添加白名单，再点击"重试"。',
      buttons: ['重试', '退出'],
      defaultId: 0
    })
    if (choice === 0) {
      app.relaunch()
      app.quit()
    } else {
      app.quit()
    }
    return
  }

  purgeBrokenPlugins()
  patchPluginSdkRootAlias()

  // 写入版本标记，下次启动直接命中缓存
  try { fs.writeFileSync(tempVersionFile, currentVersion, 'utf8') } catch {}
}

// ─── Plugin patches ────────────────────────────────────────────────────────

function patchPluginSdkRootAlias() {
  const pluginSdkDir = path.join(tempOpenclawDir, 'dist', 'plugin-sdk')
  const rootAlias = path.join(pluginSdkDir, 'root-alias.cjs')
  if (!fs.existsSync(rootAlias)) return
  let content = fs.readFileSync(rootAlias, 'utf8')
  if (content.includes('// openclaw-usb-patch-v2')) return

  if (!content.includes('module.exports = rootExports')) {
    content += '\nmodule.exports = rootExports;\n'
    fs.writeFileSync(rootAlias, content, 'utf8')
  }

  const submodules = fs.readdirSync(pluginSdkDir)
    .filter(f => f.endsWith('.js') && f !== 'root-alias.cjs')

  const lines = [
    '\n// openclaw-usb-patch-v2: merge all plugin-sdk submodule exports into target',
    'try {',
    '  const { createRequire } = require("node:module");',
    '  const _nr = createRequire(__filename);',
  ]
  for (const mod of submodules) {
    lines.push(`  try { Object.assign(target, _nr("./${mod}")); } catch {}`)
  }
  lines.push('} catch {}')
  fs.appendFileSync(rootAlias, lines.join('\n') + '\n', 'utf8')
}

function purgeBrokenPlugins() {
  const BROKEN_PLUGINS = [
    'acpx', 'diagnostics-otel', 'diffs', 'googlechat', 'matrix',
    'memory-lancedb', 'msteams', 'nostr', 'tlon', 'twitch', 'whatsapp', 'zalouser'
  ]
  const extDir = path.join(tempOpenclawDir, 'dist', 'extensions')
  for (const name of BROKEN_PLUGINS) {
    try { fs.rmSync(path.join(extDir, name), { recursive: true, force: true }) } catch {}
  }
}

// ─── App lifecycle ─────────────────────────────────────────────────────────

app.on('window-all-closed', () => {
  killOpenclaw()
  if (usbMonitorTimer) { clearInterval(usbMonitorTimer); usbMonitorTimer = null }
  try { if (weixinLoginProc)  { weixinLoginProc.kill();  weixinLoginProc  = null } } catch {}
  try { if (weixinUpdateProc) { weixinUpdateProc.kill(); weixinUpdateProc = null } } catch {}
  app.quit()
})

// ─── Pet Window ────────────────────────────────────────────────────────────

function createPetWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  petWindow = new BrowserWindow({
    width: 220,
    height: 320,
    x: width - 230,
    y: height - 330,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'pet-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  petWindow.loadFile('pet.html')
  petWindow.setIgnoreMouseEvents(true, { forward: true })
  petWindow.on('closed', () => { petWindow = null })
}

function updatePetStatus(running) {
  if (petWindow) petWindow.webContents.send('pet-status', { running })
}

ipcMain.handle('show-pet', () => {
  if (!petWindow) createPetWindow()
  else petWindow.show()
  return { ok: true }
})

ipcMain.handle('hide-pet', () => {
  if (petWindow) petWindow.hide()
  return { ok: true }
})

ipcMain.on('pet-ignore-mouse', (_, ignore) => {
  if (!petWindow) return
  if (ignore) petWindow.setIgnoreMouseEvents(true, { forward: true })
  else         petWindow.setIgnoreMouseEvents(false)
})

ipcMain.handle('pet-open-ui', async () => {
  const url = currentGatewayToken
    ? `http://127.0.0.1:18789/#token=${currentGatewayToken}`
    : `http://127.0.0.1:18789/`
  await openUrl(url)
  return { ok: true }
})

// ─── USB Monitor ───────────────────────────────────────────────────────────

function startUsbMonitor() {
  if (!app.isPackaged) return
  const drive = path.resolve(usbRoot).charAt(0).toUpperCase()

  let missCount = 0
  let checking = false
  usbMonitorTimer = setInterval(() => {
    if (checking) return
    checking = true
    fs.access(`${drive}:\\`, fs.constants.F_OK, (err) => {
      checking = false
      if (!err) {
        missCount = 0
        return
      }
      if (++missCount < 3) return
      clearInterval(usbMonitorTimer)
      usbMonitorTimer = null
      killOpenclaw()
      mainWindow?.webContents.send('usb-removed')
      setTimeout(() => app.quit(), 2500)
    })
  }, 800)
}

// ─── Process management ────────────────────────────────────────────────────

// [修复 #12] Windows 进程强杀改用 taskkill，SIGKILL 在 Windows 上等同 SIGTERM 无额外效果
function killOpenclaw() {
  if (!openclawProc) return
  const proc = openclawProc
  openclawProc = null
  try { proc.kill('SIGTERM') } catch {}
  setTimeout(() => {
    try {
      if (proc.pid && !proc.killed) {
        const { execFile } = require('child_process')
        execFile('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { windowsHide: true }, () => {})
      }
    } catch {}
  }, 2000)
}

// 运行 openclaw doctor --fix
function runDoctorFix(nodePath, mjs) {
  return new Promise(resolve => {
    let resolved = false
    const done = () => { if (!resolved) { resolved = true; resolve() } }
    const proc = spawn(nodePath, [mjs, 'doctor', '--fix'], {
      env: buildOpenclawEnv(), cwd: tempOpenclawDir, shell: false, stdio: ['ignore', 'pipe', 'pipe']
    })
    proc.stdout.on('data', (d) => sendLog(d.toString('utf8')))
    proc.stderr.on('data', (d) => sendLog(d.toString('utf8')))
    proc.on('exit', done)
    proc.on('error', done)
    setTimeout(() => { try { proc.kill() } catch {} done() }, 10000)
  })
}

// ─── IPC: Window ──────────────────────────────────────────────────────────

ipcMain.on('window-minimize', () => mainWindow?.minimize())
ipcMain.on('window-close',    () => app.quit())

// [修复 #11] openUrl 的 cmd fallback 用双引号包裹 URL，防止 & 等特殊字符被截断
async function openUrl(url) {
  try {
    await shell.openExternal(url)
  } catch {
    const { execFile } = require('child_process')
    execFile('cmd', ['/c', 'start', '""', url], { windowsHide: true })
  }
}

ipcMain.handle('open-external', async (_, url) => {
  if (typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return { ok: false, error: 'invalid url' }
  }
  await openUrl(url)
  return { ok: true }
})

// ─── IPC: Navigation ──────────────────────────────────────────────────────

const ALLOWED_PAGES = ['setup', 'launcher']
ipcMain.handle('navigate', (_, page) => {
  if (!ALLOWED_PAGES.includes(page)) return { ok: false, error: 'invalid page' }
  mainWindow.loadFile(page + '.html')
  return { ok: true }
})

// ─── IPC: Setup ───────────────────────────────────────────────────────────

ipcMain.handle('get-setup-status', () => {
  if (!fs.existsSync(setupFile)) return { done: false }
  try {
    return { done: true, setup: JSON.parse(fs.readFileSync(setupFile, 'utf8')) }
  } catch { return { done: false } }
})

ipcMain.handle('save-setup', async (_, setup) => {
  try {
    await ensureDirs()
    const config = buildOpenclawConfig(setup)
    await fs.promises.writeFile(
      path.join(configDir, 'openclaw.json'),
      JSON.stringify(config, null, 2), 'utf8'
    )
    await fs.promises.writeFile(setupFile, JSON.stringify({
      ...setup,
      apiKey: setup.apiKey ? '***' : '',
      savedAt: new Date().toISOString()
    }, null, 2), 'utf8')
    await backupSetup()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ─── IPC: Openclaw ────────────────────────────────────────────────────────

ipcMain.handle('get-openclaw-status', () => ({
  running: openclawProc !== null
}))

ipcMain.handle('start-openclaw', async () => {
  if (openclawProc) return { ok: true, already: true }

  const nodePath = getNodePath()
  const mjs = getOpenclawMjs()

  if (!mjs) return { ok: false, error: '程序文件未找到，请确认 U 盘内容完整' }

  await ensureDirs()

  // ── 统一自愈流程 ─────────────────────────────────────────────
  await sanitizeConfig(sendLog)

  currentGatewayToken = await applyFreshGatewayToken()

  // setup.json 丢失时尝试从备份恢复
  await restoreSetup()

  // token 失败 → 尝试从 setup.json 重建配置
  if (!currentGatewayToken && fs.existsSync(setupFile)) {
    try {
      const setup = JSON.parse(await fs.promises.readFile(setupFile, 'utf8'))
      const config = buildOpenclawConfig(setup)
      await fs.promises.writeFile(
        path.join(configDir, 'openclaw.json'),
        JSON.stringify(config, null, 2), 'utf8'
      )
      sendLog('正在自动恢复配置...\n')
      currentGatewayToken = await applyFreshGatewayToken()
      if (currentGatewayToken) {
        return { ok: false, needApiKey: true, error: '配置已自动恢复，需要重新输入 API Key' }
      }
    } catch (e) {
      console.error('[start-openclaw] rebuild from setup.json failed:', e.message)
    }
  }

  if (!currentGatewayToken) {
    return { ok: false, error: '配置文件丢失或损坏，请点击"一键修复"或重新完成初始配置' }
  }

  await runDoctorFix(nodePath, mjs)

  // ── 启动 gateway ────────────────────────────────────────────
  // [修复 #10] 使用环形缓冲限制 gatewayLog 内存
  const LOG_MAX = 100000
  let gatewayLog = ''

  try {
    openclawProc = spawn(nodePath, [mjs, 'gateway'], {
      env: buildOpenclawEnv(),
      cwd: tempOpenclawDir,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const onLog = (d) => {
      const s = d.toString('utf8')
      gatewayLog += s
      if (gatewayLog.length > LOG_MAX * 2) gatewayLog = gatewayLog.slice(-LOG_MAX)

      const bcMatch = s.match(/Browser control listening on http:\/\/127\.0\.0\.1:(\d+)/)
      // browserControlPort 备用，未来可能用于直连 Browser Control UI

      // 日志翻译
      const result = translateLog(s)
      if (result === null) {
        if (s.trim()) sendLog(s)
      } else if (result.hide) {
        // 隐藏此行
      } else if (result.append) {
        sendLog(result.append + '\n')
      }
    }
    openclawProc.stdout.on('data', onLog)
    openclawProc.stderr.on('data', onLog)
    updatePetStatus(true)
    const startTime = Date.now()
    openclawProc.on('exit', async (code) => {
      openclawProc = null
      currentGatewayToken = null
      updatePetStatus(false)

      // Config invalid：自动修复后通知前端重启
      if (gatewayLog.includes('Config invalid')) {
        sendLog('\n正在自动修复配置问题...\n')
        await sanitizeConfig(sendLog)
        await runDoctorFix(nodePath, mjs)
        const token = await applyFreshGatewayToken()
        if (token) {
          sendLog('配置已修复，正在重新启动...\n')
          mainWindow?.webContents.send('openclaw-auto-restart')
          return
        }
        sendLog('自动修复未能解决问题，请联系售后支持\n')
      }

      // 网络超时等瞬时错误
      const uptime = Date.now() - startTime
      const isNetworkError = /ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed/i.test(gatewayLog)
      if (code !== 0 && uptime < 30000 && isNetworkError) {
        mainWindow?.webContents.send('openclaw-network-retry')
      }
      mainWindow?.webContents.send('openclaw-stopped', code)
    })
    openclawProc.on('error', err => {
      openclawProc = null
      sendLog('[错误] ' + err.message)
      mainWindow?.webContents.send('openclaw-stopped', -1)
    })

    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('stop-openclaw', () => {
  killOpenclaw()
  return { ok: true }
})

// ─── IPC: Repair config ────────────────────────────────────────────────────

ipcMain.handle('repair-config', async () => {
  try {
    const configPath = path.join(configDir, 'openclaw.json')

    // setup.json 丢失时尝试从备份恢复
    await restoreSetup()

    // openclaw.json 不存在，但 setup.json 存在 → 从 setup 重建完整配置
    if (!fs.existsSync(configPath) && fs.existsSync(setupFile)) {
      try {
        const setup = JSON.parse(await fs.promises.readFile(setupFile, 'utf8'))
        await ensureDirs()
        const config = buildOpenclawConfig(setup)
        await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
      } catch (e) {
        return { ok: false, error: '从已有配置重建失败: ' + e.message }
      }
    }

    if (!fs.existsSync(configPath)) return { ok: false, error: '配置文件不存在，请先完成初始配置' }

    await sanitizeConfig(sendLog)

    const token = await applyFreshGatewayToken()
    if (token) return { ok: true }

    // token 为 null 说明 JSON 可能损坏
    try {
      JSON.parse(await fs.promises.readFile(configPath, 'utf8'))
    } catch {
      await fs.promises.unlink(configPath).catch(() => {})
      await ensureDirs()
      const newToken = crypto.randomBytes(24).toString('hex')
      const minimalConfig = {
        meta: { lastTouchedVersion: APP_VERSION, lastTouchedAt: new Date().toISOString() },
        gateway: {
          mode: 'local',
          auth: { mode: 'token', token: newToken },
          controlUi: { allowInsecureAuth: true, dangerouslyDisableDeviceAuth: true }
        },
        update: { checkOnStart: false }
      }
      await fs.promises.writeFile(configPath, JSON.stringify(minimalConfig, null, 2), 'utf8')
      return { ok: false, needsReconfig: true, error: '配置文件已损坏并重建，需要重新输入 API Key，请点击"修改 API Key"' }
    }

    return { ok: false, error: '修复失败，请联系售后支持' }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ─── IPC: Update API Key ──────────────────────────────────────────────────
// [修复 #5] 使用统一的 applyProviderConfig 消除重复 switch

ipcMain.handle('update-api-key', async (_, payload) => {
  try {
    const configPath = path.join(configDir, 'openclaw.json')
    if (!fs.existsSync(configPath)) return { ok: false, error: '配置文件不存在，请先完成初始配置' }
    if (!fs.existsSync(setupFile)) return { ok: false, error: '初始配置不存在，请先完成初始配置' }

    const newKey  = typeof payload === 'string' ? payload : payload.key
    const setup   = JSON.parse(await fs.promises.readFile(setupFile, 'utf8'))
    const cfg     = JSON.parse(await fs.promises.readFile(configPath, 'utf8'))
    const provider = (typeof payload === 'object' && payload.provider) ? payload.provider : setup.aiProvider

    // 切换服务商时，先清除所有旧的 API Key 配置
    if (provider !== setup.aiProvider) {
      if (cfg.env) {
        delete cfg.env.ANTHROPIC_API_KEY
        delete cfg.env.ANTHROPIC_BASE_URL
        delete cfg.env.OPENAI_API_KEY
        delete cfg.env.ZAI_API_KEY
      }
      delete cfg.models
    }

    // 使用统一函数写入新服务商配置
    applyProviderConfig(cfg, provider, newKey, {
      baseUrl: (typeof payload === 'object' && payload.baseUrl) || setup.baseUrl,
      modelId: (typeof payload === 'object' && payload.modelId) || setup.customModelId,
    })

    await fs.promises.writeFile(configPath, JSON.stringify(cfg, null, 2), 'utf8')

    // 同步更新 setup.json 中的服务商记录
    const providerChanged = provider !== setup.aiProvider
    setup.aiProvider = provider
    setup.apiKey = '***'
    setup.savedAt = new Date().toISOString()
    if (providerChanged) {
      delete setup.baseUrl
      delete setup.customModelId
    }
    if (provider === 'custom') {
      setup.baseUrl = (typeof payload === 'object' && payload.baseUrl) || ''
      setup.customModelId = (typeof payload === 'object' && payload.modelId) || ''
    }
    if (provider === 'volcengine') {
      setup.customModelId = (typeof payload === 'object' && payload.modelId) || ''
    }
    await fs.promises.writeFile(setupFile, JSON.stringify(setup, null, 2), 'utf8')
    await backupSetup()

    return { ok: true, provider }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ─── IPC: Validate API Key ────────────────────────────────────────────────

const API_VALIDATORS = {
  anthropic: (key, baseUrl) => ({
    url: (baseUrl || 'https://api.anthropic.com') + '/v1/messages',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
  }),
  openai: (key, baseUrl) => ({
    url: (baseUrl || 'https://api.openai.com') + '/v1/models',
    headers: { 'Authorization': 'Bearer ' + key }
  }),
  deepseek: (key) => ({
    url: 'https://api.deepseek.com/v1/models',
    headers: { 'Authorization': 'Bearer ' + key }
  }),
  qwen: (key) => ({
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
    headers: { 'Authorization': 'Bearer ' + key }
  }),
  glm: (key) => ({
    url: 'https://open.bigmodel.cn/api/paas/v4/models',
    headers: { 'Authorization': 'Bearer ' + key }
  }),
  volcengine: (key) => ({
    url: 'https://ark.cn-beijing.volces.com/api/v3/models',
    headers: { 'Authorization': 'Bearer ' + key }
  }),
}

// [修复 #8] 放宽协议限制，支持 HTTP（为 API 代理网关做准备）
ipcMain.handle('validate-api-key', async (_, { key, provider, baseUrl }) => {
  const builder = API_VALIDATORS[provider]
  if (!builder) return { ok: true }  // custom 等未知 provider 跳过验证

  try {
    const config = builder(key, baseUrl)
    const { URL } = require('url')
    const url = new URL(config.url)

    // 仅允许 http 和 https 协议
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false, error: 'API 地址协议不支持，请使用 http:// 或 https://' }
    }

    const httpModule = url.protocol === 'https:' ? require('https') : require('http')

    const result = await new Promise((resolve) => {
      let resolved = false
      const done = (val) => { if (!resolved) { resolved = true; resolve(val) } }

      const req = httpModule.request(url, {
        method: config.body ? 'POST' : 'GET',
        headers: config.headers,
        timeout: 15000,
      }, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            let msg = 'API Key 无效或已过期'
            try {
              const body = JSON.parse(data)
              const errMsg = body.error?.message || body.message || ''
              if (errMsg.includes('quota') || errMsg.includes('balance') || errMsg.includes('insufficient'))
                msg = 'API Key 有效，但账户余额不足'
              else if (errMsg.includes('expired'))
                msg = 'API Key 已过期，请更换'
              else if (errMsg.includes('invalid'))
                msg = 'API Key 无效，请检查是否复制完整'
            } catch {}
            done({ ok: false, error: msg })
          } else {
            done({ ok: true })
          }
        })
      })
      req.on('timeout', () => { req.destroy(); done({ ok: false, error: '连接超时，请检查网络（15秒）' }) })
      req.on('error', (e) => {
        if (e.code === 'ENOTFOUND') done({ ok: false, error: '无法连接服务商，请检查网络' })
        else if (e.code === 'ECONNREFUSED') done({ ok: false, error: '服务商拒绝连接，请检查网络' })
        else done({ ok: false, error: '网络错误: ' + e.message })
      })
      if (config.body) req.write(config.body)
      req.end()
    })

    return result
  } catch (e) {
    return { ok: false, error: '验证失败: ' + e.message }
  }
})

// ─── IPC: WeChat ClawBot ──────────────────────────────────────────────────

function getWeixinPluginDir() {
  return path.join(configDir, 'extensions', 'openclaw-weixin')
}

ipcMain.handle('get-weixin-status', () => {
  const installed = fs.existsSync(
    path.join(configDir, 'extensions', 'openclaw-weixin', 'openclaw.plugin.json')
  )
  return { installed }
})

// [修复 #6] 消除 async Promise 构造函数反模式
ipcMain.handle('install-weixin-plugin', async () => {
  let zipPath = path.join(usbRoot, 'weixin-plugin.zip')
  if (!fs.existsSync(zipPath)) {
    zipPath = path.join(app.getAppPath(), 'assets', 'weixin-plugin.zip')
  }
  if (!fs.existsSync(zipPath)) {
    return { ok: false, error: '未找到 weixin-plugin.zip，请联系作者获取插件包' }
  }

  const destDir = path.join(configDir, 'extensions')
  const pluginDir = path.join(destDir, 'openclaw-weixin')

  try {
    await fs.promises.rm(pluginDir, { recursive: true, force: true }).catch(() => {})
    await fs.promises.mkdir(destDir, { recursive: true })
  } catch (e) {
    return { ok: false, error: '准备目录失败: ' + e.message }
  }

  sendLog('Extracting ' + zipPath + '…\n')

  return new Promise(resolve => {
    const yauzl = require('yauzl')
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return resolve({ ok: false, error: '解压失败: ' + err.message })

      zipfile.readEntry()
      zipfile.on('entry', (entry) => {
        const name = entry.fileName.replace(/\\/g, '/')
        const dest = path.join(destDir, name)
        if (!path.normalize(dest).startsWith(path.normalize(destDir))) {
          return resolve({ ok: false, error: '不合法的归档条目: ' + name })
        }
        if (/\/$/.test(name)) {
          fs.mkdirSync(dest, { recursive: true })
          zipfile.readEntry()
        } else {
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) return resolve({ ok: false, error: '解压失败: ' + err.message })
            const ws = fs.createWriteStream(dest)
            readStream.pipe(ws)
            ws.on('close', () => zipfile.readEntry())
            ws.on('error', (e) => resolve({ ok: false, error: e.message }))
          })
        }
      })

      zipfile.on('end', () => {
        const manifest = path.join(pluginDir, 'openclaw.plugin.json')
        if (fs.existsSync(manifest)) {
          sendLog('✅ 插件解压完成\n')
          resolve({ ok: true })
        } else {
          resolve({ ok: false, error: '解压完成但未找到 openclaw.plugin.json，请检查 zip 格式' })
        }
      })
      zipfile.on('error', (e) => resolve({ ok: false, error: e.message }))
    })
  })
})

ipcMain.handle('login-weixin-channel', () => {
  const nodePath = getNodePath()
  const mjs = getOpenclawMjs()
  if (!mjs) return { ok: false, error: 'OpenClaw 未找到' }

  if (weixinLoginProc) {
    try { weixinLoginProc.kill() } catch {}
    weixinLoginProc = null
  }

  const proc = spawn(nodePath, [mjs, 'channels', 'login', '--channel', 'openclaw-weixin'], {
    env: buildOpenclawEnv(),
    cwd: tempOpenclawDir,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  weixinLoginProc = proc

  const send = (data) => mainWindow?.webContents.send('weixin-login-output', data.toString('utf8'))
  proc.stdout.on('data', send)
  proc.stderr.on('data', send)
  proc.on('exit', code => {
    weixinLoginProc = null
    mainWindow?.webContents.send('weixin-login-done', code)
  })
  proc.on('error', err => {
    weixinLoginProc = null
    mainWindow?.webContents.send('weixin-login-output', '[错误] ' + err.message)
    mainWindow?.webContents.send('weixin-login-done', -1)
  })

  return { ok: true }
})

ipcMain.handle('update-weixin-plugin', () => {
  const nodePath = getNodePath()
  const mjs = getOpenclawMjs()
  if (!mjs) return { ok: false, error: 'OpenClaw 未找到' }

  if (weixinUpdateProc) {
    try { weixinUpdateProc.kill() } catch {}
    weixinUpdateProc = null
  }

  const proc = spawn(nodePath, [mjs, 'plugins', 'update', 'openclaw-weixin'], {
    env: buildOpenclawEnv(),
    cwd: tempOpenclawDir,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  weixinUpdateProc = proc

  const send = (data) => mainWindow?.webContents.send('weixin-update-output', data.toString('utf8'))
  proc.stdout.on('data', send)
  proc.stderr.on('data', send)
  proc.on('exit', code => {
    weixinUpdateProc = null
    mainWindow?.webContents.send('weixin-update-done', code)
  })
  proc.on('error', err => {
    weixinUpdateProc = null
    mainWindow?.webContents.send('weixin-update-output', '[错误] ' + err.message)
    mainWindow?.webContents.send('weixin-update-done', -1)
  })

  return { ok: true }
})

// ─── IPC: Version ──────────────────────────────────────────────────────────

ipcMain.handle('get-version', () => app.getVersion())

// ─── IPC: License Info（售后核验用）─────────────────────────────────────────

ipcMain.handle('get-license-info', async () => {
  const drive = path.resolve(usbRoot).charAt(0).toUpperCase()
  let serial = '未知'
  try {
    serial = await getVolSerial(drive)
  } catch {}
  return {
    version:  app.getVersion(),
    serial,
    platform: process.platform,
    arch:     process.arch,
  }
})

// ─── IPC: Preflight check ─────────────────────────────────────────────────

function checkPortFree(port) {
  return new Promise(resolve => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

ipcMain.handle('kill-port', async (_, port) => {
  const { execFile } = require('child_process')
  const portNum = parseInt(port, 10)
  if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) {
    return { ok: false, error: '无效的端口号' }
  }
  return new Promise(resolve => {
    const script = `Get-NetTCPConnection -LocalPort ${portNum} -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if($p){ "$($_.OwningProcess)|$($p.ProcessName)" } }`
    execFile('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 5000 }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve({ ok: false, error: '未找到占用端口的进程' })
      const lines = stdout.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      const safeNames = new Set(['node', 'node.exe', 'openclaw', 'openclaw.exe'])
      let killed = 0
      const skipped = []
      for (const line of lines) {
        const [pidStr, name] = line.split('|')
        const pid = parseInt(pidStr, 10)
        if (!Number.isInteger(pid) || pid <= 0) continue
        const lowerName = (name || '').toLowerCase()
        if (safeNames.has(lowerName)) {
          try { process.kill(pid); killed++ } catch {}
        } else {
          skipped.push(name || pidStr)
        }
      }
      if (killed === 0 && skipped.length > 0) {
        return setTimeout(() => resolve({
          ok: false,
          error: `端口被其他程序占用（${skipped.join(', ')}），请手动关闭该程序后重试`
        }), 200)
      }
      setTimeout(() => resolve({ ok: killed > 0, killed }), 500)
    })
  })
})

ipcMain.handle('preflight-check', async () => {
  const results = []

  // 1. Node.js runtime
  const nodePath = getNodePath()
  const nodeIsBundled = nodePath !== 'node'
  const nodeExists = nodeIsBundled ? fs.existsSync(nodePath) : true
  results.push({
    id: 'node',
    label: 'Node.js 运行环境',
    ok: nodeExists,
    detail: nodeExists ? '正常' : '运行环境缺失，请重新下载完整 U 盘安装包'
  })

  // 2. OpenClaw program files
  const mjs = getOpenclawMjs()
  results.push({
    id: 'openclaw',
    label: 'OpenClaw 程序文件',
    ok: mjs !== null,
    detail: mjs !== null ? '正常' : '程序文件缺失，请重新下载完整 U 盘安装包'
  })

  // 3. Port availability
  const portFree = await checkPortFree(18789)
  results.push({
    id: 'port',
    label: '端口 18789',
    ok: portFree,
    warn: !portFree,
    detail: portFree ? '正常' : '被占用，将自动释放'
  })

  // 4. Config file
  const configPath = path.join(configDir, 'openclaw.json')
  let configOk = false
  let configDetail = ''
  if (!fs.existsSync(configPath)) {
    configOk = false
    configDetail = '未找到，启动时将自动创建'
  } else {
    try {
      const cfg = JSON.parse(await fs.promises.readFile(configPath, 'utf8'))
      if (cfg.gateway?.auth?.mode === 'token' && typeof cfg.gateway?.auth?.token === 'string' && cfg.gateway.auth.token.length > 0) {
        configOk = true
        configDetail = '配置正常'
      } else {
        configOk = false
        configDetail = '需要更新，启动时将自动修复'
      }
    } catch {
      configOk = false
      configDetail = '文件损坏，点击"一键修复"即可恢复'
    }
  }
  results.push({
    id: 'config',
    label: '网关配置',
    ok: configOk,
    warn: !configOk && fs.existsSync(configPath),
    detail: configDetail
  })

  // 5. USB disk space (>30 MB free required)
  await new Promise(resolve => {
    const { exec } = require('child_process')
    const drive = path.resolve(usbRoot).charAt(0).toUpperCase()
    exec(
      `powershell -NoProfile -Command "(Get-PSDrive -Name ${drive}).Free"`,
      { encoding: 'utf8', timeout: 3000 },
      (err, stdout) => {
        if (err) {
          results.push({ id: 'disk', label: 'U 盘剩余空间', ok: true, warn: false, detail: '无法检测（跳过）' })
        } else {
          const freeMB = Math.floor(parseInt(stdout.trim(), 10) / 1024 / 1024)
          const enough = freeMB > 30
          results.push({
            id: 'disk',
            label: 'U 盘剩余空间',
            ok: enough,
            warn: !enough,
            detail: isNaN(freeMB) ? '无法读取磁盘信息' : `剩余 ${freeMB} MB${enough ? '' : '（建议至少 30 MB 以保证正常运行）'}`
          })
        }
        resolve()
      }
    )
  })

  return results
})

// ─── IPC: UI Window ────────────────────────────────────────────────────────

ipcMain.handle('open-ui-window', async () => {
  const url = currentGatewayToken
    ? `http://127.0.0.1:18789/#token=${currentGatewayToken}`
    : `http://127.0.0.1:18789/`
  await openUrl(url)
  return { ok: true }
})
