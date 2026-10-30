import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getCompatibilityProfiles } from './advisor.mjs'
import { getCatalog } from './catalog.mjs'
import { probeEnvironment } from './probe.mjs'

// 证据等级决定候选版本的排序权重。
// 核心原则：本机真实跑通过的版本，优先于任何网上说法。
const EVIDENCE_LEVELS = {
  'proven-this-machine': { score: 100, label: '本机实测可用' },
  'tested-local': { score: 85, label: '本项目实测通过' },
  'vendor-documented': { score: 62, label: '厂商文档' },
  'community-reported': { score: 40, label: '社区经验（未验证）' },
  guess: { score: 20, label: '待验证' },
}

const OUTCOMES = new Set(['worked', 'failed'])
const MAX_ATTEMPTS = 500

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

function safeRegExp(pattern) {
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

export function fingerprintOf(env = {}) {
  const os = env.os || {}
  // 用内核 build 号（release）而不是“Windows 11 Home China”这种展示名，
  // 否则换语言或换版本名就会被误判成另一台机器。
  return [env.platform || '', os.release || os.version || '', os.arch || ''].join('|')
}

export class RepairHistory {
  constructor(homeDir, options = {}) {
    this.homeDir = resolve(homeDir)
    this.file = join(this.homeDir, 'repair-history.json')
    this.now = options.now || (() => new Date())
    mkdirSync(this.homeDir, { recursive: true })
  }

  read() {
    const data = readJson(this.file, null)
    if (!data || !Array.isArray(data.attempts)) return { schemaVersion: 1, attempts: [] }
    return { schemaVersion: 1, attempts: data.attempts.filter((x) => x && OUTCOMES.has(x.outcome)) }
  }

  write(data) {
    writeJsonAtomic(this.file, {
      schemaVersion: 1,
      updatedAt: this.now().toISOString(),
      attempts: data.attempts.slice(-MAX_ATTEMPTS),
    })
  }

  list(softwareId) {
    const attempts = this.read().attempts
    return (softwareId ? attempts.filter((x) => x.softwareId === softwareId) : attempts)
      .slice()
      .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))
  }

  record(input = {}, env = {}) {
    const softwareId = safeText(input.softwareId || input.software, 40)
    const version = safeText(input.version, 40)
    const outcome = OUTCOMES.has(input.outcome) ? input.outcome : null
    if (!softwareId) throw new Error('缺少软件编号')
    if (!version) throw new Error('缺少版本号')
    if (!outcome) throw new Error('outcome 只能是 worked 或 failed')

    const fingerprint = safeText(input.fingerprint, 120) || fingerprintOf(env)
    const entry = {
      softwareId,
      component: safeText(input.component, 40, 'main'),
      name: safeText(input.name, 80),
      version,
      outcome,
      fingerprint,
      symptom: safeText(input.symptom, 400),
      notes: safeText(input.notes, 600),
      recordedAt: this.now().toISOString(),
    }
    const data = this.read()
    const existing = data.attempts.find((x) => x.softwareId === entry.softwareId
      && x.component === entry.component
      && x.version === entry.version
      && x.fingerprint === entry.fingerprint
      && x.outcome === entry.outcome)
    if (existing) {
      existing.symptom = entry.symptom || existing.symptom
      existing.notes = entry.notes || existing.notes
      existing.recordedAt = entry.recordedAt
      existing.hits = (Number(existing.hits) || 1) + 1
    } else {
      data.attempts.push({ ...entry, hits: 1 })
    }
    this.write(data)
    return { ok: true, entry: existing || entry, total: data.attempts.length }
  }

  summary(softwareId) {
    const attempts = this.list(softwareId)
    const proven = attempts.filter((x) => x.outcome === 'worked')
    const failed = attempts.filter((x) => x.outcome === 'failed')
    return {
      total: attempts.length,
      proven: proven.slice(0, 10),
      failed: failed.slice(0, 10),
      // 同一 component+version 既成功又失败时，以最近一次记录为准。
      latestByVersion: Object.values(attempts.reduce((acc, item) => {
        const key = `${item.component}@${item.version}`
        if (!acc[key] || String(item.recordedAt) > String(acc[key].recordedAt)) acc[key] = item
        return acc
      }, {})),
    }
  }
}

function matchSignature(playbook, symptom) {
  const text = String(symptom || '')
  if (!text.trim()) return null
  const scored = []
  for (const signature of playbook?.signatures || []) {
    const hits = (signature.patterns || []).filter((pattern) => {
      const regex = safeRegExp(pattern)
      return regex ? regex.test(text) : false
    })
    if (!hits.length) continue
    scored.push({
      signature,
      hits,
      confidence: Math.min(0.55 + hits.length * 0.15, 0.95),
    })
  }
  scored.sort((a, b) => b.hits.length - a.hits.length)
  return scored[0] || null
}

