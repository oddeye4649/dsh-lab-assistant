import assert from 'node:assert/strict'
import test from 'node:test'
import { probeEnvironment } from '../lib/probe.mjs'

test('可对任意目录软件做只读探测而不要求一定安装', { skip: process.platform !== 'win32' }, async () => {
  const result = await probeEnvironment({ software: 'eNSP, Wireshark, 不存在的实验软件' })
  assert.equal(result.ok, true)
  assert.equal(result.requested.length, 3)
  assert.equal(result.requested[0].software.id, 'ensp')
  assert.ok(Array.isArray(result.requested[0].detected))
  assert.ok(result.findings.some((item) => item.code === 'probe-is-readonly'))
  assert.ok(result.findings.some((item) => item.code.startsWith('detected-') || item.code.startsWith('not-detected-')))
})
