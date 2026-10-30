import assert from 'node:assert/strict'
import test from 'node:test'
import { adviseCompatibility, getCompatibilityProfiles } from '../lib/advisor.mjs'
import { getCatalog } from '../lib/catalog.mjs'

test('兼容方案引用合法，并且不会自动安装', () => {
  const data = getCompatibilityProfiles()
  const catalogIds = new Set(getCatalog().software.map((item) => item.id))
  assert.ok(data.profiles.length >= 7)
  assert.equal(data.policy.recommendationDoesNotEqualInstallPermission, true)
  assert.equal(data.policy.doNotChangeWorkingSetup, true)
  for (const profile of data.profiles) {
    assert.ok(profile.id && profile.name && profile.status)
    assert.ok(Array.isArray(profile.installOrder))
    assert.ok(profile.installOrder.every((step) => typeof step === 'string'))
    for (const softwareId of profile.softwareIds) assert.ok(catalogIds.has(softwareId), `${profile.id} 引用了未知软件 ${softwareId}`)
  }
  assert.ok(data.profiles.filter((profile) => profile.status === 'tested-local').length >= 4)
})

test('根据实际环境给出保留、诊断或更换方案', { skip: process.platform !== 'win32' }, async () => {
  const advice = await adviseCompatibility({ software: 'ensp', currentlyWorking: true })
  assert.equal(advice.ok, true)
  assert.ok(advice.recommendation)
  assert.ok(advice.disclaimer.includes('不是安装授权'))
  const detected = advice.installed.some((app) => /ensp/i.test(app.name))
  if (detected) {
    assert.equal(advice.recommendation.action, 'keep-current')
  } else {
    assert.equal(advice.recommendation.action, 'propose-profile')
  }
  assert.ok(Array.isArray(advice.recommendation.verification))
})

test('未知软件会明确拒绝编造方案', async () => {
  const advice = await adviseCompatibility({ software: '不存在的软件' })
  assert.equal(advice.ok, false)
  assert.match(advice.error, /目录中没有/)
})
