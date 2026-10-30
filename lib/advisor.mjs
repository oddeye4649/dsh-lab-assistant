import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeEnvironment } from './probe.mjs'
import { getCatalog } from './catalog.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PROFILE_FILE = join(ROOT, 'coursepacks', 'compatibility-profiles.json')
let cached = null

export function getCompatibilityProfiles() {
  if (!cached) cached = JSON.parse(readFileSync(PROFILE_FILE, 'utf8'))
  return cached
}

function majorOf(version) {
  const match = /^(\d+)/.exec(String(version || '').trim())
  return match ? Number(match[1]) : null
}

function appLabel(app) {
  if (!app) return ''
  const name = String(app.name || '')
  const version = String(app.version || '')
  if (!version || /\d/.test(name)) return name
  return `${name} ${version}`
}

function findInstalled(env, matcher) {
  const apps = (env.dependencies && env.dependencies.length) ? env.dependencies : (env.installed || [])
  return apps.find((app) => matcher.test(`${app.name} ${app.publisher}`))
}

function evaluateConflicts(profile, env) {
  const conflicts = []
  const virtualBox = findInstalled(env, /virtualbox/i)
  const npcap = findInstalled(env, /npcap/i)
  const winpcap = findInstalled(env, /winpcap/i)
  for (const rule of profile.conflicts || []) {
    if (rule.type === 'installed-major-mismatch') {
      if (!virtualBox) continue
      const major = majorOf(virtualBox.version)
      if (rule.notEqualMajor != null && major != null && major !== rule.notEqualMajor) {
        conflicts.push({ severity: rule.severity, message: `${rule.message} 当前版本：${appLabel(virtualBox)}。` })
      }
      if (rule.atLeastMajor != null && major != null && major >= rule.atLeastMajor) {
        conflicts.push({ severity: rule.severity, message: `${rule.message} 当前版本：${appLabel(virtualBox)}。` })
      }
    }
    if (rule.type === 'hypervisor-present' && env.virtualization.hypervisorPresent === true) {
      conflicts.push({ severity: rule.severity, message: rule.message })
    }
    if (rule.type === 'virtualization-disabled' && env.cpu.virtualizationFirmwareEnabled === false) {
      conflicts.push({ severity: rule.severity, message: rule.message })
    }
    if (rule.type === 'capture-driver-conflict' && npcap && winpcap) {
      conflicts.push({ severity: rule.severity, message: `${rule.message} 当前同时发现：${winpcap.name}、${npcap.name}。` })
    }
  }
  return conflicts
}

function evaluateProfile(profile, env, context) {
  const blockers = []
  const warnings = []
  const info = []

  if (!(profile.appliesTo?.platforms || []).includes(env.platform)) blockers.push('当前操作系统不在适配范围')
  if ((profile.appliesTo?.arch || []).length && !(profile.appliesTo.arch || []).includes(env.os.arch)) blockers.push(`当前架构 ${env.os.arch} 不在适配范围`)
  const memoryGB = Number(env.memoryGB || 0)
  if (profile.appliesTo?.minMemoryGB && memoryGB && memoryGB < profile.appliesTo.minMemoryGB) {
    warnings.push(`内存 ${memoryGB.toFixed(1)} GB，低于方案建议的 ${profile.appliesTo.minMemoryGB} GB`)
  }

  const eNSP = findInstalled(env, /ensp/i)
  const virtualBox = findInstalled(env, /virtualbox/i)
  if (eNSP) info.push(`已发现 ${appLabel(eNSP)}`)
  if (virtualBox) info.push(`已发现 ${appLabel(virtualBox)}`)

  const conflicts = evaluateConflicts(profile, env)
  for (const conflict of conflicts) {
    if (conflict.severity === 'blocker') blockers.push(conflict.message)
    else warnings.push(conflict.message)
  }

  if (profile.action === 'keep-current' && context.currentlyWorking !== true) {
    warnings.push('只有在用户确认当前 eNSP 已能完成实验时，才应保留现有组合')
  }

  return {
    ...profile,
    evaluation: {
      applicable: blockers.length === 0,
      blockers,
      warnings,
      notes: info,
      currentInstallDetected: Boolean(eNSP),
    },
  }
}

export async function adviseCompatibility(options = {}) {
  const software = String(options.software || 'ensp').trim() || 'ensp'
  const currentlyWorking = options.currentlyWorking === true
  const catalog = getCatalog()
  const softwareEntry = catalog.software.find((item) => item.id === software || item.name.toLowerCase() === software.toLowerCase())
  if (!softwareEntry) {
    return {
      ok: false,
      error: `目录中没有 ${software}。请先在软件目录中登记，或提供课程要求和安装包信息。`,
      recommendation: null,
    }
  }

  const env = await probeEnvironment({ software: softwareEntry.name })
  const profileData = getCompatibilityProfiles()
  const candidates = profileData.profiles
    .filter((profile) => (profile.softwareIds || []).includes(softwareEntry.id))
    .map((profile) => evaluateProfile(profile, env, { currentlyWorking }))

  let recommended = null
  const eNSPDetected = candidates.some((item) => item.evaluation.currentInstallDetected)
  if (softwareEntry.id === 'ensp') {
    if (currentlyWorking && eNSPDetected) {
      recommended = candidates.find((item) => item.id === 'ensp-current-working-keep') || null
    } else if (eNSPDetected) {
      recommended = candidates.find((item) => item.id === 'ensp-vbox7-diagnose-only') || null
    } else {
      recommended = candidates.find((item) => item.id === 'ensp-win-x64-classic-vbox52') || null
    }
  } else {
    recommended = candidates.find((item) => item.evaluation.applicable) || candidates[0] || null
  }

  return {
    ok: true,
    software: {
      id: softwareEntry.id,
      name: softwareEntry.name,
      priority: softwareEntry.priority,
      license: softwareEntry.license,
      support: softwareEntry.support,
    },
    context: {
      currentlyWorking,
      platform: env.platform,
      osVersion: env.os.version,
      arch: env.os.arch,
      memoryGB: env.memoryGB,
      virtualizationFirmwareEnabled: env.cpu.virtualizationFirmwareEnabled,
      hypervisorPresent: env.virtualization.hypervisorPresent,
    },
    environmentFindings: env.findings || [],
    installed: env.installed || [],
    dependencies: env.dependencies || [],
    recommendation: recommended ? {
      id: recommended.id,
      name: recommended.name,
      status: recommended.status,
      statusLabel: recommended.statusLabel,
      action: recommended.action,
      whenToUse: recommended.whenToUse,
      doNotUseWhen: recommended.doNotUseWhen,
      components: recommended.components,
      installOrder: recommended.installOrder,
      checksBeforeChange: recommended.checksBeforeChange,
      verification: recommended.verification,
      rollback: recommended.rollback,
      evaluation: recommended.evaluation,
    } : null,
    alternatives: candidates.filter((item) => item.id !== recommended?.id).map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      action: item.action,
      evaluation: item.evaluation,
    })),
    nextStep: recommended?.action === 'keep-current'
      ? '保留当前可用组合，补充版本清单和最小拓扑证据。不要因为追求“最新”而改动。'
      : recommended?.action === 'diagnose-only'
        ? '先采集启动错误和设备状态，不卸载现有 VirtualBox。确认原因后再选择修复方案。'
        : '向用户展示候选方案、依赖顺序和回退办法，得到明确确认后才能开始安装。',
    disclaimer: '这是配置适配建议，不是安装授权。社区经验方案需结合课程要求并在目标电脑上做最小运行测试。',
  }
}
