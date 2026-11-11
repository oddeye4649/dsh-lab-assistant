// 由 coursepacks/software-catalog.json 生成 docs/SOFTWARE_CATALOG.md 的学科段
// 目的：避免「JSON 目录」和「Markdown 文档」两份清单漂移
// 用法：node scripts/regen-catalog-doc.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CAT = join(ROOT, 'coursepacks', 'software-catalog.json')
const DOC = join(ROOT, 'docs', 'SOFTWARE_CATALOG.md')

const data = JSON.parse(readFileSync(CAT, 'utf8'))
const byId = new Map(data.software.map((s) => [s.id, s]))

function label(s) {
  if (s.support === 'verified-diagnose') return `- ${s.name}（${s.priority}，已实现只读检测）`
  if (s.support === 'verified-run') return `- ${s.name}（${s.priority}，已完成最小实验）`
  return `- ${s.name}（${s.priority}）`
}

const blocks = data.disciplines.map((d, i) => {
  const lines = [`### ${i + 1}. ${d.name}`, '']
  for (const sid of d.softwareIds) {
    const s = byId.get(sid)
    if (!s) throw new Error(`学科 ${d.id} 引用了不存在的软件 ${sid}`)
    lines.push(label(s))
  }
  lines.push('', `课程关联：${d.courses.join('、')}。`)
  if (d.notes) lines.push('', `> ${d.notes}`)
  return lines.join('\n')
})

const section = [
  '## 学科软件分布',
  '',
  '> 下面按学科列出目录里全部条目，括号内是优先级与当前支持状态。',
  '> **只有标注「已完成最小实验 / 已实现只读检测」的条目才有真实测试记录，其余均为仅归类。**',
  '> 授权方式、平台、控制方式和备注在 `coursepacks/software-catalog.json` 里，文档不重复。',
  '',
  blocks.join('\n\n'),
  '',
].join('\n')

const text = readFileSync(DOC, 'utf8')
const lines = text.split('\n')
const start = lines.findIndex((l) => l.startsWith('## 学科软件分布'))
const end = lines.findIndex((l) => l.startsWith('## 建议的适配建档顺序'))
if (start < 0 || end < 0) throw new Error('找不到「学科软件分布」或「建议的适配建档顺序」标题')

let head = lines.slice(0, start).join('\n')
head = head.replace(/> 更新时间：\d{4}-\d{2}-\d{2}/, `> 更新时间：${data.updatedAt}`)
head = head.replace(
  /> 当前覆盖：\d+ 个学科方向、\d+ 项代表软件。/,
  `> 当前覆盖：${data.disciplines.length} 个学科方向、${data.software.length} 项代表软件。`
)
const tail = lines.slice(end).join('\n')

writeFileSync(DOC, `${head}\n${section}\n${tail}`, 'utf8')
console.log(`已生成：${data.disciplines.length} 学科 / ${data.software.length} 软件`)
