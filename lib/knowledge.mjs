// 经验闭环：把 guide-presets / page-maps / software-notes 三套数据合成一张可执行的界面地图。
// 设计原则：一个库（interface）+ 两类动作（record 自动写、guide 自动查）+ 一个注入点（档案读取）。
// 宿主无关：不读 DSH 环境变量、不 import DSH 包；所有返回值可 JSON 序列化。
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

export const KNOWLEDGE_LIMITS = Object.freeze({
  pitfalls: 5, controls: 8, failures: 3, tips: 3, where: 3, hot: 5,
})

export const USED_SOURCES = Object.freeze([
  'interface-live',      // 同版本 UIA 实时命中（不套旧坐标，让桌宠按控件名重新定位）
  'interface-history',   // 同版本历史坐标命中
  'interface-drift',     // 跨版本 / 窗口尺寸不一致 / 尺寸未知，需核对
  'preset-window',       // 只命中窗口级旧 preset（粒度不足）
  'none',                // 没命中，靠 agent 传的坐标
])

export function slug(value) {
  const raw = String(value ?? '').toLowerCase()
  let out = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!out) return createHash('sha256').update(raw).digest('hex').slice(0, 8)
  // 实测边界：中文/特殊字符会把名字压得极短（「软件:A/B」→「a-b」），不同软件可能撞到同一文件。
  // 非 ASCII 或过短的名字追加哈希后缀；规则可复算，读写两端一致。
  const needsSuffix = /[^\x00-\x7f]/.test(raw) || out.length < 3
  if (needsSuffix) out = `${out}-${createHash('sha256').update(raw).digest('hex').slice(0, 8)}`
  return out.slice(0, 40)
}

function safeText(value, maxLength = 400, fallback = '') {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return (text || fallback).slice(0, maxLength)
}

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

function appendJsonLine(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  // 单进程内串行追加；每行一条完整 JSON，读时逐行容错（坏行不影响其余）。
  appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8')
}

function readJsonLines(file, limit = 100000) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { return [] }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* 跳过坏行，不让一条脏数据拖垮整个查询 */ }
    if (out.length >= limit) break
  }
  return out
}

function clampNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeRect(raw) {
  if (!raw || typeof raw !== 'object') return null
  const x = clampNumber(raw.x, NaN), y = clampNumber(raw.y, NaN)
  const w = clampNumber(raw.w, 0), h = clampNumber(raw.h, 0)
  if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) return null
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

function normalizeWindowSize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const w = clampNumber(raw.w, 0), h = clampNumber(raw.h, 0)
  return w > 0 && h > 0 ? { w: Math.round(w), h: Math.round(h) } : null
}

function controlKey(software, window, name) {
  return `${software}::${window}::${name}`.toLowerCase()
}

function freshControl(software, window, name, extra = {}) {
  return {
    key: controlKey(software, window, name),
    name: safeText(name, 120),
    alias: [],
    purpose: safeText(extra.purpose, 200),
    window: safeText(window, 120),
    rect: normalizeRect(extra.rect),
    coord: 'window',            // 相对整窗，与 screenshot / click / guide 的 client=false 一致
    windowSize: normalizeWindowSize(extra.windowSize),
    dpi: clampNumber(extra.dpi, 0) || null,
    source: ['uia', 'preset', 'manual'].includes(extra.source) ? extra.source : 'manual',
    versionSeen: Array.isArray(extra.versionSeen) ? extra.versionSeen.slice(0, 20) : [],
    hits: 0, ok: 0, fail: 0,
    lastOkAt: '',
    anchor: '',
    pad: clampNumber(extra.pad, 0),
    needsRevalidate: extra.needsRevalidate === true,
  }
}

function emptyInterface(software) {
  return { schemaVersion: 1, software: String(software), version: '', updatedAt: '', controls: [], whereTexts: [] }
}

export class KnowledgeBase {
  constructor(store, options = {}) {
    this.store = store
    this.home = resolve(store.homeDir)
    this.now = options.now || (() => new Date())
    this.interfaceDir = join(this.home, 'interface')
    this.anchorsDir = join(this.interfaceDir, 'anchors')
    this.actionsDir = join(this.home, 'actions')
    this.failuresDir = join(this.home, 'failures')
    this.usageDir = join(this.home, 'usage')
    this.fragmentsDir = join(this.home, 'report-fragments')
    this.windowsFile = join(this.interfaceDir, '_windows.json')
  }

