import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { readDocx, readMarkdown } from './docx-read.mjs'
import { buildDocx } from './docx-write.mjs'
import { getCatalog } from './catalog.mjs'

const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024
const MAX_IMAGES = 6
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const IMAGE_RE = /\.(png|jpe?g)$/i

const KIND_RULES = [
  { kind: 'purpose', match: /(目的|目标|任务要求|实验要求)/ },
  { kind: 'principle', match: /(原理|理论|背景)/ },
  { kind: 'environment', match: /(环境|器材|设备|工具|平台)/ },
  { kind: 'topology', match: /(拓扑|组网|结构图)/ },
  { kind: 'steps', match: /(步骤|过程|内容|方法|操作)/ },
  { kind: 'analysis', match: /(分析|讨论|思考)/ },
  { kind: 'results', match: /(结果|数据|记录|现象|验证)/ },
  { kind: 'problems', match: /(问题|故障|排错|异常|错误)/ },
  { kind: 'summary', match: /(总结|心得|体会|收获|结论)/ },
  { kind: 'references', match: /(参考|文献|资料)/ },
]

const BUILTIN_BLOCKS = [
  { type: 'heading', level: 1, text: '一、实验目的' },
  { type: 'heading', level: 1, text: '二、实验环境与器材' },
  { type: 'heading', level: 1, text: '三、实验步骤' },
  { type: 'heading', level: 1, text: '四、实验结果与数据' },
  { type: 'heading', level: 1, text: '五、结果分析' },
  { type: 'heading', level: 1, text: '六、问题与解决' },
  { type: 'heading', level: 1, text: '七、实验总结' },
]

function safeName(value, fallback = 'report') {
  return String(value || fallback).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback
}

function slug(value) {
  return safeName(value, 'template').replace(/\s+/g, '-').toLowerCase().slice(0, 48)
}

function kindOf(title) {
  for (const rule of KIND_RULES) if (rule.match.test(title)) return rule.kind
  return 'other'
}

function dateText(value) {
  try {
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
  } catch {
    return String(value || '')
  }
}

export function buildProfile(blocks, options = {}) {
  const headings = []
  let current = null
  let documentTitle = options.title || ''
  let startIndex = 0
  const first = blocks[0]
  // 只把“看起来像报告标题”的一级标题当标题，避免把“一、实验目的”吃掉。
  const looksLikeTitle = Boolean(first && /(报告|模板|report|实验名称|课程设计)/i.test(first.text))
  const hasDeeperHeading = Boolean(first && blocks.slice(1).some((block) => block.type === 'heading' && block.level > first.level))
  if (first?.type === 'heading' && first.level === 1 && (looksLikeTitle || hasDeeperHeading)) {
    documentTitle = first.text
    startIndex = 1
  }
  const metaLabels = []
  let seenHeading = false
  for (const block of blocks.slice(startIndex)) {
    if (block.type === 'heading') {
      seenHeading = true
      current = {
        title: block.text,
        level: block.level,
        kind: kindOf(block.text),
        templateHints: [],
        tableHeaders: [],
        tableRows: 0,
        required: !/选做|可选/.test(block.text),
      }
      headings.push(current)
      continue
    }
    if (block.type === 'table' && !seenHeading && !metaLabels.length) {
      for (const row of block.rows) {
        const label = String(row[0] || '').trim()
        if (label && label.length <= 20) metaLabels.push(label)
      }
      continue
    }
    if (!current) {
      if (block.type === 'paragraph') {
        current = { title: options.fallbackTitle || '实验报告', level: 1, kind: 'other', templateHints: [], tableHeaders: [], tableRows: 0, required: true }
        headings.push(current)
      } else continue
    }
    if (block.type === 'paragraph' && current.templateHints.length < 3) current.templateHints.push(block.text)
    if (block.type === 'table') {
      if (!current.tableHeaders.length) current.tableHeaders = block.rows[0] || []
      current.tableRows = Math.max(current.tableRows, Math.max(0, block.rows.length - 1))
    }
  }
  const warnings = []
  if (!headings.length) warnings.push('模板里没有识别到标题层级，已回退为内置通用结构。')
  if (!headings.some((item) => item.kind === 'results')) warnings.push('模板里没有“结果/数据”章节，生成时会追加一节。')

  return {
    schemaVersion: 1,
    id: options.id || `tpl-${Date.now().toString(36)}`,
    name: options.name || '实验报告模板',
    title: documentTitle,
    sourceFile: options.sourceFile || '',
    sourceType: options.sourceType || 'builtin',
    importedAt: options.importedAt || new Date().toISOString(),
    metaLabels,
    sections: headings,
    warnings,
  }
}

