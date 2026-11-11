// 合成基准：同一软件「第一次 / 第二次」实验的经验复用效果。
// 用临时 homeDir 造数据，不碰用户真实档案；结果写 temp/benchmark-knowledge/result.json。
// 注意：这是合成基准，不等于真人两次实验；不可自动测的指标会明确标为「需真人验证」。
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ExperimentStore } from '../lib/store.mjs'
import { KnowledgeBase, slug } from '../lib/knowledge.mjs'
import { createCore } from '../lib/core.mjs'

const ROOT = join(process.cwd(), 'temp', 'benchmark-knowledge')
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(ROOT, { recursive: true })

const home = join(ROOT, 'home')
const store = new ExperimentStore(home)
const kb = new KnowledgeBase(store)
const core = createCore({ store, knowledge: kb, assetsRoot: join(process.cwd(), 'assets') })
const SOFTWARE = 'eNSP'
const WINDOW = 'eNSP 主窗口'
const WINDOW_SIZE = { w: 1280, h: 800 }

// 模拟 desktop_place 成功后登记的窗口尺寸
mkdirSync(join(home, 'interface'), { recursive: true })
writeFileSync(join(home, 'interface', '_windows.json'), `${JSON.stringify({ ensp: WINDOW_SIZE })}\n`, 'utf8')

// 第二次实验要指路的 13 个控件：10 个上次记过、2 个版本漂移、1 个全新的
const controls = Array.from({ length: 13 }, (_, i) => `btn${i + 1}`)

// ---- 第一次实验：经验库为空，每个控件都得靠 agent 量坐标 ----
const firstPass = controls.map((name) => kb.findControl({
  software: SOFTWARE, window: WINDOW, controlName: name, windowSize: WINDOW_SIZE,
}))
const firstHits = firstPass.filter((x) => x && x.usedSource !== 'none').length
const firstMeasured = controls.length - firstHits

// 量完坐标后沉淀（等价于 note_add 带 controlName+rect，或 page_map_capture 双写）
for (let i = 0; i < 10; i++) {
  kb.upsertControl(SOFTWARE, {
    controlName: controls[i], window: WINDOW,
    rect: { x: 100 + i * 30, y: 90, w: 80, h: 28 },
    windowSize: WINDOW_SIZE,
    source: i < 2 ? 'uia' : 'manual',
    version: '1.3.00.100',
  })
}
// 两个版本漂移的控件：上次记的是旧版本
for (let i = 10; i < 12; i++) {
  kb.upsertControl(SOFTWARE, {
    controlName: controls[i], window: WINDOW,
    rect: { x: 100 + i * 30, y: 90, w: 80, h: 28 },
    windowSize: WINDOW_SIZE, source: 'manual', version: '1.2.00.500',
  })
}
store.addSoftwareNote(SOFTWARE, 'pitfall', '启动设备失败，错误代码 40，先开 VirtualBox')
kb.recordFailure(SOFTWARE, { stepId: 'step-3', controlName: 'btn3', error: '启动设备失败，错误代码 40' })
for (let i = 0; i < 13; i++) {
  kb.recordAction('exp-first', {
    action: 'guide', software: SOFTWARE, window: WINDOW, controlName: controls[i],
    source: 'none', ok: true, stepId: 'step-3',
  })
}

// ---- 第二次实验：不传坐标，靠经验定位 ----
// 前 10 个控件版本没变（2 个 UIA 实时 + 8 个历史坐标）；
// 第 11/12 个模拟软件升级后版本变了 → 降级命中；第 13 个是全新按钮 → 未命中。
const secondPass = controls.map((name, i) => kb.findControl({
  software: SOFTWARE, window: WINDOW, controlName: name,
  version: i >= 10 && i < 12 ? '2.0.0' : '1.3.00.100',
  windowSize: WINDOW_SIZE,
}))
const distribution = {}
for (const hit of secondPass) {
  const key = hit ? hit.usedSource : 'none'
  distribution[key] = (distribution[key] || 0) + 1
}
const CONTROL_SOURCES = new Set(['interface-live', 'interface-history', 'interface-drift', 'anchor'])
const RELIABLE_SOURCES = new Set(['interface-live', 'interface-history'])
const secondHits = secondPass.filter((x) => x && CONTROL_SOURCES.has(x.usedSource)).length
const reliableHits = secondPass.filter((x) => x && RELIABLE_SOURCES.has(x.usedSource)).length
const degradedHits = secondHits - reliableHits
const secondMeasured = controls.length - secondHits
const hitRate = secondHits / controls.length
const reliableRate = reliableHits / controls.length
const measureDrop = (firstMeasured - secondMeasured) / firstMeasured

// 经验前置：第二次开工的档案里自动带出坑 / 控件 / 失败
const exp2 = core.experimentCreate({ title: '静态路由（第 2 次）', course: '计算机网络', software: SOFTWARE })
const got = core.experimentGet({ id: exp2.experiment.id })
const knowledge = got.knowledge
const failureVisible = knowledge.failures.some((f) => /错误代码 40/.test(f.error))
const hot = kb.rebuildUsage(SOFTWARE)