  // 自动采集总开关：默认开启，用户可在面板/设置里关闭；关闭后所有写入静默跳过。
  autoCapture() {
    try { return this.store.getSettings().autoCapture !== false } catch { return true }
  }

  pathOf(kind, software) {
    const name = slug(software)
    if (kind === 'interface') return join(this.interfaceDir, `${name}.json`)
    if (kind === 'failures') return join(this.failuresDir, `${name}.jsonl`)
    if (kind === 'usage') return join(this.usageDir, `${name}.json`)
    if (kind === 'fragments') return join(this.fragmentsDir, `${name}.json`)
    if (kind === 'anchors') return join(this.anchorsDir, name)
    if (kind === 'actions') return join(this.actionsDir, `${slug(software)}.jsonl`) // software 位置传 expId
    return ''
  }

  // ---- L1：interface 是唯一查询入口；旧三套数据只在首次读取时导入，不迁移、不删除 ----
  getInterface(software, { force = false } = {}) {
    const name = String(software || '').trim()
    if (!name) return emptyInterface('')
    const file = this.pathOf('interface', name)
    const cached = force ? null : readJson(file, null)
    if (cached && typeof cached === 'object' && Array.isArray(cached.controls)) return cached
    return this.rebuild(name)
  }

  pageMapDir() { return join(this.home, 'page-maps') }

  listPageMaps(software) {
    let files = []
    try { files = readdirSync(this.pageMapDir()).filter((f) => f.endsWith('.json')) } catch { return [] }
    const wanted = String(software || '').toLowerCase()
    return files.map((f) => {
      try {
        const full = join(this.pageMapDir(), f)
        const data = JSON.parse(readFileSync(full, 'utf8'))
        if (wanted && String(data.software || '').toLowerCase() !== wanted) return null
        return { file: full, ...data }
      } catch { return null }
    }).filter(Boolean).sort((a, b) => String(b.capturedAt || '').localeCompare(String(a.capturedAt || '')))
  }

