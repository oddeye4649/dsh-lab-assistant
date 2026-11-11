// 宿主无关的业务门面。
// 约定：不读 DSH 环境变量、不 import DSH 包；所有方法返回 JSON 可序列化对象。
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { catalogHighlights, searchCatalog } from './catalog.mjs'
import { probeEnvironment } from './probe.mjs'
import { adviseCompatibility } from './advisor.mjs'
import { planRepair, recordRepair, RepairHistory } from './remedy.mjs'
import { buildReportPlan, builtinProfile, deleteTemplate, generateReport, importTemplate, listTemplates, loadTemplate } from './report.mjs'
import { KnowledgeBase, safeKnowledgeCall } from './knowledge.mjs'

const WORKFLOW = [
  '1 读档案：experiment_get（没有就先 experiment_create，把模板/要求/数据路径填进去）',
  '1.5 确认模板：动手之前先在会话里问用户「老师发的实验报告模板是哪个 .docx？」',
  '    有模板 → lab_report_template(path) 导入，模板决定封面字段和章节；',
  '    用户明确说没有 → 用内置封面（课程名称/专业年级/学期/学号/姓名），report_generate 传 useBuiltin:true',
  '    不要默认套通用模板：实测会因格式对不上整份返工',
  '2 读经验：experiment_get 的返回里已带 knowledge（坑 / 控件位置 / 失败记录 / 热区），开工前直接看，不用再单独调 note_list',
  '    指路用 desktop_guide(controlName:"按钮名")，插件按控件级经验定位；同一个窗口换按钮不会串到上一次的位置',
  '    想深挖再调 knowledge_query(software)；档案里没有的经验不会凭空出现，别自己猜按钮位置',
  '3 归位窗口：desktop_place(process|windowTitle, width, height) —— 固定矩形，截图与坐标才可复用；插件会登记窗口尺寸，尺寸变了会自动降级不套旧坐标',
  '4 逐步执行：粒度按文档自己的分节/编号走（文档说一次做完就一次做完），每步一次截图 → 立即 desktop_screenshot → 校验预期变化',
  '    通过才 record_result(passed=true, evidence=[截图])；不通过就 record_result(passed=false) 并停下问人',
  '5 出报告：report_generate',
  '6 读交接单：reports/handoff.md —— 缺口、该软件经验、每步实测都在里面',
  '7 解释待补：把 pending 逐条说明原因（模板不匹配 / 没做到 / 需人工补数据），',
  '    并明确告诉用户「这份报告还不能交」；文件顶部已加红色警示条，补全后重新生成才会消失',
  '8 复盘写经验：note_add(software, kind, text) —— 坑 pitfall、位置 where、技巧 tip；',
  '    记住按钮位置时补上 controlName + window + rect，会一并写成可执行的控件条目，下次能直接命中',
  '',
  '被挡时的替代方案：',
  '- 控件读不到（eNSP / Weka）→ 整窗高亮 + 截图自己看位置，坐标记进 where',
  '- 文件对话框输入不进去 → 让用户在面板「数据」行选一次，或命令行带参启动',
  '- 里层菜单选不中 → 用命令行等价操作，并在报告里注明「GUI 未使用，CLI 执行」',
  '- 点击后没变化 → 先怀疑控件被禁用，再怀疑坐标',
].join('\n')

