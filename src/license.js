/**
 * 授权验证模块
 * ECDSA 签名验证 + U 盘序列号读取 + license.key 备份保护
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { app, dialog } = require('electron')
const { usbRoot, dataDir } = require('./paths')

// 内嵌公钥 — 私钥由开发者保管，此处仅用于验证签名
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdzen0/wxPzE508F5WU7S5RK2MIHH
gbCQcDmOwvKZEbkO9BGuTnDb9C/m3BzEZuhh3eF7ltJZ6OIjzKch0xV3HA==
-----END PUBLIC KEY-----`

// 备份路径：藏在 openclaw-data 深层目录，AI 不太会碰到
const LICENSE_BACKUP = () => path.join(dataDir, '.openclaw', '.license.bak')

// 标准化序列号：去掉横杠和空格，统一大写（确保签名端和验证端格式一致）
function normalizeSerial(raw) {
  return raw.replace(/[-\s]/g, '').toUpperCase()
}

function getVolSerial(driveLetter) {
  return new Promise(resolve => {
    const { exec } = require('child_process')
    // 方法 1：PowerShell WMI（返回无横杠格式）
    exec(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_LogicalDisk -Filter 'DeviceID=\\"${driveLetter}:\\"').VolumeSerialNumber"`,
      { encoding: 'utf8' },
      (err, stdout) => {
        if (!err && stdout.trim()) return resolve(normalizeSerial(stdout.trim()))
        // 方法 2：vol 命令（返回带横杠格式 XXXX-XXXX）
        exec(`vol ${driveLetter}:`, { encoding: 'utf8' }, (err2, out) => {
          if (err2) return resolve(null)
          const m = out.match(/[0-9A-F]{4}[\s-][0-9A-F]{4}/i)
          resolve(m ? normalizeSerial(m[0]) : null)
        })
      }
    )
  })
}

async function verifyLicense() {
  if (!app.isPackaged) return true  // 开发模式跳过验证

  const drive = path.resolve(usbRoot).charAt(0).toUpperCase()
  const serial = await getVolSerial(drive)

  if (!serial) {
    dialog.showErrorBox('授权验证失败', '无法读取 U 盘序列号，请确认程序从 U 盘运行。')
    app.quit()
    return false
  }

  const licFile = path.join(usbRoot, 'license.key')
  const backupFile = LICENSE_BACKUP()

  // license.key 丢失时尝试从备份恢复
  if (!fs.existsSync(licFile) && fs.existsSync(backupFile)) {
    try {
      fs.copyFileSync(backupFile, licFile)
    } catch {}
  }

  if (!fs.existsSync(licFile)) {
    dialog.showErrorBox(
      '未找到授权文件',
      '未找到 license.key，请联系作者获取授权文件后放入 U 盘根目录。'
    )
    app.quit()
    return false
  }

  try {
    const signature = fs.readFileSync(licFile, 'utf8').trim()
    const verify = crypto.createVerify('SHA256')
    verify.update(serial)
    const ok = verify.verify(PUBLIC_KEY, signature, 'hex')
    if (!ok) throw new Error('签名不匹配')

    // 验证通过后，自动备份 license.key（每次启动都刷新备份）
    try {
      fs.mkdirSync(path.dirname(backupFile), { recursive: true })
      fs.copyFileSync(licFile, backupFile)
    } catch {}

    return true
  } catch {
    dialog.showErrorBox(
      '授权验证失败',
      `授权文件无效或与当前 U 盘不匹配。\n请联系作者重新授权。\n（序列号：${serial}）`
    )
    app.quit()
    return false
  }
}

module.exports = { PUBLIC_KEY, getVolSerial, verifyLicense }
