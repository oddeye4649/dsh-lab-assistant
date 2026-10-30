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

test('状态摘要只把 eNSP 标为已验证检测', () => {
  const summary = catalogHighlights()
  assert.deepEqual(summary.verified, ['eNSP'])
  assert.deepEqual(summary.testedRun.sort(), ['ImageJ / Fiji', 'MySQL', 'Python', 'Weka'].sort())
  assert.ok(summary.priorityCounts.P0 > 0)
  assert.ok(summary.priorityCounts.P2 > 0)
})
