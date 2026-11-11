import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import http from 'node:http'
import test from 'node:test'
import { overlayRequest, resolveCompiler, findReferenceLib } from '../lib/overlay.mjs'

test('overlay 协议：带 token 的 JSON 请求/响应', async () => {
  const server = http.createServer((request, response) => {
    if (!request.url.includes('token=secret-token')) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ok: false, error: 'token 不匹配' }))
      return
    }
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body || '{}')
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ok: true, echo: payload.text, rect: { x: 10, y: 20, w: 30, h: 40 } }))
    })
  })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const port = server.address().port
  try {
    const good = await overlayRequest({ port, token: 'secret-token' }, '/guide', { text: '你好' })
    assert.equal(good.ok, true)
    assert.equal(good.echo, '你好')
    assert.deepEqual(good.rect, { x: 10, y: 20, w: 30, h: 40 })

    const bad = await overlayRequest({ port, token: 'wrong' }, '/status')
    assert.equal(bad.ok, false)
    assert.match(bad.error, /token/)

    const down = await overlayRequest({ port: 1, token: 'x' }, '/status', {}, 1500)
    assert.equal(down.ok, false)
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
})

test('P4a 编译器选路：默认优先 Roslyn，DSH_LAB_FORCE_FRAMEWORK_CSC=1 强制回退', () => {
  const original = process.env.DSH_LAB_FORCE_FRAMEWORK_CSC
  try {
    delete process.env.DSH_LAB_FORCE_FRAMEWORK_CSC
    const auto = resolveCompiler()
    if (process.platform !== 'win32') {
      assert.deepEqual(auto, { kind: 'none', path: null, forced: false })
      return
    }
    assert.ok(['roslyn', 'framework', 'none'].includes(auto.kind))
    assert.equal(auto.forced, false)
    if (auto.kind !== 'none') assert.ok(auto.path)

    // 关键断言：强制回退时绝不允许再选 Roslyn，否则 P4a 验的就不是用户的真实路径
    process.env.DSH_LAB_FORCE_FRAMEWORK_CSC = '1'
    const forced = resolveCompiler()
    assert.notEqual(forced.kind, 'roslyn')
    assert.equal(forced.forced, true)
    if (forced.kind === 'framework') assert.match(forced.path, /v4\.0\.30319/)
    else assert.equal(forced.kind, 'none')

    // 显式关闭不等于开启
    process.env.DSH_LAB_FORCE_FRAMEWORK_CSC = '0'
    assert.equal(resolveCompiler().forced, false)
  } finally {
    if (original === undefined) delete process.env.DSH_LAB_FORCE_FRAMEWORK_CSC
    else process.env.DSH_LAB_FORCE_FRAMEWORK_CSC = original
  }
})

test('P4b 回归：-lib 必须指向真实存在的引用目录（含 UIAutomationClient）', () => {
  const lib = findReferenceLib()
  if (lib === null) return // 极简系统可能确实没有，允许 null
  assert.ok(existsSync(lib), `-lib 目录不存在：${lib}`)
  assert.ok(existsSync(join(lib, 'UIAutomationClient.dll')), `${lib} 缺 UIAutomationClient.dll`)
  assert.ok(existsSync(join(lib, 'UIAutomationTypes.dll')), `${lib} 缺 UIAutomationTypes.dll`)
  // 不能把编译器所在目录本身当引用目录（那里没有这三个 dll）
  assert.doesNotMatch(lib, /v4\.0\.30319$/i)
})

test('P4b 回归：没有 VS 的机器必须能回退到系统 WPF 目录', () => {
  // 干净 Win11（无 VS / 无 Reference Assemblies）上，三个程序集在
  // %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\WPF。
  // 只断言候选路径结构成立：若 Reference Assemblies 不存在，返回值必须落在 WPF 目录下。
  const refRoots = [
    'C:\\Program Files (x86)\\Reference Assemblies\\Microsoft\\Framework\\.NETFramework',
    'C:\\Program Files\\Reference Assemblies\\Microsoft\\Framework\\.NETFramework',
  ]
  const hasRefAsm = refRoots.some((p) => existsSync(p))
  const lib = findReferenceLib()
  if (lib === null) return
  if (!hasRefAsm) assert.match(lib, /[\\/]WPF$/i, `无 Reference Assemblies 时应回退 WPF，实际 ${lib}`)
})
