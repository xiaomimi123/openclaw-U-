# OpenClaw U盘版 更新日志

---

## v1.6.3 (2026-03-30) — 修复解压路径分隔符导致依赖丢失

### Bug 修复（严重）
- **修复 openclaw.zip 解压后依赖包丢失**：Windows `ZipFile.CreateFromDirectory` 用反斜杠 `\` 创建 zip 条目，但 yauzl 只识别正斜杠 `/` 作为目录标记。导致目录条目被误创建为 0 字节文件，子文件无法写入，整个包丢失。所有用户都受影响。
- 修复方式：解压前统一 `entry.fileName.replace(/\\/g, '/')` 标准化路径

---

## v1.6.2 (2026-03-30) — 修复授权工具序列号兼容性

### Bug 修复
- **修复带横杠序列号无法授权**：统一 `normalizeSerial()` 处理，`ACD8-7D0B` 和 `ACD87D0B` 格式均可正确签名和验证
- 授权工具 `getSerial()` 增加 `vol` 命令 fallback，PowerShell 失败时仍可获取序列号
- `sign-usb.js` 支持粘贴带横杠/空格的序列号，自动去除
- 验证端 `getVolSerial()` 两个分支统一标准化格式

---

## v1.6.1 (2026-03-30) — 修复 AI 工具执行权限

### Bug 修复
- **修复 AI 无法访问主机文件**：添加 `tools.exec.host=gateway` + `tools.profile=full`，使 AI 能在宿主机执行命令（U盘版没有 Docker，默认的 sandbox 模式无法工作）
- 每次启动时强制确保 tools 配置存在，已有用户无需重新配置

---

## v1.6.0 (2026-03-29) — 代码架构重构

### 架构改进
- **main.js 模块化拆分**：从 1730 行单文件拆为 `src/paths.js`、`src/config.js`、`src/license.js`、`src/log-translate.js` 四个模块，main.js 降至约 780 行
- **统一 Provider 配置**：新增 `applyProviderConfig()` 函数，消除 `buildOpenclawConfig` 和 `update-api-key` 之间的重复 switch 逻辑
- **公共 CSS 提取**：`styles/common.css` 包含 CSS 变量和共享样式（titlebar、覆层、spinner），launcher.html 和 setup.html 引用
- **单元测试**：新增 32 个测试用例覆盖 log-translate 和 config 模块，`npm test` 可运行

### Bug 修复
- **修复 async Promise 反模式**：`install-weixin-plugin` 不再使用 `async` Promise 构造函数，避免异常被静默吞掉
- **修复 validate-api-key HTTPS 限制**：支持 HTTP 协议，为 API 代理网关做准备
- **修复 openUrl cmd 转义**：URL 用双引号包裹，防止 `&` 等特殊字符被 cmd 截断
- **修复 Windows 进程强杀**：`killOpenclaw` 改用 `taskkill /F /T` 替代无效的 SIGKILL
- **修复日志翻译正则**：schema 详情行的正则修正为 `^-\s+` 格式，匹配 trim 后的内容
- **修复 gatewayLog 内存控制**：环形缓冲阈值从 200KB 降至 100KB，减少 GC 压力

### 清理
- **删除废弃的 activate.js**：该文件使用 HMAC 签名，与 main.js 的 ECDSA 验证不兼容
- **添加 .gitignore**：排除 private.pem、license.key、dist/、node_modules/
- **删除过期的 `代码审查报告.md`**：内容为 v1.1.0 时期，已不适用

---

## v1.1.1 — v1.4.x (2026-03-22 ~ 2026-03-28)

### 功能新增
- **火山引擎（豆包）支持**：setup 和 API Key 修改支持 volcengine provider
- **自定义服务商支持**：setup 和 API Key 修改支持 custom provider（自定义 baseUrl + modelId）
- **日志翻译层**：技术错误自动转译为中文友好提示，隐藏 schema 详情等噪音
- **网络重试机制**：ETIMEDOUT/ECONNREFUSED 等错误自动提示重试
- **配置自愈增强**：sanitizeConfig 8 条清理规则，启动前主动修复非法字段
- **API Key 验证**：保存前发请求验证 Key 有效性，支持所有服务商
- **跨电脑插件路径修复**：fixPluginPaths 自动更新 TEMP 和 USB 路径

### Bug 修复
- **agents.defaults.tools 导致 Config invalid**：清理旧版非法字段，打破 doctor --fix 死循环
- **切换服务商时 models 残留**：切换时 `delete cfg.models` 整体清除
- **watchdog 竞态假绿灯**：进程退出后检查状态再触发 UI 更新
- **repair-config 从 setup.json 重建**：setup.json 存在但 openclaw.json 丢失时自动恢复
- **DeepSeek/通义 models 数组缺失**：切换时写入完整 provider 对象含 models 数组

---

## v1.1.0 (2026-03-22) — 初始发布版

### 1. 桌面小宠物（Desktop Pet）
- 新增透明悬浮窗，显示卡通龙虾 SVG 形象
- 龙虾使用 SVG 内联绘制：渐变色身体、大螯、触角、腮红、微笑表情
- 支持 CSS 动画：idle 呼吸摇摆 + hover 弹跳效果
- 点击龙虾弹出气泡菜单，显示 OpenClaw 运行状态（绿点/红点）
- 气泡菜单含"打开控制界面"按钮和"收起"按钮
- 支持鼠标穿透（不遮挡其他窗口操作）
- 窗口可拖拽（`-webkit-app-region: drag`）
- OpenClaw 启动时自动显示，停止时自动隐藏

### 2. U盘文件传输优化（ZIP 压缩方案）
- 原方案：拷贝 93,055 个文件（1.2GB），速度极慢
- 新方案：打包为单个 `openclaw.zip`（~279MB），传输只需 1 个文件
- 首次启动时自动检测是否已解压：
  - 若未解压：检查磁盘空间（需 ≥ 1.5GB）
  - 显示解压进度 splash 窗口
  - 解压失败时自动清理残留，弹出重试对话框
  - 解压超时保护（10 分钟）

### 3. 新增同步打包脚本（`同步U盘版.ps1`）
- 自动比较本地版本与 U盘内容版本
- 同步指定文件夹到 `F:\U盘内容\openclaw\`
- 自动压缩为 `openclaw.zip` 并显示文件大小

### 4. 批量 U盘授权工具（`授权工具.js` 重写）
- 原版：每次手动输入一个盘符，一次只能授权一个 U 盘
- 新版：**全自动批量处理**，同时插多少 U 盘就授权多少个
  - 使用 `wmic logicaldisk` 自动枚举所有磁盘
  - 跳过系统盘（DriveType=3）和无序列号的盘
  - 自动验证现有 `license.key` 是否有效（ECDSA SHA256 公钥验证）
  - 对未授权 U 盘自动签名并写入 `license.key`
  - 彩色汇总报告：✅ 新授权 / ✅ 已授权跳过 / ❌ 失败 / 跳过
  - 双击 `授权U盘.bat` 一键完成，无需任何输入

### 5. 独立授权工具打包（`打包授权工具.bat`）
- 生成可在其他员工电脑上独立运行的授权工具包
- 包含：`node.exe`、`授权工具.js`、`授权U盘.bat`、`private.pem`、`public.pem`
- **零依赖**：无需安装 Node.js、Python 或任何软件
- 输出：`F:\openclaw-shouquan.zip`（约 31MB）

### 6. UI / 功能优化
- 日志栏支持文字复制（`user-select: text`）
- 窗口支持拖拽调整大小（`resizable: true`，最小 760×520）
- 新增版本号显示（标题栏版本徽章）
- 新增"修改 API Key"功能（无需重新配置即可更新密钥）
- 修复"重新配置"确认对话框措辞（明确提示聊天记录将被删除）

### 7. Bug 修复
- **修复**：配置文件 JSON 损坏时修复按钮失效 → 自动检测损坏、删除重建最小配置，提示重新输入 API Key
- **修复**：`meta: Unrecognized key: description` 报错 → 写入配置时自动过滤未知字段，仅保留合法 meta 字段
- **修复**：`applyFreshGatewayToken` 返回 null 时修复流程卡死

---

## 项目整体说明

### 项目定位
OpenClaw U盘版是面向**商业客户**的加密便携版本，具备以下特点：

| 特性 | 说明 |
|------|------|
| 授权锁定 | 通过 U 盘序列号 + ECDSA 私钥签名，绑定到指定 U 盘 |
| 无需安装 | 内置 Node.js runtime，双击 exe 直接运行 |
| 数据隔离 | 所有数据存储在 U 盘自身（不写入用户电脑） |
| 零配置 | 客户收到 U 盘即可使用，首次自动解压、自动初始化 |
| 桌面宠物 | 运行时桌面显示卡通龙虾，直观感知 OpenClaw 状态 |

---

### 文件结构

```
F:\openclaw-usb\              ← 开发目录
├── main.js                   ← Electron 主进程
├── preload.js                ← 主窗口 IPC 桥接
├── pet-preload.js            ← 宠物窗口 IPC 桥接
├── launcher.html             ← 主控制界面
├── setup.html                ← 首次配置向导
├── pet.html                  ← 桌面宠物界面
├── package.json              ← electron-builder 配置
├── private.pem               ← 授权私钥（保密）
├── public.pem                ← 授权公钥（随程序分发）
├── 授权工具.js               ← 批量签名脚本
├── 授权U盘.bat               ← 批量授权启动器
├── 打包授权工具.bat           ← 生成独立授权工具包
├── 同步U盘版.ps1             ← 同步+打包 openclaw.zip