  // 合并规则（按可信度）：UIA > 历史坐标 > 文本描述。
  // 关键：/inspect 的 rect 是屏幕绝对坐标，rel 才是相对整窗；guide/screenshot/click 一律用整窗基准，
  // 所以这里只认 rel，绝不把 rect 当相对坐标导入（否则高亮框会整体偏一个窗口左上角）。
  rebuild(software) {
    const name = String(software || '').trim()
    const data = emptyInterface(name)
    if (!name) return data
    const controls = new Map()
    const ensure = (window, controlName, extra = {}) => {
      const key = controlKey(name, window, controlName)
      let item = controls.get(key)
      if (!item) {
        item = freshControl(name, window, controlName, extra)
        controls.set(key, item)
      }
      return item
    }

    // 1) page-maps：导入控件名 + rel（相对整窗）坐标
    const maps = this.listPageMaps(name)
    for (const map of maps) {
      const version = safeText(map.version, 60, 'latest')
      const window = safeText(map.windowTitle, 120, '主窗口')
      const windowSize = normalizeWindowSize(map.windowRect) || normalizeWindowSize(map.windowSize)
      data.version = data.version || version
      for (const raw of Array.isArray(map.controls) ? map.controls : []) {
        const controlName = safeText(raw && raw.name, 120)
        if (!controlName) continue
        const rel = normalizeRect(raw && raw.rel)
        const item = ensure(window, controlName, {
          source: 'uia',
          rect: rel,
          windowSize,
          versionSeen: [version],
          // 只有绝对坐标没有 rel：仍记控件名，但不记坐标，必须重新定位
          needsRevalidate: !rel || !windowSize,
        })
        item.source = 'uia'
        if (rel && !item.rect) item.rect = rel
        if (windowSize && !item.windowSize) item.windowSize = windowSize
        if (!item.versionSeen.includes(version)) item.versionSeen.push(version)
        if (safeText(raw && raw.type, 60) && !item.alias.includes(safeText(raw.type, 60))) {
          item.alias.push(safeText(raw.type, 60))
        }
      }
    }

    // 2) guide-presets：只有「软件::窗口」级坐标，没有控件名 → 匿名窗口条目
    let presets = {}
    try { presets = this.store.listGuidePresets() || {} } catch { presets = {} }
    const prefix = `${name.toLowerCase()}::`
    const wanted = name.toLowerCase()
    for (const [key, value] of Object.entries(presets)) {
      if (!value || typeof value !== 'object') continue
      const lowerKey = String(key).toLowerCase()
      const valueSoftware = String(value.software || '').toLowerCase()
      // 旧版 desktop_guide 常把「窗口标题」当 software 用，键可能是 <窗口标题>::<窗口标题>；
      // 只按前缀匹配会漏掉这类历史数据，所以再做一次包含匹配（仅用于最低优先级的匿名条目）。
      const related = lowerKey.startsWith(prefix) || valueSoftware === wanted
        || (wanted.length >= 3 && (lowerKey.includes(wanted) || valueSoftware.includes(wanted)))
      if (!related) continue
      const window = lowerKey.startsWith(prefix)
        ? (String(key).slice(prefix.length) || safeText(value.title, 120, '主窗口'))
        : safeText(value.title, 120, String(key).split('::')[0] || '主窗口')
      if (String(value.coord || '') !== 'window') continue // 0.14.3 前的客户区坐标一律不导入
      const item = ensure(window, '__window__', {
        source: 'preset',
        rect: normalizeRect(value),
        windowSize: normalizeWindowSize(value.windowSize),
        needsRevalidate: true,
      })
      item.hits = Math.max(item.hits, clampNumber(value.uses, 0))
      item.pad = clampNumber(value.pad, 0)
    }

    // 3) notes.where：自由文本，按控件名模糊挂载；挂不上的保留作人工参考
    let notes = null
    try { notes = this.store.listSoftwareNotes(name) } catch { notes = null }
    if (notes) {
      const whereTexts = []
      for (const text of Array.isArray(notes.where) ? notes.where : []) {
        const line = safeText(text, 300)
        if (!line) continue
        const matched = [...controls.values()].filter((c) => c.name !== '__window__' &&
          (line.toLowerCase().includes(c.name.toLowerCase()) ||
            c.alias.some((a) => line.toLowerCase().includes(String(a).toLowerCase()))))
        if (matched.length) {
          for (const c of matched) if (!c.purpose) c.purpose = line
        } else {
          whereTexts.push(line)
        }
      }
      data.whereTexts = whereTexts.slice(-20)
    }

    data.controls = [...controls.values()].slice(0, 500)
    data.updatedAt = this.now().toISOString()
    writeJsonAtomic(this.pathOf('interface', name), data)
    return data
  }

  upsertControl(software, input = {}) {
    const name = String(software || '').trim()
    const controlName = safeText(input.controlName || input.name, 120)
    if (!name || !controlName) return null
    const window = safeText(input.window || input.windowTitle, 120, '主窗口')
    const data = this.getInterface(name)
    const key = controlKey(name, window, controlName)
    let item = (data.controls || []).find((c) => c.key === key)
    if (!item) {
      item = freshControl(name, window, controlName, input)
      data.controls.push(item)
    }
    if (input.rect) {
      const rect = normalizeRect(input.rect)
      if (rect) { item.rect = rect; item.coord = 'window' }
    }
    if (input.windowSize) item.windowSize = normalizeWindowSize(input.windowSize) || item.windowSize
    if (input.purpose) item.purpose = safeText(input.purpose, 200)
    if (input.dpi != null) item.dpi = clampNumber(input.dpi, 0) || item.dpi
    if (input.source) item.source = ['uia', 'preset', 'manual'].includes(input.source) ? input.source : item.source
    if (input.alias) {
      const extra = Array.isArray(input.alias) ? input.alias : [input.alias]
      for (const a of extra) {
        const text = safeText(a, 60)
        if (text && !item.alias.includes(text)) item.alias.push(text)
      }
    }
    if (input.version) {
      const v = safeText(input.version, 60)
      if (v && !item.versionSeen.includes(v)) item.versionSeen.push(v)
      if (v) data.version = v
    }
    if (input.anchor) item.anchor = safeText(input.anchor, 200)
    if (item.rect && item.windowSize) item.needsRevalidate = false
    data.updatedAt = this.now().toISOString()
    data.controls = data.controls.slice(0, 500)
    writeJsonAtomic(this.pathOf('interface', name), data)
    return item
  }