function installedVersionOf(env, component) {
  const apps = (env.dependencies && env.dependencies.length) ? env.dependencies : (env.installed || [])
  const matcher = component === 'virtualization'
    ? /virtualbox/i
    : component === 'capture-driver'
      ? /winpcap|npcap/i
      : null
  if (!matcher) return null
  return apps.find((app) => matcher.test(`${app.name} ${app.publisher}`)) || null
}

function rankCandidates({ signature, history, env, playbook }) {
  const latest = new Map(history.latestByVersion.map((item) => [`${item.component}@${item.version}`, item]))
  // 记录时可能没带 component，退回按版本号匹配。
  const latestByVersionOnly = new Map(history.latestByVersion.map((item) => [item.version, item]))
  const installed = {
    virtualization: installedVersionOf(env, 'virtualization'),
    'capture-driver': installedVersionOf(env, 'capture-driver'),
  }
  const fingerprint = fingerprintOf(env)
  const osRelease = env.os?.release || env.os?.version || ''
  const osArch = env.os?.arch || ''
  return (signature.candidates || []).map((candidate) => {
    const level = EVIDENCE_LEVELS[candidate.evidence] || EVIDENCE_LEVELS.guess
    let score = level.score
    let evidenceLabel = level.label
    const flags = []
    const record = latest.get(`${candidate.component}@${candidate.version}`) || latestByVersionOnly.get(candidate.version)
    const installedApp = installed[candidate.component]
    const sameAsInstalled = Boolean(installedApp && String(installedApp.version || '').includes(candidate.version))

    // “本机”只在两种情况下成立：这台机器的经验库里有记录，或系统版本与验证记录一致。
    // 别人电脑上验证过的版本，对当前用户只能算“他机实测”，不能当成保证。
    const localProof = (history.proven || []).find((item) => item.version === candidate.version && item.fingerprint === fingerprint)
    const evidenceEntry = (playbook?.machineEvidence || []).find((item) => item.version === candidate.version)
    const evidenceOs = String(evidenceEntry?.os || '')
    const sameBuild = Boolean(evidenceEntry && osRelease
      && evidenceOs.includes(osRelease)
      && (!osArch || evidenceOs.includes(osArch)))
    const provenHere = Boolean(localProof || sameBuild)
    if (candidate.evidence === 'proven-this-machine') {
      if (localProof) {
        evidenceLabel = '本机经验库已记录可用'
      } else if (sameBuild) {
        evidenceLabel = '本机实测可用'
      } else {
        score = 68
        evidenceLabel = '他机实测通过（你的系统不同，需复测）'
      }
    }

    if (record?.outcome === 'worked') {
      score += 15
      flags.push('这台机器上试过，可用')
    }
    if (record?.outcome === 'failed') {
      score -= 130
      flags.push('这台机器上试过，失败')
    }
    if (sameAsInstalled) {
      if (provenHere) {
        // 这个版本在这台机器上被验证过，现在失败更可能是环境变了，不是版本不对。
        score -= 20
        flags.push('本机曾验证可用，先查环境变化')
      } else {
        score -= 70
        flags.push('与当前正在报错的版本相同')
      }
    }
    return {
      component: candidate.component,
      name: candidate.name,
      version: candidate.version,
      evidence: candidate.evidence,
      evidenceLabel: record?.outcome === 'worked' ? '本机经验库已记录可用' : evidenceLabel,
      score,
      why: candidate.why,
      verify: candidate.verify,
      installed: sameAsInstalled,
      previouslyTried: record ? record.outcome : null,
      flags,
    }
  }).sort((a, b) => b.score - a.score)
}

function softwareName(id, entry) {
  return entry?.name || id
}

