import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { buildProfile, buildReportPlan, generateReport, importTemplate, listTemplates } from '../lib/report.mjs'
import { readDocx, readMarkdown } from '../lib/docx-read.mjs'
import { buildDocx } from '../lib/docx-write.mjs'
import { zipRead, zipWrite } from '../lib/zip.mjs'

const BASE = join(process.cwd(), 'test-output', `report-${process.pid}`)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function workspace(name) {
  const dir = join(BASE, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'home'), { recursive: true })
  mkdirSync(join(dir, 'experiments', 'exp-20261028-180000-abcd', 'screenshots'), { recursive: true })
  mkdirSync(join(dir, 'experiments', 'exp-20261028-180000-abcd', 'data'), { recursive: true })
  return dir
}

function experimentAt(dir) {
  const workDir = join(dir, 'experiments', 'exp-20261028-180000-abcd')
  writeFileSync(join(workDir, 'screenshots', '01-topology.png'), PNG)
  writeFileSync(join(workDir, 'screenshots', '02-ping.png'), PNG)
  writeFileSync(join(workDir, 'data', 'routes.txt'), '10.0.0.0/24 via 192.168.1.1\n')
  return {
    id: 'exp-20261028-180000-abcd',
    title: '计算机网络实验三：静态路由',
    course: '计算机网络',
    software: 'eNSP',
    status: 'active',
    notes: '按指导书完成两台路由器互联。',
    workDir,
    steps: [
      { title: '搭建拓扑', instruction: '拖入 2 台 AR2220 与 2 台 PC', expected: '设备全部绿色', actual: '设备全部绿色', passed: true },
      { title: '配置接口 IP', instruction: '按地址表配置 GE0/0/0', expected: '接口 up', actual: '接口 up', passed: true },
    ],
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:30:00.000Z',
  }
}

const ENV = {
  platform: 'win32',
  memoryGB: 32,
  os: { version: 'Windows 11 Home China', release: '10.0.26200', arch: 'x64' },
  installed: [
    { name: 'Huawei eNSP', version: 'V1.3.00.100' },
    { name: 'Oracle VM VirtualBox', version: '7.2.22' },
  ],
  findings: [],
}

const HISTORY = {
  attempts: [
    { softwareId: 'ensp', component: 'virtualization', name: 'Oracle VirtualBox', version: '6.1.30', outcome: 'failed', symptom: '启动设备失败' },
    { softwareId: 'ensp', component: 'virtualization', name: 'Oracle VirtualBox', version: '7.2.22', outcome: 'worked', symptom: '' },
  ],
}

test.after(() => rmSync(BASE, { recursive: true, force: true }))

test('自定义 zip 读写可用，能被 Python 与其他库识别', () => {
  const buffer = zipWrite([{ name: 'a/b.txt', data: 'hello 实验' }])
  const files = zipRead(buffer)
  assert.equal(files.get('a/b.txt').toString('utf8'), 'hello 实验')
})

test('docx 写入后能原样读回标题、表格与图片', () => {
  const docx = buildDocx({
    title: '实验报告',
    meta: [['课程', '计算机网络']],
    sections: [{
      title: '一、实验环境',
      level: 1,
      paragraphs: ['操作系统：Windows 11'],
      table: { headers: ['设备', '型号'], rows: [['AR1', '【待补】']] },
      images: [{ name: '01.png', data: PNG, caption: '图 1 拓扑' }],
    }],
  })
  const { blocks, media } = readDocx(docx)
  const headings = blocks.filter((block) => block.type === 'heading').map((block) => block.text)
  assert.deepEqual(headings, ['实验报告', '一、实验环境'])
  const tables = blocks.filter((block) => block.type === 'table')
  assert.equal(tables.length, 2)
  assert.deepEqual(tables[1].rows[0], ['设备', '型号'])
  assert.ok(media.includes('word/media/01.png'))
})

