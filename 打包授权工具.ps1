# 打包 OpenClaw 独立授权工具
# 运行后生成 F:\openclaw-授权工具.zip，发给员工解压即用

$out    = "F:\openclaw-授权工具"
$zip    = "F:\openclaw-授权工具.zip"
$srcDir = $PSScriptRoot
$node   = "F:\U盘内容\runtime\node.exe"

Write-Host ""
Write-Host "╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     OpenClaw 授权工具 打包程序        ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# 检查必要文件
$required = @(
    @{ path = $node;                        name = "node.exe (runtime)" },
    @{ path = "$srcDir\授权工具.js";        name = "授权工具.js" },
    @{ path = "$srcDir\授权U盘.bat";        name = "授权U盘.bat" },
    @{ path = "$srcDir\private.pem";        name = "private.pem" },
    @{ path = "$srcDir\public.pem";         name = "public.pem" }
)
$ok = $true
foreach ($f in $required) {
    if (-not (Test-Path $f.path)) {
        Write-Host "  ❌ 找不到: $($f.name)" -ForegroundColor Red
        $ok = $false
    }
}
if (-not $ok) { Write-Host ""; pause; exit 1 }

# 清理旧输出
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Path $out -Force | Out-Null

# 复制文件
Write-Host "  正在复制文件..." -ForegroundColor Cyan
Copy-Item $node                    "$out\node.exe"        -Force
Copy-Item "$srcDir\授权工具.js"    "$out\授权工具.js"     -Force
Copy-Item "$srcDir\授权U盘.bat"    "$out\授权U盘.bat"     -Force
Copy-Item "$srcDir\private.pem"    "$out\private.pem"     -Force
Copy-Item "$srcDir\public.pem"     "$out\public.pem"      -Force

# 打包 zip
Write-Host "  正在打包 zip..." -ForegroundColor Cyan
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -Assembly 'System.IO.Compression.FileSystem'
[System.IO.Compression.ZipFile]::CreateFromDirectory($out, $zip)

$sizeMB = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ""
Write-Host "  ✅ 打包完成！" -ForegroundColor Green
Write-Host "  📦 文件位置: $zip  ($sizeMB MB)" -ForegroundColor Green
Write-Host ""
Write-Host "  发给员工后，解压并双击 [授权U盘.bat] 即可使用。" -ForegroundColor Yellow
Write-Host ""
pause