F:\U盘内容\                   ← 分发给客户的 U 盘内容
├── OpenClaw-U盘版.exe        ← 主程序（electron-builder 输出）
├── license.key               ← 授权文件（按 U 盘序列号生成）
├── openclaw.zip              ← OpenClaw 本体（首次启动自动解压）
└── runtime\
    └── node.exe              ← 内置 Node.js 运行时
```

---

### 工作流程

#### 出货前（你的操作）
```
1. npm run build              → 生成 OpenClaw-U盘版.exe
2. 运行 同步U盘版.ps1         → 生成 openclaw.zip
3. 插入客户 U 盘
4. 双击 授权U盘.bat           → 自动检测+签名，生成 license.key
5. 将以下 4 个文件复制到 U 盘：
   - OpenClaw-U盘版.exe
   - license.key
   - openclaw.zip
   - runtime\
```

#### 客户使用
```
1. 插入 U 盘
2. 双击 OpenClaw-U盘版.exe
3. 程序自动验证授权 → 自动解压 openclaw.zip（首次）→ 启动
4. 桌面出现龙虾宠物，点击可打开控制界面
```

#### 新员工授权（内部）
```
1. 解压 openclaw-shouquan.zip 到任意目录
2. 插入待授权 U 盘（可同时插多个）
3. 双击 授权U盘.bat → 全自动完成
```
