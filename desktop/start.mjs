#!/usr/bin/env node
// WorkBuddy 桌面启动器。
//
// 干三件事：
//   1. 起一个只监听 127.0.0.1 的本地 API（复用 lib/api.mjs，和 DSH 面板同一套路由）；
//   2. 拉起桌宠 + 「实验助手」面板（复用 lib/overlay.mjs，C# 源码一行没改）；
//   3. 写一个发现文件，让 MCP 适配器把工具调用转发到这里，
//      保证任何时刻只有本进程持有 store/core，避免两个进程同时写同一份实验档案。
//
// 用法：
//   node desktop/start.mjs                 启动（桌宠 + 面板 + API）
//   node desktop/start.mjs --no-pet       只起 API（无界面环境 / 自动化测试）
//   node desktop/start.mjs --status       查看是否已在运行
//   node desktop/start.mjs --stop         干净退出
//   node desktop/start.mjs --enable-autostart / --disable-autostart   开机自启（默认关）
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { ExperimentStore } from '../lib/store.mjs'
import { KnowledgeBase } from '../lib/knowledge.mjs'
import { createCore } from '../lib/core.mjs'
import { createApiHandler, assetStatus } from '../lib/api.mjs'
import { sendJson } from '../lib/http.mjs'
import { startOverlay, stopOverlay, activeOverlay, overlayRequest } from '../lib/overlay.mjs'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const HOME = process.env.LAB_ASSISTANT_HOME
  || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'lab-assistant')
const DISCOVERY = join(HOME, 'desktop.json')
const AUTOSTART_PREF = join(HOME, 'desktop-autostart.json')
const ASSETS_ROOT = join(PACKAGE_ROOT, 'assets')
const VERSION = (() => {
  try { return String(JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version || '0.0.0') }
  catch { return '0.0.0' }
})()
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const RUN_NAME = 'WorkBuddy Lab Assistant'

mkdirSync(HOME, { recursive: true })

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)

function readDiscovery() {
  try { return JSON.parse(readFileSync(DISCOVERY, 'utf8')) } catch { return null }
}
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}
async function probe(d) {
  if (!d?.port || !d?.token) return false
  try {
    const r = await fetch(`http://127.0.0.1:${d.port}/dsh-lab/api/status?token=${encodeURIComponent(d.token)}`, {
      signal: AbortSignal.timeout(1500),
    })
    return r.ok
  } catch { return false }
}
// 自启状态记在本地文件里，托盘菜单每次展开只读文件，不去动注册表。
// 只有用户显式点「开机自动启动」/ 跑 --enable-autostart 时才写 Run 项。
function readAutoStartPref() {
  try { return JSON.parse(readFileSync(AUTOSTART_PREF, 'utf8')).enabled === true } catch { return false }
}
function writeAutoStartPref(enabled) {
  writeFileSync(AUTOSTART_PREF, `${JSON.stringify({ enabled: Boolean(enabled) }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(AUTOSTART_PREF, 0o600) } catch { }
}
function setAutoStart(enabled) {
  if (process.platform !== 'win32') throw new Error('开机自启目前只支持 Windows')
  if (!enabled) {
    try { execFileSync('reg', ['delete', RUN_KEY, '/v', RUN_NAME, '/f'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 本来就没有 */ }
    writeAutoStartPref(false)
    return false
  }
  const nodeExe = process.execPath
  const script = join(PACKAGE_ROOT, 'desktop', 'start.mjs')
  const value = `"${nodeExe}" "${script}"`
  execFileSync('reg', ['add', RUN_KEY, '/v', RUN_NAME, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true, stdio: 'ignore' })
  writeAutoStartPref(true)
  return true
}

// ---- 命令行分支：状态 / 停止 / 自启开关 ----
if (has('--status') || has('--stop') || has('--enable-autostart') || has('--disable-autostart')) {
  if (has('--enable-autostart') || has('--disable-autostart')) {
    try {
      const enabled = setAutoStart(has('--enable-autostart'))
      console.log(enabled ? '已开启开机自启（用户级，无需管理员）' : '已关闭开机自启')
    } catch (error) {
      console.error('设置自启失败：' + (error?.message || error))
      process.exitCode = 1
    }
  }
  if (has('--status') || has('--stop')) {
    const d = readDiscovery()
    const online = d ? await probe(d) : false
    console.log(JSON.stringify({ running: online, discovery: DISCOVERY, ...(online ? { pid: d.pid, port: d.port, version: d.version, homeDir: d.homeDir } : {}) }, null, 2))
    if (has('--stop')) {
      if (!online) { console.log('没有运行中的桌面服务'); }
      else {
        try {
          const r = await fetch(`http://127.0.0.1:${d.port}/dsh-lab/api/desktop/shutdown?token=${encodeURIComponent(d.token)}`, {
            method: 'POST', signal: AbortSignal.timeout(3000),
          })
          console.log(r.ok ? '已发出退出指令' : '退出指令失败：HTTP ' + r.status)
        } catch (error) { console.error('退出指令失败：' + (error?.message || error)); process.exitCode = 1 }
      }
    }
  }
  process.exit(process.exitCode || 0)
}

// ---- 主流程 ----
const existing = readDiscovery()
if (existing && await probe(existing)) {
  console.log(`桌面服务已在运行（pid=${existing.pid}, port=${existing.port}）。`)
  console.log('要重启请先执行：node desktop/start.mjs --stop')
  process.exit(0)
}

