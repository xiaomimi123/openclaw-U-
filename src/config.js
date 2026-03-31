/**
 * 配置构建、修复、清理模块
 * 包含 buildOpenclawConfig、sanitizeConfig、applyFreshGatewayToken 等
 */
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { configDir, tempOpenclawDir, setupFile } = require('./paths')
const APP_VERSION = require('../package.json').version

// ─── 基础模型条目 ─────────────────────────────────────────────────────────

function baseModelEntry(id, name) {
  return {
    id, name,
    api: 'openai-completions',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192
  }
}

// ─── 统一 Provider 配置（消除 buildOpenclawConfig 与 update-api-key 的重复） ──

/**
 * 将指定服务商的 API Key 配置写入 cfg 对象
 * @param {object} cfg - openclaw.json 配置对象（会被原地修改）
 * @param {string} provider - 服务商标识
 * @param {string} key - API Key
 * @param {object} opts - 额外选项 { baseUrl, modelId, modelName }
 */
function applyProviderConfig(cfg, provider, key, opts = {}) {
  if (!cfg.env) cfg.env = {}
  if (!cfg.agents) cfg.agents = {}
  if (!cfg.agents.defaults) cfg.agents.defaults = {}

  switch (provider) {
    case 'anthropic':
      cfg.env.ANTHROPIC_API_KEY = key
      if (opts.baseUrl) cfg.env.ANTHROPIC_BASE_URL = opts.baseUrl
      cfg.agents.defaults.model = { primary: 'anthropic/claude-sonnet-4-6' }
      break

    case 'openai':
      if (opts.baseUrl) {
        if (!cfg.models) cfg.models = {}
        if (!cfg.models.providers) cfg.models.providers = {}
        cfg.models.providers.openai = {
          apiKey: key,
          baseUrl: opts.baseUrl,
          models: [baseModelEntry('gpt-4o', 'GPT-4o')]
        }
      } else {
        cfg.env.OPENAI_API_KEY = key
      }
      cfg.agents.defaults.model = { primary: 'openai/gpt-4o' }
      break

    case 'deepseek':
      if (!cfg.models) cfg.models = {}
      if (!cfg.models.providers) cfg.models.providers = {}
      cfg.models.providers.openai = {
        apiKey: key,
        baseUrl: 'https://api.deepseek.com',
        models: [baseModelEntry('deepseek-chat', 'DeepSeek Chat')]
      }
      cfg.agents.defaults.model = { primary: 'openai/deepseek-chat' }
      break

    case 'qwen':
      if (!cfg.models) cfg.models = {}
      if (!cfg.models.providers) cfg.models.providers = {}
      cfg.models.providers.openai = {
        apiKey: key,
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        models: [baseModelEntry('qwen-max', '通义千问 Max')]
      }
      cfg.agents.defaults.model = { primary: 'openai/qwen-max' }
      break

    case 'glm':
      cfg.env.ZAI_API_KEY = key
      cfg.agents.defaults.model = { primary: 'zai/glm-4-plus' }
      break

    case 'volcengine': {
      const volcModelId = opts.modelId || 'doubao-seed-2-0-pro-260215'
      if (!cfg.models) cfg.models = {}
      if (!cfg.models.providers) cfg.models.providers = {}
      cfg.models.providers.openai = {
        apiKey: key,
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        models: [baseModelEntry(volcModelId, '豆包')]
      }
      cfg.agents.defaults.model = { primary: 'openai/' + volcModelId }
      break
    }

    case 'custom': {
      if (!cfg.models) cfg.models = {}
      if (!cfg.models.providers) cfg.models.providers = {}
      cfg.models.providers.openai = {
        apiKey: key,
        baseUrl: opts.baseUrl,
        models: [baseModelEntry(opts.modelId || 'custom-model', opts.modelName || '自定义模型')]
      }
      cfg.agents.defaults.model = { primary: 'openai/' + (opts.modelId || 'custom-model') }
      break
    }

    default:
      throw new Error('未知的 AI 服务商: ' + provider)
  }
}

