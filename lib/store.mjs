import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 1,
  displayName: '主人',
  petSize: 160,
  petEnabled: true,
  reduceNameUsage: false,
  dataDir: '',
})

const MODES = new Set(['guided', 'automatic', 'mixed'])
const STATUSES = new Set(['active', 'paused', 'completed', 'archived'])
const ID_RE = /^exp-\d{8}-\d{6}-[a-z0-9]{4}$/

function safeText(value, maxLength, fallback = '') {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return (text || fallback).slice(0, maxLength)
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

function normalizeSettings(input) {
  const merged = { ...DEFAULT_SETTINGS, ...(input && typeof input === 'object' ? input : {}) }
  return {
    schemaVersion: 1,
    displayName: safeText(merged.displayName, 24, DEFAULT_SETTINGS.displayName),
    petSize: Math.max(96, Math.min(260, Number(merged.petSize) || DEFAULT_SETTINGS.petSize)),
    dataDir: safeText(merged.dataDir, 400),
    petEnabled: merged.petEnabled !== false,
    reduceNameUsage: merged.reduceNameUsage === true,
    currentExperimentId: safeText(merged.currentExperimentId, 60),
  }
}

function normalizeStep(step, index) {
  if (!step || typeof step !== 'object') return null
  return {
    id: safeText(step.id, 64, `step-${index + 1}`),
    title: safeText(step.title, 120, `步骤 ${index + 1}`),
    instruction: safeText(step.instruction, 2000),
    expected: safeText(step.expected, 1000),
    // 位置知识：按钮/控件在哪（例如「工具栏第 3 个图标」「Explorer 在左上第 2 个」）
    where: safeText(step.where, 300),
    status: ['pending', 'active', 'done', 'skipped', 'blocked'].includes(step.status) ? step.status : 'pending',
    actual: safeText(step.actual, 1000),
    passed: typeof step.passed === 'boolean' ? step.passed : null,
    evidence: Array.isArray(step.evidence) ? step.evidence.filter((x) => typeof x === 'string').slice(0, 20) : [],
  }
}

function summaryOf(manifest) {
  return {
    id: manifest.id,
    title: manifest.title,
    course: manifest.course,
    software: manifest.software,
    mode: manifest.mode,
    status: manifest.status,
    currentStep: manifest.currentStep,
    totalSteps: Array.isArray(manifest.steps) ? manifest.steps.length : 0,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    workDir: manifest.workDir,
    requirementPath: manifest.requirementPath || '',
    datasetPath: manifest.datasetPath || '',
  }
}

export class ExperimentStore {
  constructor(homeDir, options = {}) {
    this.homeDir = resolve(homeDir)
    this.settingsFile = join(this.homeDir, 'settings.json')
    this.now = options.now || (() => new Date())
    // 数据目录可自定义：settings.dataDir 为空时用 <home>/experiments
    const saved = normalizeSettings(readJson(this.settingsFile, DEFAULT_SETTINGS))
    const custom = options.dataDir !== undefined ? safeText(options.dataDir, 400) : saved.dataDir
    this.dataDir = custom ? resolve(custom) : ''
    this.experimentsDir = this.dataDir || join(this.homeDir, 'experiments')
    this.ensureLayout()
  }

  ensureLayout() {
    mkdirSync(this.experimentsDir, { recursive: true })
    if (!existsSync(this.settingsFile)) writeJsonAtomic(this.settingsFile, DEFAULT_SETTINGS)
  }

  getSettings() {
    const current = readJson(this.settingsFile, DEFAULT_SETTINGS)
    return normalizeSettings(current)
  }

  updateSettings(patch) {
    const current = this.getSettings()
    const next = normalizeSettings({ ...current, ...(patch || {}) })
    writeJsonAtomic(this.settingsFile, next)
    return next
  }

  experimentDir(id) {
    if (!ID_RE.test(String(id || ''))) throw new Error('无效的实验编号')
    return join(this.experimentsDir, id)
  }

  experimentFile(id) {
    return join(this.experimentDir(id), 'experiment.json')
  }

  createExperiment(input = {}) {
    const createdAt = this.now().toISOString()
    const compactTime = createdAt.replace(/\D/g, '').slice(0, 14)
    const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, '0')
    const id = `exp-${compactTime.slice(0, 8)}-${compactTime.slice(8, 14)}-${suffix}`
    const workDir = this.experimentDir(id)
    for (const dir of ['screenshots', 'data', 'reports', 'logs']) mkdirSync(join(workDir, dir), { recursive: true })

    const steps = Array.isArray(input.steps)
      ? input.steps.map(normalizeStep).filter(Boolean).slice(0, 100)
      : []
    const manifest = {
      schemaVersion: 1,
      id,
      title: safeText(input.title, 120, `未命名实验 ${createdAt.slice(0, 10)}`),
      course: safeText(input.course, 80),
      software: safeText(input.software, 80, 'eNSP'),
      mode: MODES.has(input.mode) ? input.mode : 'mixed',
      status: 'active',
      currentStep: 0,
      coursePack: safeText(input.coursePack, 120),
      reportTemplate: safeText(input.reportTemplate, 240),
      requirementPath: safeText(input.requirementPath, 400),
      datasetPath: safeText(input.datasetPath, 400),
      notes: safeText(input.notes, 4000),
      steps,
      createdAt,
      updatedAt: createdAt,
      workDir,
    }
    writeJsonAtomic(this.experimentFile(id), manifest)
    return manifest
  }

  // 复制一份实验骨架：沿用课程/软件/模式/模板/要求与步骤顺序，
  // 但清空实测结果与状态，方便同一门课的第二次实验直接开工。
  cloneExperiment(sourceId, overrides = {}) {
    const source = this.getExperiment(sourceId)
    const steps = (source.steps || []).map((step, index) => ({
      id: `step-${index + 1}`,
      title: step.title,
      instruction: step.instruction,
      expected: step.expected,
      where: step.where,
      status: 'pending',
      actual: '',
      passed: null,
      evidence: [],
    }))
    return this.createExperiment({
      title: safeText(overrides.title, 120, `${source.title}（第 2 次）`),
      course: source.course,
      software: source.software,
      mode: source.mode,
      coursePack: source.coursePack,
      reportTemplate: source.reportTemplate,
      requirementPath: source.requirementPath,
      notes: safeText(overrides.notes, 4000, source.notes),
      steps,
    })
  }

  // ---- 软件经验库：按软件累积「坑 / 位置 / 技巧」，供后续同类实验直接复用 ----
  notesFile() {
    return join(this.homeDir, 'software-notes.json')
  }

  listSoftwareNotes(software) {
    const all = readJson(this.notesFile(), {})
    if (!software) return all
    const key = String(software).toLowerCase().trim()
    return all[key] || null
  }

  addSoftwareNote(software, kind, text) {
    const key = String(software || '').toLowerCase().trim()
    if (!key) throw new Error('需要 software（软件名）')
    const value = safeText(text, 800)
    if (!value) throw new Error('需要 text（要记的内容）')
    const all = readJson(this.notesFile(), {})
    const entry = all[key] || { tips: [], pitfalls: [], where: [], updatedAt: '' }
    const bucket = kind === 'pitfall' ? 'pitfalls' : kind === 'where' ? 'where' : 'tips'
    if (!Array.isArray(entry[bucket])) entry[bucket] = []
    if (!entry[bucket].includes(value)) entry[bucket].push(value)
    entry[bucket] = entry[bucket].slice(-60)
    entry.updatedAt = this.now().toISOString()
    all[key] = entry
    writeJsonAtomic(this.notesFile(), all)
    return { software: key, kind: bucket, ...entry }
  }

  // 指引位置经验库：同一个窗口下次直接用上次调好的框
  guidePresetsFile() {
    return join(this.homeDir, 'guide-presets.json')
  }

  listGuidePresets() {
    return readJson(this.guidePresetsFile(), {})
  }

  getGuidePreset(key) {
    const all = this.listGuidePresets()
    return all[String(key || '').toLowerCase()] || null
  }

  saveGuidePreset(key, value) {
    const name = String(key || '').toLowerCase().trim()
    if (!name) return null
    const all = this.listGuidePresets()
    const previous = all[name] || { uses: 0 }
    all[name] = {
      ...previous,
      ...value,
      uses: (Number(previous.uses) || 0) + 1,
      updatedAt: this.now().toISOString(),
    }
    writeJsonAtomic(this.guidePresetsFile(), all)
    return all[name]
  }

  // 当前正在做的实验（模式硬约束需要它）
  setCurrentExperiment(id) {
    this.updateSettings({ currentExperimentId: String(id || '') })
    return String(id || '')
  }

  currentExperimentId() {
    return String(this.getSettings().currentExperimentId || '')
  }

  currentMode() {
    const id = this.currentExperimentId()
    if (!id) return ''
    try { return String(this.getExperiment(id).mode || 'mixed') } catch { return '' }
  }

  listExperiments({ status, query } = {}) {
    let files
    try {
      files = readdirSync(this.experimentsDir, { withFileTypes: true })
    } catch {
      return []
    }
    const items = []
    for (const entry of files) {
      if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue
      const manifest = readJson(join(this.experimentsDir, entry.name, 'experiment.json'), null)
      if (!manifest || manifest.id !== entry.name) continue
      if (status && manifest.status !== status) continue
      if (query) {
        const haystack = `${manifest.title} ${manifest.course} ${manifest.software}`.toLowerCase()
        if (!haystack.includes(String(query).toLowerCase())) continue
      }
      items.push(summaryOf(manifest))
    }
    return items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }

  // 删除实验：移到 homeDir/_trash，不做不可逆销毁；删的是当前实验时一并清空
  deleteExperiment(id) {
    const experiment = this.getExperiment(id)
    const dir = this.experimentDir(id)
    if (!existsSync(dir)) throw new Error('实验档案不存在')
    const trash = join(this.homeDir, '_trash')
    mkdirSync(trash, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = join(trash, `${id}-${stamp}`)
    renameSync(dir, target)
    if (this.currentExperimentId() === id) this.setCurrentExperiment('')
    return { id, title: experiment.title || id, movedTo: target }
  }

  getExperiment(id) {
    const manifest = readJson(this.experimentFile(id), null)
    if (!manifest || manifest.id !== id) throw new Error('找不到该实验')
    return manifest
  }

  updateExperiment(id, patch = {}) {
    const current = this.getExperiment(id)
    const next = { ...current }
    if ('title' in patch) next.title = safeText(patch.title, 120, current.title)
    if ('course' in patch) next.course = safeText(patch.course, 80)
    if ('software' in patch) next.software = safeText(patch.software, 80, current.software)
    if ('mode' in patch && MODES.has(patch.mode)) next.mode = patch.mode
    if ('status' in patch && STATUSES.has(patch.status)) next.status = patch.status
    if ('notes' in patch) next.notes = safeText(patch.notes, 4000)
    if ('coursePack' in patch) next.coursePack = safeText(patch.coursePack, 120)
    if ('reportTemplate' in patch) next.reportTemplate = safeText(patch.reportTemplate, 240)
    if ('requirementPath' in patch) next.requirementPath = safeText(patch.requirementPath, 400)
    if ('datasetPath' in patch) next.datasetPath = safeText(patch.datasetPath, 400)
    if ('steps' in patch && Array.isArray(patch.steps)) next.steps = patch.steps.map(normalizeStep).filter(Boolean).slice(0, 100)
    if ('currentStep' in patch) {
      const max = Math.max(0, next.steps.length - 1)
      next.currentStep = Math.max(0, Math.min(Number(patch.currentStep) || 0, max))
    }
    next.updatedAt = this.now().toISOString()
    writeJsonAtomic(this.experimentFile(id), next)
    return next
  }

  recordStepResult(id, input = {}) {
    const current = this.getExperiment(id)
    const key = String(input.stepId || input.title || '').trim()
    if (!key) throw new Error('需要 stepId 或步骤标题')
    const index = current.steps.findIndex((step) => step.id === key || step.title === key)
    if (index < 0) throw new Error('找不到该步骤')
    const step = current.steps[index]
    current.steps[index] = {
      ...step,
      actual: safeText(input.actual, 1000, step.actual),
      passed: typeof input.passed === 'boolean' ? input.passed : step.passed,
      status: input.status && ['pending', 'active', 'done', 'skipped', 'blocked'].includes(input.status)
        ? input.status
        : (typeof input.passed === 'boolean' ? 'done' : step.status),
      evidence: Array.isArray(input.evidence)
        ? [...new Set([...(step.evidence || []), ...input.evidence.filter((x) => typeof x === 'string')])].slice(0, 20)
        : step.evidence,
    }
    current.updatedAt = this.now().toISOString()
    writeJsonAtomic(this.experimentFile(id), current)
    return current
  }

  status() {
    const experiments = this.listExperiments()
    return {
      homeDir: this.homeDir,
      settings: this.getSettings(),
      experiments: {
        total: experiments.length,
        active: experiments.filter((x) => x.status === 'active').length,
        paused: experiments.filter((x) => x.status === 'paused').length,
        completed: experiments.filter((x) => x.status === 'completed').length,
      },
      lastExperiment: experiments[0] || null,
    }
  }
}

export function assertUsableDirectory(dir) {
  const st = statSync(dir)
  if (!st.isDirectory()) throw new Error('实验目录不是文件夹')
  return true
}
