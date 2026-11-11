// HTTP 健壮性回归：错误码语义 + 空标题拦截 + /tool 白名单
// 起因：0.16.0 审计发现坏请求一律 500、空标题能建出「未命名实验」。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

process.env.DSH_LAB_OVERLAY = '0'

const { readJsonBody } = await import('../lib/http.mjs')
const { startPreview } = await import('../scripts/preview-server.mjs')

function fakeReq(chunks) {
  const req = {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield Buffer.from(c)
    },
  }
  return req
}

const HOME = mkdtempSync(join(tmpdir(), 'http-robust-'))
const preview = await startPreview({ home: HOME })
const base = `http://127.0.0.1:${preview.port}/dsh-lab/api`
test.after(async () => {
  await preview.close()
  rmSync(HOME, { recursive: true, force: true })
})

test('readJsonBody：非法 JSON 抛出 400 语义的错误', async () => {
  await assert.rejects(
    () => readJsonBody(fakeReq(['{bad json'])),
    (error) => error.statusCode === 400 && /有效 JSON/.test(error.message),
  )
})

test('readJsonBody：非对象抛 400，超大抛 413', async () => {
  await assert.rejects(
    () => readJsonBody(fakeReq(['[1,2,3]'])),
    (error) => error.statusCode === 400 && /JSON 对象/.test(error.message),
  )
  await assert.rejects(
    () => readJsonBody(fakeReq([JSON.stringify({ pad: 'x'.repeat(2048) })]), 512),
    (error) => error.statusCode === 413 && /过大/.test(error.message),
  )
})

test('POST /experiments 空标题返回 400 且不落库', async () => {
  const res = await fetch(`${base}/experiments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '   ' }),
  })
  const body = await res.json()
  assert.equal(res.status, 400)
  assert.equal(body.ok, false)
  assert.match(body.error, /标题不能为空/)

  const list = await fetch(`${base}/experiments`).then((r) => r.json())
  assert.equal(list.experiments.length, 0, '空标题不应建出档案')
})

test('POST /experiments 正常标题仍返回 201', async () => {
  const res = await fetch(`${base}/experiments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '回归实验', software: 'eNSP' }),
  })
  const body = await res.json()
  assert.equal(res.status, 201)
  assert.equal(body.ok, true)
  assert.equal(body.experiment.title, '回归实验')
})

test('非法 JSON 请求体返回 400（不再是 500）', async () => {
  const res = await fetch(`${base}/experiments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad json',
  })
  assert.equal(res.status, 400)
})

test('/tool 未知方法返回 400，超大请求体返回 413', async () => {
  const bad = await fetch(`${base}/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'notARealMethod', args: {} }),
  })
  assert.equal(bad.status, 400)

  const huge = await fetch(`${base}/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'status', args: { pad: 'x'.repeat(80 * 1024) } }),
  })
  assert.equal(huge.status, 413)
})

test('/tool 白名单方法可正常转发', async () => {
  const res = await fetch(`${base}/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'status', args: {} }),
  })
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.plugin, 'dsh-lab-assistant')
})
