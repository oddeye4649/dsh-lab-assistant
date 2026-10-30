import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SOURCE = join(ROOT, 'overlay', 'LabPet.cs')
const MANIFEST = join(ROOT, 'overlay', 'app.manifest')

let active = null

// 编译用的 csc 有两条路：
// 1) 装了 Visual Studio / MSBuild 的机器，用其自带的 Roslyn csc（快、诊断好）；
// 2) 没装 VS 的机器，退回系统自带的 .NET Framework csc（Framework64\v4.0.30319）——
//    它只支持 C# 5，所以 overlay/LabPet.cs 刻意保持 C# 5 兼容（不用 `is 类型 变量`、不用 $"..."），
//    两条路都能编出 LabPet.exe。改动该文件时别引入 C# 6/7 语法，否则没装 VS 的用户会编译失败、桌宠不可用。
function findRoslynCsc() {
  const bases = [
    'C:\\Program Files\\Microsoft Visual Studio',
    'C:\\Program Files (x86)\\Microsoft Visual Studio',
    'C:\\Program Files\\Microsoft Visual Studio\\2022',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022',
  ]
  for (const base of bases) {
    try {
      if (!existsSync(base)) continue
      const years = readdirSync(base).filter((n) => /^\d{4}$/.test(n))
      for (const year of years) {
        const yDir = join(base, year)
        for (const edition of readdirSync(yDir)) {
          const direct = join(yDir, edition, 'MSBuild', 'Current', 'Bin', 'Roslyn', 'csc.exe')
          if (existsSync(direct)) return direct
        }
      }
      // 有些安装直接把 MSBuild 放在基目录下
      const flat = join(base, 'MSBuild', 'Current', 'Bin', 'Roslyn', 'csc.exe')
      if (existsSync(flat)) return flat
    } catch (err) {}
  }
  return null
}

function findCsc() {
  if (process.platform !== 'win32') return null
  const roslyn = findRoslynCsc()
  if (roslyn) return roslyn
  const root = process.env.SystemRoot || 'C:\\Windows'
  const candidates = [
    join(root, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    join(root, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ]
  return candidates.find((path) => existsSync(path)) || null
}

// UIAutomationClient/Types 不在 csc 同目录（System.Windows.Forms 是），
// 而在 GAC 或 .NET Framework 参考程序集里。编译时需要用 -lib 指过去，
// 否则 csc 报 CS0006 「未能找到元数据文件」。
function findReferenceLib() {
  if (process.platform !== 'win32') return null
  const roots = [
    'C:\\Program Files (x86)\\Reference Assemblies\\Microsoft\\Framework\\.NETFramework',
    'C:\\Program Files\\Reference Assemblies\\Microsoft\\Framework\\.NETFramework',
  ]
  for (const root of roots) {
    try {
      if (!existsSync(root)) continue
      const versions = readdirSync(root).filter((v) => /^v4\./.test(v)).sort().reverse()
      for (const v of versions) {
        const dir = join(root, v)
        if (existsSync(join(dir, 'UIAutomationClient.dll')) && existsSync(join(dir, 'UIAutomationTypes.dll'))) return dir
      }
    } catch (err) {}
  }
  return null
}

function run(command, args, timeoutMs) {
  return new Promise((resolvePromise) => {
    execFile(command, args, { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolvePromise({ ok: !error, stdout: stdout || '', stderr: stderr || '', blocked: error ? /blocked|拒绝/i.test(error.message || '') : false })
    })
  })
}

function freePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = http.createServer()
    server.unref()
    server.on('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePromise(port))
    })
  })
}

export async function overlayRequest({ port, token }, path, payload = {}, timeoutMs = 10000) {
  const body = JSON.stringify(payload)
  return new Promise((resolvePromise) => {
    const request = http.request(
      {
        host: '127.0.0.1', port, path: `${path}?token=${token}`, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: timeoutMs,
      },
      (response) => {
        let data = ''
        response.on('data', (chunk) => { data += chunk })
        response.on('end', () => {
          try { resolvePromise({ ok: true, status: response.statusCode, ...JSON.parse(data) }) }
          catch { resolvePromise({ ok: false, error: `返回不是 JSON：${data.slice(0, 120)}` }) }
        })
      },
    )
    request.on('timeout', () => { request.destroy(); resolvePromise({ ok: false, error: '伴随进程响应超时' }) })
    request.on('error', (error) => resolvePromise({ ok: false, error: error.message }))
    request.write(body)
    request.end()
  })
}

