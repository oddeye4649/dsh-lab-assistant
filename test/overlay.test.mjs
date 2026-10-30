import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { overlayRequest } from '../lib/overlay.mjs'

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
