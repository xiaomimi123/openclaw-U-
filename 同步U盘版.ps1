# OpenClaw USB Sync Script v4
# Usage: run after each openclaw release: git pull -> build -> npm pack -> zip
# Key: npm install (no --omit=optional) ensures all deps (axios, tslog, etc.) are included

$ocSrc    = "F:\openclaw"
$stage    = "F:\openclaw-usb\dist-extra\stage"
$zipStage = "F:\openclaw-usb\dist-extra\zip-stage"
$tgzDir   = "F:\openclaw-usb\dist-extra"
$zipPath  = "F:\U盘内容\openclaw.zip"

$ErrorActionPreference = "Stop"

Write-Host "========================================"
Write-Host "  OpenClaw USB - Build openclaw.zip"
Write-Host "========================================"

# ── 1. Checkout pinned version ───────────────────────────────────────────────
# LOCKED VERSION — only change after full manual test pass:
#   gateway starts without "Config invalid"
#   weixin plugin installs and logs in
#   Telegram/Discord channels work
# To upgrade: set $OPENCLAW_VERSION to the new tag, run script, test, then commit.
$OPENCLAW_VERSION = "v2026.3.13-1"

Write-Host ""
Write-Host "[1/5] Checking out openclaw $OPENCLAW_VERSION..." -ForegroundColor Cyan
Set-Location $ocSrc
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "git fetch failed" }
git checkout $OPENCLAW_VERSION
if ($LASTEXITCODE -ne 0) { throw "git checkout $OPENCLAW_VERSION failed - tag may not exist" }
$version = (Get-Content "package.json" | ConvertFrom-Json).version
Write-Host "Version: $version" -ForegroundColor Green

# ── 2. Build ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[2/5] Building (pnpm install + pnpm build)..." -ForegroundColor Cyan

# Make Git bash take precedence over WSL bash (canvas:a2ui:bundle needs bash)
$gitBashCandidates = @(
    "C:\Program Files\Git\usr\bin",
    "C:\Program Files\Git\bin"
)
$bashFixed = $false
foreach ($d in $gitBashCandidates) {
    if (Test-Path "$d\bash.exe") {
        $env:PATH = "$d;" + $env:PATH
        Write-Host "Bash: $d\bash.exe" -ForegroundColor DarkGray
        $bashFixed = $true
        break
    }
}
if (-not $bashFixed) {
    Write-Host "[WARN] bash.exe not found in Git for Windows paths - canvas step may fail" -ForegroundColor Yellow
}

pnpm install
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
pnpm build
if ($LASTEXITCODE -ne 0) { throw "pnpm build failed (hint: install Git for Windows to fix bash)" }
# Also build control UI (part of openclaw prepack, skip if not needed)
pnpm ui:build 2>&1 | Out-Null
Write-Host "Build complete" -ForegroundColor Green

# ── 3. npm pack (--ignore-scripts: we already built above, no need to rebuild) ──
Write-Host ""
Write-Host "[3/5] npm pack..." -ForegroundColor Cyan
if (-not (Test-Path $tgzDir)) { New-Item -ItemType Directory -Force $tgzDir | Out-Null }
$tgzName = "openclaw-$version.tgz"
$tgzPath = Join-Path $tgzDir $tgzName
if (Test-Path $tgzPath) { Remove-Item $tgzPath -Force }
npm pack --pack-destination $tgzDir --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw "npm pack failed" }
if (-not (Test-Path $tgzPath)) { throw "tgz not found after npm pack: $tgzPath" }
Write-Host "Created: $tgzName" -ForegroundColor Green

# ── 4. npm install (all deps, no --omit=optional) ────────────────────────────
Write-Host ""
Write-Host "[4/5] npm install (all deps)..." -ForegroundColor Cyan
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null
Set-Content -Path (Join-Path $stage "package.json") -Value '{"name":"stage","version":"1.0.0"}'
Set-Location $stage
npm install $tgzPath --registry https://registry.npmmirror.com
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
Write-Host "Dependencies installed" -ForegroundColor Green

# ── 5. Assemble zip-stage and create openclaw.zip ────────────────────────────
Write-Host ""
Write-Host "[5/5] Assembling openclaw.zip..." -ForegroundColor Cyan

# Write node assembly script to a temp file (paths injected directly - no quoting issues)
$stageJs    = $stage.Replace('\', '/')
$zipStageJs = $zipStage.Replace('\', '/')
$buildJs    = "$tgzDir\build-zip.js"

@"
const fs = require('fs'), path = require('path');
const stage    = '$stageJs/node_modules';
const zipStage = '$zipStageJs';
if (fs.existsSync(zipStage)) fs.rmSync(zipStage, { recursive: true, force: true });
fs.mkdirSync(zipStage, { recursive: true });
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}
copyDir(path.join(stage, 'openclaw'), zipStage);
const nmDst = path.join(zipStage, 'node_modules');
fs.mkdirSync(nmDst, { recursive: true });
let count = 0;
for (const e of fs.readdirSync(stage, { withFileTypes: true })) {
  if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'openclaw') continue;
  copyDir(path.join(stage, e.name), path.join(nmDst, e.name));
  count++;
}
console.log('Bundled ' + count + ' dependencies');
"@ | Set-Content -Path $buildJs -Encoding UTF8

Set-Location "F:\openclaw-usb"
node $buildJs
if ($LASTEXITCODE -ne 0) { throw "Assembly script failed" }
Remove-Item $buildJs -Force -ErrorAction SilentlyContinue

Add-Type -Assembly 'System.IO.Compression.FileSystem'
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($zipStage, $zipPath)
$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "openclaw.zip: ${sizeMB} MB" -ForegroundColor Green

# ── Cleanup ───────────────────────────────────────────────────────────────────
Remove-Item $stage    -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $zipStage -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $tgzPath  -Force          -ErrorAction SilentlyContinue

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================"
Write-Host "  Done! Files to copy to USB:"         -ForegroundColor Green
Write-Host "    dist\OpenClaw-USB.exe   (run: npm run build)"
Write-Host "    U disk\openclaw.zip     <- updated v$version"
Write-Host "    runtime\node.exe"
Write-Host "    weixin-plugin.zip"
Write-Host "========================================"

pause