  // 窗口尺寸由 desktop_place 成功后登记（workflow 第 3 步本来就要求固定矩形）。
  setWindowSize(software, size) {
    const normalized = normalizeWindowSize(size)
    if (!normalized || !String(software || '').trim()) return null
    const all = readJson(this.windowsFile, {})
    all[String(software).toLowerCase()] = { ...normalized, at: this.now().toISOString() }
    writeJsonAtomic(this.windowsFile, all)
    return normalized
  }

  getWindowSize(software) {
    const all = readJson(this.windowsFile, {})
    const entry = all[String(software || '').toLowerCase()]
    return entry ? { w: entry.w, h: entry.h } : null
  }

  // 旧「软件::窗口」级 preset 的兼容读取：优先走 rebuild 导进来的匿名条目，
  // 这样即使 software 名与旧键不一致（例如旧键用窗口标题当软件名）也能复用。
  findWindowPreset(software, window) {
    const name = String(software || '').trim()
    if (!name) return null
    const list = (this.getInterface(name).controls || []).filter((c) => c.name === '__window__' && c.rect)
    if (!list.length) return null
    const wanted = String(window || '').toLowerCase()
    const hit = list.find((c) => c.window.toLowerCase() === wanted)
      || list.find((c) => c.window.toLowerCase().includes(wanted))
      || list[0]
    return {
      coord: 'window',
      x: hit.rect.x, y: hit.rect.y, w: hit.rect.w, h: hit.rect.h,
      pad: clampNumber(hit.pad, 0), uses: hit.hits || 0,
      window: hit.window,
    }
  }

  // ---- 控件级定位：返回 usedSource，命中率指标全靠它 ----
  findControl({ software, window, controlName, version, windowSize, softwareVersion } = {}) {
    const name = String(software || '').trim()
    const target = safeText(controlName, 120)
    if (!name || !target) return null
    const data = this.getInterface(name)
    const pool = (data.controls || []).filter((c) => c.name !== '__window__')
    if (!pool.length) return null
    const wanted = target.toLowerCase()
    const inWindow = window ? pool.filter((c) => c.window.toLowerCase() === String(window).toLowerCase()) : pool
    const candidates = (inWindow.length ? inWindow : pool)
    const exact = candidates.find((c) => c.name.toLowerCase() === wanted)
    const fuzzy = candidates.find((c) => c.name.toLowerCase().includes(wanted) ||
      c.alias.some((a) => String(a).toLowerCase() === wanted || String(a).toLowerCase().includes(wanted)))
    const control = exact || fuzzy
    if (!control || !control.rect) return null

    const currentVersion = safeText(version || softwareVersion || data.version, 60)
    const versionDrift = Boolean(currentVersion && control.versionSeen.length &&
      !control.versionSeen.some((v) => String(v).toLowerCase() === currentVersion.toLowerCase()))
    const currentSize = normalizeWindowSize(windowSize) || this.getWindowSize(name)
    const sizeMismatch = Boolean(currentSize && control.windowSize &&
      (Math.abs(currentSize.w - control.windowSize.w) > 24 || Math.abs(currentSize.h - control.windowSize.h) > 24))
    const sizeUnknown = !control.windowSize || !currentSize

    let usedSource = 'interface-history'
    let preferLive = false
    if (control.source === 'uia' && !versionDrift) {
      // UIA 可读：让桌宠按控件名实时定位，比套旧坐标更准
      usedSource = 'interface-live'
      preferLive = true
    } else if (versionDrift || sizeMismatch || sizeUnknown || control.needsRevalidate) {
      usedSource = 'interface-drift'
      if (control.source === 'uia' && target) preferLive = true
    }
    return {
      control,
      rect: control.rect,
      usedSource,
      preferLive,
      versionDrift,
      sizeMismatch,
      sizeUnknown,
      windowSize: currentSize,
    }
  }