export function createCore({ store, version = '0.0.0', assetsRoot = '', hostNotes = [], overlay = null, knowledge = null }) {
  if (!store) throw new Error('createCore 需要 store')
  // 经验库：默认自建（core 单测也能独立跑），宿主可注入同一个实例共享缓存。
  const kb = knowledge || new KnowledgeBase(store)

  function assetStatus() {
    const petDir = join(assetsRoot, 'pet')
    let files = []
    try { files = readdirSync(petDir) } catch { files = [] }
    const hasGroup = (base) => files.some((name) => name === `${base}.png` || (name.startsWith(`${base}_`) && name.endsWith('.png')))
    const countGroup = (base) => files.filter((name) => name === `${base}.png` || (name.startsWith(`${base}_`) && name.endsWith('.png'))).length
    const groups = ['idle', 'swim', 'dash', 'point', 'happy', 'confused']
    return {
      states: Object.fromEntries(groups.map((name) => [`${name}.png`, hasGroup(name)])),
      frames: Object.fromEntries(groups.map((name) => [name, countGroup(name)])),
      icon: existsSync(join(assetsRoot, 'icon.png')),
      note: '桌宠素材由桌面伴随进程直接读取本地文件；网页内不再注入桌宠。',
    }
  }

  function pageMapDir() {
    return join(store.homeDir, 'page-maps')
  }

  function listPageMaps(software) {
    const dir = pageMapDir()
    let files = []
    try { files = readdirSync(dir).filter((name) => name.endsWith('.json')) } catch { return [] }
    const maps = files.map((name) => {
      try {
        const data = JSON.parse(readFileSync(join(dir, name), 'utf8'))
        return { file: join(dir, name), software: data.software, version: data.version, windowTitle: data.windowTitle, controls: (data.controls || []).length, capturedAt: data.capturedAt }
      } catch { return null }
    }).filter(Boolean)
    const matched = software ? maps.filter((item) => String(item.software).toLowerCase() === String(software).toLowerCase()) : maps
    return matched.sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)))
  }

  // 从实验档案里找回用户当初选的模板。
  // 面板新建实验时把「模板库」里选中的模板 ID 写进 reportTemplate，
  // 会话侧也可能直接写路径或名称。早期只认 args.templateId，
  // 结果是：面板导入并绑定了模板，会话里生成报告却静默套用内置通用模板
  // （章节和老师要求对不上，而且没有任何提示）。
  function resolveStoredTemplate(value) {
    const key = String(value || '').trim()
    if (!key) return null
    try { return loadTemplate(store.homeDir, key) } catch { /* 不是模板 ID，继续按名称/路径找 */ }
    const dir = join(store.homeDir, 'report-templates')
    let files = []
    try { files = readdirSync(dir).filter((name) => name.endsWith('.json')) } catch { return null }
    const asPath = key.replace(/\//g, '\\').toLowerCase()
    for (const name of files) {
      try {
        const data = JSON.parse(readFileSync(join(dir, name), 'utf8'))
        if (String(data.id || '') === key) return data
        if (String(data.name || '') === key) return data
        if (String(data.sourceFile || '').replace(/\//g, '\\').toLowerCase() === asPath) return data
      } catch { /* 单个坏文件不影响其它模板 */ }
    }
    // 最后把档案里的值当模板文件路径试一次；只有文件确实存在才导入，避免无谓写盘
    if (existsSync(key)) {
      try { return importTemplate({ filePath: key, homeDir: store.homeDir }) } catch { return null }
    }
    return null
  }

  async function reportPlanFor(args = {}) {
    // 不传编号时退回当前实验：面板和会话里都常用「就刚才那份」
    const experimentId = String(args.experimentId || args.id || store.currentExperimentId() || '').trim()
    if (!experimentId) throw new Error('缺少实验编号（当前也没有选中的实验）')
    const experiment = store.getExperiment(experimentId)
    let profile = null
    if (args.templateId) {
      try { profile = loadTemplate(store.homeDir, String(args.templateId)) } catch { profile = null }
    }
    if (args.templatePath) {
      profile = importTemplate({ filePath: String(args.templatePath), homeDir: store.homeDir })
    }
    // 显式参数都没给：回到实验档案里找（templateId 优先，其次 reportTemplate）
    if (!profile) profile = resolveStoredTemplate(experiment.templateId)
    if (!profile) profile = resolveStoredTemplate(experiment.reportTemplate)
    // 是否真的拿到了「老师给的模板」：只有真加载到才算，否则会静默用内置结构
    const hasTemplate = Boolean(profile)
    if (!profile) profile = builtinProfile()
    const environment = await probeEnvironment({ software: experiment.software })
    const attempts = new RepairHistory(store.homeDir).list()
    const plan = buildReportPlan({ experiment, profile, environment, history: { attempts }, overrides: args.sectionTexts })
    plan.templateMissing = !hasTemplate
    plan.templateSource = hasTemplate
      ? (profile.storedAt || profile.sourceFile || profile.name || '')
      : ''
    plan.requirementPath = String(experiment.requirementPath || '').trim()
    return plan
  }

  return {
    workflow() {
      return { ok: true, workflow: WORKFLOW, mustExplainPending: true }
    },

    status() {
      const base = {
        ok: true,
        plugin: 'dsh-lab-assistant',
        version,
        ...store.status(),
        assets: assetStatus(),
        catalog: catalogHighlights(),
        readOnlyProbeAvailable: true,
        hostDeps: hostNotes,
      }
      // 多任务实验最需要的是「哪一步到哪了」：按 已执行 / 已配置 / 已截图 / 已记录 四态给出来
      try {
        const currentId = store.currentExperimentId()
        const experiment = currentId ? store.getExperiment(currentId) : null
        if (!experiment) return base
        let screenshotCount = 0
        try {
          const dir = join(experiment.workDir, 'screenshots')
          screenshotCount = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f)).length : 0
        } catch { screenshotCount = 0 }
        const steps = (experiment.steps || []).map((step, index) => {
          const recorded = Boolean(String(step.actual || '').trim()) || step.passed === true || step.passed === false
          const executed = recorded || (step.status && step.status !== 'pending')
          const configured = Boolean(String(step.where || '').trim()) || Boolean(String(step.notes || '').trim())
          return {
            index: index + 1,
            title: step.title,
            status: step.status || 'pending',
            executed,
            configured,
            recorded,
            passed: step.passed,
            actual: String(step.actual || '').slice(0, 80),
          }
        })
        base.currentExperiment = {
          id: experiment.id,
          title: experiment.title,
          mode: store.currentMode(),
          screenshotCount,
          steps,
          missing: {
            notExecuted: steps.filter((x) => !x.executed).map((x) => x.title),
            notRecorded: steps.filter((x) => !x.recorded).map((x) => x.title),
            noScreenshot: screenshotCount === 0 ? '整个实验一张截图都没有' : '',
          },
          note: '四态含义：executed=执行过（有状态或实测）；configured=记录了位置/笔记；recorded=有实测值或通过判定；截图是实验级总数。',
        }
      } catch { /* 状态增强失败不影响主状态 */ }
      return base
    },

    softwareCatalog(args = {}) {
      return { ok: true, ...searchCatalog(args) }
    },

    pageMapList(software = '') {
      const maps = listPageMaps(software ? String(software) : '')
      // page-maps 只作为导入源保留；查询主路径是 interface（唯一真相）。
      const name = String(software || '').trim()
      const iface = name ? safeKnowledgeCall(() => {
        const data = kb.getInterface(name)
        const controls = (data.controls || []).filter((c) => c.name !== '__window__')
        return {
          software: name,
          version: data.version,
          controlCount: controls.length,
          updatedAt: data.updatedAt,
          controls: controls.slice(0, 20).map((c) => ({
            name: c.name, window: c.window, rect: c.rect, source: c.source, hits: c.hits || 0,
          })),
        }
      }, null) : null
      return { ok: true, maps, interface: iface, note: 'page-maps 是历史导入源；指引定位请以 interface 为准。' }
    },

    experimentCreate(args = {}) {
      // 面板写 templateId、会话侧常写 reportTemplate（ID / 名称 / 路径）。
      // 两者互为别名，统一进档案，否则生成报告时找不到用户选过的模板。
      const input = { ...args }
      const explicitId = String(input.templateId || '').trim()
      const explicitTpl = String(input.reportTemplate || '').trim()
      if (explicitId && !explicitTpl) input.reportTemplate = explicitId
      if (explicitTpl && !explicitId) input.templateId = explicitTpl
      const manifest = store.createExperiment(input)
      // A 经验前置①：新建档案就把同软件的历史经验带出来，不用等 agent 想起来调 note_list
      const knowledge = safeKnowledgeCall(() => {
        const k = kb.knowledgeFor({
          software: manifest.software,
          limits: { pitfalls: 3, controls: 0, failures: 0, hot: 0, tips: 0, where: 0 },
        })
        return k.brief ? { brief: k.brief } : null
      }, null)
      return {
        ok: true,
        experiment: manifest,
        knowledge,
        hint: '实验档案已建立。安装、卸载或修改系统设置仍需用户单独确认。',
        isCurrent: (() => { try { return store.setCurrentExperiment(manifest.id) === manifest.id } catch { return false } })(),
      }
    },

    experimentDelete(args = {}) {
      if (args.confirm !== true) {
        return { ok: false, error: '删除需要显式传 confirm:true', hint: '请先向用户确认要删哪一份，再带 confirm:true 重试。' }
      }
      // 其余工具里这个字段叫 id；这里历史上叫 experimentId。两个都认，避免调用方混用就失败。
      const deleteId = String(args.experimentId || args.id || '').trim()
      if (!deleteId) return { ok: false, error: '需要 experimentId（实验编号）' }
      try {
        const removed = store.deleteExperiment(deleteId)
        return { ok: true, deleted: removed, note: '已移入 _trash，需要时可手动恢复' }
      } catch (error) {
        return { ok: false, error: error.message }
      }
    },

    experimentClone(args = {}) {
      if (!String(args.sourceId || '').trim()) return { ok: false, error: '需要 sourceId' }
      const experiment = store.cloneExperiment(String(args.sourceId).trim(), {
        title: args.title,
        notes: args.notes,
      })
      return {
        ok: true,
        experiment: store.getExperiment(experiment.id),
        hint: '骨架已复制，实测结果为空。按 where 提示逐条操作，完成后用 desktop_screenshot + experiment_record_result 记录。',
      }
    },

    experimentList(args = {}) {
      return { ok: true, experiments: store.listExperiments(args) }
    },

    experimentGet(args = {}) {
      // 不传 id 时退回「当前实验」：workflow 第 1 步就是读档案，
      // agent 常常省略编号，硬失败会让它以为档案不存在。
      const getExpId = String(args.id || args.experimentId || store.currentExperimentId() || '').trim()
      if (!getExpId) return { ok: false, error: '还没有实验档案：先 experiment_create' }
      let experiment
      try {
        experiment = store.getExperiment(getExpId)
      } catch (error) {
        // 抛出去会变成 HTTP 500 / 工具异常；这里统一成和其他方法一样的可读错误
        return { ok: false, error: String(error?.message || error), experimentId: getExpId }
      }
      const mode = String(experiment.mode || 'mixed')
      const modeHint = mode === 'guided'
        ? 'guided：每步都先说做什么、做完截图给人看；慢但最稳。'
        : mode === 'automatic'
          ? 'automatic：连续执行不打断，只在失败或不可逆操作前停下；快但风险高。'
          : 'mixed：只读/可逆操作直接做，删除、清空、覆盖等不可逆操作先确认。'
      try { store.setCurrentExperiment(experiment.id) } catch { /* 忽略 */ }
      // A 经验前置②：agent 开工必读的调用里带经验，硬限流 5/8/3，避免撑爆上下文
      const knowledge = safeKnowledgeCall(() => kb.knowledgeFor({
        software: experiment.software,
        stepId: (experiment.steps || [])[experiment.currentStep || 0]?.id || '',
      }), null)
      const currentStep = (experiment.steps || [])[experiment.currentStep || 0]
      const stepHint = currentStep && Array.isArray(currentStep.actions) && currentStep.actions.length
        ? `上次这步指过：${currentStep.actions.map((a) => a.controlName || a.window).filter(Boolean).join(' → ')}（仅作位置提示，不由插件代点）`
        : ''
      return { ok: true, experiment, modeHint, isCurrent: true, knowledge, stepHint }
    },

    experimentUpdate(args = {}) {
      // 兼容两种写法：patch:{...} 或直接把要改的字段平铺（合并工具后平铺更顺手）
      const patch = (args.patch && typeof args.patch === 'object') ? { ...args.patch } : {}
      for (const key of Object.keys(args)) {
        if (key === 'id' || key === 'patch') continue
        patch[key] = args[key]
      }
      const id = String(args.id || args.experimentId || '').trim()
      if (!id) return { ok: false, error: '需要 id（实验编号）' }
      let experiment
      try {
        experiment = store.updateExperiment(id, patch)
      } catch (error) {
        return { ok: false, error: String(error?.message || error) }
      }
      // B1：归档时压 actions 明细为摘要。重复调用会刷新摘要（归档后又补记动作也能重新压缩）。
      // 不删原始 jsonl —— 用户可在档案里追溯，gzip 只是额外副本。
      if (patch.status === 'archived') {
        const archived = safeKnowledgeCall(() => kb.archiveActions(id, experiment.software), null)
        if (archived) {
          return {
            ok: true,
            experiment,
            archived: {
              expId: archived.expId,
              lines: archived.sourceLines,
              controls: archived.byControl.length,
              steps: archived.steps.length,
              summary: kb.summaryPath(id),
              note: '原始 actions 明细完整保留、未删除；另生成聚合摘要与 gzip 副本。',
            },
          }
        }
      }
      return { ok: true, experiment }
    },

    async experimentRecordResult(args = {}) {
      // 兼容两种写法：id 与 experimentId（其余工具用 experimentId，这里历史原因用 id）
      const expId = String(args.id || args.experimentId || '')
      if (!expId) return { ok: false, error: '需要 id（实验编号）' }
      let result = store.recordStepResult(expId, args)
      const stepKey = String(args.stepId || args.title || '')
      const step = (result.steps || []).find((item) => item.id === stepKey || item.title === stepKey)
      const software = String(result.software || '')
      // L2：记录结果本身也是一条动作；只录事实，不录任何可回放的点击
      safeKnowledgeCall(() => kb.recordAction(expId, {
        action: 'record', stepId: step?.id || stepKey, software,
        controlName: String(args.controlName || ''), ok: args.passed !== false,
      }), null)
      if (args.passed === true) {
        // L2：把这一步骤的指引序列摘要钉进档案，experiment_clone 会随之复制
        const actions = safeKnowledgeCall(() => kb.actionSummary(expId, step?.id || ''), [])
        if (step && actions.length) {
          try {
            const steps = result.steps.map((item) => item.id === step.id ? { ...item, actions } : item)
            result = store.updateExperiment(expId, { steps })
          } catch { /* 摘要写不进去不影响实测结果 */ }
        }
      } else if (args.passed === false) {
        // L4：失败反例，下次走到同一步会先提示，坑不重复踩
        safeKnowledgeCall(() => kb.recordFailure(software, {
          expId, stepId: step?.id || stepKey,
          window: String(args.window || ''),
          controlName: String(args.controlName || ''),
          error: String(args.actual || args.error || '这一步未通过'),
          shot: (Array.isArray(args.evidence) ? args.evidence[0] : '') || '',
        }), null)
      }
      // 这一步做完了，把钉住的框和气泡收走
      if (args.passed === true && overlay && typeof overlay.clear === 'function') {
        try { await overlay.clear() } catch { /* 桌宠不在就算了 */ }
      }
      return { ok: true, experiment: result }
    },

    noteAdd(args = {}) {
      try {
        const entry = store.addSoftwareNote(args.software, args.kind, args.text)
        // L1：文本经验升级成可执行控件条目。带 controlName 时写进 interface，
        // 之后 desktop_guide(controlName) 能直接命中；不带时仍只是文本，行为与旧版一致。
        const control = String(args.controlName || '').trim()
          ? safeKnowledgeCall(() => kb.upsertControl(args.software, {
              controlName: args.controlName,
              window: args.window || args.windowTitle,
              rect: args.rect,
              windowSize: args.windowSize,
              version: args.version,
              purpose: args.text,
              source: 'manual',
              alias: args.alias,
            }), null)
          : null
        return {
          ok: true,
          software: entry.software,
          kind: entry.kind,
          total: entry.pitfalls.length + entry.where.length + entry.tips.length,
          control: control ? { key: control.key, name: control.name, rect: control.rect } : null,
          executable: Boolean(control && control.rect),
        }
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) }
      }
    },

    noteList(args = {}) {
      const notes = store.listSoftwareNotes(args.software ? String(args.software) : '')
      const name = String(args.software || '').trim()
      const controls = name ? safeKnowledgeCall(() => kb.getInterface(name).controls
        .filter((c) => c.name !== '__window__')
        .slice(0, 8)
        .map((c) => ({ name: c.name, window: c.window, rect: c.rect, purpose: c.purpose, source: c.source })), []) : []
      return { ok: true, notes: notes || {}, found: Boolean(notes), controls }
    },

    // A 经验前置③：按需深挖的工具，避免把全部经验一次性塞进上下文
    knowledgeQuery(args = {}) {
      const software = String(args.software || '').trim()
      if (!software) return { ok: false, error: '需要 software' }
      const limits = {}
      for (const key of ['pitfalls', 'controls', 'failures', 'tips', 'where', 'hot']) {
        if (Number.isFinite(Number(args[key])) && Number(args[key]) >= 0) limits[key] = Math.min(50, Number(args[key]))
      }
      const knowledge = safeKnowledgeCall(() => kb.knowledgeFor({ software, stepId: String(args.stepId || ''), limits }), null)
      return { ok: true, software, knowledge }
    },

    knowledgeSettings(args = {}) {
      const action = String(args.action || 'status').toLowerCase()
      if (action === 'status') {
        return { ok: true, ...safeKnowledgeCall(() => kb.dataInventory(), { autoCapture: true }), note: '采集内容、存放位置与删除方法见 docs/knowledge-data.md' }
      }
      if (action === 'off' || action === 'on') {
        const next = store.updateSettings({ autoCapture: action === 'on' })
        return { ok: true, autoCapture: next.autoCapture, note: action === 'off' ? '已暂停自动采集；已有数据保留，可手动删除目录。' : '已恢复自动采集。' }
      }
      if (action === 'rebuild') {
        const software = String(args.software || '').trim()
        if (!software) return { ok: false, error: 'rebuild 需要 software' }
        const data = safeKnowledgeCall(() => kb.rebuild(software), null)
        return { ok: Boolean(data), software, controlCount: data ? (data.controls || []).length : 0, note: '从旧 page-maps / guide-presets / notes 重新导入；旧数据不删除。' }
      }
      if (action === 'rebuild-usage') {
        const software = String(args.software || '').trim()
        if (!software) return { ok: false, error: 'rebuild-usage 需要 software' }
        const usage = safeKnowledgeCall(() => kb.rebuildUsage(software), {})
        return { ok: true, software, controls: Object.keys(usage).length }
      }
      return { ok: false, error: `未知 action: ${action}` }
    },

    reportFragmentAdd(args = {}) {
      // 不传 software 就退回「课程通用」，按软件细分会静默失效。
      // 所以缺省时从当前实验档案推断；要写跨软件通用骨架，显式传 software:'' 即可。
      const explicit = Object.prototype.hasOwnProperty.call(args, 'software')
      let software = explicit ? String(args.software || '').trim() : ''
      let inferred = false
      if (!explicit) {
        try {
          const id = store.currentExperimentId()
          software = String((id ? store.getExperiment(id) : null)?.software || '')
          inferred = Boolean(software)
        } catch { software = '' }
      }
      const result = safeKnowledgeCall(() => kb.addFragment(
        args.course, args.section, args.pattern, software
      ), null)
      if (!result) return { ok: false, error: '写入报告片段失败' }
      return { ...result, inferredSoftware: inferred }
    },

    compatibilityAdvise(args = {}) {
      return adviseCompatibility({ software: String(args.software || 'ensp'), currentlyWorking: args.currentlyWorking === true })
    },

    repairPlan(args = {}) {
      return planRepair({
        software: String(args.software || 'ensp'),
        symptom: String(args.symptom || ''),
        homeDir: store.homeDir,
      })
    },

    repairRecord(args = {}) {
      const result = recordRepair(store.homeDir, {
        software: String(args.software || ''),
        component: String(args.component || 'main'),
        name: String(args.name || ''),
        version: String(args.version || ''),
        outcome: String(args.outcome || ''),
        symptom: String(args.symptom || ''),
        notes: String(args.notes || ''),
      })
      return { ...result, hint: '已写入本机经验库，不会上传到任何服务器。' }
    },

    tutorialClaims(args = {}) {
      try {
        const claimExpId = String(args.experimentId || args.id || store.currentExperimentId() || '')
        if (!claimExpId) return { ok: false, error: '需要 experimentId（实验编号）' }
        const experiment = store.getExperiment(claimExpId)
        const file = join(experiment.workDir, 'tutorial-claims.jsonl')
        if (!existsSync(file)) return { ok: true, claims: [], note: '还没有回执' }
        const claims = readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => { try { return JSON.parse(line) } catch { return null } })
          .filter(Boolean)
        return { ok: true, claims, total: claims.length, passedCount: claims.filter((item) => item.passed).length }
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) }
      }
    },

    async environmentProbe(args = {}) {
      const probe = await probeEnvironment({ software: String(args.software || '') })
      return {
        ok: probe.ok,
        probe,
        next: '先根据发现项核对课程要求的版本组合；任何修复动作必须由用户明确确认。',
      }
    },

    reportTemplate(args = {}) {
      if (args.deleteId) {
        try {
          const removed = deleteTemplate(store.homeDir, String(args.deleteId))
          return { ok: true, deleted: removed, note: '模板已移入 _trash，可手动恢复' }
        } catch (error) {
          return { ok: false, error: error.message }
        }
      }
      if (!args.path) {
        return { ok: true, templates: listTemplates(store.homeDir), hint: '传 path 可导入新模板；传 deleteId 可删除模板。' }
      }
      let profile
      try {
        profile = importTemplate({ filePath: String(args.path), name: String(args.name || ''), homeDir: store.homeDir })
      } catch (error) {
        // 损坏 docx / 非支持格式 / 文件不存在：统一成可读错误，面板与工具都能显示具体原因
        return { ok: false, error: String(error?.message || error), path: String(args.path) }
      }
      return { ok: true, template: profile, hint: '模板已保存到本机，可重复使用。' }
    },

    async reportPlan(args = {}) {
      const plan = await reportPlanFor(args)
      const { _sections, _evidence, _profile, ...visible } = plan
      return visible
    },

    async reportGenerate(args = {}) {
      // 要求文件先落进档案，供 DSH 读取解析，再据此组织报告内容
      if (String(args.requirementPath || '').trim()) {
        try { store.updateExperiment(args.experimentId, { requirementPath: String(args.requirementPath).trim() }) } catch { /* 路径无效不影响生成 */ }
      }
      const plan = await reportPlanFor(args)
      // 只有要求文件、没有模板时：直接生成会套用内置通用模板，和老师的格式对不上（实测返工一次）。
      // 这里停下来要模板，而不是静默产出。
      if (plan.templateMissing && args.useBuiltin !== true) {
        return {
          ok: false,
          needTemplate: true,
          experimentId: plan.experiment && plan.experiment.id,
          requirementPath: plan.requirementPath || '',
          error: '还没有报告模板：现在生成会套用内置通用模板，章节和老师要求对不上。',
          askUser: '请在会话里问用户：老师发的实验报告模板（.docx）是哪个文件？拿到路径后先导入再生成。',
          hint: '把老师的 .docx 模板路径传给 lab_report_template(path) 导入（只需一次），'
            + '用户明确说没有模板时传 useBuiltin:true —— 会用学校实验报告那套封面（课程名称/专业年级/学期/学号/姓名），'
            + '专业年级、学期这类填不了的留【待补】，不会瞎编。',
          howTo: [
            'lab_report_template(path:"D:\\我校模板\\实验报告模板.docx")  ← 导入模板',
            'lab_report_generate(experimentId:"...", templateId:"...")        ← 再生成',
          ],
          mustExplain: '向用户说明：没有模板会与老师格式不一致，所以先暂停生成。',
        }
      }
      const output = generateReport({
        plan,
        student: { name: String(args.studentName || ''), studentId: String(args.studentId || '') },
      })
      // 交接单：把这次报告需要的全部上下文固化下来，DSH 读它就能接手补写
      let handoff = ''
      let fragmentHints = []
      try {
        const exp = store.getExperiment(String(args.experimentId || ''))
        let notes = null
        try { notes = store.listSoftwareNotes(exp.software) } catch { notes = null }
        // L5：句式骨架只在交接单和返回值里给，不进报告正文；禁止携带数值、不得标已核对
        fragmentHints = safeKnowledgeCall(() => kb.fragmentHints(exp.course,
          (plan.sections || []).map((item) => item.title), exp.software), [])
        const handoffKnowledge = safeKnowledgeCall(() => kb.knowledgeFor({ software: exp.software }), null)
        const lines = [
          `# 报告交接单：${exp.title}`,
          '',
          `- 实验编号：${exp.id}`,
          `- 课程：${exp.course || '(未填)'}`,
          `- 软件：${exp.software || '(未填)'}`,
          `- 报告模板：${exp.reportTemplate || '(未填)'}`,
          `- 实验要求：${exp.requirementPath || '(未填)'}`,
          `- 数据文件：${exp.datasetPath || '(未填)'}`,
          `- 已生成：${output.files && output.files.docx ? output.files.docx : ''}`,
          '',
          '## 需要 DSH 补写的内容',
          `模板覆盖度 ${output.coverage ? output.coverage.percent : '?'}%，`
            + `缺口 ${output.placeholderCount || 0} 处：`,
          ...plan.sections
            .filter((item) => item.coverage === 'partial' || item.coverage === 'pending')
            .map((item) => `- ${item.title}`),
          '',
          '## 实验步骤与实测结果',
          ...(exp.steps || []).map((step, index) =>
            `- [${step.status}] ${index + 1}. ${step.title}`
            + (step.where ? `｜位置：${step.where}` : '')
            + (step.actual ? `｜实测：${step.actual}` : '')
            + (step.passed === true ? '｜通过' : step.passed === false ? '｜未通过' : '')),
          '',
          '',
          '## 该软件的已知经验',
          ...(notes
            ? [
                ...(notes.pitfalls || []).map((item) => `- [坑] ${item}`),
                ...(notes.where || []).map((item) => `- [位置] ${item}`),
                ...(notes.tips || []).map((item) => `- [技巧] ${item}`),
              ]
            : ['（暂无，跑完后用 note_add 记几条）']),
          '',
          '## 界面地图（控件级，供下次实验指路）',
          ...((handoffKnowledge && handoffKnowledge.controls.length)
            ? handoffKnowledge.controls.map((c) => `- ${c.window} / ${c.name}${c.purpose ? `：${c.purpose}` : ''}${c.rect ? ` @(${c.rect.x},${c.rect.y})` : '（位置待重新定位）'}`)
            : ['（暂无控件条目，跑完后用 note_add 带 controlName 记一条）']),
          '',
          '## 这一步踩过的坑（下次先避开）',
          ...((handoffKnowledge && handoffKnowledge.failures.length)
            ? handoffKnowledge.failures.map((f) => `- [${f.stepId || '未知步骤'}] ${f.error}`)
            : ['（暂无失败记录）']),
          '',
          '## 报告句式骨架（仅供改写，禁止直接复制）',
          ...(fragmentHints.length
            ? fragmentHints.map((f) => `- [${f.scope === 'software' ? `本软件 ${exp.software}` : '本课程通用'}] ${f.section}：${f.pattern} —— ${f.note}`)
            : ['（暂无片段；用 report_fragment_add 沉淀合格写法）']),
          '',
          '## 交接方式',
          'DSH 读取本文件后：用 experiment_update 把补写内容写进对应步骤的 actual/notes，',
          '再调用 report_generate 重新生成终稿。',
        ]
        handoff = join(exp.workDir, 'reports', 'handoff.md')
        writeFileSync(handoff, `${lines.join('\n')}\n`, 'utf8')
      } catch (error) { handoff = '' }

      return {
        ...output,
        template: plan.template,
        // 让调用方一眼核对「模板到底生效没有」：章节标题必须来自模板
        templateSections: (plan.sections || []).map((item) => item.title),
        drafts: plan.drafts,
        handoff,
        fragmentHints,
        mustExplain: '逐条解释 pending 的原因（模板不匹配 / 没做到 / 需人工补数据），不要静默交付。',
        pending: plan.sections.filter((item) => item.coverage === 'partial' || item.coverage === 'pending').map((item) => item.title),
      }
    },

    async reportUpdate(args = {}) {
      const plan = await reportPlanFor(args)
      const countFigures = (p) => (p.sections || []).reduce(
        (sum, item) => sum + ((item.images && item.images.length) || 0), 0)
      const before = countFigures(plan)
      const output = generateReport({
        plan,
        student: { name: String(args.studentName || ''), studentId: String(args.studentId || '') },
      })
      const after = countFigures(plan)
      return {
        ok: true,
        updated: true,
        experimentId: plan.experiment && plan.experiment.id,
        figuresBefore: before,
        figuresNow: after,
        added: Math.max(0, after - before),
        files: output.files,
        coverage: output.coverage,
        pending: plan.sections.filter((item) => item.coverage === 'partial' || item.coverage === 'pending').map((item) => item.title),
        note: '已按当前档案重新生成；新增截图会自动并入对应章节。',
      }
    },
  }
}
