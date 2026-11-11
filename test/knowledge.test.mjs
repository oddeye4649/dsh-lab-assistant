import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import { ExperimentStore } from '../lib/store.mjs'
import { createCore } from '../lib/core.mjs'
import { KnowledgeBase, KNOWLEDGE_LIMITS, USED_SOURCES, slug } from '../lib/knowledge.mjs'

const ROOT = join(process.cwd(), 'test-output', `knowledge-${process.pid}`)

function fresh(name) {
  const home = join(ROOT, name)
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true })
  const store = new ExperimentStore(home)
  const kb = new KnowledgeBase(store)
  const core = createCore({ store, knowledge: kb, assetsRoot: join(process.cwd(), 'assets') })
  return { home, store, kb, core }
}

function pageMap(home, data) {
  const dir = join(home, 'page-maps')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${slug(data.software)}-${slug(data.version)}-a.json`), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

test.before(() => {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(ROOT, { recursive: true })
})
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

test('软件名净化：中文/空格/斜杠/冒号都能安全落盘且可复算', () => {
  assert.equal(slug('eNSP'), 'ensp')
  assert.equal(slug('R / RStudio'), 'r-rstudio')
  assert.equal(slug('软件:A/B'), slug('软件:A/B'))
  assert.match(slug('软件:A/B'), /^[a-z0-9-]{8,40}$/)
  assert.ok(slug('中文软件名').length >= 8)
  assert.equal(slug(''), slug(''))
  assert.ok(USED_SOURCES.includes('interface-live') && USED_SOURCES.includes('none'))
})

test('L1 合并旧三套数据：只用相对整窗 rel，绝不把屏幕绝对 rect 当坐标', () => {
  const { home, store, kb } = fresh('merge')
  pageMap(home, {
    software: 'eNSP', version: '1.3.00.100', windowTitle: 'eNSP 主窗口',
    windowRect: { x: 80, y: 40, w: 1280, h: 800 },
    controls: [
      { name: 'btnExport', type: 'Button', rect: { x: 500, y: 200, w: 88, h: 28 }, rel: { x: 420, y: 160, w: 88, h: 28 } },
      { name: 'btnLegacy', type: 'Button', rect: { x: 700, y: 300, w: 60, h: 24 } }, // 只有绝对坐标
    ],
    capturedAt: '2026-11-10T10:00:00.000Z',
  })
  store.saveGuidePreset('ensp::ensp 主窗口', { coord: 'window', x: 10, y: 12, w: 64, h: 40, uses: 3 })
  store.addSoftwareNote('eNSP', 'pitfall', '启动设备失败，错误代码 40')
  store.addSoftwareNote('eNSP', 'where', '导出在 btnExport 按钮')

  const data = kb.rebuild('eNSP')
  const exp = data.controls.find((c) => c.name === 'btnExport')
  assert.ok(exp, 'btnExport 应被导入')
  assert.deepEqual(exp.rect, { x: 420, y: 160, w: 88, h: 28 }, '必须用 rel，不能用 rect.x=500')
  assert.equal(exp.source, 'uia')
  assert.deepEqual(exp.windowSize, { w: 1280, h: 800 })
  assert.ok(exp.versionSeen.includes('1.3.00.100'))
  const legacy = data.controls.find((c) => c.name === 'btnLegacy')
  assert.equal(legacy.rect, null, '只有绝对坐标时不得编造相对位置')
  assert.equal(legacy.needsRevalidate, true)
  assert.ok(data.controls.some((c) => c.name === '__window__'), '旧窗口级 preset 应保留为匿名条目')
  assert.ok(data.controls.find((c) => c.name === 'btnExport').purpose.includes('导出'))

  const knowledge = kb.knowledgeFor({ software: 'eNSP' })
  assert.ok(knowledge.pitfalls.some((x) => x.includes('代码 40')))
  assert.ok(knowledge.brief.includes('eNSP'))
})

test('兼容：旧版把窗口标题当软件名的 preset 仍能复用，不会因 software 推断而丢失', () => {
  const { store, kb } = fresh('legacy-preset')
  store.saveGuidePreset('ensp 主窗口::ensp 主窗口', {
    coord: 'window', x: 77, y: 88, w: 100, h: 40, pad: 20,
    software: '', title: 'eNSP 主窗口', uses: 4,
  })
  const hit = kb.findWindowPreset('eNSP', 'eNSP 主窗口')
  assert.ok(hit, '旧键格式也该被导入 interface')
  assert.equal(hit.x, 77)
  assert.equal(hit.pad, 20)
  assert.ok(hit.uses >= 1, '导入时应保留历史使用次数')
  const data = kb.getInterface('eNSP')
  assert.ok(data.controls.some((c) => c.name === '__window__'))
})

test('usedSource：UIA 实时 / 同版本历史 / 版本漂移 / 窗口尺寸变化 四态可区分', () => {
  const { home, kb } = fresh('sources')
  pageMap(home, {
    software: 'Weka', version: '3.8.7', windowTitle: 'Weka',
    windowRect: { x: 0, y: 0, w: 1280, h: 800 },
    controls: [{ name: 'btnStart', type: 'Button', rel: { x: 200, y: 120, w: 80, h: 28 } }],
    capturedAt: '2026-11-10T10:00:00.000Z',
  })
  const live = kb.findControl({ software: 'Weka', controlName: 'btnStart', version: '3.8.7', windowSize: { w: 1280, h: 800 } })
  assert.equal(live.usedSource, 'interface-live')
  assert.equal(live.preferLive, true)

  // 改成人工记录（非 UIA）→ 走历史坐标
  kb.upsertControl('Weka', {
    controlName: 'btnManual', window: 'Weka', rect: { x: 300, y: 140, w: 80, h: 28 },
    windowSize: { w: 1280, h: 800 }, source: 'manual', version: '3.8.7',
  })
  const history = kb.findControl({ software: 'Weka', controlName: 'btnManual', version: '3.8.7', windowSize: { w: 1280, h: 800 } })
  assert.equal(history.usedSource, 'interface-history')
  assert.equal(history.preferLive, false)
  assert.deepEqual(history.rect, { x: 300, y: 140, w: 80, h: 28 })

  const drift = kb.findControl({ software: 'Weka', controlName: 'btnManual', version: '3.9.0', windowSize: { w: 1280, h: 800 } })
  assert.equal(drift.usedSource, 'interface-drift')
  assert.equal(drift.versionDrift, true)

  const resized = kb.findControl({ software: 'Weka', controlName: 'btnManual', version: '3.8.7', windowSize: { w: 1920, h: 1080 } })
  assert.equal(resized.usedSource, 'interface-drift')
  assert.equal(resized.sizeMismatch, true, '窗口尺寸变了不能套旧坐标')
})

test('经验前置：experiment_create 带 brief，experiment_get 带限流后的 knowledge', () => {
  const { store, kb, core } = fresh('inject')
  for (let i = 0; i < 12; i++) {
    kb.upsertControl('eNSP', {
      controlName: `btn${i}`, window: '主窗口', rect: { x: i * 20, y: 30, w: 60, h: 24 },
      windowSize: { w: 1280, h: 800 }, source: 'manual',
    })
  }
  for (let i = 0; i < 9; i++) store.addSoftwareNote('eNSP', 'pitfall', `第 ${i} 个坑`)
  const created = core.experimentCreate({ title: '静态路由', software: 'eNSP', course: '计算机网络' })
  assert.equal(created.ok, true)
  assert.ok(created.knowledge && created.knowledge.brief.includes('eNSP'))

  const got = core.experimentGet({ id: created.experiment.id })
  assert.equal(got.ok, true)
  assert.ok(got.knowledge)
  assert.equal(got.knowledge.controls.length, KNOWLEDGE_LIMITS.controls, '控件必须硬限流')
  assert.ok(got.knowledge.pitfalls.length <= KNOWLEDGE_LIMITS.pitfalls)
  assert.equal(got.knowledge.failures.length, 0)
})

test('note_add 带 controlName + rect 会把文本经验升级成可执行控件条目', () => {
  const { core, kb } = fresh('noteadd')
  const result = core.noteAdd({
    software: 'eNSP', kind: 'where', text: '导出拓扑在工具栏',
    controlName: 'btnExport', window: 'eNSP 主窗口',
    rect: { x: 420, y: 96, w: 88, h: 28 }, windowSize: { w: 1280, h: 800 },
  })
  assert.equal(result.ok, true)
  assert.equal(result.executable, true)
  assert.equal(result.control.name, 'btnExport')
  const hit = kb.findControl({ software: 'eNSP', controlName: 'btnExport', windowSize: { w: 1280, h: 800 } })
  assert.ok(hit)
  assert.equal(hit.rect.x, 420)

  const plain = core.noteAdd({ software: 'eNSP', kind: 'tip', text: '记得先保存' })
  assert.equal(plain.ok, true)
  assert.equal(plain.control, null, '不带 controlName 时保持旧行为')
})

test('L2 自动录制 + clone 复制动作摘要（只带位置，不带点击回放）', async () => {
  const { store, kb, core } = fresh('actions')
  const exp = store.createExperiment({ title: '网络实验', software: 'eNSP', steps: [{ title: '导出配置' }] })
  const stepId = exp.steps[0].id
  core.experimentGet({ id: exp.id })
  kb.recordAction(exp.id, { action: 'guide', stepId, software: 'eNSP', window: '主窗口', controlName: 'btnExport', source: 'interface-history', ok: true })
  kb.recordAction(exp.id, { action: 'click', stepId, software: 'eNSP', rect: { x: 420, y: 96, w: 1, h: 1 }, ok: true })
  const summary = kb.actionSummary(exp.id, stepId)
  assert.equal(summary.length, 1, '摘要只收 guide，不收 click')
  assert.equal(summary[0].controlName, 'btnExport')
  assert.ok(!Object.hasOwn(summary[0], 'rect'), '摘要不得携带可回放坐标')
  assert.ok(!Object.hasOwn(summary[0], 'action'))

  const after = await core.experimentRecordResult({ id: exp.id, stepId, actual: '导出成功', passed: true })
  assert.ok(after.ok)
  assert.equal(after.experiment.steps[0].actions.length, 1)
  const cloned = core.experimentClone({ sourceId: exp.id })
  assert.equal(cloned.experiment.steps[0].actions.length, 1, 'clone 必须复制动作摘要')
  assert.equal(cloned.experiment.steps[0].actual, '', '但实测结果必须清空')
})

test('L4 失败反例：record_result(passed:false) 自动落库并在 knowledge 里排前面', async () => {
  const { store, kb, core } = fresh('failures')
  const exp = store.createExperiment({ title: '启动设备', software: 'eNSP', steps: [{ title: '启动 AR1' }] })
  await core.experimentRecordResult({
    id: exp.id, title: '启动 AR1', actual: '启动设备失败，错误代码 40',
    passed: false, controlName: 'btnStart', evidence: ['screenshots/01.png'],
  })
  const rows = kb.failuresFor('eNSP')
  assert.equal(rows.length, 1)
  assert.match(rows[0].error, /错误代码 40/)
  assert.equal(rows[0].controlName, 'btnStart')
  const knowledge = kb.knowledgeFor({ software: 'eNSP', stepId: exp.steps[0].id })
  assert.equal(knowledge.failures.length, 1)
  assert.ok(knowledge.brief.includes('失败'))
})

test('L4 排序：同一步的失败会被顶到最前，新失败不能把老坑挤掉', () => {
  const { kb } = fresh('failure-sort')
  kb.recordFailure('Weka', { stepId: 'step-2', error: '当前步骤挂了' })
  kb.recordFailure('Weka', { stepId: 'step-9', error: '别的步骤挂了' })
  const knowledge = kb.knowledgeFor({ software: 'Weka', stepId: 'step-2' })
  assert.equal(knowledge.failures.length, 2)
  assert.equal(knowledge.failures[0].stepId, 'step-2', '同一步的失败必须排第一')
})

test('L6 热区：bumpUsage 累计，rebuildUsage 能从 actions 全量重建', () => {
  const { kb } = fresh('usage')
  kb.bumpUsage('Weka', 'weka::main::btnstart', true)
  kb.bumpUsage('Weka', 'weka::main::btnstart', false)
  const hot = kb.usageFor('Weka')
  assert.equal(hot[0].hits, 2)
  assert.equal(hot[0].ok, 1)
  assert.equal(hot[0].fail, 1)
  kb.recordAction('exp-x', { action: 'guide', software: 'Weka', window: 'main', controlName: 'btnOther', ok: true })
  const all = kb.rebuildUsage('Weka')
  assert.ok(Object.keys(all).some((k) => k.includes('btnother')))
})

test('隐私总开关：off 后所有自动采集静默跳过，on 后恢复', () => {
  const { store, kb } = fresh('privacy')
  kb.recordAction('exp-a', { action: 'guide', software: 'eNSP', controlName: 'btnA', ok: true })
  assert.equal(kb.actionsFor('exp-a').length, 1)
  assert.equal(store.updateSettings({ autoCapture: false }).autoCapture, false)
  kb.recordAction('exp-a', { action: 'guide', software: 'eNSP', controlName: 'btnB', ok: true })
  kb.recordFailure('eNSP', { error: 'x' })
  kb.bumpUsage('eNSP', 'k', true)
  assert.equal(kb.actionsFor('exp-a').length, 1, 'off 后不应再写动作')
  assert.equal(kb.failuresFor('eNSP').length, 0)
  assert.equal(kb.dataInventory().autoCapture, false)
  store.updateSettings({ autoCapture: true })
  kb.recordAction('exp-a', { action: 'guide', software: 'eNSP', controlName: 'btnC', ok: true })
  assert.equal(kb.actionsFor('exp-a').length, 2)
})

test('L5 报告片段：禁止携带数值，产出带「不得标已核对」提示', async () => {
  const { core, kb, store } = fresh('fragments')
  const bad = core.reportFragmentAdd({ course: '计算机网络', section: '结果分析', pattern: '延迟为 12ms，丢包率 3%' })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /数值/)
  const good = core.reportFragmentAdd({ course: '计算机网络', section: '结果分析', pattern: '本实验通过对比配置前后的连通性，观察到预期变化，说明该配置生效。' })
  assert.equal(good.ok, true)
  const hints = kb.fragmentHints('计算机网络', ['结果分析', '实验总结'])
  assert.equal(hints.length, 1)
  assert.ok(hints[0].note.includes('不得标记为已核对'))
  assert.ok(!/\d/.test(hints[0].pattern), '骨架里不能出现任何数字')

  const exp = store.createExperiment({ title: '静态路由', course: '计算机网络', software: 'eNSP', steps: [{ title: '配置路由', actual: 'ping 通', passed: true }] })
  const generated = await core.reportGenerate({ experimentId: exp.id, useBuiltin: true })
  assert.equal(generated.ok, true)
  assert.ok(generated.fragmentHints.length >= 1)
  const handoff = readFileSync(generated.handoff, 'utf8')
  assert.match(handoff, /界面地图/)
  assert.match(handoff, /报告句式骨架/)
  assert.doesNotMatch(handoff, /延迟为 12ms/, '被拒绝的含数值片段不得进入交接单')
  assert.match(handoff, /禁止直接复制/)
  // 硬约束：片段只给 agent 改写参考，绝不能自动写进报告正文（防「抄自己」）
  const markdown = readFileSync(generated.files.markdown, 'utf8')
  assert.doesNotMatch(markdown, /观察到预期变化/, '句式骨架不得自动进正文')
  assert.doesNotMatch(markdown, /本实验通过对比配置前后/, '正文不得复用上次写法')
})

test('knowledge_settings：status / off / rebuild / rebuild-usage 都可调用', () => {
  const { core, home, kb } = fresh('settings')
  pageMap(home, {
    software: 'eNSP', version: '1.3', windowTitle: 'eNSP',
    windowRect: { w: 1280, h: 800 },
    controls: [{ name: 'btnA', rel: { x: 10, y: 20, w: 60, h: 24 } }],
    capturedAt: '2026-11-10T10:00:00.000Z',
  })
  const status = core.knowledgeSettings({})
  assert.equal(status.ok, true)
  assert.ok(status.dirs.interface.includes('interface'))
  assert.equal(core.knowledgeSettings({ action: 'off' }).autoCapture, false)
  core.knowledgeSettings({ action: 'on' })
  const rebuilt = core.knowledgeSettings({ action: 'rebuild', software: 'eNSP' })
  assert.equal(rebuilt.ok, true)
  assert.equal(rebuilt.controlCount, 1)
  kb.recordAction('exp-u', { action: 'guide', software: 'eNSP', window: 'eNSP', controlName: 'btnA', ok: true })
  assert.equal(core.knowledgeSettings({ action: 'rebuild-usage', software: 'eNSP' }).controls, 1)
  assert.equal(core.knowledgeSettings({ action: 'nope' }).ok, false)
})

test('B2 补强：agent 不传 software 时按当前实验推断，显式空串仍写课程通用', () => {
  const { core, kb, store } = fresh('fragments-infer')
  const exp = store.createExperiment({ title: '静态路由', course: '计算机网络', software: 'eNSP' })
  store.setCurrentExperiment(exp.id)

  const auto = core.reportFragmentAdd({
    course: '计算机网络', section: '结果分析', pattern: '结合设备状态表说明配置是否生效。',
  })
  assert.equal(auto.ok, true)
  assert.equal(auto.software, 'eNSP', '缺省必须归属当前实验软件，否则细分静默失效')
  assert.equal(auto.inferredSoftware, true)
  assert.equal(kb.fragmentHints('计算机网络', ['结果分析'], 'eNSP')[0].scope, 'software')
  assert.equal(kb.fragmentHints('计算机网络', ['结果分析'], 'Wireshark').length, 0, '专属片段不得串到别的软件')

  const common = core.reportFragmentAdd({
    course: '计算机网络', software: '', section: '实验总结', pattern: '归纳实验现象并说明结论适用范围。',
  })
  assert.equal(common.software, '', '显式空串是写跨软件通用骨架的退路')
  assert.equal(common.inferredSoftware, false)
  assert.ok(kb.fragmentHints('计算机网络', ['实验总结'], 'Wireshark').some((x) => x.scope === 'course'))
})

test('B1 归档压缩：明细→摘要、原文件保留、gzip 可还原、热区不双计不漏计', () => {
  const { core, kb, store } = fresh('archive')
  const exp = store.createExperiment({ title: '静态路由', course: '计算机网络', software: 'eNSP', steps: [{ title: '配置路由' }] })
  const id = exp.id
  for (let i = 0; i < 5; i += 1) {
    kb.recordAction(id, { action: 'guide', software: 'eNSP', window: 'eNSP', controlName: 'btnExport', stepId: 's1', ok: i !== 2, source: 'interface-live' })
  }
  for (let i = 0; i < 3; i += 1) {
    kb.recordAction(id, { action: 'shot', software: 'eNSP', window: 'eNSP', controlName: 'btnStart', stepId: 's2', ok: true, source: 'interface-history' })
  }
  const srcFile = kb.pathOf('actions', id)
  const before = kb.rebuildUsage('eNSP')
  assert.equal(before['ensp::ensp::btnexport'].hits, 5)
  assert.equal(before['ensp::ensp::btnexport'].fail, 1)
  assert.equal(before['ensp::ensp::btnstart'].hits, 3)

  const updated = core.experimentUpdate({ id, status: 'archived' })
  assert.equal(updated.experiment.status, 'archived')
  assert.equal(updated.archived.lines, 8)
  assert.equal(updated.archived.controls, 2)
  assert.equal(updated.archived.steps, 2)

  const summary = JSON.parse(readFileSync(updated.archived.summary, 'utf8'))
  assert.equal(summary.sourceLines, 8)
  assert.equal(summary.software, 'eNSP')
  assert.equal(summary.byControl.find((c) => c.controlName === 'btnExport').hits, 5)
  // 摘要只留「指过哪里」的提示，绝不存坐标或可回放的点击序列
  for (const step of summary.steps) {
    for (const a of step.actions) {
      assert.ok(!('x' in a) && !('y' in a) && !('rect' in a) && !('count' in a))
    }
  }
  // 原始明细完整保留，gzip 只是额外副本且能无损还原
  assert.ok(existsSync(srcFile), '归档不得删除原始 jsonl')
  const raw = readFileSync(srcFile, 'utf8')
  assert.equal(raw.trim().split('\n').length, 8)
  const gz = `${srcFile}.gz`
  assert.ok(existsSync(gz))
  assert.equal(gunzipSync(readFileSync(gz)).toString('utf8'), raw)

  // 归档后重建热区：既不能把摘要和明细重复计一遍，也不能漏掉归档后新增的动作
  assert.deepEqual(kb.rebuildUsage('eNSP'), before)
  kb.recordAction(id, { action: 'guide', software: 'eNSP', window: 'eNSP', controlName: 'btnExport', stepId: 's3', ok: false })
  const after = kb.rebuildUsage('eNSP')
  assert.equal(after['ensp::ensp::btnexport'].hits, 6, '归档后新增的尾部明细必须计入')
  assert.equal(after['ensp::ensp::btnexport'].fail, 2)

  // 重复归档可刷新摘要（归档后补记动作也能重新压缩），且普通 update 不触发
  const again = core.experimentUpdate({ id, status: 'archived' })
  assert.equal(again.archived.lines, 9)
  const plain = core.experimentUpdate({ id, notes: '补一句备注' })
  assert.equal(plain.archived, undefined)
})

test('B2 片段按软件细分：同课不同软件不串、专属优先、通用兜底、边界不变', async () => {
  const { core, kb, store } = fresh('fragments-software')
  assert.equal(core.reportFragmentAdd({ course: '计算机网络', section: '结果分析', pattern: '通用骨架：通过对比说明变化。' }).ok, true)
  assert.equal(core.reportFragmentAdd({ course: '计算机网络', software: 'eNSP', section: '结果分析', pattern: 'eNSP骨架：结合设备状态表说明配置生效。' }).ok, true)
  assert.equal(core.reportFragmentAdd({ course: '计算机网络', software: 'Wireshark', section: '结果分析', pattern: 'Wireshark骨架：结合抓包字段说明报文特征。' }).ok, true)

  const hEnsp = kb.fragmentHints('计算机网络', ['结果分析'], 'eNSP')
  assert.equal(hEnsp.length, 1, '同章节只给一条，专属优先')
  assert.equal(hEnsp[0].scope, 'software')
  assert.match(hEnsp[0].pattern, /eNSP/)
  const hWire = kb.fragmentHints('计算机网络', ['结果分析'], 'Wireshark')
  assert.match(hWire[0].pattern, /Wireshark/)
  assert.doesNotMatch(hWire[0].pattern, /eNSP/)
  const hOther = kb.fragmentHints('计算机网络', ['结果分析'], 'LTspice')
  assert.equal(hOther[0].scope, 'course', '没有专属片段时回落到课程通用')
  assert.equal(kb.fragmentHints('计算机网络', ['结果分析']).length, 1, '旧的两参调用保持兼容')

  const bad = core.reportFragmentAdd({ course: '计算机网络', software: 'eNSP', section: '结果分析', pattern: '延迟 12ms' })
  assert.equal(bad.ok, false, '按软件细分不得放宽「禁止数值」约束')

  const exp = store.createExperiment({ title: '静态路由', course: '计算机网络', software: 'eNSP', steps: [{ title: '配置路由', actual: 'ping 通', passed: true }] })
  const generated = await core.reportGenerate({ experimentId: exp.id, useBuiltin: true })
  assert.equal(generated.ok, true)
  assert.equal(generated.fragmentHints[0].scope, 'software')
  assert.match(generated.fragmentHints[0].note, /不得标记为已核对/)
  const handoff = readFileSync(generated.handoff, 'utf8')
  assert.match(handoff, /本软件 eNSP/, '交接单要标出片段来源')
  assert.match(handoff, /禁止直接复制/)
  const markdown = readFileSync(generated.files.markdown, 'utf8')
  assert.doesNotMatch(markdown, /eNSP骨架/, '按软件细分后仍绝不自动进正文')
  assert.doesNotMatch(markdown, /通用骨架/)
})
