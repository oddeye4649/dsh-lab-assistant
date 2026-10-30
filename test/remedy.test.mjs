import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { RepairHistory, fingerprintOf, planRepair, recordRepair } from '../lib/remedy.mjs'
import { getCompatibilityProfiles } from '../lib/advisor.mjs'

const BASE = join(process.cwd(), 'test-output', `remedy-${process.pid}`)

function freshHome(name) {
  const dir = join(BASE, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

function envWith(virtualBoxVersion = '6.1.30') {
  return {
    platform: 'win32',
    memoryGB: 32,
    os: { version: '10.0.26200', arch: 'x64', release: '10.0.26200' },
    cpu: { virtualizationFirmwareEnabled: true },
    virtualization: { hypervisorPresent: true },
    installed: [
      { name: 'Huawei eNSP', version: 'V1.3.00.100' },
      ...(virtualBoxVersion ? [{ name: 'Oracle VM VirtualBox', version: virtualBoxVersion }] : []),
      { name: 'WinPcap', version: '4.1.3' },
    ],
    dependencies: [],
    findings: [],
  }
}

test.after(() => rmSync(BASE, { recursive: true, force: true }))

test('失败特征的正则都能编译，避免知识库写错导致永远匹配不到', () => {
  const playbook = getCompatibilityProfiles().failurePlaybook
  assert.ok(playbook && playbook.ensp)
  for (const signature of playbook.ensp.signatures) {
    for (const pattern of signature.patterns) {
      assert.doesNotThrow(() => new RegExp(pattern, 'i'), `${signature.id} 的正则无法编译：${pattern}`)
    }
  }
})

test('报错能定位到设备启动失败，并给出可执行的换版本顺序', async () => {
  const home = freshHome('match')
  const plan = await planRepair({
    software: 'ensp',
    symptom: '启动设备失败，错误代码 40，AR_Base 无法启动',
    environment: envWith(),
    homeDir: home,
  })
  assert.equal(plan.ok, true)
  assert.equal(plan.symptom.matched, 'ensp-device-start-fail')
  assert.equal(plan.plan.action, 'change-version')
  assert.ok(plan.candidates.length >= 3)
  assert.equal(plan.candidates[0].version, '7.2.22')
  assert.equal(plan.candidates[0].evidence, 'proven-this-machine')
  assert.ok(plan.plan.steps.some((step) => step.includes('7.2.22')))
  assert.ok(plan.plan.verification.length > 0)
  assert.equal(plan.policy.autoInstall, false)
  assert.equal(plan.policy.requiresConfirmation, true)
})

test('信息不足时不瞎猜版本，先要求采集', async () => {
  const home = freshHome('unknown')
  const plan = await planRepair({ software: 'ensp', symptom: '就是不好使', environment: envWith(), homeDir: home })
  assert.equal(plan.symptom.matched, null)
  assert.equal(plan.plan.action, 'collect-info')
  assert.equal(plan.candidates.length, 0)
  assert.ok(plan.plan.steps.length >= 3)
  assert.ok(plan.research.query.includes('eNSP'))
})

test('记过失败的版本不再排在前面，记过可用的会升到第一', async () => {
  const home = freshHome('history')
  const env = envWith()
  recordRepair(home, {
    software: 'ensp',
    component: 'virtualization',
    name: 'Oracle VirtualBox',
    version: '7.2.22',
    outcome: 'failed',
    symptom: '启动设备失败',
    fingerprint: fingerprintOf(env),
  })
  const afterFail = await planRepair({ software: 'ensp', symptom: '启动设备失败，错误代码 40', environment: env, homeDir: home })
  assert.notEqual(afterFail.candidates[0].version, '7.2.22')
  const failedEntry = afterFail.candidates.find((item) => item.version === '7.2.22')
  assert.equal(failedEntry.previouslyTried, 'failed')
  assert.ok(failedEntry.flags.some((flag) => flag.includes('失败')))

  recordRepair(home, {
    software: 'ensp',
    component: 'virtualization',
    name: 'Oracle VirtualBox',
    version: '6.1.44',
    outcome: 'worked',
    fingerprint: fingerprintOf(env),
  })
  const afterWorked = await planRepair({ software: 'ensp', symptom: '启动设备失败，错误代码 40', environment: env, homeDir: home })
  assert.equal(afterWorked.candidates[0].version, '6.1.44')
  assert.equal(afterWorked.candidates[0].evidenceLabel, '本机经验库已记录可用')
})

test('本机验证过的版本仍在报错时，优先提示查环境而不是重装', async () => {
  const home = freshHome('installed')
  const plan = await planRepair({
    software: 'ensp',
    symptom: '启动设备失败，错误代码 40',
    environment: envWith('7.2.22'),
    homeDir: home,
  })
  const same = plan.candidates.find((item) => item.version === '7.2.22')
  assert.equal(same.installed, true)
  assert.ok(same.flags.some((flag) => flag.includes('本机曾验证可用')))
  assert.equal(plan.candidates[0].version, '7.2.22')
  assert.equal(plan.plan.action, 'verify-environment')
  assert.match(plan.plan.summary, /先按检查项排查/)
})

test('换一台系统版本不同的电脑，同一个版本只能算他机实测', async () => {
  const home = freshHome('other-build')
  const env = envWith('6.1.30')
  env.os = { version: '10.0.19045', arch: 'x64', release: '10.0.19045' }
  const plan = await planRepair({ software: 'ensp', symptom: '启动设备失败，错误代码 40', environment: env, homeDir: home })
  const candidate = plan.candidates.find((item) => item.version === '7.2.22')
  assert.match(candidate.evidenceLabel, /他机实测/)
  assert.ok(candidate.score < 70)
})

test('经验库只接受 worked / failed，并去重累计次数', () => {
  const home = freshHome('validate')
  const history = new RepairHistory(home)
  assert.throws(() => history.record({ software: 'ensp', version: '7.2.22', outcome: 'maybe' }), /worked 或 failed/)
  assert.throws(() => history.record({ software: 'ensp', outcome: 'worked' }), /缺少版本号/)
  for (let i = 0; i < 3; i += 1) {
    recordRepair(home, {
      software: 'ensp',
      component: 'virtualization',
      version: '7.2.22',
      outcome: 'worked',
      fingerprint: 'win32|10.0.26200|x64',
    })
  }
  const attempts = history.list('ensp')
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].hits, 3)
})

test('非 eNSP 软件走通用采集流程，不会套用别人的版本号', async () => {
  const home = freshHome('generic')
  const plan = await planRepair({
    software: 'weka',
    symptom: '打开就闪退',
    environment: envWith(),
    homeDir: home,
  })
  assert.equal(plan.software.id, 'weka')
  assert.equal(plan.symptom.matched, null)
  assert.equal(plan.plan.action, 'collect-info')
  assert.equal(plan.candidates.length, 0)
})
