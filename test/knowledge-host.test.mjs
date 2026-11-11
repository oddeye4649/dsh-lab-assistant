import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { syntheticPng, matchAnchor } from '../lib/anchor.mjs'

// 与 selfcheck 一样禁用桌面伴随进程：定位/查询逻辑照常跑，只有 /guide 本身返回不可用。
process.env.DSH_LAB_OVERLAY = '0'

const HOME = join(process.cwd(), 'test-output', `knowledge-host-${process.pid}`)
const state = {}

function fakeCtx(home) {
  const tools = [], routes = [], injections = []
  let tap = null
  const ctx = {
    get(key) { return key === 'dshHomePath' ? (...parts) => join(home, ...parts) : undefined },
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
  state.mod = mod
  state.fake = fake
  mod.default.apply(fake.ctx, { displayName: '主人', petSize: 160 })
})

test.after(() => rmSync(HOME, { recursive: true, force: true }))

const call = (action, args = {}) => state.fake.tools[0].execute({ action, args })
const homeDir = () => join(HOME, 'lab-assistant')
const button = (x, y) => (px, py) => {
  const dx = px - x, dy = py - y
  if (dx >= 0 && dx < 80 && dy >= 0 && dy < 34) {
    if (dx < 3 || dy < 3 || dx > 76 || dy > 30) return 30
    return (dx % 7 < 3) ? 60 : 190
  }
  return 235
}

test('合并入口只注册一个工具，新的经验工具都在 action 清单里', () => {
  assert.equal(state.fake.tools.length, 1)
  const doc = state.fake.tools[0].description || ''
  for (const name of ['knowledge_query', 'knowledge_settings', 'report_fragment_add', 'anchor_capture', 'anchor_locate']) {
    assert.ok(doc.includes(name), `ACTION_DOC 缺少 ${name}`)
  }
})

test('experience 前置：create / get 都自动带 knowledge，不必 agent 主动调 note_list', async () => {
  const created = await call('note_add', {
    software: 'eNSP', kind: 'where', text: '导出拓扑在工具栏第三个按钮',
    controlName: 'btnExport', window: 'eNSP 主窗口',
    rect: { x: 420, y: 96, w: 88, h: 28 }, windowSize: { w: 1280, h: 800 },
  })
  assert.equal(created.ok, true)
  assert.equal(created.executable, true)

  // 模拟 desktop_place 成功后登记的窗口尺寸（真实环境由 place 写）
  const interfaceDir = join(homeDir(), 'interface')
  mkdirSync(interfaceDir, { recursive: true })
  writeFileSync(join(interfaceDir, '_windows.json'), `${JSON.stringify({ ensp: { w: 1280, h: 800 } })}\n`, 'utf8')

  const exp = await call('experiment_create', { title: '静态路由', course: '计算机网络', software: 'eNSP' })
  assert.equal(exp.ok, true)
  assert.ok(exp.knowledge && exp.knowledge.brief.includes('eNSP'))
  state.expId = exp.experiment.id

  const got = await call('experiment_get', { id: exp.experiment.id })
  assert.equal(got.ok, true)
  assert.ok(Array.isArray(got.knowledge.controls))
  assert.ok(got.knowledge.controls.some((c) => c.name === 'btnExport'))
})

