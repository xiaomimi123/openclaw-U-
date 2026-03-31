@echo off
chcp 65001 > nul
setlocal

set OUT=F:\openclaw-授权工具
set ZIP=F:\openclaw-授权工具.zip
set SRC=%~dp0
set NODE=F:\U盘内容\runtime\node.exe

echo.
echo  正在检查文件...

if not exist "%NODE%" (
    echo  [错误] 找不到 node.exe: %NODE%
    goto fail
)
if not exist "%SRC%授权工具.js" (
    echo  [错误] 找不到 授权工具.js
    goto fail
)
if not exist "%SRC%private.pem" (
    echo  [错误] 找不到 private.pem
    goto fail
)
if not exist "%SRC%public.pem" (
    echo  [错误] 找不到 public.pem
    goto fail
)

echo  正在创建输出目录...
if exist "%OUT%" rd /s /q "%OUT%"
mkdir "%OUT%"

echo  正在复制文件...
copy "%NODE%"             "%OUT%\node.exe"      > nul
copy "%SRC%授权工具.js"   "%OUT%\授权工具.js"   > nul
copy "%SRC%授权U盘.bat"   "%OUT%\授权U盘.bat"   > nul
copy "%SRC%private.pem"   "%OUT%\private.pem"   > nul
copy "%SRC%public.pem"    "%OUT%\public.pem"    > nul

echo  正在打包 zip...
if exist "%ZIP%" del /f /q "%ZIP%"
powershell.exe -NoProfile -Command "Add-Type -Assembly 'System.IO.Compression.FileSystem'; [System.IO.Compression.ZipFile]::CreateFromDirectory('%OUT%', '%ZIP%')"
if %errorlevel% neq 0 (
    echo  [错误] 打包失败
    goto fail
)

echo.
echo  打包完成！
echo  文件位置: %ZIP%
echo.
echo  发给员工后，解压并双击 [授权U盘.bat] 即可使用。
echo.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