  // ---- L2：操作序列自动录制（只录指引，不录点击回放） ----
  recordAction(expId, entry = {}) {
    if (!this.autoCapture()) return null
    const id = safeText(expId, 80)
    if (!id) return null
    const row = {
      at: this.now().toISOString(),
      stepId: safeText(entry.stepId, 80),
      action: safeText(entry.action, 40) || 'guide',
      software: safeText(entry.software, 80),
      window: safeText(entry.window, 120),
      controlName: safeText(entry.controlName, 120),
      rect: normalizeRect(entry.rect),
      windowSize: normalizeWindowSize(entry.windowSize),
      source: safeText(entry.source, 40),
      ok: entry.ok !== false,
      ms: clampNumber(entry.ms, 0),
    }
    appendJsonLine(this.pathOf('actions', id), row)
    return row
  }

  actionsFor(expId, stepId = '') {
    const rows = readJsonLines(this.pathOf('actions', safeText(expId, 80)))
    return stepId ? rows.filter((r) => r.stepId === String(stepId)) : rows
  }

  // 把某步骤的指引序列摘要写进档案；clone 会随之复制。只保留窗口/控件/来源，不保留坐标回放能力。
  actionSummary(expId, stepId) {
    return this.actionsFor(expId, stepId)
      .filter((r) => r.action === 'guide' && r.ok)
      .slice(-12)
      .map((r) => ({
        window: r.window,
        controlName: r.controlName,
        source: r.source,
        windowSize: r.windowSize,
      }))
  }

  // ---- L4：失败反例 ----
  recordFailure(software, entry = {}) {
    if (!this.autoCapture()) return null
    const name = String(software || '').trim()
    if (!name) return null
    const row = {
      at: this.now().toISOString(),
      expId: safeText(entry.expId, 80),
      stepId: safeText(entry.stepId, 80),
      window: safeText(entry.window, 120),
      controlName: safeText(entry.controlName, 120),
      error: safeText(entry.error || entry.actual, 500),
      shot: safeText(entry.shot, 240),
    }
    appendJsonLine(this.pathOf('failures', name), row)
    return row
  }

  failuresFor(software, limit = 3) {
    return readJsonLines(this.pathOf('failures', software)).slice(-limit).reverse()
  }

  // ---- L6：热区统计（可由 actions 重建） ----
  bumpUsage(software, controlKeyName, ok) {
    if (!this.autoCapture()) return null
    const name = String(software || '').trim()
    const key = safeText(controlKeyName, 200)
    if (!name || !key) return null
    const file = this.pathOf('usage', name)
    const all = readJson(file, {})
    const cur = all[key] || { hits: 0, ok: 0, fail: 0, lastAt: '' }
    cur.hits += 1
    if (ok === false) cur.fail += 1
    else cur.ok += 1
    cur.lastAt = this.now().toISOString()
    all[key] = cur
    writeJsonAtomic(file, all)
    return cur
  }