export function importTemplate({ filePath, name, homeDir }) {
  const full = resolve(String(filePath || ''))
  if (!existsSync(full)) throw new Error(`找不到模板文件：${full}`)
  const stat = statSync(full)
  if (!stat.isFile()) throw new Error('模板路径不是文件')
  if (stat.size > MAX_TEMPLATE_BYTES) throw new Error('模板超过 10 MB，请先精简')
  const ext = extname(full).toLowerCase()
  let blocks
  let sourceType
  if (ext === '.docx') {
    blocks = readDocx(readFileSync(full)).blocks
    sourceType = 'docx'
  } else if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
    blocks = readMarkdown(readFileSync(full, 'utf8'))
    sourceType = ext.replace('.', '')
  } else {
    throw new Error('只支持 .docx、.md、.txt 模板')
  }
  const profile = buildProfile(blocks, {
    name: name || basename(full, ext),
    sourceFile: full,
    sourceType,
  })
  if (homeDir) {
    const dir = join(resolve(homeDir), 'report-templates')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${slug(profile.name)}-${profile.id.slice(-6)}.json`)
    writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`, 'utf8')
    profile.storedAt = file
  }
  return profile
}

export function listTemplates(homeDir) {
  const dir = join(resolve(homeDir), 'report-templates')
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => {
      try {
        const data = JSON.parse(readFileSync(join(dir, name), 'utf8'))
        return { id: data.id, name: data.name, sections: data.sections?.length || 0, importedAt: data.importedAt, storedAt: join(dir, name) }
      } catch {
        return null
      }
    }).filter(Boolean)
  } catch {
    return []
  }
}

export function loadTemplate(homeDir, templateId) {
  const found = listTemplates(homeDir).find((item) => item.id === templateId)
  if (!found) throw new Error('找不到该模板，请先导入')
  return JSON.parse(readFileSync(found.storedAt, 'utf8'))
}

function listEvidence(experiment) {
  const root = experiment?.workDir
  const scan = (sub) => {
    try {
      return readdirSync(join(root, sub)).filter((name) => !name.startsWith('.')).sort()
    } catch {
      return []
    }
  }
  return {
    screenshots: scan('screenshots').filter((name) => IMAGE_RE.test(name)),
    data: scan('data'),
    reports: scan('reports'),
  }
}

function environmentLines(environment) {
  if (!environment) return []
  const os = environment.os || {}
  const lines = []
  const osName = [os.version, os.release ? `build ${os.release}` : '', os.arch].filter(Boolean).join(' · ')
  if (osName) lines.push(`操作系统：${osName}`)
  if (environment.memoryGB) lines.push(`内存：${environment.memoryGB} GB`)
  const apps = (environment.dependencies?.length ? environment.dependencies : environment.installed) || []
  if (apps.length) {
    lines.push(`已安装组件：${apps.slice(0, 8).map((app) => `${app.name}${app.version && !app.name.includes(app.version) ? ` ${app.version}` : ''}`).join('、')}`)
  }
  return lines
}

function historyLines(history, software) {
  const target = String(software || '').toLowerCase()
  const attempts = (history?.attempts || []).filter((item) => !target
    || String(item.softwareId || '').toLowerCase() === target
    || String(item.name || '').toLowerCase() === target)
  return attempts.slice(0, 8).map((item) => `${item.name || item.component} ${item.version} → ${item.outcome === 'worked' ? '可用' : '失败'}${item.symptom ? `（${item.symptom}）` : ''}`)
}


