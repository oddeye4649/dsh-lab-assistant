import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CATALOG_FILE = join(ROOT, 'coursepacks', 'software-catalog.json')
let cache = null

export function getCatalog() {
  if (!cache) cache = JSON.parse(readFileSync(CATALOG_FILE, 'utf8'))
  return cache
}

function normalize(value, max = 80) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
}

function disciplineNames(ids) {
  const byId = new Map(getCatalog().disciplines.map((item) => [item.id, item.name]))
  return (ids || []).map((id) => byId.get(id) || id)
}

export function searchCatalog({ discipline = '', priority = '', query = '' } = {}) {
  const catalog = getCatalog()
  const disciplineId = normalize(discipline, 40)
  const priorityValue = normalize(priority, 4).toUpperCase()
  const keyword = normalize(query).toLowerCase()
  const allowed = disciplineId
    ? new Set(catalog.disciplines.find((item) => item.id === disciplineId)?.softwareIds || [])
    : null

  const results = catalog.software
    .filter((item) => !allowed || allowed.has(item.id))
    .filter((item) => !['P0', 'P1', 'P2'].includes(priorityValue) || item.priority === priorityValue)
    .filter((item) => {
      if (!keyword) return true
      return [item.name, item.id, item.category, ...(item.aliases || [])]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
    .map((item) => ({
      ...item,
      disciplineNames: disciplineNames(item.disciplines),
    }))

  return {
    catalogVersion: catalog.schemaVersion,
    updatedAt: catalog.updatedAt,
    disclaimer: catalog.disclaimer,
    priorityLegend: catalog.priorityLegend,
    supportLegend: catalog.supportLegend,
    disciplines: catalog.disciplines.map((item) => ({
      id: item.id,
      name: item.name,
      courses: item.courses,
      softwareCount: item.softwareIds.length,
      notes: item.notes,
    })),
    software: results,
    total: results.length,
  }
}

export function catalogHighlights() {
  const catalog = getCatalog()
  const counts = { P0: 0, P1: 0, P2: 0 }
  for (const item of catalog.software) counts[item.priority] = (counts[item.priority] || 0) + 1
  return {
    disciplines: catalog.disciplines.length,
    software: catalog.software.length,
    priorityCounts: counts,
    verified: catalog.software.filter((item) => item.support === 'verified-diagnose').map((item) => item.name),
    testedRun: catalog.software.filter((item) => item.support === 'verified-run').map((item) => item.name),
    updatedAt: catalog.updatedAt,
    disclaimer: catalog.disclaimer,
  }
}

export function matchRequestedSoftware(requested, installed) {
  const catalog = getCatalog()
  const terms = String(requested || '')
    .split(/[,，;；\n]/)
    .map((item) => normalize(item, 80))
    .filter(Boolean)
    .slice(0, 12)
  if (!terms.length) return []

  return terms.map((term) => {
    const lowered = term.toLowerCase()
    const entry = catalog.software.find((item) => {
      const candidates = [item.name, item.id, ...(item.aliases || [])].map((x) => x.toLowerCase())
      return candidates.includes(lowered)
    })
    const patterns = [...new Set([term, entry?.name, ...(entry?.aliases || [])].filter(Boolean).map((x) => String(x).toLowerCase()))]
    const detected = installed.filter((app) => {
      const haystack = `${app.name} ${app.publisher}`.toLowerCase()
      return patterns.some((pattern) => haystack.includes(pattern))
    })
    return {
      query: term,
      status: detected.length ? 'detected' : 'not-detected',
      software: entry ? {
        id: entry.id,
        name: entry.name,
        category: entry.category,
        priority: entry.priority,
        license: entry.license,
        support: entry.support,
        disciplineNames: disciplineNames(entry.disciplines),
        notes: entry.notes,
      } : null,
      detected,
      caution: '只读匹配注册表或常见安装信息，不代表版本兼容或课程实验可运行。',
    }
  })
}
