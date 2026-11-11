import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { ExperimentStore } from '../lib/store.mjs'

const ROOT = join(process.cwd(), 'test-output', `store-${process.pid}`)

test.before(() => {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(ROOT, { recursive: true })
})

test.after(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

test('默认称呼为主人，并保存在本地设置中', () => {
  const store = new ExperimentStore(join(ROOT, 'settings'))
  assert.equal(store.getSettings().displayName, '主人')
  const next = store.updateSettings({ displayName: '  同学  ', petSize: 9999 })
  assert.equal(next.displayName, '同学')
  assert.equal(next.petSize, 260)
  assert.equal(store.getSettings().displayName, '同学')
})

test('新建实验会建立独立目录、清单和证据子目录', () => {
  const store = new ExperimentStore(join(ROOT, 'create'))
  const experiment = store.createExperiment({
    title: '计算机网络实验三：静态路由',
    course: '计算机网络',
    mode: 'guided',
  })
  assert.match(experiment.id, /^exp-\d{8}-\d{6}-[a-z0-9]{4}$/)
  assert.equal(experiment.status, 'active')
  assert.equal(experiment.mode, 'guided')
  assert.equal(experiment.currentStep, 0)
  assert.ok(existsSync(join(experiment.workDir, 'screenshots')))
  assert.ok(existsSync(join(experiment.workDir, 'reports')))
  assert.deepEqual(JSON.parse(readFileSync(join(experiment.workDir, 'experiment.json'), 'utf8')), experiment)
})

test('历史实验可列出、搜索、读取和更新', () => {
  const store = new ExperimentStore(join(ROOT, 'history'))
  const first = store.createExperiment({ title: 'Weka 分类实验', software: 'Weka' })
  const second = store.createExperiment({ title: 'eNSP 静态路由', software: 'eNSP' })

  assert.equal(store.listExperiments().length, 2)
  assert.equal(store.listExperiments({ query: '静态' })[0].id, second.id)
  assert.equal(store.listExperiments({ status: 'active' }).length, 2)

  const updated = store.updateExperiment(first.id, {
    status: 'paused',
    currentStep: 7,
    steps: [
      { title: '准备数据', status: 'done' },
      { title: '训练模型', status: 'active' },
    ],
    title: 'Weka 分类实验（修正版）',
  })
  assert.equal(updated.status, 'paused')
  assert.equal(updated.currentStep, 1)
  assert.equal(updated.title, 'Weka 分类实验（修正版）')
  assert.equal(store.getExperiment(first.id).steps.length, 2)
})

test('非法实验编号被拒绝', () => {
  const store = new ExperimentStore(join(ROOT, 'invalid'))
  assert.throws(() => store.getExperiment('../../settings'), /无效的实验编号/)
})

test('步骤可记录实测值与是否通过，重复记录会合并证据', () => {
  const store = new ExperimentStore(join(ROOT, 'results'))
  const experiment = store.createExperiment({
    title: '静态路由',
    steps: [{ title: '搭建拓扑', expected: '设备全部绿色' }],
  })
  const updated = store.recordStepResult(experiment.id, {
    title: '搭建拓扑',
    actual: '设备全部绿色，接口 up',
    passed: true,
    evidence: ['screenshots/01-topology.png'],
  })
  assert.equal(updated.steps[0].actual, '设备全部绿色，接口 up')
  assert.equal(updated.steps[0].passed, true)
  assert.equal(updated.steps[0].status, 'done')
  assert.deepEqual(updated.steps[0].evidence, ['screenshots/01-topology.png'])

  const again = store.recordStepResult(experiment.id, {
    stepId: updated.steps[0].id,
    actual: '设备全部绿色，接口 up',
    passed: true,
    evidence: ['data/ping.txt', 'screenshots/01-topology.png'],
  })
  assert.deepEqual(again.steps[0].evidence, ['screenshots/01-topology.png', 'data/ping.txt'])
  // 0.15.26 起：面板建的实验没有步骤，给标题就自动补一条，不再直接抛错
  const appended = store.recordStepResult(experiment.id, { title: '新补的步骤', actual: '现场记录' })
  assert.equal(appended.steps.length, 2)
  assert.equal(appended.steps[1].title, '新补的步骤')
  assert.equal(appended.steps[1].actual, '现场记录')
  // 连标题都不给才报错
  assert.throws(() => store.recordStepResult(experiment.id, { actual: 'x' }), /需要 stepId 或步骤标题/)
})
