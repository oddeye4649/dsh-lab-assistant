import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

// 自检环境禁用桌面伴随进程，保证结果确定性；真实行为由 dsh-integration 与用户机器验证。
process.env.DSH_LAB_OVERLAY = '0'

const HOME = join(process.cwd(), 'test-output', `selfcheck-${process.pid}`)
const root = {}

function fakeCtx(home) {
  const tools = []
  const routes = []
  const injections = []
  let tap = null
  const ctx = {
    get(key) {
      if (key === 'dshHomePath') return (...parts) => join(home, ...parts)
      return undefined
    },
    tools: { register: (tool) => { tools.push(tool); return tool } },
    webServer: {
      register: (route) => { routes.push(route); return () => {} },
      tapIndex: (fn) => { tap = fn; return () => {} },
    },
    effect(fn) { return fn() },
    inject(_services, cb) { cb(ctx) },
    on(event, handler) { if (event === 'webserver/index-inject') injections.push(handler) },
  }
  return { ctx, tools, routes, injections, get tap() { return tap } }
}

test.before(async () => {
  rmSync(HOME, { recursive: true, force: true })
  mkdirSync(HOME, { recursive: true })
  const mod = await import('../index.js')
  const fake = fakeCtx(HOME)
  root.mod = mod
  root.fake = fake
  mod.default.apply(fake.ctx, { displayName: '主人', petSize: 160 })
  assert.equal(fake.routes.length, 1)
  assert.equal(fake.tools.length, 1)
})

test.after(() => {
  rmSync(HOME, { recursive: true, force: true })
})

test('注册了 DSH 工具、注入行和桌宠静态入口', () => {
  const { fake, mod } = root
  assert.equal(mod.name, 'lab-assistant')
  const names = fake.tools.map((tool) => tool.name).sort()
  assert.deepEqual(names, ['lab_assistant'])
  // 桌宠只在桌面伴随进程里，网页不再注入任何脚本
  assert.equal(fake.injections.length, 0)
  assert.equal(fake.tap, null)
})

test('API 可从本机读取状态、设置与实验档案', async () => {
  const { fake } = root
  const route = fake.routes[0]
  const server = http.createServer((req, res) => route.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  try {
    const status = await fetch(`${base}/dsh-lab/api/status`).then((x) => x.json())
    assert.equal(status.ok, true)
    assert.equal(status.plugin, 'dsh-lab-assistant')
    assert.equal(status.settings.displayName, '主人')
    assert.ok(status.catalog.software >= 60)

    const catalog = await fetch(`${base}/dsh-lab/api/catalog?discipline=electronics`).then((x) => x.json())
    assert.equal(catalog.ok, true)
    assert.ok(catalog.software.length >= 5)
    assert.ok(catalog.software.every((item) => item.disciplines.includes('electronics')))

    const advice = await fetch(`${base}/dsh-lab/api/advise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ software: 'ensp', currentlyWorking: true }),
    }).then((x) => x.json())
    assert.equal(advice.ok, true)
    assert.ok(advice.recommendation)
    assert.ok(['keep-current', 'propose-profile', 'diagnose-only'].includes(advice.recommendation.action))

    const repair = await fetch(`${base}/dsh-lab/api/repair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ software: 'ensp', symptom: '启动设备失败，错误代码 40' }),
    }).then((x) => x.json())
    assert.equal(repair.ok, true)
    assert.equal(repair.symptom.matched, 'ensp-device-start-fail')
    assert.ok(repair.candidates.length >= 1)
    assert.equal(repair.policy.autoInstall, false)

    const recorded = await fetch(`${base}/dsh-lab/api/repair/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ software: 'ensp', component: 'virtualization', name: 'Oracle VirtualBox', version: '7.2.22', outcome: 'worked' }),
    }).then((x) => x.json())
    assert.equal(recorded.ok, true)
    assert.equal(recorded.entry.outcome, 'worked')

    const created = await fetch(`${base}/dsh-lab/api/experiments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '网络实验',
        course: '计算机网络',
        mode: 'mixed',
        steps: [{ title: '搭建拓扑', instruction: '拖入两台路由器', expected: '设备全部绿色' }],
      }),
    }).then((x) => x.json())
    assert.equal(created.ok, true)
    assert.equal(created.experiment.title, '网络实验')

    const list = await fetch(`${base}/dsh-lab/api/experiments`).then((x) => x.json())
    assert.equal(list.experiments.length, 1)
    assert.equal(list.experiments[0].title, '网络实验')

    const recordedResult = await fetch(`${base}/dsh-lab/api/experiments/${created.experiment.id}/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '搭建拓扑', actual: '设备全部绿色，接口 up', passed: true }),
    }).then((x) => x.json())
    assert.equal(recordedResult.ok, true)
    assert.equal(recordedResult.experiment.steps[0].actual, '设备全部绿色，接口 up')
    assert.equal(recordedResult.experiment.steps[0].passed, true)

    const generated = await fetch(`${base}/dsh-lab/api/report/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ experimentId: created.experiment.id, studentName: '张三', studentId: '20260001' }),
    }).then((x) => x.json())
    assert.equal(generated.ok, true)
    assert.ok(generated.files.docx.endsWith('.docx'))
    assert.equal(existsSync(generated.files.docx), true)
    assert.equal(existsSync(generated.files.markdown), true)
    assert.ok(generated.placeholderCount >= 0)
    const markdownText = readFileSync(generated.files.markdown, 'utf8')
    assert.match(markdownText, /实际：设备全部绿色，接口 up/)

    const settings = await fetch(`${base}/dsh-lab/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: '同学' }),
    }).then((x) => x.json())
    assert.equal(settings.settings.displayName, '同学')

    const call = (action, args) => fake.tools[0].execute({ action, args })
    const desktopStatus = await call('desktop_status')
    assert.equal(desktopStatus.ok, true)
    assert.equal(desktopStatus.running, false)
    const pageMapList = await call('page_map_list')
    assert.equal(pageMapList.ok, true)
    assert.deepEqual(pageMapList.maps, [])
    const desktopPet = await call('desktop_pet', { action: 'move', x: 100, y: 100 })
    assert.equal(desktopPet.ok, false)
    assert.match(desktopPet.error, /桌面伴随进程不可用/)

    const desktopVisible = await fetch(`${base}/dsh-lab/api/desktop/visible`).then((x) => x.json())
    assert.equal(desktopVisible.ok, true)
    assert.equal(desktopVisible.running, false)

    const pet = await fetch(`${base}/dsh-lab/pet.js`)
    assert.equal(pet.status, 404, '网页桌宠已下线，pet.js 不应再被提供')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('跨站请求被拒绝', async () => {
  const { fake } = root
  const route = fake.routes[0]
  const server = http.createServer((req, res) => route.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const response = await fetch(`http://127.0.0.1:${port}/dsh-lab/api/status`, {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    })
    assert.equal(response.status, 403)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