let store = new ExperimentStore(HOME)
const knowledge = new KnowledgeBase(store)
const hostNotes = ['通过 WorkBuddy 桌面启动器调用；本进程是唯一的数据写入点，MCP 工具调用会转发到这里']
const makeCore = (s) => createCore({
  store: s,
  version: VERSION,
  assetsRoot: ASSETS_ROOT,
  hostNotes,
  overlay: null,
  knowledge,
})
let core = makeCore(store)

const token = randomBytes(16).toString('hex')
let apiInfo = null
let overlayInfo = null
let watchTimer = null
let shuttingDown = false
let server = null

const deps = {
  store,
  core,
  knowledge,
  homeDir: HOME,
  version: VERSION,
  assetStatus: () => assetStatus(ASSETS_ROOT),
  overlayStatus: async () => ({ running: Boolean(overlayInfo?.ok) }),
  petMood: (state, text) => {
    const connection = activeOverlay()?.connection
    if (!connection) return
    overlayRequest(connection, '/pet', { action: 'state', state, durationMs: 4200 }).catch(() => {})
    if (text) overlayRequest(connection, '/pet', { action: 'say', text, durationMs: 6500 }).catch(() => {})
  },
  replaceStore: (next) => {
    store = next
    knowledge.store = next
    // 桌面版顺手把 core 也重建，避免 DSH 侧「换数据目录后 core 仍持旧 store」的历史问题。
    core = makeCore(next)
    deps.core = core
  },
  getAutoStart: readAutoStartPref,
  setAutoStart,
  shutdown: () => { shutdown().catch(() => {}) },
}
const api = createApiHandler(deps)

server = http.createServer(async (req, res) => {
  let parsed
  try { parsed = new URL(req.url || '/', 'http://127.0.0.1') }
  catch { return sendJson(res, 400, { ok: false, error: '请求地址无效' }) }
  if (parsed.searchParams.get('token') !== token) return sendJson(res, 403, { ok: false, error: 'token 不匹配' })
  if (!parsed.pathname.startsWith('/dsh-lab/api/')) return sendJson(res, 404, { ok: false, error: '路径不存在' })
  try { await api(req, res, parsed.pathname, parsed.searchParams) }
  catch (error) { sendJson(res, error?.statusCode || 500, { ok: false, error: String(error?.message || error) }) }
})
server.on('error', (error) => {
  process.stderr.write(`[lab-assistant-desktop] 本地服务出错：${error?.message || error}\n`)
  shutdown().catch(() => {})
})

await new Promise((resolvePromise, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    server.removeListener('error', reject)
    resolvePromise()
  })
})
const port = server.address().port
apiInfo = { base: `http://127.0.0.1:${port}/dsh-lab/api`, token }

function writeDiscovery() {
  const data = {
    pid: process.pid, port, token, version: VERSION,
    homeDir: HOME, startedAt: new Date().toISOString(),
  }
  writeFileSync(DISCOVERY, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(DISCOVERY, 0o600) } catch { /* Windows 上尽力而为 */ }
}
function clearDiscovery() {
  try {
    const d = readDiscovery()
    if (d && d.pid === process.pid) unlinkSync(DISCOVERY)
  } catch { /* 已删或无权限，不阻断退出 */ }
}
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  if (watchTimer) clearInterval(watchTimer)
  clearDiscovery()
  try { await stopOverlay() } catch { }
  try { server?.close() } catch { }
  process.exit(0)
}
process.on('SIGINT', () => { shutdown().catch(() => {}) })
process.on('SIGTERM', () => { shutdown().catch(() => {}) })
process.on('exit', clearDiscovery)

writeDiscovery()
console.log(`[lab-assistant-desktop] v${VERSION} 已启动`)
console.log(`  本地 API   http://127.0.0.1:${port}/dsh-lab/api`)
console.log(`  发现文件   ${DISCOVERY}`)
console.log(`  数据目录   ${HOME}`)

if (process.platform !== 'win32') {
  console.log('  当前不是 Windows：桌宠不可用，仅提供本地 API（MCP 转发仍可用）')
} else if (has('--no-pet')) {
  console.log('  --no-pet：不启动桌宠，仅提供本地 API')
} else {
  const settings = store.getSettings()
  try {
    const result = await startOverlay({
      homeDir: HOME,
      displayName: settings.displayName || '主人',
      petSize: settings.petSize,
      tray: true,
      apiInfo: () => apiInfo,
    })
    overlayInfo = result
    if (result.ok) {
      console.log(`  桌宠已启动 pid=${result.pid}${result.rebuilt ? '（首次编译完成）' : ''}`)
      // 托盘「退出」会让桌宠进程结束；跟着一起收尾，避免留下孤儿 API 进程。
      watchTimer = setInterval(() => { if (!isAlive(result.pid)) shutdown().catch(() => {}) }, 2000)
      watchTimer.unref?.()
    } else {
      console.warn(`  桌宠启动失败（${result.reason}）：${result.error}`)
      console.warn('  本地 API 与 MCP 转发仍然可用；日志见数据目录 overlay/build.log')
    }
  } catch (error) {
    console.warn('  桌宠启动异常：' + (error?.message || error))
    console.warn('  本地 API 与 MCP 转发仍然可用')
  }
}