function stepTitles(experiment) {
  return (experiment.steps || []).map((step) => String(step.title || '').trim()).filter(Boolean)
}

function dataExcerpt(experiment, evidence) {
  const lines = []
  const wanted = /[.](txt|csv|log|json|md|ini|conf)$/i
  for (const name of evidence.data.filter((item) => wanted.test(item)).slice(0, 3)) {
    try {
      const file = join(experiment.workDir, 'data', name)
      if (statSync(file).size > 200 * 1024) continue
      const content = readFileSync(file, 'utf8').replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 8)
      if (content.length) lines.push(`${name}：${content.join('；')}`)
    } catch {
      // 单个数据文件读不到就跳过，不影响整份报告。
    }
  }
  return lines
}

function fillResultTable(headers, experiment) {
  if (!headers.length) return null
  const steps = (experiment.steps || []).slice(0, 8)
  if (!steps.length) return { headers, rows: [headers.map(() => '【待补】')] }
  const rows = steps.map((step) => headers.map((header) => {
    if (/(测试项|项目|步骤|内容|操作)/.test(header)) return String(step.title || '【待补】')
    if (/预期/.test(header)) return String(step.expected || '【待补】')
    if (/实际|现象|输出/.test(header)) return String(step.actual || '【待补】')
    if (/结论|判定/.test(header)) return step.passed === true ? '符合预期' : step.passed === false ? '不符合预期' : '【待补】'
    return '【待补】'
  }))
  return { headers, rows }
}

function softwareFacts(software) {
  try {
    const entry = getCatalog().software.find((item) => item.id === String(software || '').toLowerCase()
      || item.name.toLowerCase() === String(software || '').toLowerCase())
    if (!entry) return null
    return { name: entry.name, category: entry.category, notes: entry.notes }
  } catch {
    return null
  }
}

// 把章节标题里的「表名 / 英文标识符」和已完成的步骤对上，
// 例如「4.3.1 院系信息表 Dept_info」↔「创建 Dept_info（院系信息表）」
function tokensOf(text) {
  const source = String(text || '')
  const ascii = (source.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || []).map((item) => item.toLowerCase())
  const cjk = source.match(/[\u4e00-\u9fa5]{2,}/g) || []
  return { ascii, cjk }
}

function matchStepByTitle(title, experiment) {
  const steps = Array.isArray(experiment && experiment.steps) ? experiment.steps : []
  if (!steps.length) return null
  const wanted = tokensOf(title)
  if (!wanted.ascii.length) return null          // 没有英文标识符就不猜，避免误配
  let best = null
  let bestScore = 0
  for (const step of steps) {
    if (step.status !== 'done' && step.status !== 'skipped') continue
    const hay = [step.title, step.instruction, step.where, step.actual].join(' ').toLowerCase()
    let score = 0
    let asciiHit = false
    for (const token of wanted.ascii) {
      if (hay.includes(token)) { score += 3; asciiHit = true }
    }
    if (!asciiHit) continue
    for (const token of wanted.cjk) if (hay.includes(token)) score += 1
    if (score > bestScore) { bestScore = score; best = step }
  }
  return bestScore >= 3 ? best : null
}

// 同一张截图只插一次；图号在全篇连续编号
function pushImage(ctx, file, name) {
  const key = String(name || '')
  if (!key || ctx.usedImages.has(key)) return null
  try {
    if (statSync(file).size > MAX_IMAGE_BYTES) return null
    ctx.usedImages.add(key)
    ctx.imageSeq += 1
    return { name: safeName(key), data: readFileSync(file), caption: `图 ${ctx.imageSeq}　${key.replace(/\.[a-z]+$/i, '')}` }
  } catch {
    return null
  }
}

