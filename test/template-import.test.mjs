// 模板导入的边界行为（0.15.26 起）：
// 1) 模板首行「实验报告」这类标题不能被当成章节
// 2) 完全识别不到标题时回退内置七节，而不是生成空报告
// 3) 同一个源文件重复导入要覆盖原条目并保留 id
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildProfile, importTemplate, listTemplates } from '../lib/report.mjs'
import { buildDocx } from '../lib/docx-write.mjs'

function docxAt(dir, name, model) {
  const p = join(dir, name)
  writeFileSync(p, buildDocx(model))
  return p
}

const fourSections = {
  title: '实验报告',
  subtitle: '',
  meta: [],
  sections: [
    { title: '一、实验目的', level: 1, paragraphs: ['理解原理'], bullets: [], table: null, images: [] },
    { title: '二、实验原理', level: 1, paragraphs: ['机制'], bullets: [], table: null, images: [] },
    { title: '三、实验步骤', level: 1, paragraphs: ['1. 打开软件'], bullets: [], table: null, images: [] },
    { title: '四、实验结果', level: 1, paragraphs: ['端口状态'], bullets: [], table: null, images: [] },
  ],
}

test('模板首行的文档标题不会被当成章节', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpl-title-'))
  const file = docxAt(dir, 'tpl.docx', fourSections)
  const profile = importTemplate({ filePath: file, name: '四节模板', homeDir: dir })
  const titles = profile.sections.map((s) => s.title)
  assert.deepEqual(titles, ['一、实验目的', '二、实验原理', '三、实验步骤', '四、实验结果'])
  assert.ok(!titles.some((t) => t === '实验报告'), '标题不应成为章节')
  assert.equal(profile.title, '实验报告')
})

test('首个标题本身是章节名时，不能被当成文档标题吞掉', () => {
  const blocks = [
    { type: 'heading', level: 1, text: '一、实验目的' },
    { type: 'paragraph', text: '理解原理' },
    { type: 'heading', level: 2, text: '二、实验步骤' },
    { type: 'paragraph', text: '1. 打开软件' },
  ]
  const profile = buildProfile(blocks, { name: 'md 模板', sourceType: 'md' })
  assert.deepEqual(profile.sections.map((s) => s.title), ['一、实验目的', '二、实验步骤'])
})

test('完全识别不到标题时回退内置七节，而不是空报告', () => {
  const blocks = [{ type: 'paragraph', text: '只有一段正文，没有任何标题' }]
  const profile = buildProfile(blocks, { name: '无标题', sourceType: 'txt' })
  assert.equal(profile.sections.length, 7)
  assert.ok(profile.warnings.some((w) => w.includes('回退为内置通用结构')))
})

test('同一源文件重复导入：覆盖原条目并保留 id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpl-dup-'))
  const file = docxAt(dir, 'same.docx', fourSections)
  const first = importTemplate({ filePath: file, name: '同源模板', homeDir: dir })
  const second = importTemplate({ filePath: file, name: '同源模板', homeDir: dir })
  assert.equal(second.id, first.id, 'id 必须保持不变，已有实验的绑定不能失效')
  assert.equal(second.replaced, true)
  const files = readdirSync(join(dir, 'report-templates')).filter((n) => n.endsWith('.json'))
  assert.equal(files.length, 1, '模板库里只应留一份')
  assert.equal(listTemplates(dir).length, 1)
  // 覆盖后内容仍然完整
  const saved = JSON.parse(readFileSync(join(dir, 'report-templates', files[0]), 'utf8'))
  assert.equal(saved.sections.length, 4)
})

test('不同源文件、同名：各自保留（允许同一模板的不同版本）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpl-two-'))
  const a = docxAt(dir, 'a.docx', fourSections)
  const b = docxAt(dir, 'b.docx', fourSections)
  const first = importTemplate({ filePath: a, name: '同名模板', homeDir: dir })
  const second = importTemplate({ filePath: b, name: '同名模板', homeDir: dir })
  assert.notEqual(first.id, second.id)
  assert.equal(listTemplates(dir).length, 2)
})