test('desktop_guide 返回 usedSource：控件级命中，不再复用窗口级坐标', async () => {
  const first = await call('desktop_guide', {
    windowTitle: 'eNSP 主窗口', process: 'eNSP', controlName: 'btnExport',
    text: '点这里导出拓扑', stepId: 'step-1', screenshot: false,
  })
  assert.equal(first.usedSource, 'interface-history', `实际 usedSource=${first.usedSource}`)
  assert.equal(first.matchedControl, 'btnExport')
  assert.equal(first.usedPreset, false, '控件级命中不应退化成窗口级 preset')
  assert.equal(first.software, 'eNSP')

  // 同一个窗口换一个按钮：旧实现会复用 btnExport 的坐标，现在必须明确是 none
  const other = await call('desktop_guide', {
    windowTitle: 'eNSP 主窗口', process: 'eNSP', controlName: 'btnStart',
    text: '点这里启动设备', screenshot: false,
  })
  assert.equal(other.usedSource, 'none', `换按钮不该串位，实际 ${other.usedSource}`)
  assert.equal(other.matchedControl, null)

  // L2 自动录制：两次指引都落到了该实验的动作文件里
  const actionsFile = join(homeDir(), 'actions', `${state.expId}.jsonl`)
  assert.equal(existsSync(actionsFile), true)
  const rows = readFileSync(actionsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.ok(rows.length >= 2)
  assert.ok(rows.every((r) => r.action === 'guide' && r.software === 'eNSP'))
  assert.ok(rows.some((r) => r.controlName === 'btnExport' && r.source === 'interface-history'))
  assert.ok(!rows.some((r) => r.action === 'click-replay'), '不得录制可回放的点击动作')
})

test('usedSource=preset-window：没有控件名时明确标记「粒度不足」，而不是冒充命中', async () => {
  const preset = await call('note_add', { software: 'OldApp', kind: 'tip', text: '随便一条' })
  assert.equal(preset.ok, true)
  // 造一条只有窗口级、没有控件名的旧 preset
  const stateHome = homeDir()
  writeFileSync(join(stateHome, 'guide-presets.json'), `${JSON.stringify({
    'oldapp::oldapp 窗口': { coord: 'window', x: 30, y: 40, w: 64, h: 40, pad: 36, software: 'OldApp', uses: 2 },
  })}\n`, 'utf8')
  const guided = await call('desktop_guide', {
    software: 'OldApp', windowTitle: 'OldApp 窗口', text: '看整个窗口', screenshot: false,
  })
  assert.equal(guided.usedSource, 'preset-window', `实际 ${guided.usedSource}`)
  assert.equal(guided.usedPreset, true)
  assert.match(guided.note, /换按钮/)
})

test('新工具可调用：knowledge_query / settings / fragment_add / anchor_locate 降级', async () => {
  const query = await call('knowledge_query', { software: 'eNSP', controls: 3 })
  assert.equal(query.ok, true)
  assert.ok(query.knowledge.controls.length <= 3)

  const status = await call('knowledge_settings', { action: 'status' })
  assert.equal(status.ok, true)
  assert.equal(status.autoCapture, true)
  assert.ok(status.dirs.interface.includes('interface'))

  const bad = await call('report_fragment_add', { course: '计算机网络', section: '结果分析', pattern: '延迟 12ms' })
  assert.equal(bad.ok, false)
  const good = await call('report_fragment_add', { course: '计算机网络', section: '结果分析', pattern: '通过对比配置前后的连通性，说明该配置生效。' })
  assert.equal(good.ok, true)

  const anchor = await call('anchor_locate', { software: 'eNSP', controlName: 'btnExport', windowTitle: 'eNSP 主窗口' })
  assert.equal(anchor.matched, false, '没有锚点时必须明确降级')
  assert.match(anchor.error, /降级/)

  const map = await call('page_map_guide', { software: 'eNSP', controlName: 'btnExport', windowTitle: 'eNSP 主窗口' })
  assert.ok(['interface-history', 'interface-live', 'none'].includes(map.usedSource), `意外的 usedSource=${map.usedSource}`)
})

test('自动采集可一键关闭，关闭后 guide 不再写 actions', async () => {
  const off = await call('knowledge_settings', { action: 'off' })
  assert.equal(off.autoCapture, false)
  const actionsFile = join(homeDir(), 'actions', `${state.expId}.jsonl`)
  const before = readFileSync(actionsFile, 'utf8').trim().split('\n').length
  await call('desktop_guide', {
    windowTitle: 'eNSP 主窗口', process: 'eNSP', controlName: 'btnExport', screenshot: false,
  })
  const after = readFileSync(actionsFile, 'utf8').trim().split('\n').length
  assert.equal(after, before, '关掉开关后不应再采集')
  await call('knowledge_settings', { action: 'on' })
})

test('批次2：click / shot 也自动落一条，但绝不录可回放的点击序列', async () => {
  const actionsFile = join(homeDir(), 'actions', `${state.expId}.jsonl`)
  const before = readFileSync(actionsFile, 'utf8').trim().split('\n').length
  await call('desktop_click', { windowTitle: 'eNSP 主窗口', x: 420, y: 96, confirm: false })
  await call('desktop_screenshot', { experimentId: state.expId, windowTitle: 'eNSP 主窗口', place: false })
  const rows = readFileSync(actionsFile, 'utf8').trim().split('\n')
    .slice(before).map((line) => JSON.parse(line))
  assert.ok(rows.some((r) => r.action === 'click'), 'click 应自动落一条')
  assert.ok(rows.some((r) => r.action === 'shot'), 'shot 应自动落一条')
  assert.ok(rows.every((r) => r.action !== 'click-replay' && !('replay' in r)), '不得有点击回放数据')
})

test('批次5：anchor_capture 只裁控件周边并写进 interface，锚点能自匹配', async () => {
  const png = syntheticPng(200, 120, button(50, 30))
  const shot = join(HOME, 'anchor-source.png')
  writeFileSync(shot, png)
  const captured = await call('anchor_capture', {
    software: 'eNSP', controlName: 'btnAnchor',
    rect: { x: 50, y: 30, w: 80, h: 34 }, shot,
  })
  assert.equal(captured.ok, true, captured.error)
  assert.equal(captured.width, 96, '只裁控件 + 8px padding')
  assert.equal(captured.height, 50)
  assert.equal(existsSync(captured.file), true)
  const hit = matchAnchor(png, readFileSync(captured.file))
  assert.ok(hit, '存下来的锚点必须能匹配回原图')
  assert.ok(Math.abs(hit.x - 42) <= 3)

  const query = await call('knowledge_query', { software: 'eNSP', controls: 20 })
  assert.ok(query.knowledge.controls.some((c) => c.name === 'btnAnchor'))
  const interfaceFile = join(homeDir(), 'interface', 'ensp.json')
  const iface = JSON.parse(readFileSync(interfaceFile, 'utf8'))
  assert.ok(iface.controls.some((c) => c.name === 'btnAnchor' && c.anchor), '锚点路径应写进控件条目')
})

test('B1/B2 宿主通路：片段带 software、归档压摘要原明细保留', async () => {
  const frag = await call('report_fragment_add', {
    course: '计算机网络', software: 'eNSP', section: '结果分析',
    pattern: '结合设备状态表说明配置是否生效。',
  })
  assert.equal(frag.ok, true)
  assert.equal(frag.software, 'eNSP')
  const files = readdirSync(join(homeDir(), 'report-fragments'))
  assert.ok(files.some((f) => f.includes('__ensp.json')), `应有软件专属片段文件，实际 ${files.join(',')}`)

  const created = await call('experiment_create', { title: '归档压缩验证', course: '计算机网络', software: 'eNSP' })
  assert.equal(created.ok, true)
  const id = created.experiment.id
  const updated = await call('experiment_update', { id, status: 'archived' })
  assert.equal(updated.experiment.status, 'archived')
  assert.equal(updated.archived.lines >= 0, true)
  assert.ok(existsSync(updated.archived.summary))
  assert.equal(JSON.parse(readFileSync(updated.archived.summary, 'utf8')).expId, id)
  const doc = state.fake.tools[0].description || ''
  assert.match(doc, /software\?/, '工具清单要写明片段支持 software')
})

test('网页入口不注入桌宠，本机 API 仍可用', async () => {
  const route = state.fake.routes[0]
  const server = http.createServer((req, res) => route.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const status = await fetch(`http://127.0.0.1:${server.address().port}/dsh-lab/api/status`).then((x) => x.json())
    assert.equal(status.ok, true)
    assert.equal(status.settings.autoCapture, true)
    assert.equal(state.fake.injections.length, 0)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('回归：桌面面板「导入模板」发的复数路径必须成功', async () => {
  // 真实故障：LabPet.cs 的 ImportTemplate() 调 Api("POST", "/report/templates")，
  // 而 index.js 早期只注册了单数 /report/template，面板稳定收到 404，
  // 用户看到「模板导入失败：…(404) 未找到」。这里用真实 HTTP 请求钉死两种写法。
  const route = state.fake.routes[0]
  const server = http.createServer((req, res) => route.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${server.address().port}/dsh-lab/api`
    const tpl = join(HOME, 'panel-template.md')
    writeFileSync(tpl, '# 一、实验目的\n\n写目的\n\n# 二、实验步骤\n\n写步骤\n', 'utf8')

    const posted = await fetch(`${base}/report/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: tpl }),
    })
    const saved = await posted.json()
    assert.equal(posted.status, 200, `面板复数路径应 200，实际 ${posted.status}：${JSON.stringify(saved)}`)
    assert.equal(saved.ok, true)
    assert.ok(saved.template?.id, '应返回模板 id')

    // 单数路径仍然可用（不破坏旧调用方）
    const single = await fetch(`${base}/report/template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: tpl }),
    })
    assert.equal(single.status, 200)

    // 导入后列表里必须能看到
    const list = await fetch(`${base}/report/templates`).then((x) => x.json())
    assert.ok(list.templates.some((item) => item.id === saved.template.id), 'GET 列表应包含刚导入的模板')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

