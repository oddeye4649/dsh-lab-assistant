// 校验 software-catalog.json 的 verify 字段一致性。
// 目的：防止「标了 verified-run 却没有可复算命令」「catalog-only 却挂了 verify」
// 「expect 为空」「timeoutMs 不合理」这类手工录入错误。
// 用法: node scripts/check-catalog-verify.mjs
import { readFileSync } from 'node:fs'

const CATALOG = new URL('../coursepacks/software-catalog.json', import.meta.url)
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'))
const items = catalog.software || []
const problems = []
const warned = []

const PLACEHOLDERS = new Set(['{script}', '{tex}', '{netlist}', '{inp}', '{rpt}', '{out}', '{model}', '{data}', '{file}', '{dir}', '{datadir}', '{arff}', '{macro}', '{weka_jar}', '{ij_jar}', '{my_ini}', '{circ}', '{vec}'])

for (const item of items) {
  const id = item.id || '(no-id)'
  const support = item.support || ''
  const verify = item.verify

  if (support === 'verified-run') {
    if (!verify) {
      problems.push(`${id}: support=verified-run 但缺少 verify 字段`)
      continue
    }
    if (typeof verify.cmd !== 'string' || !verify.cmd.trim()) {
      problems.push(`${id}: verify.cmd 为空或不是字符串`)
    }
    const hasExpect = Array.isArray(verify.expect) && verify.expect.length > 0
    const hasArtifact = Array.isArray(verify.artifactExpect) && verify.artifactExpect.length > 0
    const hasReport = Array.isArray(verify.reportExpect) && verify.reportExpect.length > 0
    const hasContains = Array.isArray(verify.reportContains) && verify.reportContains.length > 0
    if (!hasExpect && !hasArtifact && !hasReport && !hasContains) {
      problems.push(`${id}: verify 既没有 expect，也没有 artifactExpect/reportExpect/reportContains——判定没有依据`)
    }
    if (typeof verify.timeoutMs !== 'number' || verify.timeoutMs < 5000 || verify.timeoutMs > 1800000) {
      problems.push(`${id}: verify.timeoutMs 缺失或不在 5s~30min 之间（当前 ${verify.timeoutMs}）`)
    }
    if (typeof verify.deterministic !== 'boolean') {
      problems.push(`${id}: verify.deterministic 必须是布尔值`)
    }
    if (typeof verify.note !== 'string' || verify.note.trim().length < 10) {
      warned.push(`${id}: verify.note 太短，后面复现时容易踩坑`)
    }
    // 占位符必须来自白名单
    for (const m of String(verify.cmd).matchAll(/\{[a-zA-Z]+\}/g)) {
      if (!PLACEHOLDERS.has(m[0])) warned.push(`${id}: verify.cmd 用了未知占位符 ${m[0]}`)
    }
    // 版本号/路径不应写死
    if (/[A-Za-z]:\\/.test(verify.cmd)) problems.push(`${id}: verify.cmd 里写死了本机盘符路径`)
  } else if (verify) {
    problems.push(`${id}: support=${support} 却带了 verify（只有 verified-run 才允许）`)
  }

  if (support === 'verified-diagnose' && item.verify) {
    problems.push(`${id}: verified-diagnose 不应带 verify 命令（只能定位/截图，不能判定数值）`)
  }
}

const stats = items.reduce((acc, x) => {
  const k = x.support || 'unknown'
  acc[k] = (acc[k] || 0) + 1
  return acc
}, {})

console.log(`扫描 ${items.length} 项；状态分布 ${JSON.stringify(stats)}`)
if (warned.length) {
  console.log(`\n提醒 ${warned.length} 条：`)
  for (const w of warned) console.log('  ! ' + w)
}
if (problems.length) {
  console.log(`\n❌ 发现 ${problems.length} 个问题：`)
  for (const p of problems) console.log('  - ' + p)
  process.exit(1)
}
console.log('\n✅ verify 字段一致性检查通过')