function autoContent(section, ctx) {
  const { experiment, environment, history, evidence, student } = ctx
  switch (section.kind) {
    case 'environment': {
      const lines = environmentLines(environment)
      if (lines.length) return { coverage: 'auto', paragraphs: lines, bullets: [] }
      return { coverage: 'pending', paragraphs: ['【待补：实验环境】填写操作系统、软件名称与版本、硬件配置。'], bullets: [] }
    }
    case 'steps': {
      const steps = experiment.steps || []
      if (steps.length) {
        return {
          coverage: 'auto',
          paragraphs: steps.map((step, index) => `${index + 1}. ${step.title}${step.instruction ? `：${step.instruction}` : ''}${step.expected ? `\n预期：${step.expected}` : ''}${step.actual ? `\n实际：${step.actual}` : ''}`),
          bullets: [],
        }
      }
      return { coverage: 'pending', paragraphs: ['【待补：实验步骤】已建立实验档案但还没有录入步骤。'], bullets: [] }
    }
    case 'results': {
      const paragraphs = []
      const bullets = []
      const images = []
      if (evidence.screenshots.length) {
        paragraphs.push(`本次实验共保存 ${evidence.screenshots.length} 张截图，按文件名顺序插入。`)
        for (const name of evidence.screenshots.slice(0, MAX_IMAGES)) {
          const file = join(experiment.workDir, 'screenshots', name)
          try {
            const image = pushImage(ctx, file, name)
            if (image) images.push(image)
          } catch {
            // 单张图片读失败不影响整份报告。
          }
        }
      }
      if (evidence.data.length) bullets.push(`数据文件：${evidence.data.join('、')}`)
      if (experiment.notes) paragraphs.push(`实验备注：${experiment.notes}`)
      const table = fillResultTable(section.tableHeaders, experiment)
      if (!images.length && !evidence.data.length && !experiment.notes) {
        return {
          coverage: 'pending',
          paragraphs: ['【待补：实验结果】没有找到截图或数据文件。可先把结果截图放进实验档案的 screenshots 目录。'],
          bullets,
          table,
        }
      }
      return { coverage: images.length || evidence.data.length ? 'auto' : 'partial', paragraphs, bullets, table, images }
    }
    case 'problems': {
      const lines = historyLines(history, experiment.software)
      const steps = experiment.steps || []
      const failures = steps.filter((step) =>
        step.passed === false || /ERROR|失败|拒绝|超时|denied|refus/i.test(String(step.actual || '') + ' ' + String(step.notes || '')))
      const bullets = [
        ...failures.slice(0, 8).map((step) => `「${step.title}」：${String(step.actual || step.notes || '').trim()}`),
        ...lines,
      ]
      if (bullets.length) {
        return {
          coverage: 'auto',
          paragraphs: failures.length
            ? [`本次共遇到 ${failures.length} 处与预期不符的情况，按出现顺序记录如下：`]
            : ['本机记录的版本与环境处理过程：'],
          bullets,
          draftNote: failures.length
            ? '现象已从实测记录自动抽取；原因与最终处理方式请补充一句。'
            : '',
        }
      }
      return { coverage: 'partial', paragraphs: ['【待补：问题与解决】本次实验未记录故障。如果过程中出现过报错，请补上现象、原因和处理方式。'], bullets: [] }
    }
    case 'purpose': {
      const steps = experiment.steps || []
      if (!steps.length) {
        return { coverage: 'pending', paragraphs: ['【待补：实验目的】先录入实验步骤，或按指导书手写。'], bullets: [] }
      }
      return {
        coverage: 'draft',
        paragraphs: [`本实验属于《${experiment.course || '本课程'}》的“${experiment.title || '实验'}”，在 ${experiment.software || '实验软件'} 环境中完成。`],
        bullets: steps.slice(0, 6).map((step) => `完成「${step.title}」${step.expected ? `，达到“${step.expected}”` : ''}`),
        draftNote: '自动草稿，请按指导书核对目标表述。',
      }
    }
    case 'principle': {
      const facts = softwareFacts(experiment.software)
      const steps = stepTitles(experiment)
      if (!steps.length && !facts) {
        return { coverage: 'pending', paragraphs: ['【待补：实验原理】按教材补充机制说明。'], bullets: [] }
      }
      const paragraphs = []
      if (facts) paragraphs.push(`${facts.name} 属于${facts.category}。${facts.notes || ''}`.trim())
      if (steps.length) paragraphs.push(`本实验涉及的操作对象：${steps.join('、')}。原理部分应说明这些操作背后的机制、数据流向和判定依据。`)
      return {
        coverage: 'draft',
        paragraphs,
        bullets: [],
        draftNote: '自动草稿，机制说明需按教材补充，不要直接提交。',
      }
    }
    case 'analysis': {
      const steps = experiment.steps || []
      const hasEvidence = evidence.screenshots.length || evidence.data.length || experiment.notes
      if (!hasEvidence || !steps.length) {
        return { coverage: 'partial', paragraphs: ['【待补：结果分析】需要真实结果和步骤后才能分析。'], bullets: [] }
      }
      const excerpt = dataExcerpt(experiment, evidence)
      const measured = steps.filter((step) => String(step.actual || '').trim())
      const paragraphs = [
        `本次实验记录了 ${steps.length} 个步骤、${evidence.screenshots.length} 张截图、${evidence.data.length} 个数据文件。`,
      ]
      if (excerpt.length) paragraphs.push(`数据摘录：${excerpt.join('　')}`)
      // 每条 actual 本身就是一句实测结论，直接转成"实测发现…"比留占位强得多
      if (measured.length) {
        paragraphs.push(`实测结论：${measured
          .slice(0, 6)
          .map((step) => `${step.title}——${String(step.actual).trim()}${step.passed === true ? '（与预期一致）' : step.passed === false ? '（与预期不一致）' : ''}`)
          .join('；')}。`)
      }
      const unmeasured = steps.filter((step) => !String(step.actual || '').trim())
      return {
        coverage: measured.length ? 'auto' : 'draft',
        paragraphs,
        bullets: unmeasured.slice(0, 6).map((step) => `「${step.title}」还没有实测值，需要补做或补记录。`),
        draftNote: measured.length
          ? '结论由已录入的实测值自动汇总；因果分析与误差讨论仍需本人补充。'
          : '自动草稿，只列出了应分析的对象，因果结论必须由本人根据真实数据补写。',
      }
    }
    case 'summary': {
      const steps = stepTitles(experiment)
      const failures = historyLines(history, experiment.software)
      if (!steps.length) {
        return { coverage: 'pending', paragraphs: ['【待补：实验总结】先录入步骤，或按实际过程手写。'], bullets: [] }
      }
      const bullets = steps.slice(0, 5).map((title) => `完成了「${title}」的操作。`)
      if (failures.length) bullets.push(`本机经验库记录了 ${failures.length} 次版本/环境处理，可作为排错依据。`)
      return {
        coverage: 'draft',
        paragraphs: ['实际结果是否达到预期，需结合实验结果与截图核对后再下结论。'],
        bullets,
        draftNote: '自动草稿，请补充个人收获、不足和改进办法。',
      }
    }
    case 'references': {
      return { coverage: 'partial', paragraphs: ['【待补：参考资料】课程指导书、教材、官方文档链接。'], bullets: [] }
    }
    case 'topology': {
      const match = evidence.screenshots.find((name) => /(拓扑|topology|topo)/i.test(name))
      if (!match) {
        return { coverage: 'pending', paragraphs: ['【待补：拓扑图】把文件名含“拓扑”的截图放进 screenshots 目录，重新生成会自动插入。'], bullets: [] }
      }
      const images = []
      try {
        const file = join(experiment.workDir, 'screenshots', match)
        if (statSync(file).size <= MAX_IMAGE_BYTES) images.push({ name: safeName(match), data: readFileSync(file), caption: `图 1　${match}` })
      } catch {
        // 图片读不到时退回待补。
      }
      if (!images.length) return { coverage: 'pending', paragraphs: ['【待补：拓扑图】截图读取失败，请检查文件。'], bullets: [] }
      return { coverage: 'auto', paragraphs: [`拓扑图文件：${match}`], bullets: [], images }
    }
    default: {
      // 模板章节常写成「4.3.1 院系信息表 Dept_info」，可直接对上同名步骤
      const matchedStep = matchStepByTitle(section.title, ctx.experiment)
      if (matchedStep) {
        const paragraphs = []
        if (matchedStep.actual) paragraphs.push(matchedStep.actual)
        if (matchedStep.where) paragraphs.push(`执行：${matchedStep.where}`)
        if (!paragraphs.length) paragraphs.push(`${matchedStep.title}：已完成，详见实验步骤。`)
        // 该步骤留下的截图一并插进本节（对应成品报告里的「图 1-x」）
        const images = []
        for (const rel of matchedStep.evidence || []) {
          if (!/\.(png|jpg|jpeg|webp)$/i.test(String(rel))) continue
          const file = join(ctx.experiment.workDir, String(rel))
          const name = String(rel).split(/[\\/]/).pop()
          const image = pushImage(ctx, file, name)
          if (image) images.push(image)
        }
        return { coverage: 'auto', paragraphs, bullets: [], images }
      }
      if (section.templateHints.length) return { coverage: 'partial', paragraphs: [], bullets: [] }
      return { coverage: 'pending', paragraphs: [`【待补：${section.title}】模板要求的本节内容。`], bullets: [] }
    }
  }
}

