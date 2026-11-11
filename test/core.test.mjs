import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ExperimentStore } from '../lib/store.mjs'
import { createCore } from '../lib/core.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function makeCore() {
  const home = mkdtempSync(join(tmpdir(), 'lab-core-'))
  const store = new ExperimentStore(home)
  const core = createCore({ store, version: '0.0.0-test', assetsRoot: join(ROOT, 'assets'), hostNotes: ['test'] })
  return { home, store, core }
}

test('core: workflow / status / catalog 不依赖 DSH', async () => {
  const { home, core } = makeCore()
  try {
    const workflow = core.workflow()
    assert.equal(workflow.ok, true)
    assert.match(workflow.workflow, /confirm|确认模板|实验报告模板/)

    const status = core.status()
    assert.equal(status.ok, true)
    assert.equal(status.plugin, 'dsh-lab-assistant')
    assert.equal(status.version, '0.0.0-test')
    assert.equal(status.assets.frames.swim, 8)
    assert.equal(status.assets.states['swim.png'], true)

    const catalog = core.softwareCatalog({ query: 'eNSP' })
    assert.equal(catalog.ok, true)
    assert.ok(Array.isArray(catalog.software))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('core: 实验档案 CRUD 与克隆', async () => {
  const { home, core } = makeCore()
  try {
    const created = core.experimentCreate({ title: '计算机网络实验三', course: '计算机网络', software: 'eNSP' })
    assert.equal(created.ok, true)
    assert.equal(created.isCurrent, true)

    const id = created.experiment.id
    const list = core.experimentList({})
    assert.equal(list.experiments.length, 1)

    const got = core.experimentGet({ id })
    assert.equal(got.experiment.title, '计算机网络实验三')

    const updated = core.experimentUpdate({ id, patch: { status: 'paused' } })
    assert.equal(updated.experiment.status, 'paused')

    const cloned = core.experimentClone({ sourceId: id, title: '实验四' })
    assert.equal(cloned.ok, true)
    assert.notEqual(cloned.experiment.id, id)
    assert.equal(cloned.experiment.title, '实验四')

    assert.deepEqual(core.experimentDelete({ experimentId: id, confirm: false }).ok, false)
    assert.equal(core.experimentDelete({ experimentId: id, confirm: true }).ok, true)
    assert.equal(core.experimentList({}).experiments.length, 1)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('core: pageMapList 空目录返回空数组', async () => {
  const { home, core } = makeCore()
  try {
    assert.deepEqual(core.pageMapList('').maps, [])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('core: 面板绑定的模板必须真的被用上，不能静默套内置模板', async () => {
  const { home, core } = makeCore()
  try {
    const tplFile = join(home, 'teacher.md')
    writeFileSync(tplFile, '# 一、实验目的\n\n写目的\n\n# 二、实验记录\n\n| 项目 | 值 |\n| --- | --- |\n| 电压 |  |\n', 'utf8')

    const tpl = core.reportTemplate({ path: tplFile })
    assert.equal(tpl.ok, true)
    const titles = tpl.template.sections.map((s) => s.title)
    assert.deepEqual(titles, ['一、实验目的', '二、实验记录'])

    // 面板 CreateExperiment 写的是 reportTemplate（值是模板库里的 ID）
    const exp = core.experimentCreate({
      title: '模板绑定验证', course: '计算机网络', software: 'eNSP',
      reportTemplate: tpl.template.id,
    })
    assert.equal(exp.experiment.templateId, tpl.template.id, 'reportTemplate 与 templateId 应互为别名')

    // 会话里只给 experimentId，也必须用上老师模板
    const plan = await core.reportPlan({ experimentId: exp.experiment.id })
    assert.equal(plan.templateMissing, false)
    assert.deepEqual(plan.sections.map((s) => s.title), titles, '章节应来自老师模板，而不是内置通用结构')

    // 模板被删掉之后不能假装还有模板
    core.reportTemplate({ deleteId: tpl.template.id })
    const after = await core.reportPlan({ experimentId: exp.experiment.id })
    assert.equal(after.templateMissing, true)
    const generated = await core.reportGenerate({ experimentId: exp.experiment.id })
    assert.equal(generated.needTemplate, true)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
