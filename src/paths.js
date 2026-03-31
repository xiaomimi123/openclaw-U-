/**
 * 路径常量和路径工具函数
 * 所有与文件路径、Node/OpenClaw 定位相关的逻辑集中在此
 */
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { app } = require('electron')

// USB root: where the .exe lives (on USB), set by electron-builder portable
const usbRoot = app.isPackaged
  ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath))
  : path.join(__dirname, '..', 'dev-data')

const dataDir    = path.join(usbRoot, 'openclaw-data')
const setupFile  = path.join(dataDir, 'setup.json')
const configDir  = path.join(dataDir, '.openclaw')

// 本机 TEMP 缓存目录（解压到本地 SSD，比直接写 U 盘快 10-50 倍）
const tempCacheDir    = path.join(os.tmpdir(), 'openclaw-usb')
const tempOpenclawDir = path.join(tempCacheDir, 'openclaw')
const tempVersionFile = path.join(tempCacheDir, 'version.txt')

function getNodePath() {
  const bundled = path.join(usbRoot, 'runtime', 'node.exe')
  if (fs.existsSync(bundled)) return bundled
  return 'node'  // system Node.js (dev mode)
}

function getOpenclawMjs() {
  // 优先用本机 TEMP 缓存（已解压则秒启动）
  const cached = path.join(tempOpenclawDir, 'openclaw.mjs')
  if (fs.existsSync(cached)) return cached
  // 兼容旧版（直接放在 U 盘 openclaw/ 目录）
  const usb = path.join(usbRoot, 'openclaw', 'openclaw.mjs')
  if (fs.existsSync(usb)) return usb
  // Dev fallback: use global npm install
  const global = path.join(
    process.env.APPDATA || os.homedir() + '/AppData/Roaming',
    'npm', 'node_modules', 'openclaw', 'openclaw.mjs'
  )
  if (fs.existsSync(global)) return global
  return null
}

// 获取 zip 版本标识（大小 + 文件头 256 字节 MD5），避免 FAT32 时间戳 2 秒精度问题
function getZipVersion(zipPath) {
  try {
    const stat = fs.statSync(zipPath)
    const buf = Buffer.alloc(256)
    const fd = fs.openSync(zipPath, 'r')
    try {
      fs.readSync(fd, buf, 0, 256, 0)
    } finally {
      fs.closeSync(fd)
    }
    const hash = crypto.createHash('md5').update(buf).digest('hex').slice(0, 16)
    return `${stat.size}:${hash}`
  } catch { return null }
}

async function ensureDirs() {
  for (const d of [
    configDir,
    path.join(dataDir, 'AppData', 'Roaming'),
    path.join(dataDir, 'AppData', 'Local'),
    path.join(dataDir, 'tmp')
  ]) await fs.promises.mkdir(d, { recursive: true })
}

// 构建 openclaw 子进程所需的环境变量
function buildOpenclawEnv() {
  return {
    ...process.env,
    HOME:                dataDir,
    USERPROFILE:         dataDir,
    APPDATA:             path.join(dataDir, 'AppData', 'Roaming'),
    LOCALAPPDATA:        path.join(dataDir, 'AppData', 'Local'),
    // 注意：TEMP/TMP 不重定向到 USB（FAT32 的 realpath 返回 8.3 短名，
    // 导致 openclaw 的 isPathInside 误报 symlink traversal，插件安装报错）
    TEMP:                os.tmpdir(),
    TMP:                 os.tmpdir(),
    npm_config_registry: 'https://registry.npmmirror.com',  // 淘宝镜像，国内直连
  }
}

// setup.json 备份路径（藏在 .openclaw 深层目录）
const setupBackupFile = path.join(configDir, '.setup.bak')

// 备份 setup.json（每次写入后调用）
async function backupSetup() {
  try {
    if (fs.existsSync(setupFile)) {
      await fs.promises.copyFile(setupFile, setupBackupFile)
    }
  } catch {}
}

// 恢复 setup.json（丢失时调用）
async function restoreSetup() {
  try {
    if (!fs.existsSync(setupFile) && fs.existsSync(setupBackupFile)) {
      await fs.promises.copyFile(setupBackupFile, setupFile)
      return true
    }
  } catch {}
  return false
}

module.exports = {
  usbRoot, dataDir, setupFile, configDir,
  tempCacheDir, tempOpenclawDir, tempVersionFile,
  getNodePath, getOpenclawMjs, getZipVersion, ensureDirs,
  buildOpenclawEnv,
  backupSetup, restoreSetup
}