async function waitReady(connection, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await overlayRequest(connection, '/status', {}, 2000)
    if (status.ok) return status
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))
  }
  return null
}

// 首次运行会用系统自带的 csc 编译伴随进程（一次性，结果缓存在 DSH home）。
// 我的沙箱禁止运行编译器，所以在开发环境会走 compile-blocked 分支；用户机器上是正常路径。
export async function startOverlay({ homeDir, displayName = '主人', petSize, petPath, apiInfo } = {}) {
  if (process.platform !== 'win32') return { ok: false, reason: 'unsupported-platform', error: '桌面伴随进程仅支持 Windows' }
  if (!existsSync(SOURCE) || !existsSync(MANIFEST)) return { ok: false, reason: 'missing-source', error: 'overlay 源码缺失，安装包可能不完整' }
  const csc = findCsc()
  if (!csc) return { ok: false, reason: 'no-compiler', error: '系统里找不到 .NET Framework 编译器（csc.exe）' }

  const dir = join(resolve(homeDir), 'overlay')
  mkdirSync(dir, { recursive: true })
  const exe = join(dir, 'LabPet.exe')
  const logFile = join(dir, 'build.log')
  let rebuilt = false

  const needsBuild = !existsSync(exe)
    || statSync(exe).mtimeMs < statSync(SOURCE).mtimeMs
    || statSync(exe).mtimeMs < statSync(MANIFEST).mtimeMs
  if (needsBuild) {
    const refLib = findReferenceLib()
    const roslyn = /Roslyn/i.test(csc)
    const compile = await run(csc, [
      '-nologo', '-target:winexe', `-out:${exe}`,
      ...(roslyn ? ['-langversion:latest'] : []),
      ...(refLib ? [`-lib:${refLib}`] : []),
      '-r:System.Windows.Forms.dll', '-r:System.Drawing.dll',
      '-r:System.Web.Extensions.dll', '-r:UIAutomationClient.dll', '-r:UIAutomationTypes.dll',
      '-r:WindowsBase.dll',
      `-win32manifest:${MANIFEST}`, SOURCE,
    ], 90000)
    writeFileSync(logFile, `# ${new Date().toISOString()}\nexit=${compile.ok}\n${compile.stdout}\n${compile.stderr}\n`, 'utf8')
    if (!compile.ok || !existsSync(exe)) {
      return { ok: false, reason: 'compile-failed', error: '伴随进程编译失败，详见 build.log', logFile }
    }
    rebuilt = true
  }

  const port = await freePort()
  const token = randomBytes(16).toString('hex')
  // 等插件把实验助手 API 的本机地址准备好（最多 3 秒），传给桌面面板。
  let apiArgs = []
  if (typeof apiInfo === 'function') {
    for (let i = 0; i < 15; i += 1) {
      const info = apiInfo()
      if (info && info.base) {
        apiArgs = ['--api', info.base, '--apitoken', info.token]
        break
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))
    }
  }
  // 允许多只桌宠并存（用户要求）：旧实例不清理，各自带自己的右键菜单可单独关闭。
  const child = spawn(exe, [
    '--port', String(port),
    '--token', token,
    '--pet', petPath || join(ROOT, 'assets', 'pet', 'idle.png'),
    '--config', dir,
    ...apiArgs,
  ], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()

  const connection = { port, token }
  const status = await waitReady(connection, 10000)
  if (!status) {
    try { process.kill(child.pid) } catch { }
    return { ok: false, reason: 'no-response', error: '伴随进程启动后没有响应，详见 overlay 目录', logFile }
  }
  if (displayName) await overlayRequest(connection, '/pet', { action: 'rename', name: displayName })
  if (typeof petSize === 'number' && petSize >= 96 && petSize <= 320) await overlayRequest(connection, '/pet', { action: 'size', size: petSize })
  active = { connection, pid: child.pid, dir }
  return { ok: true, rebuilt, pid: child.pid, port, token, configDir: dir, name: status.name }
}

export function activeOverlay() {
  return active
}

export async function stopOverlay() {
  if (!active) return { ok: true, stopped: false }
  const { connection, pid } = active
  await overlayRequest(connection, '/quit', {}, 3000)
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 800))
  try { process.kill(pid) } catch { }
  active = null
  return { ok: true, stopped: true }
}

export async function overlayStatus() {
  if (!active) return { ok: true, running: false, hint: '伴随进程未启动；桌面指引/截图能力需要它。' }
  const status = await overlayRequest(active.connection, '/status', {}, 3000)
  return { ok: true, running: Boolean(status.ok), pid: active.pid, ...status }
}