function buildPlan({ software, signature, candidates, playbook, env }) {
  const top = candidates[0]
  if (!signature) {
    return {
      action: 'collect-info',
      summary: `还没有足够的失败信息来定位 ${software.name} 的版本问题。先采集错误原文和当前版本，再决定换哪个版本。`,
      steps: [
        '记录软件当前精确版本号（帮助/关于，或安装目录里的版本文件）',
        '记录完整报错原文、错误码和出现时间，截图存进实验档案',
        `确认操作系统版本：${env.os?.version || '未知'} ${env.os?.arch || ''}`,
        '确认最近是否换过版本、装过驱动或开过 Hyper-V 等系统功能',
        '把上述信息补回来，再生成换版本方案',
      ],
      verification: ['能够复述一条可复现的失败步骤'],
      rollback: [],
      risk: 'none',
    }
  }
  if (!top || top.score <= 0) {
    return {
      action: 'collect-info',
      summary: '候选版本都已被这台机器的历史记录否定，先不要再装。需要补充错误信息或人工核对课程要求。',
      steps: [
        '停止继续更换版本，避免把环境改得更乱',
        '导出当前错误日志与设备信息',
        '核对课程指导书要求的版本组合',
        '确认是否有可回退的备份后再决定',
      ],
      verification: ['明确一个尚未尝试过的候选版本'],
      rollback: playbook?.rollback || [],
      risk: 'none',
    }
  }
  const topProvenHere = top.installed && /本机/.test(top.evidenceLabel)
  if (topProvenHere) {
    return {
      action: 'verify-environment',
      summary: `当前已装的 ${top.name} ${top.version} 在这台机器上验证过可用，现在报错更可能是环境变了。先按检查项排查，不要急着重装。`,
      steps: [
        ...(signature.firstChecks || []).slice(0, 4),
        '以上都正常仍然失败时，再按候选列表换到下一个版本',
      ],
      verification: [top.verify, '环境修正后重启，再复测一次最小拓扑'].filter(Boolean),
      rollback: playbook?.rollback || [],
      risk: 'low',
      riskNote: '这一步只做检查，不改动版本。',
    }
  }
  return {
    action: 'change-version',
    summary: `按当前症状判断是 ${signature.label}，首选换到 ${top.name} ${top.version}（${top.evidenceLabel}）。`,
    steps: (playbook?.installOrder || []).map((step) => step.replaceAll('{{version}}', top.version)),
    verification: [top.verify, '重启系统后再复测一次，排除偶然成功'].filter(Boolean),
    rollback: playbook?.rollback || [],
    risk: playbook?.risk || 'medium',
    riskNote: playbook?.riskNote || '卸载或降级依赖组件可能影响其他软件，必须先确认没有正在使用的项目。',
  }
}

export async function planRepair(options = {}) {
  const softwareId = safeText(options.software, 40, 'ensp')
  const symptom = safeText(options.symptom, 1200)
  const homeDir = options.homeDir ? resolve(options.homeDir) : null
  const catalog = getCatalog()
  const entry = catalog.software.find((item) => item.id === softwareId
    || item.name.toLowerCase() === softwareId.toLowerCase()
    || (item.aliases || []).includes(softwareId.toLowerCase()))
  const resolvedId = entry?.id || softwareId
  const software = { id: resolvedId, name: softwareName(resolvedId, entry) }

  const env = options.environment || await probeEnvironment({ software: software.name })
  const playbook = getCompatibilityProfiles().failurePlaybook?.[resolvedId] || null
  const history = homeDir ? new RepairHistory(homeDir).summary(resolvedId) : { total: 0, proven: [], failed: [], latestByVersion: [] }
  const matched = matchSignature(playbook, symptom)
  const candidates = matched
    ? rankCandidates({ signature: matched.signature, history, env, playbook })
    : []
  const plan = buildPlan({ software, signature: matched?.signature || null, candidates, playbook, env })

  const installedLabel = (env.dependencies || env.installed || [])
    .map((app) => `${app.name}${app.version && !String(app.name).includes(app.version) ? ` ${app.version}` : ''}`)
    .join('、')

  return {
    ok: true,
    software,
    symptom: {
      raw: symptom,
      matched: matched?.signature?.id || null,
      label: matched?.signature?.label || '未匹配到已知失败特征',
      confidence: matched ? Math.round(matched.confidence * 100) / 100 : 0,
      hits: matched?.hits || [],
    },
    environment: {
      platform: env.platform,
      osVersion: env.os?.version || '',
      osRelease: env.os?.release || '',
      arch: env.os?.arch || '',
      fingerprint: fingerprintOf(env),
      installed: installedLabel,
      findings: env.findings || [],
    },
    diagnosis: {
      likelyCauses: matched?.signature?.likelyCauses || [],
      firstChecks: matched?.signature?.firstChecks || [],
      note: matched
        ? '先核对下面几项，再动手换版本；有些“版本不兼容”其实是虚拟化或驱动问题。'
        : '没有匹配到已知特征，先采集信息，避免盲换版本。',
    },
    candidates,
    plan,
    history,
    research: {
      query: matched
        ? `${software.name} ${matched.signature.label} 兼容版本 解决`
        : `${software.name} ${installedLabel || ''} 启动失败 兼容版本`.trim(),
      hint: '如果候选里没有可用版本，先用这条查询找官方兼容列表或同类故障记录，确认后再补进台账。',
    },
    record: {
      tool: 'lab_repair_record',
      template: {
        software: resolvedId,
        component: candidates[0]?.component || 'main',
        name: candidates[0]?.name || software.name,
        version: candidates[0]?.version || '',
        outcome: 'worked 或 failed',
        symptom,
      },
      note: '每试完一个版本就记一次。记过失败的版本不会再被推荐，记过成功的会排到最前。',
    },
    policy: {
      autoInstall: false,
      requiresConfirmation: true,
      reason: '换版本涉及卸载和驱动变更，必须由用户确认后手动执行。',
    },
  }
}

export function listRepairHistory(homeDir, softwareId) {
  return new RepairHistory(homeDir).summary(softwareId)
}

export function recordRepair(homeDir, input) {
  return new RepairHistory(homeDir).record(input)
}