export function buildReportPlan({ experiment, profile, environment, history, student, overrides }) {
  if (!experiment) throw new Error('缺少实验档案')
  const effectiveProfile = profile && profile.sections?.length ? profile : buildProfile(BUILTIN_BLOCKS, { name: '内置通用实验报告' })
  const evidence = listEvidence(experiment)
  const ctx = { experiment, environment, history, evidence, student: student || {}, imageSeq: 0, usedImages: new Set() }
  const overrideFor = (title) => {
    if (!overrides || typeof overrides !== 'object') return ''
    const key = String(title || '').trim()
    if (overrides[key]) return String(overrides[key]).trim()
    for (const name of Object.keys(overrides)) {
      if (key.includes(name) || name.includes(key)) return String(overrides[name] || '').trim()
    }
    return ''
  }

  const sections = effectiveProfile.sections.map((section) => {
    const written = overrideFor(section.title)
    const content = written
      ? { coverage: 'auto', paragraphs: written.split(/\n+/), bullets: [], images: [] }
      : autoContent(section, ctx)
    return {
      title: section.title,
      level: section.level,
      kind: section.kind,
      required: section.required,
      coverage: content.coverage,
      autoFields: content.coverage === 'auto' ? ['内容已自动填充'] : [],
      pending: content.coverage === 'auto' ? [] : [`${section.title}需要补充`],
      templateHints: section.templateHints,
      _content: content,
    }
  })
  const total = sections.length || 1
  const auto = sections.filter((item) => item.coverage === 'auto').length
  const draft = sections.filter((item) => item.coverage === 'draft').length
  const partial = sections.filter((item) => item.coverage === 'partial').length
  const pending = sections.filter((item) => item.coverage === 'pending').length
  const missing = []
  if (!evidence.screenshots.length) missing.push('实验截图目录为空')
  if (!evidence.data.length) missing.push('数据目录为空')
  if (!(experiment.steps || []).length) missing.push('实验步骤未录入')
  if (!(experiment.notes || '').trim()) missing.push('实验备注为空')

  return {
    ok: true,
    experiment: {
      id: experiment.id,
      title: experiment.title,
      course: experiment.course,
      software: experiment.software,
      workDir: experiment.workDir,
    },
    template: { id: effectiveProfile.id, name: effectiveProfile.name, sourceType: effectiveProfile.sourceType },
    coverage: {
      total,
      auto,
      draft,
      partial,
      pending,
      percent: Math.round(((auto + draft * 0.75 + partial * 0.5) / total) * 100),
    },
    drafts: sections.filter((item) => item.coverage === 'draft').map((item) => item.title),
    missing,
    evidence,
    sections: sections.map(({ _content, ...rest }) => rest),
    next: pending || partial
      ? '先把标记【待补】的部分补齐；截图放进 screenshots 目录后重新生成，会自动插入。'
      : '结构已填满，建议通读一遍再提交。',
    _sections: sections,
    _evidence: evidence,
    _profile: effectiveProfile,
  }
}