// ─── 构建完整配置 ─────────────────────────────────────────────────────────

function buildOpenclawConfig(setup) {
  const config = {
    meta: {
      lastTouchedVersion: APP_VERSION,
      lastTouchedAt: new Date().toISOString()
    },
    wizard: {
      lastRunAt: new Date().toISOString(),
      lastRunVersion: APP_VERSION,
      lastRunCommand: 'configure',
      lastRunMode: 'local'
    },
    env: {},
    agents: {
      defaults: {
        model: { primary: '' },
        compaction: { mode: 'safeguard' },
        maxConcurrent: 4,
        subagents: { maxConcurrent: 8 },
      }
    },
    channels: {},
    gateway: {
      mode: 'local',
      auth: {
        mode: 'token',
        token: crypto.randomBytes(24).toString('hex')  // placeholder; overwritten at each launch
      },
      controlUi: {
        allowInsecureAuth: true,
        dangerouslyDisableDeviceAuth: true
      }
    },
    plugins: {
      entries: {}
    },
    tools: {
      profile: 'full',       // 开放所有工具（exec, read, write, browser 等）
      exec: {
        host: 'gateway',     // 在宿主机执行（U盘版没有 Docker，不能用默认的 sandbox）
        security: 'full',    // 允许所有命令（小白用户无法理解 allowlist 审批弹窗）
      }
    },
    commands: { native: 'auto', nativeSkills: 'auto', restart: true, ownerDisplay: 'raw' },
    update: { checkOnStart: false }
  }

  // AI provider
  applyProviderConfig(config, setup.aiProvider, setup.apiKey, {
    baseUrl: setup.baseUrl,
    modelId: setup.customModelId,
    modelName: setup.customModelName
  })

  // Chat channel
  switch (setup.chatTool) {
    case 'telegram':
      config.channels.telegram = {
        enabled: true,
        botToken: setup.chatConfig.botToken,
        dmPolicy: 'pairing',
        groupPolicy: 'allowlist',
        streaming: 'partial'
      }
      config.plugins.entries.telegram = { enabled: true }
      break

    case 'discord':
      config.channels.discord = {
        enabled: true,
        token: setup.chatConfig.token
      }
      config.plugins.entries.discord = { enabled: true }
      break

    case 'feishu':
      config.channels.feishu = {
        enabled: true,
        appId: setup.chatConfig.appId,
        appSecret: setup.chatConfig.appSecret,
      }
      break

    case 'none':
    default:
      break
  }

  return config
}

// ─── 修复插件路径（跨电脑时 TEMP 路径和 USB 盘符会变）───────────────────

function fixPluginPaths(cfg) {
  if (!cfg.plugins?.entries || typeof cfg.plugins.entries !== 'object') return
  for (const entry of Object.values(cfg.plugins.entries)) {
    if (!entry || typeof entry.dir !== 'string') continue
    const d = entry.dir.replace(/\\/g, '/')

    // 内置插件：路径含 /openclaw-usb/openclaw/，更新为当前 TEMP 里的路径
    const tempMarker = '/openclaw-usb/openclaw/'
    const tempIdx = d.indexOf(tempMarker)
    if (tempIdx !== -1) {
      entry.dir = path.join(tempOpenclawDir, d.slice(tempIdx + tempMarker.length))
      continue
    }

    // 用户安装的插件：路径含 /openclaw-data/.openclaw/extensions/，更新为当前 USB 路径
    const extMarker = '/openclaw-data/.openclaw/extensions/'
    const extIdx = d.indexOf(extMarker)
    if (extIdx !== -1) {
      const pluginName = d.slice(extIdx + extMarker.length).split('/')[0]
      if (pluginName) entry.dir = path.join(configDir, 'extensions', pluginName)
    }
  }
}

// ─── 写入 gateway token + 禁用 device auth ────────────────────────────────

