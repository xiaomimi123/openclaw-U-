# OpenClaw U盘便携版

面向小白用户的 AI 助手即插即用方案。插上 U 盘，双击启动，无需安装任何软件。

## 解决什么问题

- **部署难**：普通用户不会装 Node.js、不会配环境、不会用命令行
- **数据安全**：所有数据只存 U 盘，拔出即停止，不在本机留痕

## 核心特性

- **即插即用** — U 盘插入后双击 exe 即可启动，零配置
- **数据隔离** — 聊天记录、配置、插件全部存储在 U 盘，不污染本机
- **自动解压** — 首次运行自动解压到本机 SSD 缓存，后续秒启动
- **授权绑定** — 每个 U 盘独立授权（ECDSA 签名 + 卷序列号），防止复制盗用
- **拔盘即停** — 实时监控 U 盘状态，拔出后自动退出程序
- **多模型支持** — Claude / GPT / DeepSeek / 通义千问 / GLM 一键切换
- **微信集成** — 内置微信插件，扫码登录即可使用
- **自助升级** — 通过 OpenClaw 自身命令行能力升级，不依赖开发者发包

## 技术栈

- **Electron** — 跨平台桌面应用框架
- **OpenClaw** — AI 网关核心（插件化架构）
- **Node.js** — 便携运行时，内置于 U 盘

## 项目结构

```
├── main.js              # 主进程（IPC、网关管理、USB 监控）
├── src/
│   ├── paths.js         # 路径常量、环境隔离
│   ├── config.js        # OpenClaw 配置生成与修复
│   ├── license.js       # 授权验证（ECDSA）
│   └── log-translate.js # 日志翻译（英→中）
├── launcher.html        # 主控制台界面
├── setup.html           # 首次配置向导
├── preload.js           # IPC 桥接
├── test/                # 单元测试
├── sign-usb.js          # 授权签发脚本
└── weixin-plugin-build/ # 微信插件源码
```

## 开发

```bash
git clone https://github.com/xiaomimi123/openclaw-U-.git
cd openclaw-U-
npm install
npm start    # 开发模式（跳过授权验证）
npm test     # 运行测试
```

## 打包

```bash
# Windows 便携版
npm run build
```

## 平台支持

- Windows（当前） — 便携 exe，即插即用
- macOS（开发中） — .app 包，适配 Apple Silicon / Intel

## 联系作者

- 微信：**become5858**

如有问题、合作意向或购买咨询，欢迎添加微信联系。