function markdownOf(model) {
  const lines = []
  if (model.title) lines.push(`# ${model.title}`, '')
  if (model.subtitle) lines.push(`> ${model.subtitle}`, '')
  if (model.meta?.length) {
    lines.push('| 项目 | 内容 |', '| --- | --- |')
    for (const [label, value] of model.meta) lines.push(`| ${label} | ${value} |`)
    lines.push('')
  }
  for (const section of model.sections) {
    if (section.title) lines.push(`${'#'.repeat(Math.min(6, Math.max(2, section.level + 1)))} ${section.title}`, '')
    for (const text of section.paragraphs || []) lines.push(text, '')
    for (const text of section.bullets || []) lines.push(`- ${text}`)
    if (section.bullets?.length) lines.push('')
    if (section.table) {
      lines.push(`| ${section.table.headers.join(' | ')} |`)
      lines.push(`| ${section.table.headers.map(() => '---').join(' | ')} |`)
      for (const row of section.table.rows) lines.push(`| ${row.join(' | ')} |`)
      lines.push('')
    }
    for (const image of section.images || []) {
      lines.push(`![${image.caption || image.name}](../screenshots/${image.name})`, '')
      if (image.caption) lines.push(`*${image.caption}*`, '')
    }
  }
  return `${lines.join('\n').trim()}\n`
}