  usageFor(software, top = 5) {
    const all = readJson(this.pathOf('usage', software), {})
    return Object.entries(all)
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => (b.hits || 0) - (a.hits || 0))
      .slice(0, top)
  }

  // ---- 归档压缩（B1）：明细 → 聚合摘要 ----
  // 设计取舍：不删、不改原始 jsonl。用户在意删除是否可恢复，所以「压缩」指信息压缩，
  // 产物是 <expId>.summary.json（查询侧读它）+ <expId>.jsonl.gz（空间优化副本），原始明细完整保留。
  summaryPath(expId) {
    return join(this.actionsDir, `${slug(safeText(expId, 80))}.summary.json`)
  }

  archiveActions(expId, software = '') {
    const id = safeText(expId, 80)
    if (!id) return null
    const srcFile = this.pathOf('actions', id)
    mkdirSync(this.actionsDir, { recursive: true })
    const rows = readJsonLines(srcFile)
    const byControl = new Map()
    const steps = new Map()
    const softwares = new Set()

    for (const row of rows) {
      const sw = safeText(row.software, 80)
      if (sw) softwares.add(sw)
      // 只统计有控件名的行，与 rebuildUsage 口径保持一致
      if (row.controlName) {
        const key = controlKey(sw, row.window, row.controlName)
        const cur = byControl.get(key) || {
          key, software: sw, window: safeText(row.window, 120),
          controlName: safeText(row.controlName, 120), hits: 0, ok: 0, fail: 0,
          firstAt: '', lastAt: '',
        }
        cur.hits += 1
        if (row.ok === false) cur.fail += 1
        else cur.ok += 1
        if (!cur.firstAt) cur.firstAt = String(row.at || '')
        cur.lastAt = String(row.at || cur.lastAt)
        byControl.set(key, cur)
      }
      const stepKey = safeText(row.stepId, 80) || '(未绑定步骤)'
      const step = steps.get(stepKey) || { stepId: stepKey, count: 0, actions: [] }
      step.count += 1
      // 只留「指过哪里」的提示，绝不存 x/y、点击次数或任何可回放的点击序列
      if (step.actions.length < 20) {
        step.actions.push({
          action: safeText(row.action, 40),
          window: safeText(row.window, 120),
          controlName: safeText(row.controlName, 120),
          source: safeText(row.source, 40),
        })
      }
      steps.set(stepKey, step)
    }

    const summary = {
      schemaVersion: 1,
      expId: id,
      software: safeText(software, 80) || [...softwares][0] || '',
      archivedAt: this.now().toISOString(),
      sourceLines: rows.length,
      sourceFile: srcFile,
      byControl: [...byControl.values()].sort((a, b) => b.hits - a.hits),
      steps: [...steps.values()],
      note: '明细 → 聚合摘要。原始 jsonl 完整保留、未删除未改写；查询侧用本文件避免重读明细。',
    }
    writeJsonAtomic(this.summaryPath(id), summary)

    // 空间优化副本：仅新增 gzip 文件，不替换 jsonl；gz 不参与任何查询（结尾不是 .jsonl）。
    try {
      if (existsSync(srcFile)) writeFileSync(`${srcFile}.gz`, gzipSync(readFileSync(srcFile), { level: 9 }))
    } catch { /* 压缩失败不影响摘要与闭环 */ }
    return summary
  }

  archiveSummary(expId) {
    if (!expId) return null
    const data = readJson(this.summaryPath(expId), null)
    return data && data.schemaVersion === 1 && Array.isArray(data.byControl) ? data : null
  }

  // 热区重建：归档过的实验读摘要 + 归档后新增的尾部明细，保证既不多计也不漏计。
  rebuildUsage(software) {
    const name = String(software || '').trim()
    if (!name) return {}
    const all = {}
    const bump = (key, hits, ok, fail, lastAt) => {
      const cur = all[key] || { hits: 0, ok: 0, fail: 0, lastAt: '' }
      cur.hits += hits
      cur.ok += ok
      cur.fail += fail
      if (lastAt && lastAt > cur.lastAt) cur.lastAt = lastAt
      all[key] = cur
    }
    let files = []
    try { files = readdirSync(this.actionsDir).filter((f) => f.endsWith('.jsonl')) } catch { files = [] }
    const addRows = (rows) => {
      for (const row of rows) {
        if (String(row.software || '').toLowerCase() !== name.toLowerCase()) continue
        if (!row.controlName) continue
        bump(controlKey(name, row.window, row.controlName), 1, row.ok === false ? 0 : 1, row.ok === false ? 1 : 0, row.at || '')
      }
    }
    for (const f of files) {
      const full = join(this.actionsDir, f)
      const summary = this.archiveSummary(f.replace(/\.jsonl$/, ''))
      if (!summary) {
        addRows(readJsonLines(full))
        continue
      }
      // 摘要覆盖了前 sourceLines 行；软件不匹配时整段跳过，避免串进别的软件
      if (String(summary.software || '').toLowerCase() === name.toLowerCase()) {
        for (const c of summary.byControl) {
          if (String(c.software || '').toLowerCase() !== name.toLowerCase()) continue
          bump(c.key, clampNumber(c.hits, 0), clampNumber(c.ok, 0), clampNumber(c.fail, 0), c.lastAt || '')
        }
      }
      // 归档之后仍可能写入新动作（例如重新打开实验补记），只补读尾部
      addRows(readJsonLines(full).slice(clampNumber(summary.sourceLines, 0)))
    }
    writeJsonAtomic(this.pathOf('usage', name), all)
    return all
  }

  // ---- L5：报告片段（句式骨架，禁止携带数值） ----
  // B2：按 (课程, 软件) 细分。课程通用文件保持旧路径 <course>.json 不变；
  // 软件专属文件为 <course>__<software>.json，旧数据无需迁移。
  fragmentsPath(course, software = '') {
    const name = slug(safeText(course, 80))
    const sw = safeText(software, 80)
    return sw
      ? join(this.fragmentsDir, `${name}__${slug(sw)}.json`)
      : join(this.fragmentsDir, `${name}.json`)
  }

  fragmentsFor(course, software = '') {
    const name = String(course || '').trim()
    const sw = String(software || '').trim()
    if (!name) return { course: '', software: '', sections: [] }
    const fallback = { course: name, software: sw, sections: [] }
    const data = readJson(this.fragmentsPath(name, sw), null)
    if (!data || typeof data !== 'object') return fallback
    return {
      course: safeText(data.course, 80, name),
      software: safeText(data.software, 80, sw),
      sections: Array.isArray(data.sections) ? data.sections : [],
    }
  }

  addFragment(course, section, pattern, software = '') {
    const name = safeText(course, 80)
    const sw = safeText(software, 80)
    const sec = safeText(section, 80)
    const text = safeText(pattern, 300)
    if (!name || !sec || !text) return { ok: false, error: '需要 course、section、pattern' }
    // 硬约束：片段不得含具体数值，数值必须从 record_result 重新填。
    if (/\d/.test(text) || /(?:[＝=]\s*[-+]?\d|[±]\s*\d|\d+(?:\.\d+)?\s*(?:V|mV|mA|ms|s|Hz|kHz|MHz|GHz|%|℃|cm|mm|kg|MB|GB))/i.test(text)) {
      return { ok: false, error: '片段不得包含具体数值或测量结果，只写句式骨架' }
    }
    const data = this.fragmentsFor(name, sw)
    data.course = name
    data.software = sw
    if (!Array.isArray(data.sections)) data.sections = []
    const found = data.sections.find((s) => s.section === sec)
    if (found) {
      if (!Array.isArray(found.samples)) found.samples = []
      if (!found.samples.includes(text)) found.samples.push(text)
      found.samples = found.samples.slice(-10)
      found.pattern = text
      found.maxLen = 300
    } else {
      data.sections.push({ section: sec, pattern: text, samples: [text], maxLen: 300 })
    }
    writeJsonAtomic(this.fragmentsPath(name, sw), data)
    return { ok: true, course: name, software: sw, section: sec, sections: data.sections.length }
  }

  // 生成报告时提供的候选：只给骨架，且明确标注不得直接复制 / 不得标已核对。
  // 检索优先级：本软件专属 > 同课程通用；同一章节只给一条，专属优先，避免同课不同软件串稿。
  fragmentHints(course, sections = [], software = '') {
    const wanted = new Set((sections || []).map((s) => String(s)))
    const eligible = (s) => !wanted.size || wanted.has(s.section) || s.section === '结果分析' || s.section === '实验总结'
    const pick = (data, scope) => (data.sections || []).filter(eligible).map((s) => ({
      scope, section: s.section, pattern: s.pattern,
      note: '句式骨架，仅供改写；禁止直接复制，禁止携带本次实测数值，产出不得标记为已核对。',
    }))
    const own = software ? pick(this.fragmentsFor(course, software), 'software') : []
    const common = pick(this.fragmentsFor(course, ''), 'course')
    const seen = new Set()
    return [...own, ...common]
      .filter((x) => {
        if (seen.has(x.section)) return false
        seen.add(x.section)
        return true
      })
      .slice(0, 6)
  }

  // ---- L3：视觉锚点路径（只裁控件周边，不存整窗） ----
  anchorPath(software, key) {
    return join(this.anchorsDir, slug(software), `${slug(key)}.png`)
  }

  // 锚点由用户主动调用 anchor_capture 生成，属于显式写入，不受自动采集开关影响。
  saveAnchor(software, key, pngBuffer) {
    if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length > 2 * 1024 * 1024) return ''
    const file = this.anchorPath(software, key)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, pngBuffer)
    return file
  }

  // ---- 查询层：唯一入口 ----
  knowledgeFor({ software, stepId = '', limits = {} } = {}) {
    const name = String(software || '').trim()
    const lim = { ...KNOWLEDGE_LIMITS, ...(limits && typeof limits === 'object' ? limits : {}) }
    const empty = { software: name, controls: [], pitfalls: [], where: [], tips: [], failures: [], hot: [], brief: '' }
    if (!name) return empty
    const data = this.getInterface(name)
    let notes = null
    try { notes = this.store.listSoftwareNotes(name) } catch { notes = null }
    const controls = [...(data.controls || [])]
      .filter((c) => c.name !== '__window__')
      .sort((a, b) => (b.hits || 0) - (a.hits || 0) || String(b.lastOkAt || '').localeCompare(String(a.lastOkAt || '')))
      .slice(0, lim.controls)
      .map((c) => ({
        name: c.name, window: c.window, purpose: c.purpose, rect: c.rect,
        source: c.source, hits: c.hits || 0, ok: c.ok || 0, fail: c.fail || 0,
        versionSeen: c.versionSeen, windowSize: c.windowSize, needsRevalidate: c.needsRevalidate,
      }))
    const pitfalls = [...(Array.isArray(notes?.pitfalls) ? notes.pitfalls : []), ...(data.whereTexts || [])]
      .slice(-lim.pitfalls)
    const where = (Array.isArray(notes?.where) ? notes.where : []).slice(-lim.where)
    const tips = (Array.isArray(notes?.tips) ? notes.tips : []).slice(-lim.tips)
    const failures = this.failuresFor(name, lim.failures)
    const hot = this.usageFor(name, lim.hot)
    if (stepId) {
      // 同一步的失败优先置顶
      failures.sort((a, b) => Number(b.stepId === stepId) - Number(a.stepId === stepId))
    }
    const brief = [
      `${name}：已记录 ${controls.length} 个控件`,
      pitfalls.length ? `${pitfalls.length} 条坑/位置提示` : '',
      failures.length ? `${failures.length} 条失败记录` : '',
      failures.length ? `最近失败「${safeText(failures[0].error, 40)}」` : '',
    ].filter(Boolean).join('、')
    return { software: name, controls, pitfalls, where, tips, failures, hot, brief }
  }

  // 命中/失败反馈：更新控件条目与热区（写失败不影响主流程）
  noteGuideOutcome(software, controlName, { ok = true, window = '', source = '', rect = null } = {}) {
    if (!this.autoCapture()) return null
    const name = String(software || '').trim()
    const target = safeText(controlName, 120)
    if (!name || !target) return null
    const data = this.getInterface(name)
    const item = (data.controls || []).find((c) => c.name.toLowerCase() === target.toLowerCase())
    if (!item) return null
    item.hits = (item.hits || 0) + 1
    if (ok) { item.ok = (item.ok || 0) + 1; item.lastOkAt = this.now().toISOString() }
    else item.fail = (item.fail || 0) + 1
    if (rect) item.rect = normalizeRect(rect) || item.rect
    if (source) item.lastSource = safeText(source, 40)
    data.updatedAt = this.now().toISOString()
    writeJsonAtomic(this.pathOf('interface', name), data)
    this.bumpUsage(name, item.key, ok)
    return item
  }

  // 采集了什么、存在哪、怎么删：面板/文档展示用
  dataInventory() {
    const dirs = {
      interface: this.interfaceDir,
      actions: this.actionsDir,
      failures: this.failuresDir,
      usage: this.usageDir,
      fragments: this.fragmentsDir,
      anchors: this.anchorsDir,
    }
    const counts = {}
    for (const [key, dir] of Object.entries(dirs)) {
      try { counts[key] = existsSync(dir) ? readdirSync(dir).length : 0 } catch { counts[key] = 0 }
    }
    return { home: this.home, dirs, counts, autoCapture: this.autoCapture() }
  }
}

export function safeKnowledgeCall(fn, fallback = null) {
  try { return fn() } catch { return fallback }
}