test('读取 Markdown 模板并识别章节类型与表格列', () => {
  const blocks = readMarkdown([
    '# 实验报告',
    '## 一、实验目的',
    '简述实验目标。',
    '## 二、实验环境',
    '| 设备 | 型号 | 数量 |',
    '| --- | --- | --- |',
    '| 路由器 | AR2220 | 2 |',
    '## 三、实验步骤',
    '1. 搭建拓扑',
    '## 四、实验结果',
    '| 测试项 | 预期 | 实际 |',
    '| --- | --- | --- |',
    '| ping | 通 |  |',
    '## 五、实验总结',
  ].join('\n'))
  const profile = buildProfile(blocks, { name: '课程模板' })
  assert.deepEqual(profile.sections.map((item) => item.kind), ['purpose', 'environment', 'steps', 'results', 'summary'])
  const results = profile.sections.find((item) => item.kind === 'results')
  assert.deepEqual(results.tableHeaders, ['测试项', '预期', '实际'])
})

test('导入 docx 模板会落盘并可再次列出', () => {
  const dir = workspace('import')
  const templatePath = join(dir, 'template.docx')
  writeFileSync(templatePath, buildDocx({
    title: '实验报告模板',
    sections: [
      { title: '一、实验目的', level: 1, paragraphs: ['请按指导书填写'] },
      { title: '二、实验环境与器材', level: 1 },
      { title: '三、实验步骤', level: 1 },
      { title: '四、实验结果与数据', level: 1, table: { headers: ['测试项', '预期', '实际'], rows: [['', '', '']] } },
      { title: '五、实验总结', level: 1 },
    ],
  }))
  const profile = importTemplate({ filePath: templatePath, name: '网络实验模板', homeDir: join(dir, 'home') })
  assert.equal(profile.sourceType, 'docx')
  assert.equal(profile.sections.length, 5)
  const results = profile.sections.find((item) => item.kind === 'results')
  assert.deepEqual(results.tableHeaders, ['测试项', '预期', '实际'])
  const templates = listTemplates(join(dir, 'home'))
  assert.equal(templates.length, 1)
  assert.equal(templates[0].name, '网络实验模板')
})

test('生成计划会区分自动填充与待补，不编造结果', () => {
  const dir = workspace('plan')
  const plan = buildReportPlan({
    experiment: experimentAt(dir),
    profile: null,
    environment: ENV,
    history: HISTORY,
  })
  assert.equal(plan.coverage.total, 7)
  assert.ok(plan.coverage.auto >= 3)
  const env = plan.sections.find((item) => item.kind === 'environment')
  assert.equal(env.coverage, 'auto')
  const steps = plan.sections.find((item) => item.kind === 'steps')
  assert.equal(steps.coverage, 'auto')
  const results = plan.sections.find((item) => item.kind === 'results')
  assert.equal(results.coverage, 'auto')
  const summary = plan.sections.find((item) => item.kind === 'summary')
  assert.equal(summary.coverage, 'draft')
  const purpose = plan.sections.find((item) => item.kind === 'purpose')
  assert.equal(purpose.coverage, 'draft')
  // 0.15.0 起：结果分析由 actual 自动汇总、问题与解决从失败步骤抽取，草稿数会相应减少
  const analysis = plan.sections.find((item) => item.kind === 'analysis')
  assert.ok(['auto', 'draft'].includes(analysis.coverage))
  assert.ok(plan.coverage.draft >= 1)
  assert.ok(plan.drafts.length >= 1)
})