async function applyFreshGatewayToken() {
  const configPath = path.join(configDir, 'openclaw.json')
  if (!fs.existsSync(configPath)) return null
  try {
    const token = crypto.randomBytes(24).toString('hex')
    const cfg = JSON.parse(await fs.promises.readFile(configPath, 'utf8'))
    // 更新 meta（保留 openclaw 自己写入的其他字段，只更新我们关心的）
    if (!cfg.meta) cfg.meta = {}
    cfg.meta.lastTouchedVersion = cfg.meta.lastTouchedVersion || APP_VERSION
    cfg.meta.lastTouchedAt = new Date().toISOString()
    if (!cfg.gateway) cfg.gateway = {}
    if (!cfg.gateway.auth) cfg.gateway.auth = {}
    cfg.gateway.auth.mode = 'token'
    cfg.gateway.auth.token = token
    if (!cfg.gateway.controlUi) cfg.gateway.controlUi = {}
    cfg.gateway.controlUi.allowInsecureAuth = true
    cfg.gateway.controlUi.dangerouslyDisableDeviceAuth = true
    if (!cfg.update) cfg.update = {}
    cfg.update.checkOnStart = false
    if (!cfg.plugins) cfg.plugins = {}
    delete cfg.plugins.deny  // 清除旧版本可能写入的 deny 列表
    // 清理旧版本写入的 agents.defaults.tools（openclaw 新版 schema 不再支持）
    if (cfg.agents?.defaults?.tools) delete cfg.agents.defaults.tools
    // 确保工具执行配置正确（U盘版没有 Docker，必须用 gateway 模式）
    if (!cfg.tools) cfg.tools = {}
    cfg.tools.profile = 'full'
    if (!cfg.tools.exec) cfg.tools.exec = {}
    cfg.tools.exec.host = 'gateway'
    cfg.tools.exec.security = 'full'
    // 修复跨电脑后插件路径失效问题
    fixPluginPaths(cfg)
    await fs.promises.writeFile(configPath, JSON.stringify(cfg, null, 2), 'utf8')
    return token
  } catch (e) {
    console.error('[applyFreshGatewayToken] failed:', e.message)
    return null
  }
}

// ─── 启动前主动清理配置中的非法字段 ──────────────────────────────────────

/**
 * @param {Function} [logFn] - 可选的日志回调，用于向 UI 推送修复信息
 */
