#!/usr/bin/env node
// 发布前敏感信息扫描：检查「将要发布进包里的文件」有没有密钥、口令、本机路径。
// 用法：
//   node scripts/publish-check.mjs                 # 按 package.json 的 files 扫描（等价于 npm pack 内容）
//   node scripts/publish-check.mjs <目录或 tgz>    # 扫描已解包的目录，或直接扫一个 .tgz
// 退出码：0 = 干净；1 = 有命中（CI 里直接挡发布）
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'

const ROOT = resolve(process.cwd())
const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.txt', '.yml', '.yaml',
  '.cs', '.ps1', '.sh', '.bat', '.py', '.css', '.html', '.xml', '.cfg', '.ini', '.toml',
])
const SKIP_DIRS = new Set(['node_modules', '.git', 'test-output', 'temp', 'dist', '.preview'])

// 高危：密钥 / 令牌 / 口令赋值
const SECRET_PATTERNS = [
  [/\bsk-[A-Za-z0-9]{20,}/g, 'OpenAI 风格 API key'],
  [/\bghp_[A-Za-z0-9]{20,}/g, 'GitHub PAT'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'GitHub fine-grained PAT'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AWS Access Key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'Slack token'],
  [/\bBearer\s+[A-Za-z0-9\-._~+/]{20,}/g, 'Bearer token'],
  [/\bapi[_-]?key\s*[:=]\s*["'][^"']{12,}["']/gi, 'API key 赋值'],
  [/\bsecret\s*[:=]\s*["'][^"']{8,}["']/gi, 'secret 赋值'],
  [/\b(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}["']/gi, '口令赋值'],
  [new RegExp('"' + '123' + '456' + '"', 'g'), '硬编码弱口令（6 位连顺）'],
]

// 本机信息：用户名路径 / 个人目录 / 聊天记录路径
const PRIVACY_PATTERNS = [
  [/[A-Za-z]:\\Users\\[^\\\s"']+/g, '本机用户目录绝对路径'],
  [/\bwxid_[a-z0-9]{8,}/g, '微信 wxid'],
  [/\bxwechat_files\b/g, '微信文件目录'],
  [/\bOneDrive\\/g, 'OneDrive 路径'],
]

function isBinary(buf) {
  const n = Math.min(buf.length, 4096)
  for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true
  return false
}

function collect(readRoot, useFilesField) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else {
        const ext = extname(entry).toLowerCase()
        if (TEXT_EXT.has(ext) || entry === 'LICENSE') out.push(full)
      }
    }
  }
  if (useFilesField) {
    const pkg = JSON.parse(readFileSync(join(readRoot, 'package.json'), 'utf8'))
    for (const item of pkg.files || []) {
      const full = join(readRoot, item)
      if (!existsSync(full)) continue
      if (statSync(full).isDirectory()) walk(full)
      else out.push(full)
    }
    out.push(join(readRoot, 'package.json'))
  } else {
    walk(readRoot)
  }
  return out
}

function scanFile(file, displayBase) {
  const buf = readFileSync(file)
  if (isBinary(buf)) return []
  const text = buf.toString('utf8')
  const hits = []
  const lines = text.split(/\r?\n/)
  for (const [pattern, label] of [...SECRET_PATTERNS, ...PRIVACY_PATTERNS]) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text)) !== null) {
      const before = text.slice(0, match.index)
      const lineNo = before.split('\n').length
      const lineText = (lines[lineNo - 1] || '').trim().slice(0, 100)
      hits.push({ file: relative(displayBase, file).replace(/\\/g, '/'), line: lineNo, label, sample: lineText })
      if (hits.length > 200) return hits
    }
  }
  return hits
}

function checkChangelogVersion(base, useFilesField) {
  // 只在扫仓库时做（扫已解包的 tgz 时包里没有 CHANGELOG）
  if (!useFilesField) return ''
  const pkgPath = join(base, 'package.json')
  const logPath = join(base, 'CHANGELOG.md')
  if (!existsSync(logPath)) return '缺少 CHANGELOG.md（Release 说明会为空）'
  const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version
  const text = readFileSync(logPath, 'utf8')
  const pattern = new RegExp('^## \\[?' + version.replace(/\./g, '\\.') + '\\]?', 'm')
  if (!pattern.test(text)) {
    return `CHANGELOG.md 里没有 ${version} 的小节（先补变更记录再发布）`
  }
  return ''
}

function main() {
  const arg = process.argv[2]
  let base = ROOT
  let useFilesField = true
  let cleanup = null

  if (arg && arg.endsWith('.tgz')) {
    const dir = mkdtempSync(join(tmpdir(), 'pubcheck-'))
    // Windows 上 GNU tar 会把 "D:\..." 里的冒号当成远程主机（报 Cannot connect to D:）。
    // 走 stdin 喂文件内容，tar 就不需要解析带盘符的路径，跨平台一致。
    execFileSync('tar', ['-xzf', '-', '-C', dir], { input: readFileSync(resolve(arg)) })
    base = join(dir, 'package')
    useFilesField = false
    cleanup = dir
  } else if (arg) {
    base = resolve(arg)
    useFilesField = false
  }

  const files = collect(base, useFilesField)
  const all = []
  for (const file of files) all.push(...scanFile(file, base))

  // 版本一致性：package.json 的版本必须在 CHANGELOG.md 里有对应小节，
  // 否则 GitHub Release 会拿不到说明（release.yml 抽不到就失败）。
  const versionProblem = checkChangelogVersion(base, useFilesField)
  if (versionProblem) {
    console.log(`❌ ${versionProblem}`)
    if (cleanup) rmSync(cleanup, { recursive: true, force: true })
    return 1
  }
  console.log('✅ CHANGELOG 有当前版本小节')

  console.log(`扫描文件：${files.length} 个（${useFilesField ? '按 package.json files' : '整目录'}）`)
  if (!all.length) {
    console.log('✅ 未发现密钥、口令或本机路径')
    if (cleanup) rmSync(cleanup, { recursive: true, force: true })
    return 0
  }
  console.log(`❌ 命中 ${all.length} 处：`)
  for (const hit of all) console.log(`  ${hit.file}:${hit.line}  [${hit.label}]  ${hit.sample}`)
  if (cleanup) rmSync(cleanup, { recursive: true, force: true })
  return 1
}

process.exit(main())