test('生成 md 与 docx，占位符明确且不含伪造数据', () => {
  const dir = workspace('generate')
  const experiment = experimentAt(dir)
  const plan = buildReportPlan({ experiment, profile: null, environment: ENV, history: HISTORY })
  const output = generateReport({ plan, student: { name: '张三', studentId: '20260001' }, outputDir: join(dir, 'reports') })
  assert.equal(output.ok, true)
  assert.ok(output.bytes.docx > 1000)
  const markdown = readFileSync(output.files.markdown, 'utf8')
  assert.match(markdown, /计算机网络实验三：静态路由/)
  assert.match(markdown, /Oracle VirtualBox 6\.1\.30 → 失败/)
  assert.ok(!markdown.includes('自动草稿'), '报告里不应出现“自动草稿”字样')
  assert.ok(!markdown.includes('模板要求'), '报告里不应出现模板提示语')
  assert.ok(!markdown.includes('提交前检查'), '报告里不应出现生成器检查清单')
  assert.match(markdown, /01-topology\.png/)
  assert.ok(!/平均正确率|测试通过率/.test(markdown))

  const docx = readDocx(readFileSync(output.files.docx))
  const text = docx.blocks.map((block) => block.text || block.rows?.flat().join(' ') || '').join('\n')
  assert.match(text, /计算机网络实验三：静态路由/)
  assert.ok(!text.includes('自动草稿'))
  assert.ok(docx.media.some((name) => name.endsWith('.png')))
})

test('模板文件缺失或格式不支持时明确报错', () => {
  const dir = workspace('errors')
  assert.throws(() => importTemplate({ filePath: join(dir, 'nope.docx') }), /找不到模板文件/)
  const bad = join(dir, 'bad.pdf')
  writeFileSync(bad, 'x')
  assert.throws(() => importTemplate({ filePath: bad }), /只支持/)
})

test('模板封面字段会保留，姓名学号自动填，空缺仍标待补', () => {
  const dir = workspace('meta')
  const templatePath = join(dir, 'cover.docx')
  writeFileSync(templatePath, buildDocx({
    title: '课程实验报告',
    meta: [['实验名称', ''], ['姓名', ''], ['学号', ''], ['班级', '']],
    sections: [{ title: '一、实验环境', level: 1 }, { title: '二、实验步骤', level: 1 }],
  }))
  const profile = importTemplate({ filePath: templatePath, homeDir: join(dir, 'home') })
  assert.deepEqual(profile.metaLabels, ['实验名称', '姓名', '学号', '班级'])
  const plan = buildReportPlan({ experiment: experimentAt(dir), profile, environment: ENV, history: HISTORY })
  const output = generateReport({ plan, student: { name: '李四', studentId: '20260002' }, outputDir: join(dir, 'reports') })
  const docx = readDocx(readFileSync(output.files.docx))
  const metaTable = docx.blocks.find((block) => block.type === 'table')
  assert.deepEqual(metaTable.rows.map((row) => row[1]), ['计算机网络实验三：静态路由', '李四', '20260002', '【待补】'])
})

test('结果表会按步骤预填测试项与预期，实际值仍留待补', () => {
  const dir = workspace('table')
  const profile = buildProfile([
    { type: 'heading', level: 1, text: '一、实验结果与数据' },
    { type: 'table', rows: [['测试项', '预期结果', '实际结果', '结论'], ['', '', '', '']] },
  ], { name: '带表模板' })
  const plan = buildReportPlan({ experiment: experimentAt(dir), profile, environment: ENV, history: HISTORY })
  const output = generateReport({ plan, outputDir: join(dir, 'reports') })
  const markdown = readFileSync(output.files.markdown, 'utf8')
  assert.match(markdown, /\| 搭建拓扑 \| 设备全部绿色 \| 设备全部绿色 \| 符合预期 \|/)
  assert.match(markdown, /\| 配置接口 IP \| 接口 up \| 接口 up \| 符合预期 \|/)
})

test('拓扑章节会插入文件名含“拓扑”的截图', () => {
  const dir = workspace('topology')
  const profile = buildProfile([
    { type: 'heading', level: 1, text: '一、实验拓扑' },
    { type: 'heading', level: 1, text: '二、实验步骤' },
  ], { name: '拓扑模板' })
  const plan = buildReportPlan({ experiment: experimentAt(dir), profile, environment: ENV, history: HISTORY })
  const topology = plan.sections.find((item) => item.kind === 'topology')
  assert.equal(topology.coverage, 'auto')
  const output = generateReport({ plan, outputDir: join(dir, 'reports') })
  const docx = readDocx(readFileSync(output.files.docx))
  assert.ok(docx.media.some((name) => name.includes('topology')))
})