async function sanitizeConfig(logFn) {
  const configPath = path.join(configDir, 'openclaw.json')
  try {
    const raw = await fs.promises.readFile(configPath, 'utf8')
    const cfg = JSON.parse(raw)
    let dirty = false
    const fixes = []

    // --- 规则 0：仅删除已知会导致 Config invalid 的顶层字段（黑名单）---
    const bannedRootKeys = new Set(['_comment'])
    for (const key of Object.keys(cfg)) {
      if (bannedRootKeys.has(key)) {
        delete cfg[key]
        fixes.push(`<root>.${key}（已知非法字段，已删除）`)
        dirty = true
      }
    }

    // --- 规则 1：agents.defaults.tools（已知的非法字段）---
    if (cfg.agents?.defaults?.tools) {
      delete cfg.agents.defaults.tools
      fixes.push('agents.defaults.tools（非法字段，已删除）')
      dirty = true
    }

    // --- 规则 3：gateway.bind 值不合法 ---
    const allowedBindValues = new Set(['auto', 'lan', 'loopback', 'custom', 'tailnet'])
    if (cfg.gateway?.bind && !allowedBindValues.has(cfg.gateway.bind)) {
      fixes.push(`gateway.bind="${cfg.gateway.bind}"（不合法，已重置为 "loopback"）`)
      cfg.gateway.bind = 'loopback'
      dirty = true
    }

    // --- 规则 4：channels 下已知错误的旧 channel id ---
    if (cfg.channels && typeof cfg.channels === 'object') {
      const staleChannelIds = new Set(['weixin'])
      for (const ch of Object.keys(cfg.channels)) {
        if (staleChannelIds.has(ch)) {
          delete cfg.channels[ch]
          fixes.push(`channels.${ch}（旧版 channel id，已删除）`)
          dirty = true
        }
      }
    }

    // --- 规则 5：plugins.entries 下的过期插件条目 ---
    if (cfg.plugins?.entries && typeof cfg.plugins.entries === 'object') {
      const stalePluginIds = new Set(['weixin'])
      for (const pid of Object.keys(cfg.plugins.entries)) {
        if (stalePluginIds.has(pid)) {
          delete cfg.plugins.entries[pid]
          fixes.push(`plugins.entries.${pid}（过期的插件 id，已删除）`)
          dirty = true
        }
      }
    }

    // --- 规则 6：models.providers 下各 provider 缺少 models 数组 ---
    if (cfg.models?.providers && typeof cfg.models.providers === 'object') {
      for (const [provName, prov] of Object.entries(cfg.models.providers)) {
        if (!prov || typeof prov !== 'object') continue
        if (!Array.isArray(prov.models)) {
          const primaryModel = cfg.agents?.defaults?.model?.primary || ''
          const modelId = primaryModel.includes('/') ? primaryModel.split('/').pop() : null
          const fallbackModels = {
            'deepseek-chat':  { id: 'deepseek-chat',  name: 'DeepSeek Chat' },
            'gpt-4o':         { id: 'gpt-4o',         name: 'GPT-4o' },
            'qwen-max':       { id: 'qwen-max',       name: '通义千问 Max' },
          }
          const entry = fallbackModels[modelId] || { id: modelId || 'default', name: modelId || 'Default Model' }
          prov.models = [baseModelEntry(entry.id, entry.name)]
          fixes.push(`models.providers.${provName}.models（缺失，已根据 ${entry.id} 自动补全）`)
          dirty = true
        }
      }
    }

    // --- 规则 7：plugins.allow 中引用了不存在的插件 ---
    if (Array.isArray(cfg.plugins?.allow)) {
      const validAllow = cfg.plugins.allow.filter(id => {
        const pluginDir = path.join(configDir, 'extensions', id)
        return fs.existsSync(pluginDir)
      })
      if (validAllow.length !== cfg.plugins.allow.length) {
        const removed = cfg.plugins.allow.filter(id => !validAllow.includes(id))
        fixes.push(`plugins.allow（移除不存在的插件: ${removed.join(', ')}）`)
        if (validAllow.length > 0) {
          cfg.plugins.allow = validAllow
        } else {
          delete cfg.plugins.allow
        }
        dirty = true
      }
    }

    // --- 规则 8：plugins.entries 下各插件的非法 key ---
    if (cfg.plugins?.entries && typeof cfg.plugins.entries === 'object') {
      const knownBadKeys = new Set(['app_id', 'app_secret', 'verification_token', 'encrypt_key'])
      for (const [pluginName, entry] of Object.entries(cfg.plugins.entries)) {
        if (!entry || typeof entry !== 'object') continue
        for (const key of Object.keys(entry)) {
          if (knownBadKeys.has(key)) {
            delete entry[key]
            fixes.push(`plugins.entries.${pluginName}.${key}（旧格式字段，已删除）`)
            dirty = true
          }
        }
      }
    }

    if (dirty) {
      await fs.promises.writeFile(configPath, JSON.stringify(cfg, null, 2), 'utf8')
      const log = '🔧 自动修复配置：\n' + fixes.map(f => '   - ' + f).join('\n') + '\n'
      if (logFn) logFn(log)
    }
    return { fixed: dirty, fixes }
  } catch {
    return { fixed: false, fixes: [] }
  }
}

module.exports = {
  baseModelEntry,
  applyProviderConfig,
  buildOpenclawConfig,
  fixPluginPaths,
  applyFreshGatewayToken,
  sanitizeConfig
}
