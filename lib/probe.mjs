import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { matchRequestedSoftware } from './catalog.mjs'

const APP_PATTERN = /ensp|virtualbox|winpcap|npcap|wireshark/i

function appCategory(name) {
  const value = String(name || '').toLowerCase()
  if (value.includes('ensp')) return 'ensp'
  if (value.includes('virtualbox')) return 'virtualbox'
  if (value.includes('winpcap')) return 'winpcap'
  if (value.includes('npcap')) return 'npcap'
  if (value.includes('wireshark')) return 'wireshark'
  return 'other'
}

function runPowerShell(script, timeoutMs = 15000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') }),
    )
  })
}

function knownPaths() {
  const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return {
    ensp: programFiles.flatMap((base) => [
      join(base, 'Huawei', 'eNSP', 'eNSP.exe'),
      join(base, 'Huawei eNSP', 'eNSP.exe'),
    ]),
    virtualBox: [
      join(process.env.ProgramFiles || 'C:\\Program Files', 'Oracle', 'VirtualBox', 'VBoxManage.exe'),
      join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Oracle', 'VirtualBox', 'VBoxManage.exe'),
    ],
    captureDrivers: [
      join(systemRoot, 'System32', 'Npcap', 'wpcap.dll'),
      join(systemRoot, 'System32', 'wpcap.dll'),
      join(systemRoot, 'System32', 'packet.dll'),
    ],
  }
}