// ---- 报告指标实测：pending 会不会因为经验库/片段而下降？ ----
const exp = store.createExperiment({
  title: '静态路由', course: '计算机网络', software: SOFTWARE,
  steps: [{ title: '配置路由', actual: 'ping 通', passed: true }],
})
const report1 = await core.reportGenerate({ experimentId: exp.id, useBuiltin: true })
const beforePending = report1.pending.length
const beforePlaceholders = report1.placeholderCount
core.reportFragmentAdd({ course: '计算机网络', section: '结果分析', pattern: '通过对比配置前后的连通性，说明该配置生效。' })
core.reportFragmentAdd({ course: '计算机网络', section: '实验总结', pattern: '本次实验按指导书完成配置，仍需补充个人收获与不足。' })
const report2 = await core.reportGenerate({ experimentId: exp.id, useBuiltin: true })
const afterPending = report2.pending.length
const afterPlaceholders = report2.placeholderCount
const hints = report2.fragmentHints.length
// 第三次：再加一条片段，反复确认 pending 是否与经验库/片段相关
core.reportFragmentAdd({ course: '计算机网络', section: '实验心得', pattern: '本次按步骤完成操作，仍需补充个人体会。' })
const report3 = await core.reportGenerate({ experimentId: exp.id, useBuiltin: true })
const thirdPending = report3.pending.length
const thirdPlaceholders = report3.placeholderCount

const result = {
  generatedAt: new Date().toISOString(),
  synthetic: true,
  controls: controls.length,
  first: { controlLevelHits: firstHits, measuredCoordinates: firstMeasured },
  second: {
    controlLevelHits: secondHits,
    measuredCoordinates: secondMeasured,
    usedSourceDistribution: distribution,
    hitRate: Number(hitRate.toFixed(4)),
    reliableRate: Number(reliableRate.toFixed(4)),
    reliableHits,
    degradedHits,
    measureDrop: Number(measureDrop.toFixed(4)),
  },
  knowledgeInjected: {
    brief: Boolean(exp2.knowledge && exp2.knowledge.brief),
    controls: knowledge.controls.length,
    pitfalls: knowledge.pitfalls.length,
    failures: knowledge.failures.length,
    failureVisible,
    hotControls: Object.keys(hot).length,
  },
  report: {
    pendingBefore: beforePending, pendingAfter: afterPending, pendingThird: thirdPending,
    placeholdersBefore: beforePlaceholders, placeholdersAfter: afterPlaceholders, placeholdersThird: thirdPlaceholders,
    fragmentHints: hints,
    pendingChanged: beforePending !== afterPending || afterPending !== thirdPending,
  },
  assertions: {
    hitRateAtLeast70: hitRate >= 0.7,
    reliableRateAtLeast50: reliableRate >= 0.5,
    measureDropAtLeast50: measureDrop >= 0.5,
    knowledgeInjected: Boolean(exp2.knowledge) && failureVisible && knowledge.controls.length > 0,
    fragmentsProvided: hints >= 2,
    // 这条是「用数据检验方案指标是否有效」，不是期望失败：
    pendingUnchanged: beforePending === afterPending && afterPending === thirdPending
      && beforePlaceholders === afterPlaceholders && afterPlaceholders === thirdPlaceholders,
  },
}

// 方案第六节里「报告 pending 下降」这一指标：实测是否成立
result.findings = []
if (result.assertions.pendingUnchanged) {
  result.findings.push('连续三次生成（无片段 / 2 条片段 / 3 条片段）pending 与占位符均不变：报告 pending 只由模板覆盖度、步骤与实测值决定，与经验库无关；代码上 generateReport 也不接收 knowledge。方案第六节该指标测不出知识库效果，需替换为可测指标。')
}
result.findings.push('追问次数、失败重复率需要真人两次实验，合成基准无法测量，只能给出代理指标（失败提示可见 / 热区覆盖）。')

writeFileSync(join(ROOT, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')

const lines = [
  '=== 经验闭环合成基准 ===',
  `控件数 ${controls.length}；第一次控件级命中 ${firstHits}，需量坐标 ${firstMeasured} 次`,
  `第二次控件级命中 ${secondHits}（可靠 ${reliableHits} / 降级 ${degradedHits}），需量坐标 ${secondMeasured} 次；命中率 ${(hitRate * 100).toFixed(1)}%，可靠命中率 ${(reliableRate * 100).toFixed(1)}%，量坐标下降 ${(measureDrop * 100).toFixed(1)}%`,
  `usedSource 分布 ${JSON.stringify(distribution)}`,
  `经验前置：brief=${result.knowledgeInjected.brief} 控件=${knowledge.controls.length} 坑=${knowledge.pitfalls.length} 失败=${knowledge.failures.length} 失败可见=${failureVisible} 热区=${Object.keys(hot).length}`,
  `报告：pending ${beforePending}→${afterPending}→${thirdPending}，占位符 ${beforePlaceholders}→${afterPlaceholders}→${thirdPlaceholders}，片段候选 ${hints}`,
  '',
  '发现：',
  ...result.findings.map((x) => `- ${x}`),
  '',
  `断言：${Object.entries(result.assertions).map(([k, v]) => `${k}=${v}`).join('  ')}`,
]
console.log(lines.join('\n'))

assert.ok(result.assertions.hitRateAtLeast70, '控件级命中率应 ≥70%')
assert.ok(result.assertions.reliableRateAtLeast50, '可靠命中率应 ≥50%')
assert.ok(result.assertions.measureDropAtLeast50, '量坐标次数应下降 ≥50%')
assert.ok(result.assertions.knowledgeInjected, '经验必须前置注入且失败提示可见')
assert.ok(result.assertions.fragmentsProvided, '报告应给出句式骨架候选')
console.log('\n基准断言全部通过；结果: temp/benchmark-knowledge/result.json')
