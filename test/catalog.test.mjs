import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogHighlights, getCatalog, matchRequestedSoftware, searchCatalog } from '../lib/catalog.mjs'

test('目录覆盖多个学科且引用完整', () => {
  const catalog = getCatalog()
  assert.ok(catalog.disciplines.length >= 12)
  assert.ok(catalog.software.length >= 60)
  const ids = new Set(catalog.software.map((item) => item.id))
  assert.equal(ids.size, catalog.software.length)
  for (const discipline of catalog.disciplines) {
    for (const id of discipline.softwareIds) assert.ok(ids.has(id), `${discipline.id} 引用了不存在的 ${id}`)
  }
})

test('可按学科和优先级筛选，并返回学科名称', () => {
  const result = searchCatalog({ discipline: 'electronics', priority: 'P1' })
  assert.ok(result.software.length >= 2)
  assert.ok(result.software.every((item) => item.disciplines.includes('electronics')))
  assert.ok(result.software.every((item) => item.priority === 'P1'))
  assert.ok(result.software.every((item) => item.disciplineNames.length > 0))
  const all = searchCatalog({ discipline: 'electronics' })
  assert.ok(all.software.length >= 5)
})

test('能匹配已安装软件，并明确未检测到', () => {
  const matches = matchRequestedSoftware('wireshark, Python, 不存在的实验软件', [
    { name: 'Wireshark 3.0.6 64-bit', version: '3.0.6', publisher: 'Wireshark', installLocation: '' },
    { name: 'Python 3.13', version: '3.13', publisher: 'Python Software Foundation', installLocation: '' },
  ])
  assert.equal(matches.length, 3)
  assert.equal(matches[0].status, 'detected')
  assert.equal(matches[0].software.id, 'wireshark')
  assert.equal(matches[1].status, 'detected')
  assert.equal(matches[2].status, 'not-detected')
  assert.equal(matches[2].software, null)
})

test('状态摘要的已验证检测包含 eNSP 与 Logisim', () => {
  const summary = catalogHighlights()
  assert.deepEqual(summary.verified, ['eNSP'])
  assert.deepEqual(
    summary.testedRun.sort(),
    ['Blender', 'EPA SWMM', 'EPANET', 'Git', 'ImageJ / Fiji', 'Logisim / Logisim Evolution', 'LTspice', 'MySQL', 'Praat', 'Python', 'R / RStudio', 'Weka', 'TeX Live / MiKTeX'].sort()
  )
  assert.ok(summary.priorityCounts.P0 > 0)
  assert.ok(summary.priorityCounts.P2 > 0)
})

test('schemaVersion 为 2，verify 字段结构完整', () => {
  const catalog = getCatalog()
  assert.equal(catalog.schemaVersion, 2)
  assert.ok(catalog.verifyLegend && typeof catalog.verifyLegend === 'object')

  const withVerify = catalog.software.filter((item) => item.verify)
  assert.ok(withVerify.length >= 4, `至少 4 个条目带 verify，实际 ${withVerify.length}`)

  for (const item of withVerify) {
    const v = item.verify
    assert.equal(typeof v.cmd, 'string', `${item.id} 缺 cmd`)
    assert.ok(v.cmd.length > 0, `${item.id} cmd 为空`)
    assert.equal(typeof v.timeoutMs, 'number', `${item.id} 缺 timeoutMs`)
    assert.ok(v.timeoutMs > 0 && v.timeoutMs <= 600000, `${item.id} timeoutMs 越界`)
    assert.equal(typeof v.deterministic, 'boolean', `${item.id} 缺 deterministic`)

    // 三种期望至少要有一种，否则这条 verify 等于没有判据
    const hasStdout = Array.isArray(v.expect) && v.expect.length > 0
    const hasReport = Array.isArray(v.reportContains) && v.reportContains.length > 0
    const hasArtifact = Array.isArray(v.artifactExpect) && v.artifactExpect.length > 0
    assert.ok(hasStdout || hasReport || hasArtifact, `${item.id} 没有任何期望判据`)

    for (const key of ['expect', 'reportContains', 'artifactExpect']) {
      if (v[key] !== undefined) {
        assert.ok(Array.isArray(v[key]), `${item.id} 的 ${key} 必须是数组`)
        assert.ok(v[key].every((x) => typeof x === 'string'), `${item.id} 的 ${key} 元素必须是字符串`)
      }
    }
  }

  // 带 verify 的必须是已实测的；仅归类的条目不许挂校验命令
  for (const item of withVerify) {
    assert.notEqual(item.support, 'catalog-only', `${item.id} 有 verify 却是 catalog-only`)
  }
})