function findingsFor(env, allApps) {
  const findings = []
  const found = new Set(allApps.map((x) => x.category))
  if (env.platform !== 'win32') {
    findings.push({ level: 'error', code: 'unsupported-platform', message: '首版实验适配仅支持 Windows。' })
    return findings
  }

  const requested = Array.isArray(env.requested) ? env.requested : []
  if (requested.length) {
    for (const item of requested) {
      if (item.status === 'detected') {
        const versions = item.detected.map((app) => `${app.name}${app.version ? ` ${app.version}` : ''}`).join('；')
        findings.push({ level: 'info', code: `detected-${item.software?.id || 'software'}`, message: `检测到 ${versions}。只代表发现安装迹象，仍需实际启动并验证课程实验。` })
      } else {
        findings.push({ level: 'info', code: `not-detected-${item.software?.id || 'software'}`, message: `未检测到 ${item.software?.name || item.query}。可能未安装、装在非标准目录，或是网页/服务器版；请人工核对。` })
      }
    }
    const wantsEnsp = requested.some((item) => item.software?.id === 'ensp' || /ensp/i.test(item.query))
    if (wantsEnsp && env.cpu.virtualizationFirmwareEnabled === false) {
      findings.push({ level: 'warning', code: 'virtualization-disabled', message: 'CPU 固件中的虚拟化没有启用。eNSP 的虚拟化组件可能无法启动，需在确认机型后检查 BIOS/UEFI 设置。' })
    }
    if (wantsEnsp && env.virtualization.hypervisorPresent === true && found.has('virtualbox')) {
      findings.push({ level: 'notice', code: 'hypervisor-present', message: '系统检测到 Hyper-V 正在运行，同时发现了 VirtualBox。不同版本组合的兼容性不同，本工具不会自动关闭 Hyper-V；请按已验证的版本组合做启动测试。' })
    }
    if (env.psError) {
      findings.push({ level: 'notice', code: 'partial-probe', message: '部分系统信息读取失败，当前结果不完整。请以手工核对和软件实际启动测试为准。' })
    }
    findings.push({ level: 'info', code: 'probe-is-readonly', message: '本次仅做只读检查，没有安装、卸载、改驱动或改系统设置。任何修复动作都需要另行确认。' })
    return findings
  }

  if (!found.has('ensp')) {
    findings.push({ level: 'info', code: 'ensp-not-found', message: '未在注册表或常见安装目录检测到 eNSP；这不代表一定没安装，可在实验档案中手动填写实际版本。' })
  }
  if (found.has('ensp') && !found.has('virtualbox')) {
    findings.push({ level: 'warning', code: 'virtualbox-not-found', message: '检测到 eNSP，但未发现 VirtualBox。部分 eNSP 版本依赖虚拟化组件，请先核对课程要求的版本组合，不要直接安装最新版。' })
  }
  if (env.cpu.virtualizationFirmwareEnabled === false) {
    findings.push({ level: 'warning', code: 'virtualization-disabled', message: 'CPU 固件中的虚拟化没有启用。eNSP 的虚拟化组件可能无法启动，需在确认机型后检查 BIOS/UEFI 设置。' })
  }
  if (env.virtualization.hypervisorPresent === true && found.has('virtualbox')) {
    findings.push({ level: 'notice', code: 'hypervisor-present', message: '系统检测到 Hyper-V 正在运行，同时发现了 VirtualBox。不同版本组合的兼容性不同，本工具不会自动关闭 Hyper-V；请按已验证的版本组合做启动测试。' })
  }
  if (found.has('ensp') && !env.captureDriverFound) {
    findings.push({ level: 'warning', code: 'capture-driver-not-found', message: '检测到 eNSP，但未发现 WinPcap/Npcap 抓包驱动迹象。若实验需要抓包，请先确认课程要求的驱动版本与安装顺序。' })
  }
  if (env.psError) {
    findings.push({ level: 'notice', code: 'partial-probe', message: '部分系统信息读取失败，当前结果不完整。请以手工核对和软件实际启动测试为准。' })
  }
  findings.push({ level: 'info', code: 'probe-is-readonly', message: '本次仅做只读检查，没有安装、卸载、改驱动或改系统设置。任何修复动作都需要另行确认。' })
  return findings
}

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$apps = @()
$roots = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
foreach ($root in $roots) {
  $apps += Get-ItemProperty $root -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName } |
    Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation
}
$cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1 Name, NumberOfCores, NumberOfLogicalProcessors, VirtualizationFirmwareEnabled
$cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue | Select-Object Manufacturer, Model, HypervisorPresent
[pscustomobject]@{
  apps = @($apps)
  cpu = $cpu
  computer = $cs
} | ConvertTo-Json -Depth 5 -Compress
`

export async function probeEnvironment(options = {}) {
  const startedAt = Date.now()
  const paths = knownPaths()
  const driverFound = paths.captureDrivers.some((p) => existsSync(p))
  const base = {
    ok: true,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    memoryGB: Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10,
    os: {
      release: os.release(),
      version: os.version(),
      arch: os.arch(),
      hostname: os.hostname(),
    },
    cpu: {
      name: (os.cpus()[0] && os.cpus()[0].model) || '',
      logicalCores: os.cpus().length,
      virtualizationFirmwareEnabled: null,
    },
    virtualization: { hypervisorPresent: null },
    installed: [],
    dependencies: [],
    requested: [],
    captureDriverFound: driverFound,
    elapsedMs: 0,
    psError: false,
    disclaimer: '这是一次只读环境检查，不会安装或修改任何软件。检测不到不代表软件一定不存在，最终以实际启动测试为准。',
  }

  if (process.platform !== 'win32') {
    base.ok = false
    base.findings = findingsFor(base, [])
    base.elapsedMs = Date.now() - startedAt
    return base
  }

  const ps = await runPowerShell(PS_SCRIPT, options.timeoutMs || 15000)
  let parsed = null
  if (!ps.error && ps.stdout.trim()) {
    try {
      parsed = JSON.parse(ps.stdout.trim())
    } catch {
      parsed = null
    }
  }
  base.psError = Boolean(ps.error || !parsed)
  if (parsed?.cpu) {
    base.cpu.name = String(parsed.cpu.Name || base.cpu.name)
    base.cpu.logicalCores = Number(parsed.cpu.NumberOfLogicalProcessors) || base.cpu.logicalCores
    base.cpu.virtualizationFirmwareEnabled = parsed.cpu.VirtualizationFirmwareEnabled === true
      ? true
      : parsed.cpu.VirtualizationFirmwareEnabled === false ? false : null
  }
  if (parsed?.computer) {
    base.virtualization.hypervisorPresent = parsed.computer.HypervisorPresent === true
      ? true
      : parsed.computer.HypervisorPresent === false ? false : null
  }
  const appRows = Array.isArray(parsed?.apps) ? parsed.apps : (parsed?.apps ? [parsed.apps] : [])
  const allApps = appRows
    .filter((row) => row && row.DisplayName)
    .map((row) => ({
      name: String(row.DisplayName || ''),
      version: String(row.DisplayVersion || ''),
      publisher: String(row.Publisher || ''),
      installLocation: String(row.InstallLocation || ''),
      category: appCategory(row.DisplayName),
    }))
  for (const file of paths.ensp.filter((p) => existsSync(p))) {
    if (!allApps.some((x) => x.category === 'ensp')) {
      allApps.push({ name: 'eNSP', version: '', publisher: 'Huawei', installLocation: file, category: 'ensp' })
    }
  }
  for (const file of paths.virtualBox.filter((p) => existsSync(p))) {
    if (!allApps.some((x) => x.category === 'virtualbox')) {
      allApps.push({ name: 'Oracle VM VirtualBox', version: '', publisher: 'Oracle', installLocation: file, category: 'virtualbox' })
    }
  }

  const requestedText = typeof options.software === 'string' ? options.software : ''
  base.dependencies = allApps.filter((app) => APP_PATTERN.test(app.name))
  if (requestedText.trim()) {
    base.requested = matchRequestedSoftware(requestedText, allApps)
    const seen = new Set()
    base.installed = []
    for (const item of base.requested) {
      for (const app of item.detected) {
        const key = `${app.name}|${app.version}|${app.installLocation}`
        if (seen.has(key)) continue
        seen.add(key)
        base.installed.push(app)
      }
    }
  } else {
    base.installed = allApps.filter((app) => APP_PATTERN.test(app.name))
  }

  base.findings = findingsFor(base, allApps)
  base.elapsedMs = Date.now() - startedAt
  return base
}
