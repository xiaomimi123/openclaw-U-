#!/usr/bin/env node
// OpenClaw U盘授权工具 — 独立 EXE 版
// 输入序列号，自动生成 license.key
// 打包命令：npx pkg sign-tool.js --targets node18-win-x64 --output dist/OpenClaw-授权工具.exe

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const readline = require('readline')

// pkg 打包后 __dirname 指向 snapshot，需要用 exe 所在目录
const scriptDir = process.pkg ? path.dirname(process.execPath) : __dirname
const privateKeyPath = path.join(scriptDir, 'private.pem')
const publicKeyPath = path.join(scriptDir, 'public.pem')

// ── 颜色输出 ──
const c = {
  reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m', cyan: '\x1b[36m', gray: '\x1b[90m', bold: '\x1b[1m',
}

// ── 密钥 ──
console.log('')
console.log(c.cyan + '╔══════════════════════════════════════╗' + c.reset)
console.log(c.cyan + '║     OpenClaw U盘 授权工具            ║' + c.reset)
console.log(c.cyan + '╚══════════════════════════════════════╝' + c.reset)
console.log('')

if (!fs.existsSync(privateKeyPath)) {
  console.log(c.red + '  ❌ 找不到 private.pem，请将此工具和 private.pem 放在同一目录' + c.reset)
  console.log('')
  waitExit()
} else {
  const privateKey = fs.readFileSync(privateKeyPath, 'utf8')
  const publicKey = fs.existsSync(publicKeyPath) ? fs.readFileSync(publicKeyPath, 'utf8') : null
  startLoop(privateKey, publicKey)
}

function waitExit() {
  console.log(c.gray + '  按任意键退出...' + c.reset)
  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  process.stdin.once('data', () => process.exit(0))
}

function startLoop(privateKey, publicKey) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  function ask() {
    console.log(c.gray + '  提示：序列号为十六进制（0-9, A-F），字母 O 会自动纠正为数字 0' + c.reset)
    console.log(c.gray + '  输入 q 退出' + c.reset)
    console.log('')
    rl.question(c.bold + '  请输入 U 盘序列号: ' + c.reset, (input) => {
      const raw = (input || '').trim().toUpperCase()
      if (raw === 'Q' || raw === 'QUIT' || raw === 'EXIT') {
        console.log('')
        console.log(c.green + '  再见！' + c.reset)
        rl.close()
        process.exit(0)
        return
      }

      if (!raw) {
        console.log(c.red + '  ❌ 请输入序列号' + c.reset)
        console.log('')
        ask()
        return
      }

      // 去掉横杠和空格（vol 命令返回 XXXX-XXXX 格式，WMI 返回 XXXXXXXX 格式）
      let serial = raw.replace(/[-\s]/g, '')
      if (serial !== raw) {
        console.log(c.gray + `  （已去除横杠/空格: ${raw} → ${serial}）` + c.reset)
      }
      // 自动纠正常见误输
      const corrected = serial.replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1')
      if (corrected !== serial) {
        console.log(c.yellow + `  ⚠ 自动纠正: ${serial} → ${corrected}（序列号为十六进制，不含 O/I/L）` + c.reset)
        serial = corrected
      }

      // 校验格式（应为 4-16 位十六进制）
      if (!/^[0-9A-F]{4,16}$/.test(serial)) {
        console.log(c.red + '  ❌ 格式不正确，序列号应为 4-16 位十六进制字符（0-9, A-F）' + c.reset)
        console.log('')
        ask()
        return
      }

      // 生成签名
      try {
        const sign = crypto.createSign('SHA256')
        sign.update(serial)
        const signature = sign.sign(privateKey, 'hex')

        const outPath = path.join(scriptDir, 'license.key')
        fs.writeFileSync(outPath, signature, 'utf8')

        console.log('')
        console.log(c.green + '  ✅ 授权文件已生成！' + c.reset)
        console.log(c.cyan + '     序列号: ' + serial + c.reset)
        console.log(c.cyan + '     文件:   ' + outPath + c.reset)

        // 验证签名
        if (publicKey) {
          const verify = crypto.createVerify('SHA256')
          verify.update(serial)
          const valid = verify.verify(publicKey, signature, 'hex')
          if (valid) {
            console.log(c.green + '     验证:   ✓ 签名有效' + c.reset)
          } else {
            console.log(c.red + '     验证:   ✗ 签名无效！请检查密钥对' + c.reset)
          }
        }

        console.log('')
        console.log(c.gray + '     将 license.key 发送给用户，放入 U 盘根目录即可。' + c.reset)
      } catch (e) {
        console.log(c.red + '  ❌ 签名失败: ' + e.message + c.reset)
      }

      console.log('')
      console.log(c.cyan + '  ────────────────────────────────────' + c.reset)
      console.log('')
      ask()
    })
  }

  ask()
}