function metaValue(label, context) {
  const { experiment, student } = context
  if (/实验名称|实验题目|项目名称/.test(label)) return experiment.title || '【待补】'
  if (/课程|科目/.test(label)) return experiment.course || '【待补】'
  if (/软件|工具|平台|模拟器/.test(label)) return experiment.software || '【待补】'
  if (/姓名/.test(label)) return student?.name || '【待补】'
  if (/学号/.test(label)) return student?.studentId || '【待补】'
  if (/班级|专业|学院/.test(label)) return '【待补】'
  if (/教师|指导/.test(label)) return '【待补】'
  if (/日期|时间/.test(label)) return dateText(Date.now())
  if (/编号/.test(label)) return experiment.id
  return '【待补】'
}

function modelOf(plan, student) {
  const experiment = plan.experiment
  const labels = plan._profile?.metaLabels || []
  const meta = labels.length
    ? labels.map((label) => [label, metaValue(label, { experiment, student })])
    : [
      ['课程', experiment.course || '【待补】'],
      ['实验软件', experiment.software || '【待补】'],
      ['实验编号', experiment.id],
      ['生成日期', dateText(Date.now())],
      ['姓名 / 学号', `${student?.name || '【待补】'} / ${student?.studentId || '【待补】'}`],
    ]
  const sections = plan._sections.map((section) => {
    const content = section._content || {}
    return {
      title: section.title,
      level: section.level,
      paragraphs: [...(content.paragraphs || [])],
      bullets: content.bullets || [],
      table: content.table || null,
      images: content.images || [],
    }
  })
  return {
    title: experiment.title || '实验报告',
    subtitle: [experiment.course, '实验报告'].filter(Boolean).join(' · '),
    meta,
    sections,
  }
}

export function generateReport({ plan, student, outputDir }) {
  const model = modelOf(plan, student)
  const markdown = markdownOf(model)
  const docx = buildDocx(model)
  const base = safeName(`${plan.experiment.title || '实验报告'}-${dateText(Date.now()).replace(/\//g, '')}`)
  const dir = resolve(outputDir || join(plan.experiment.workDir, 'reports'))
  mkdirSync(dir, { recursive: true })
  const markdownPath = join(dir, `${base}.md`)
  const docxPath = join(dir, `${base}.docx`)
  writeFileSync(markdownPath, markdown, 'utf8')
  writeFileSync(docxPath, docx)
  return {
    ok: true,
    files: { markdown: markdownPath, docx: docxPath },
    bytes: { markdown: Buffer.byteLength(markdown), docx: docx.length },
    coverage: plan.coverage,
    placeholderCount: (markdown.match(/【待补/g) || []).length,
    note: '输出为本地文件，未上传；提交前请把【待补】内容替换为真实数据。',
  }
}

export function builtinProfile() {
  return buildProfile(BUILTIN_BLOCKS, { name: '内置通用实验报告', sourceType: 'builtin', id: 'builtin-generic' })
}
