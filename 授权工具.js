// OpenClaw U盘批量授权工具
// 自动检测所有已连接磁盘，跳过已授权的，对未授权的一键签名
// 运行方式：双击 授权U盘.bat

const { execSync } = require('child_process')
const crypto = require('crypto')
const fs     = require('fs')
const path   = require('path')
const readline = require('readline')

const scriptDir     = __dirname
const privateKeyPath = path.join(scriptDir, 'private.pem')
const publicKeyPath  = path.join(scriptDir, 'public.pem')

// ── 颜色输出 ──────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  bold:   '\x1b[1m',
}
const log  = (s, col = '')  => console.log(col + s + c.reset)
const ok   = (s) => log('  ✅ ' + s, c.green)
const warn = (s) => log('  ⚠️  ' + s, c.yellow)
const err  = (s) => log('  ❌ ' + s, c.red)
const info = (s) => log('  ' + s, c.cyan)

// ── 读取密钥 ──────────────────────────────────────────────────────
log('')
log('╔══════════════════════════════════════╗', c.cyan)
log('║     OpenClaw U盘 批量授权工具        ║', c.cyan)
log('╚══════════════════════════════════════╝', c.cyan)
log('')

if (!fs.existsSync(privateKeyPath)) {
  err('找不到 private.pem，无法授权')
  process.exit(1)
}
const privateKey = fs.readFileSync(privateKeyPath, 'utf8')
const publicKey  = fs.existsSync(publicKeyPath)
  ? fs.readFileSync(publicKeyPath, 'utf8')
  : null

// ── 获取U盘序列号 ────────────────────────────────────────────────
// 标准化序列号：去掉横杠和空格，统一大写（确保签名端和验证端格式一致）
function normalizeSerial(raw) {
  return raw.replace(/[-\s]/g, '').toUpperCase()
}

function getSerial(driveLetter) {
  // 方法 1：PowerShell WMI（返回无横杠格式，如 ACD87D0B）
  try {
    const out = execSync(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_LogicalDisk -Filter \\"DeviceID='${driveLetter}:'\\" ).VolumeSerialNumber"`,
      { encoding: 'utf8', timeout: 5000 }
    )
    const s = normalizeSerial(out.trim())
    if (s) return s
  } catch {}
  // 方法 2：vol 命令（返回带横杠格式，如 ACD8-7D0B）
  try {
    const out = execSync(`vol ${driveLetter}:`, { encoding: 'utf8', timeout: 5000 })
    const m = out.match(/[0-9A-Fa-f]{4}[\s-][0-9A-Fa-f]{4}/)
    if (m) return normalizeSerial(m[0])
  } catch {}
  return null
}

// ── 验证 license.key 是否与序列号匹配 ───────────────────────────
function isValidLicense(driveLetter, serial) {
  if (!publicKey) return false
  const licPath = `${driveLetter}:\\license.key`
  if (!fs.existsSync(licPath)) return false
  try {
    const sig    = fs.readFileSync(licPath, 'utf8').trim()
    const verify = crypto.createVerify('SHA256')
    verify.update(serial)
    return verify.verify(publicKey, sig, 'hex')
  } catch { return false }
}

// ── 生成并写入 license.key ────────────────────────────────────────
function signDrive(driveLetter, serial) {
  const sign = crypto.createSign('SHA256')
  sign.update(serial)
  const signature = sign.sign(privateKey, 'hex')
  fs.writeFileSync(path.join(scriptDir, 'license.key'), signature, 'utf8')
  fs.writeFileSync(`${driveLetter}:\\license.key`, signature, 'utf8')
  return signature
}

// ── 枚举所有磁盘 ─────────────────────────────────────────────────
function listDrives() {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,VolumeSerialNumber,DriveType | ConvertTo-Json -Compress"',
      { encoding: 'utf8', timeout: 8000 }
    )
    const parsed = JSON.parse(out.trim())
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    return arr.map(d => ({
      deviceId:  (d.DeviceID  || '').trim(),
      volName:   (d.VolumeName || '').trim() || '无标签',
      serial:    normalizeSerial((d.VolumeSerialNumber || '').trim()),
      driveType: parseInt(d.DriveType  || 0)  // 2=可移动U盘, 3=本地盘, 5=光驱
    })).filter(d => d.deviceId)
  } catch { return [] }
}

// ── 主流程 ────────────────────────────────────────────────────────
async function main() {
  const drives = listDrives()

  log('检测到以下磁盘：', c.bold)
  log('')

  const results = { signed: [], already: [], skipped: [], failed: [] }

  for (const d of drives) {
    const label  = `${d.deviceId}  [${d.volName}]`
    const serial = d.serial || getSerial(d.deviceId.replace(':', ''))

    // 只处理可移动磁盘（DriveType 2 = U盘/移动硬盘），其余全部跳过
    if (d.driveType !== 2) {
      const typeDesc = d.driveType === 3 ? '本地硬盘' : d.driveType === 5 ? '光驱' : `类型${d.driveType}`
      log(`  ${label}  ${c.gray}（${typeDesc}，跳过）${c.reset}`)
      results.skipped.push(d.deviceId)
      continue
    }

    if (!serial) {
      log(`  ${label}  ${c.gray}（无序列号，跳过）${c.reset}`)
      results.skipped.push(d.deviceId)
      continue
    }

    // 检查是否已有效授权
    if (isValidLicense(d.deviceId.replace(':', ''), serial)) {
      ok(`${label}  序列号: ${serial}  →  已授权 ✓`)
      results.already.push(d.deviceId)
      continue
    }

    // 需要授权
    warn(`${label}  序列号: ${serial}  →  未授权，正在签名...`)
    try {
      signDrive(d.deviceId.replace(':', ''), serial)
      ok(`${label}  授权成功！license.key 已写入`)
      results.signed.push(d.deviceId)
    } catch (e) {
      err(`${label}  授权失败：${e.message}`)
      results.failed.push(d.deviceId)
    }
  }

  // ── 汇总报告 ──────────────────────────────────────────────────
  log('')
  log('══════════════════════════════════════', c.cyan)
  log('  授权完成，结果汇总：', c.bold)
  if (results.signed.length)   ok(`新授权：${results.signed.join('  ')}（共 ${results.signed.length} 个）`)
  if (results.already.length)  ok(`已授权：${results.already.join('  ')}（共 ${results.already.length} 个，跳过）`)
  if (results.failed.length)   err(`失败：${results.failed.join('  ')}（共 ${results.failed.length} 个）`)
  if (results.skipped.length)  info(`跳过：${results.skipped.join('  ')}`)
  log('══════════════════════════════════════', c.cyan)
  log('')

  if (results.signed.length === 0 && results.failed.length === 0) {
    log('  所有U盘均已授权，无需操作。', c.green)
  }

  log('按任意键退出...', c.gray)
  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  process.stdin.once('data', () => process.exit(0))
}

main()
