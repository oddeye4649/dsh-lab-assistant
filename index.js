import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ExperimentStore } from './lib/store.mjs'
import { probeEnvironment } from './lib/probe.mjs'
import { catalogHighlights, searchCatalog } from './lib/catalog.mjs'
import { adviseCompatibility } from './lib/advisor.mjs'
import { RepairHistory, planRepair, recordRepair } from './lib/remedy.mjs'
import { buildReportPlan, builtinProfile, deleteTemplate, generateReport, importTemplate, listTemplates, loadTemplate } from './lib/report.mjs'
import { startOverlay, stopOverlay, overlayStatus, overlayRequest } from './lib/overlay.mjs'
import { loadHostDeps } from './lib/hostdeps.mjs'
import { isTrustedLocalRequest, readJsonBody, sendJson } from './lib/http.mjs'

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))
const hostDeps = await loadHostDeps()
const { defineTool } = hostDeps

function packageVersion() {
  try {
    return String(JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version || '0.0.0')
  } catch {
    return '0.0.0'
  }
}

function resolveHome(ctx) {
  try {
    const homePath = ctx.get?.('dshHomePath')
    if (typeof homePath === 'function') return homePath('lab-assistant')
  } catch {
    // 老宿主可能没有 dshHomePath 服务，退回以下默认位置。
  }
  return join(process.env.DSH_HOME || join(os.homedir(), '.dsh'), 'lab-assistant')
}

function mergeConfig(config, settings) {
  const source = config && typeof config === 'object' ? config : {}
  const patch = {}
  if (typeof source.displayName === 'string' && source.displayName.trim()) patch.displayName = source.displayName
  if (typeof source.petSize === 'number' && Number.isFinite(source.petSize)) patch.petSize = source.petSize
  if (typeof source.enabled === 'boolean') patch.petEnabled = source.enabled
  return { ...settings, ...patch }
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter((x) => typeof x === 'string') : []
}

function assetStatus() {
  const petDir = join(PACKAGE_ROOT, 'assets', 'pet')
  const states = ['idle.png', 'swim.png', 'point.png', 'happy.png', 'confused.png']
  return {
    states: Object.fromEntries(states.map((name) => [name, existsSync(join(petDir, name))])),
    icon: existsSync(join(PACKAGE_ROOT, 'assets', 'icon.png')),
    note: '桌宠素材由桌面伴随进程直接读取本地文件；网页内不再注入桌宠。',
  }
}

export const name = 'lab-assistant'

export default {
  name,
  apply(root, config) {
    const disposers = []

    root.inject(['webServer', 'tools'], (ctx) => {
      const baseHome = resolveHome(ctx)
      let store = new ExperimentStore(baseHome)
      const settingsAtBoot = mergeConfig(config, store.getSettings())
      store.updateSettings(settingsAtBoot)

      // 桌面伴随进程：随 DSH 启动，插件卸载时退出。失败会降级为“不可用”，不影响对话工具。
      // 同时开一个仅本机、带 token 的 IPC 端口，把实验助手 API 提供给桌面面板调用。
      let overlay = null
      let ipcServer = null
      let ipcInfo = null
      const startIpc = () => {
        const token = randomBytes(16).toString('hex')
        ipcServer = http.createServer((req, res) => {
          let parsed
          try { parsed = new URL(req.url || '/', 'http://127.0.0.1') } catch { return sendJson(res, 400, { ok: false, error: '请求地址无效' }) }
          if (parsed.searchParams.get('token') !== token) return sendJson(res, 403, { ok: false, error: 'token 不匹配' })
          if (!parsed.pathname.startsWith('/dsh-lab/api/')) return sendJson(res, 404, { ok: false, error: '路径不存在' })
          api(req, res, parsed.pathname, parsed.searchParams).catch((error) => sendJson(res, 500, { ok: false, error: String(error?.message || error) }))
        })
        ipcServer.on('error', () => { ipcServer = null })
        ipcServer.listen(0, '127.0.0.1', () => {
          ipcInfo = { port: ipcServer.address().port, token, base: `http://127.0.0.1:${ipcServer.address().port}/dsh-lab/api` }
        })
      }

      // 拉起一只桌宠。可重复调用：每次都会产生「最新」的那一只，
      // 引导（/guide、/pet）只会发给它；更早的实例只当吉祥物。
      let overlaySpawning = null
      const spawnOverlay = () => {
        if (process.platform !== 'win32' || process.env.DSH_LAB_OVERLAY === '0') return Promise.resolve(null)
        if (overlaySpawning) return overlaySpawning
        if (!ipcInfo) startIpc()
        const now = store.getSettings()
        overlaySpawning = startOverlay({
          homeDir: store.homeDir,
          displayName: now.displayName,
          petSize: now.petSize,
          apiInfo: () => ipcInfo,
        })
          .then((result) => {
            overlay = result.ok
              ? { connection: { port: result.port, token: result.token }, pid: result.pid, dir: result.configDir }
              : { failed: result }
            return overlay
          })
          .catch((error) => {
            overlay = { failed: { ok: false, reason: 'start-error', error: String((error && error.message) || error) } }
            return overlay
          })
          .finally(() => { overlaySpawning = null })
        return overlaySpawning
      }

      // 启动桌宠（服务探测已移除：曾调用 llm.listModels() 导致宿主 fatal 崩溃）
      spawnOverlay()

      const textOutput = {
        schema: { type: 'object', properties: {}, additionalProperties: true },
        render: (_args, value) => [{
          type: 'text',
          text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        }],
      }
      const safe = (value) => {
        try { return JSON.parse(JSON.stringify(value)) } catch { return String(value) }
      }
      // 宿主把 parameters 原样作为 JSON Schema 发给模型 API（顶层必须 type:"object"）。
      // 插件内工具用“属性映射”书写更简洁，这里统一包成合法 schema。
      const toSchema = (params) => {
        if (params && typeof params === 'object' && params.type === 'object') return params
        return { type: 'object', properties: params && typeof params === 'object' ? params : {}, additionalProperties: false }
      }
      // 工具定义先收集起来，最后只注册「一个」统一入口。
      // 原因：工具 schema 会随每次模型请求一起发送，21 个工具约 3000~4500 tokens，
      // 合并成 1 个入口后可降到 400 左右，而待机时本来就不会调用它们。
      const collected = new Map()
      const tool = (spec) => { collected.set(spec.name, spec) }


      function overlayConnection() {
        return overlay && overlay.connection ? overlay.connection : null
      }

      function pageMapDir() {
        return join(store.homeDir, 'page-maps')
      }

      function slug(value) {
        return String(value || 'map').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 48) || 'map'
      }

      function savePageMap(data) {
        const dir = pageMapDir()
        mkdirSync(dir, { recursive: true })
        const file = join(dir, `${slug(data.software)}-${slug(data.version || 'latest')}-${Date.now().toString(36)}.json`)
        writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
        return file
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

      async function overlayCall(path, payload, errorHint) {
        let connection = overlayConnection()
        if (!connection) {
          // 当前这只已经不在了（比如被右键关掉）——补一只最新的，引导仍由它执行
          await spawnOverlay()
          connection = overlayConnection()
        }
        if (!connection) {
          const reason = overlay && overlay.failed ? overlay.failed.reason : 'not-started'
          return {
            ok: false,
            error: `桌面伴随进程不可用（${reason}）。`,
            hint: errorHint || '查看 lab_desktop_status 可获得具体原因；首次运行需要系统 .NET Framework 编译器。',
          }
        }
        const result = await overlayRequest(connection, path, payload)
        // 连接已断（桌宠被单独关闭）→ 重新拉起一只最新的再试一次
        const failedText = String((result && (result.error || result.hint)) || '')
        if (result && result.ok === false && /ECONN|socket|refused|timeout|不可用|没有响应/i.test(failedText)) {
          await spawnOverlay()
          const retry = overlayConnection()
          if (retry) return overlayRequest(retry, path, payload)
        }
        return result
      }

      // 桌宠表情/台词全部在本地完成，不消耗模型 token。
      function petMood(state, text) {
        const connection = overlayConnection()
        if (!connection) return
        overlayRequest(connection, '/pet', { action: 'state', state, durationMs: 4200 })
        if (text) overlayRequest(connection, '/pet', { action: 'say', text, durationMs: 6500 })
      }

      const WORKFLOW = [
        '1 读档案：experiment_get（没有就先 experiment_create，把模板/要求/数据路径填进去）',
        '1.5 确认模板：动手之前先在会话里问用户「老师发的实验报告模板是哪个 .docx？」',
        '    有模板 → lab_report_template(path) 导入，模板决定封面字段和章节；',
        '    用户明确说没有 → 用内置封面（课程名称/专业年级/学期/学号/姓名），report_generate 传 useBuiltin:true',
        '    不要默认套通用模板：实测会因格式对不上整份返工',
        '2 读经验：note_list(software) —— 先看这个软件踩过什么坑、按钮在哪',
        '3 归位窗口：desktop_place(process|windowTitle, width, height) —— 固定矩形，截图与坐标才可复用',
        '4 逐步执行：粒度按文档自己的分节/编号走（文档说一次做完就一次做完），每步一次截图 → 立即 desktop_screenshot → 校验预期变化',
        '    通过才 record_result(passed=true, evidence=[截图])；不通过就 record_result(passed=false) 并停下问人',
        '5 出报告：report_generate',
        '6 读交接单：reports/handoff.md —— 缺口、该软件经验、每步实测都在里面',
        '7 解释待补：把 pending 逐条说明原因（模板不匹配 / 没做到 / 需人工补数据），',
          '    并明确告诉用户「这份报告还不能交」；文件顶部已加红色警示条，补全后重新生成才会消失',
        '8 复盘写经验：note_add(software, kind, text) —— 坑 pitfall、位置 where、技巧 tip',
        '',
        '被挡时的替代方案：',
        '- 控件读不到（eNSP / Weka）→ 整窗高亮 + 截图自己看位置，坐标记进 where',
        '- 文件对话框输入不进去 → 让用户在面板「数据」行选一次，或命令行带参启动',
        '- 里层菜单选不中 → 用命令行等价操作，并在报告里注明「GUI 未使用，CLI 执行」',
        '- 点击后没变化 → 先怀疑控件被禁用，再怀疑坐标',
      ].join('\n')

      tool({
        name: 'lab_workflow',
        description: '返回实验报告的标准执行流程（八步 + 被挡时的替代方案）。用户要求生成实验报告时先调它，再按顺序执行。',
        parameters: {},
        async execute() {
          return { ok: true, workflow: WORKFLOW, mustExplainPending: true }
        },
      })

      tool({
        name: 'lab_assistant_status',
        description: '查看实验助手的本地状态：实验档案数量、默认称呼、桌宠资源、数据目录。用户提到“实验助手状态”“桌宠”“实验档案”时可调用。',
        parameters: {},
        async execute() {
          const base = {
            ok: true,
            plugin: 'dsh-lab-assistant',
            version: packageVersion(),
            ...store.status(),
            assets: assetStatus(),
            catalog: catalogHighlights(),
            readOnlyProbeAvailable: true,
            hostDeps: hostDeps.notes,
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
      })

      tool({
        name: 'lab_experiment_create',
        description: '新建一份独立实验档案。创建档案不会安装软件、不会修改系统设置。适用于用户明确要开始一个实验任务时。',
        parameters: {
          title: { type: 'string', description: '实验名称，例如“计算机网络实验三：静态路由”' },
          course: { type: 'string', description: '课程名称，可省略' },
          software: { type: 'string', description: '实验软件，默认 eNSP' },
          mode: { type: 'string', description: 'guided=详细指导，automatic=自动执行，mixed=混合模式（默认）' },
          reportTemplate: { type: 'string', description: '报告模板路径或名称，可省略' },
          requirementPath: { type: 'string', description: '实验要求文件路径（pdf/docx/图片），可省略' },
          datasetPath: { type: 'string', description: '本次实验使用的数据文件路径，可省略' },
          notes: { type: 'string', description: '备注，可省略' },
        },
        async execute(args) {
          const manifest = store.createExperiment(args)
          return {
            ok: true,
            experiment: manifest,
            hint: '实验档案已建立。安装、卸载或修改系统设置仍需用户单独确认。',
            isCurrent: (() => { try { return store.setCurrentExperiment(manifest.id) === manifest.id } catch { return false } })(),
          }
        },
      })

      tool({
        name: 'lab_experiment_delete',
        description: '删除一份实验档案：整份目录移到 homeDir/_trash（可恢复），不做不可逆销毁。删除当前实验时会清空「当前实验」。',
        parameters: {
          experimentId: { type: 'string', description: '实验编号' },
          confirm: { type: 'boolean', description: '必须显式传 true 才会删除，防止误调用' },
        },
        async execute(args) {
          if (args.confirm !== true) {
            return { ok: false, error: '删除需要显式传 confirm:true', hint: '请先向用户确认要删哪一份，再带 confirm:true 重试。' }
          }
          try {
            const removed = store.deleteExperiment(String(args.experimentId || ''))
            return { ok: true, deleted: removed, note: '已移入 _trash，需要时可手动恢复' }
          } catch (error) {
            return { ok: false, error: error.message }
          }
        },
      })

      tool({
        name: 'lab_experiment_clone',
        description: '以上一份实验为模板复制步骤骨架（沿用课程/软件/模板/要求与 where 位置提示），结果清空。同一门课的第二次实验用它直接开工，省去重新拆步骤。',
        parameters: {
          sourceId: { type: 'string', description: '要复制的实验编号' },
          title: { type: 'string', description: '新实验名称，可省略' },
          notes: { type: 'string', description: '备注，可省略' },
        },
        async execute(args) {
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
      })

      tool({
        name: 'lab_experiment_list',
        description: '列出历史实验档案，可按状态或关键词筛选。用户想继续某次实验、查看多份实验进度时调用。',
        parameters: {
          status: { type: 'string', description: 'active / paused / completed / archived，可省略' },
          query: { type: 'string', description: '按名称、课程或软件搜索，可省略' },
        },
        async execute(args) {
          return { ok: true, experiments: store.listExperiments(args) }
        },
      })

      tool({
        name: 'lab_experiment_get',
        description: '读取一份实验档案的完整内容，包括步骤、截图目录、报告与备注。',
        parameters: {
          id: { type: 'string', description: '实验编号，例如 exp-20261028-163000-a1b2' },
        },
        async execute(args) {
          const experiment = store.getExperiment(String(args.id || ''))
          const mode = String(experiment.mode || 'mixed')
          const modeHint = mode === 'guided'
            ? 'guided：每步都先说做什么、做完截图给人看；慢但最稳。'
            : mode === 'automatic'
              ? 'automatic：连续执行不打断，只在失败或不可逆操作前停下；快但风险高。'
              : 'mixed：只读/可逆操作直接做，删除、清空、覆盖等不可逆操作先确认。'
          try { store.setCurrentExperiment(experiment.id) } catch { /* 忽略 */ }
          return { ok: true, experiment, modeHint, isCurrent: true }
        },
      })

      tool({
        name: 'lab_experiment_update',
        description: '更新实验档案的标题、课程、软件、模式、状态、当前步骤、步骤清单或备注。不会执行软件操作。',
        parameters: {
          id: { type: 'string', description: '实验编号' },
          patch: { type: 'object', additionalProperties: true, description: '要更新的字段' },
        },
        async execute(args) {
          // 兼容两种写法：patch:{...} 或直接把要改的字段平铺（合并工具后平铺更顺手）
          const patch = (args.patch && typeof args.patch === 'object') ? { ...args.patch } : {}
          for (const key of Object.keys(args)) {
            if (key === 'id' || key === 'patch') continue
            patch[key] = args[key]
          }
          return { ok: true, experiment: store.updateExperiment(String(args.id || ''), patch) }
        },
      })

      tool({
        name: 'lab_experiment_record_result',
        description: '记录某一步骤的真实执行结果（实测值、是否通过、证据文件）。报告的“实际结果/结论”只会用这里记录的内容，不会由模型猜测。',
        parameters: {
          id: { type: 'string', description: '实验编号' },
          stepId: { type: 'string', description: '步骤 ID，可省略' },
          title: { type: 'string', description: '步骤标题，stepId 省略时用它匹配' },
          actual: { type: 'string', description: '真实实测值或现象，例如“ping 10.0.0.1 通，延迟 2ms”' },
          passed: { type: 'boolean', description: '是否达到预期' },
          evidence: { type: 'array', items: { type: 'string' }, description: '证据文件相对路径，可省略' },
        },
        async execute(args) {
          // 兼容两种写法：id 与 experimentId（其余工具用 experimentId，这里历史原因用 id）
          const expId = String(args.id || args.experimentId || '')
          if (!expId) return { ok: false, error: '需要 id（实验编号）' }
          const result = store.recordStepResult(expId, args)
          // 这一步做完了，把钉住的框和气泡收走
          if (args.passed === true) { try { await overlayCall('/clear', {}) } catch { /* 桌宠不在就算了 */ } }
          return { ok: true, experiment: result }
        },
      })

      tool({
        name: 'lab_note_add',
        description: '记一条软件操作经验：kind=pitfall（坑）/ where（某个按钮在哪）/ tip（技巧）。按软件累积，下次同类实验开始前先 note_list 读一遍，能显著减少重复试错。',
        parameters: {
          software: { type: 'string', description: '软件名，例如 eNSP、Weka' },
          kind: { type: 'string', description: 'pitfall / where / tip，默认 tip' },
          text: { type: 'string', description: '要记的内容' },
        },
        async execute(args) {
          try {
            const entry = store.addSoftwareNote(args.software, args.kind, args.text)
            return { ok: true, software: entry.software, kind: entry.kind, total: entry.pitfalls.length + entry.where.length + entry.tips.length }
          } catch (error) {
            return { ok: false, error: String((error && error.message) || error) }
          }
        },
      })

      tool({
        name: 'lab_note_list',
        description: '读软件经验库。开始某个软件的实验前先调它，拿到之前记下的坑/位置/技巧；不传 software 返回全部。',
        parameters: {
          software: { type: 'string', description: '软件名，可省略' },
        },
        async execute(args) {
          const notes = store.listSoftwareNotes(args.software ? String(args.software) : '')
          return { ok: true, notes: notes || {}, found: Boolean(notes) }
        },
      })

      tool({
        name: 'lab_software_catalog',
        description: '查询跨学科实验软件知识目录。覆盖计算机、网络、电子、机械、土木建筑、化学材料、生物农林、医学、经管、心理、地学环境、数理、媒体设计、人文法学。可返回优先级、授权类型、控制方式和适配状态。目录不等于已支持。',
        parameters: {
          discipline: { type: 'string', description: '学科编号，例如 computer、networking、electronics、civil-architecture；可省略' },
          priority: { type: 'string', description: 'P0 / P1 / P2，可省略' },
          query: { type: 'string', description: '按软件名、类别或别名搜索，可省略' },
        },
        async execute(args) {
          return { ok: true, ...searchCatalog(args) }
        },
      })

      tool({
        name: 'lab_compatibility_advise',
        description: '根据当前电脑环境、已安装版本和“当前实验是否能正常运行”，推荐应该保留、诊断还是更换为哪一套兼容组合。只给建议，不安装。必须让用户确认后才能执行任何变更。',
        parameters: {
          software: { type: 'string', description: '软件目录 ID 或名称，例如 ensp、MySQL；默认 ensp' },
          currentlyWorking: { type: 'boolean', description: '用户当前是否能正常完成该软件的实验；不知道就不要传 true' },
        },
        async execute(args) {
          return adviseCompatibility({ software: String(args.software || 'ensp'), currentlyWorking: args.currentlyWorking === true })
        },
      })

      tool({
        name: 'lab_repair_plan',
        description: '当软件跑不起来、装完还是用不了时调用：按报错原文匹配已知失败特征，定位原因，给出按可信度排序的候选版本、安装顺序、验证方法和回退办法。只给方案，不安装。',
        parameters: {
          software: { type: 'string', description: '软件目录 ID 或名称，例如 ensp、Weka；默认 ensp' },
          symptom: { type: 'string', description: '用户描述的报错原文或现象，例如“启动设备失败，错误代码 40”；越具体越准' },
        },
        async execute(args) {
          return planRepair({
            software: String(args.software || 'ensp'),
            symptom: String(args.symptom || ''),
            homeDir: store.homeDir,
          })
        },
      })

      tool({
        name: 'lab_repair_record',
        description: '记录一次换版本尝试的结果（可用或失败），写入本机经验库。下次生成方案时，试过失败的版本会被降权，试过可用的会排到最前。',
        parameters: {
          software: { type: 'string', description: '软件目录 ID，例如 ensp' },
          component: { type: 'string', description: '组件角色，例如 virtualization、capture-driver、main' },
          name: { type: 'string', description: '组件名称，例如 Oracle VirtualBox' },
          version: { type: 'string', description: '这次尝试的版本号，例如 7.2.22' },
          outcome: { type: 'string', description: 'worked=这台机器上可用；failed=这台机器上失败' },
          symptom: { type: 'string', description: '当时的报错或现象，可省略' },
          notes: { type: 'string', description: '补充说明，可省略' },
        },
        async execute(args) {
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
      })


      // 执行类动作（点击/截图/归位）前把桌宠停到右下角：
      // 它不会挡在操作区域中间，但仍会做待机小动作；引导时会自动解除停泊去指路。
      async function parkPetForWork(mode) {
        if (mode === 'guided') return null
        try { return await overlayCall('/pet', { action: 'park' }) } catch { return null }
      }

      async function reportPlanFor(args = {}) {
        const experimentId = String(args.experimentId || '').trim()
        if (!experimentId) throw new Error('缺少实验编号')
        const experiment = store.getExperiment(experimentId)
        let profile = args.templateId ? loadTemplate(store.homeDir, String(args.templateId)) : null
        if (args.templatePath) {
          profile = importTemplate({ filePath: String(args.templatePath), homeDir: store.homeDir })
        }
        // 是否真的拿到了「老师给的模板」：档案里记过的路径、或本次显式传的都算
        const hasTemplate = Boolean(profile) || Boolean(String(experiment.reportTemplate || '').trim())
        if (!profile) profile = builtinProfile()
        const environment = await probeEnvironment({ software: experiment.software })
        const attempts = new RepairHistory(store.homeDir).list()
        const plan = buildReportPlan({ experiment, profile, environment, history: { attempts }, overrides: args.sectionTexts })
        plan.templateMissing = !hasTemplate
        plan.requirementPath = String(experiment.requirementPath || '').trim()
        return plan
      }

      tool({
        name: 'lab_report_template',
        description: '读取用户提供的实验报告模板（.docx/.md/.txt），识别章节结构、必填项和表格列，保存为可复用的报告模板。传 path 导入；不传则列出已导入模板。',
        parameters: {
          path: { type: 'string', description: '模板文件绝对路径，可省略' },
          name: { type: 'string', description: '模板名称，可省略' },
          deleteId: { type: 'string', description: '要删除的模板 ID（移到 _trash，可恢复），可省略' },
        },
        async execute(args) {
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
          const profile = importTemplate({ filePath: String(args.path), name: String(args.name || ''), homeDir: store.homeDir })
          return { ok: true, template: profile, hint: '模板已保存到本机，可重复使用。' }
        },
      })

      tool({
        name: 'lab_report_plan',
        description: '按实验档案和报告模板生成填充计划：哪些章节能自动填、哪些必须人工补、缺哪些截图或数据。不会编造实验结果。',
        parameters: {
          experimentId: { type: 'string', description: '实验编号' },
          sectionTexts: { type: 'object', additionalProperties: true, description: 'DSH 亲笔写的章节正文，键为章节标题（可只写关键词，如“实验目的”“结果分析”），值为正文。传了就不会再用草稿。' },
          templateId: { type: 'string', description: '已导入模板 ID，可省略' },
          templatePath: { type: 'string', description: '临时指定模板文件路径，可省略' },
        },
        async execute(args) {
          const plan = await reportPlanFor(args)
          const { _sections, _evidence, _profile, ...visible } = plan
          return visible
        },
      })

      tool({
        name: 'lab_report_generate',
        description: '按模板生成实验报告的 Markdown 与 Word(.docx)，写入实验档案的 reports 目录。自动填环境、步骤、截图和故障记录；其余用【待补】显式标记，不伪造数据。',
        parameters: {
          experimentId: { type: 'string', description: '实验编号' },
          templateId: { type: 'string', description: '已导入模板 ID，可省略' },
          templatePath: { type: 'string', description: '模板文件路径，可省略' },
          studentName: { type: 'string', description: '姓名，可省略' },
          studentId: { type: 'string', description: '学号，可省略' },
          requirementPath: { type: 'string', description: '实验要求文件路径（pdf/docx/txt/md/图片），可省略；会记进档案' },
          useBuiltin: { type: 'boolean', description: '没有模板也坚持用内置通用模板生成（默认 false：先停下让用户补模板）' },
        },
        async execute(args) {
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
          try {
            const exp = store.getExperiment(String(args.experimentId || ''))
            let notes = null
            try { notes = store.listSoftwareNotes(exp.software) } catch { notes = null }
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
            drafts: plan.drafts,
            handoff,
            mustExplain: '逐条解释 pending 的原因（模板不匹配 / 没做到 / 需人工补数据），不要静默交付。',
            pending: plan.sections.filter((item) => item.coverage === 'partial' || item.coverage === 'pending').map((item) => item.title),
          }
        },
      })


      tool({
        name: 'lab_report_update',
        description: '报告生成后又补了截图/改了实测值时用：重新生成同一份报告（沿用原模板与已写章节），并回报新增的图片数量。用于「只同步图片」的场景，不必重新走一遍生成流程。',
        parameters: {
          experimentId: { type: 'string', description: '实验编号' },
          templateId: { type: 'string', description: '已导入模板 ID，可省略' },
          templatePath: { type: 'string', description: '模板文件路径，可省略' },
          sectionTexts: { type: 'object', additionalProperties: true, description: '要覆盖的章节正文，可省略（省略则沿用档案里的实测值）' },
        },
        async execute(args) {
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
      })

      tool({
        name: 'lab_desktop_status',
        description: '查看桌面伴随进程状态：是否在运行、桌宠位置、不可用原因。用于判断桌面指引/截图能力是否就绪。',
        parameters: {},
        async execute() {
          const status = await overlayStatus()
          if (!status.running && overlay && overlay.failed) {
            return { ...status, startup: overlay.failed }
          }
          return status
        },
      })

      tool({
        name: 'lab_desktop_pet',
        description: '控制桌面桌宠：显示/隐藏、移动到屏幕坐标（物理像素）、改称呼。不碰其他软件。',
        parameters: {
          action: { type: 'string', description: 'show / hide / move / rename' },
          x: { type: 'number', description: 'move 时的屏幕 X 坐标，可省略' },
          y: { type: 'number', description: 'move 时的屏幕 Y 坐标，可省略' },
          name: { type: 'string', description: 'rename 时的称呼，可省略' },
        },
        async execute(args) {
          const payload = { action: String(args.action || 'show') }
          if (args.x != null) payload.x = Number(args.x)
          if (args.y != null) payload.y = Number(args.y)
          if (args.name) payload.name = String(args.name)
          return overlayCall('/pet', payload)
        },
      })

      tool({
        name: 'lab_desktop_guide',
        description: '桌面指引：定位目标软件窗口（可精确到控件名），先用最新那只桌宠移动到旁边，窗口/控件画高亮框，头顶气泡讲解。目标窗口若已最小化会先自动恢复并前置。只读定位，不替用户点击。',
        parameters: {
          windowTitle: { type: 'string', description: '窗口标题包含的关键字，例如 eNSP' },
          process: { type: 'string', description: '进程名关键字，例如 eNSP，可与标题二选一' },
          controlName: { type: 'string', description: '控件名称（UIA Name），可省略；省略时高亮整个窗口' },
          text: { type: 'string', description: '气泡讲解文字（大肥鱼口吻，说清这一步做什么、为什么）' },
          durationMs: { type: 'number', description: '展示时长毫秒，默认 8000' },
          x: { type: 'number', description: '相对窗口的目标 X（配合截图定位，可省略）' },
          y: { type: 'number', description: '相对窗口的目标 Y' },
          w: { type: 'number', description: '高亮框宽，默认 64' },
          h: { type: 'number', description: '高亮框高，默认 40' },
          color: { type: 'string', description: '高亮颜色：yellow（默认，教学用）/ red' },
          pad: { type: 'number', description: '黄框向外放大多少像素，默认 36。宁可略大也别小——稍偏也能被看到' },
          client: { type: 'boolean', description: '相对坐标是否按客户区（不含标题栏）算，默认 false＝整窗，与截图、点击同一基准' },
          sticky: { type: 'boolean', description: '钉住：学生做完这步之前框和气泡都不消失（默认 false）' },
          remember: { type: 'boolean', description: '把这次的位置记进经验库，下次同窗口直接复用（默认 true）' },
          software: { type: 'string', description: '经验库归属的软件名，可省略（默认取窗口标题）' },
          screenshot: { type: 'boolean', description: '指引后立刻截图存证；耗时超过 1 秒会提示让学生自己截' },
          experimentId: { type: 'string', description: '截图存进哪份实验档案，可省略（默认用当前实验）' },
        },
        async execute(args) {
          const payload = {
            title: String(args.windowTitle || ''),
            process: String(args.process || ''),
            control: String(args.controlName || ''),
            text: String(args.text || ''),
            durationMs: Number(args.durationMs) || 8000,
            color: String(args.color || 'yellow'),
          }
          if (args.x != null) payload.x = Number(args.x)
          if (args.y != null) payload.y = Number(args.y)
          if (args.w != null) payload.w = Number(args.w)
          if (args.h != null) payload.h = Number(args.h)
          payload.pad = args.pad != null ? Number(args.pad) : 36
          // 0.14.3 起坐标基准统一成整窗：screenshot 截的是整窗、click 也按整窗算，
          // 只有 guide 还默认客户区的话，拿截图量出来的坐标会整体偏一个标题栏。
          payload.client = args.client === true
          payload.sticky = args.sticky === true
          if (!payload.title && !payload.process) return { ok: false, error: '需要 windowTitle 或 process 定位窗口' }

          // 经验复用：没给坐标但有历史位置，直接用上次调好的
          const presetKey = `${String(args.software || payload.title || payload.process).toLowerCase()}::${String(payload.title || payload.process).toLowerCase()}`
          let usedPreset = false
          if (payload.x == null && payload.y == null) {
            const saved = store.getGuidePreset(presetKey)
            // 只认「整窗」基准的记录：0.14.3 之前的 preset 是客户区坐标，直接复用会偏一个标题栏高度
            if (saved && saved.coord === 'window' && Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))) {
              payload.x = Number(saved.x)
              payload.y = Number(saved.y)
              if (saved.w) payload.w = Number(saved.w)
              if (saved.h) payload.h = Number(saved.h)
              if (saved.pad != null) payload.pad = Number(saved.pad)
              usedPreset = true
            }
          }

          // 引导要桌宠过去指路：先解除停泊
          try { await overlayCall('/pet', { action: 'unpark' }) } catch { /* 忽略 */ }
          const startedAt = Date.now()
          const guided = await overlayCall('/guide', payload)
          const guideMs = Date.now() - startedAt

          let remembered = null
          if (args.remember !== false && payload.x != null && guided && guided.ok) {
            try {
              remembered = store.saveGuidePreset(presetKey, {
                coord: 'window',
                x: Number(payload.x), y: Number(payload.y),
                w: Number(payload.w || 0), h: Number(payload.h || 0),
                pad: Number(payload.pad || 0),
                software: String(args.software || ''),
                title: String(payload.title || ''),
                process: String(payload.process || ''),
                located: String(guided.located || ''),
              })
            } catch { remembered = null }
          }

          // 引导模式默认顺手截一张，便于事后核对；超过 1 秒就让学生自己截
          if (args.screenshot !== false) {
            // /screenshot 必须带 out：伴随进程缺少保存路径时只会回 {"ok":false,"error":"缺少 out 保存路径"}，
            // 旧实现没传 out，于是「指引后自动截图」从来没真正落过盘。
            const experimentId = String(args.experimentId || store.currentExperimentId() || '').trim()
            let out = ''
            if (experimentId) {
              try {
                const experiment = store.getExperiment(experimentId)
                const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
                out = join(experiment.workDir, 'screenshots', `guide-${stamp}.png`)
              } catch { out = '' }
            }
            let shot
            const shotStart = Date.now()
            if (out) {
              try {
                shot = await overlayCall('/screenshot', { title: payload.title, process: payload.process, out })
              } catch { shot = null }
            }
            const shotMs = Date.now() - shotStart
            const late = shotMs > 1000
            return {
              ...guided,
              guideMs,
              usedPreset,
              remembered: remembered ? remembered.uses : 0,
              shot: shot && shot.out ? shot.out : '',
              shotMs,
              shotNote: out ? '' : '当前没有绑定实验档案，未做截图存证：先 experiment_create 或 experiment_get 选一份档案（或直接传 experimentId）。',
              remindUserToScreenshot: late,
              remind: late
                ? `截图用了 ${shotMs} 毫秒（超过 1 秒），可能不是当前画面 —— 这一步请让学生自己按 Win+Shift+S 截图，或重试一次。`
                : '',
            }
          }
          return { ...guided, guideMs }
        },
      })

      tool({
        name: 'lab_desktop_tutorial',
        description: '启动桌面教学循环：把步骤计划交给桌宠，之后学生每点一下桌宠，桌宠就跑一步的校验命令；通过自动进入下一步（不需要 DSH 在线，也不需要学生再说话）。回执写到 <实验>/tutorial-claims.jsonl。',
        parameters: {
          experimentId: { type: 'string', description: '实验编号（回执写进这个实验目录）' },
          windowTitle: { type: 'string', description: '目标窗口标题关键字' },
          process: { type: 'string', description: '进程名关键字，可与标题二选一' },
          steps: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '步骤数组：{id,title,text,x,y,w,h,verifyCmd,verifyExpect}。verifyCmd 是校验命令（跑完看输出），verifyExpect 是要在输出里出现的文本；都不给则点击即视为完成' },
          env: { type: 'object', additionalProperties: true, description: '校验命令的环境变量，例如 {"MYSQL_PWD":"***"}。只进内存：不写文件、不进命令行；启动 DSH 前设过 MYSQL_PWD 的话会自动带上，不必在这里传' },
        },
        async execute(args) {
          if (!args.experimentId) return { ok: false, error: '需要 experimentId' }
          const experiment = store.getExperiment(String(args.experimentId))
          const claimFile = join(experiment.workDir, 'tutorial-claims.jsonl')
          const steps = Array.isArray(args.steps) ? args.steps : []
          if (!steps.length) return { ok: false, error: '需要 steps' }
          // 口令不必经过对话：启动 DSH 前设好 MYSQL_PWD，这里自动透传给桌宠的子进程（只进内存，不写文件、不进命令行）。
          const env = (args.env && typeof args.env === 'object') ? { ...args.env } : {}
          if (!env.MYSQL_PWD && process.env.MYSQL_PWD) env.MYSQL_PWD = process.env.MYSQL_PWD
          return overlayCall('/tutorial', {
            windowTitle: String(args.windowTitle || ''),
            process: String(args.process || ''),
            claimFile,
            steps,
            env,
          })
        },
      })

      tool({
        name: 'lab_desktop_tutorial_step',
        description: '手动推进教学循环（等同学生点一下桌宠）：跑当前步骤的校验命令，通过则进下一步。',
        parameters: {},
        async execute() {
          return overlayCall('/tutorial/next', {})
        },
      })

      tool({
        name: 'lab_tutorial_claims',
        description: '读教学回执：每一行的 {stepId,index,passed,cmd,expect,output,at}。DSH 据此把结果正式写进实验档案。',
        parameters: {
          experimentId: { type: 'string', description: '实验编号' },
        },
        async execute(args) {
          try {
            const experiment = store.getExperiment(String(args.experimentId || ''))
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
      })

      tool({
        name: 'lab_desktop_clear',
        description: '清掉桌宠当前的高亮框和气泡（钉住模式用完后要手动清；记录步骤成功时会自动清）。',
        parameters: {},
        async execute() {
          return overlayCall('/clear', {})
        },
      })

      tool({
        name: 'lab_desktop_click',
        description: '在目标软件窗口内点击（鼠标真的按下）。默认直接点击；传 confirm:false 可只做预演（移动光标+高亮不点）。点击前会校验该坐标确实属于目标窗口，越界或被他窗遮挡会拒绝。坐标默认相对窗口左上角。',
        parameters: {
          windowTitle: { type: 'string', description: '窗口标题关键字' },
          process: { type: 'string', description: '进程名关键字，可与标题二选一' },
          x: { type: 'number', description: '目标 X（默认相对窗口左上角）' },
          y: { type: 'number', description: '目标 Y' },
          relative: { type: 'boolean', description: '是否相对窗口坐标，默认 true' },
          confirm: { type: 'boolean', description: '默认真点；只有显式传 false 才是预演（移动光标 + 高亮，不按键）' },
          count: { type: 'number', description: '点击次数，默认 1，最多 3' },
          force: { type: 'boolean', description: '引导模式下强制代点（默认禁止）' },
        },
        async execute(args) {
          // 模式硬约束：引导模式下不代点，学生自己动手
          const mode = store.currentMode()
          if (mode === 'guided' && args.force !== true) {
            return {
              ok: false,
              blocked: true,
              mode: 'guided',
              error: '引导模式（guided）下不代学生点击。请用 desktop_guide 指到位置 + 气泡讲解，让学生自己点。',
              hint: '确实需要代点时传 force:true（会留下记录）。',
            }
          }
          await parkPetForWork(mode)
          return overlayCall('/click', {
            title: String(args.windowTitle || ''),
            process: String(args.process || ''),
            x: Number(args.x) || 0,
            y: Number(args.y) || 0,
            relative: args.relative !== false,
            confirm: args.confirm !== false,
            count: Number(args.count) || 1,
          })
        },
      })

      tool({
        name: 'lab_desktop_place',
        description: '把实验软件窗口归位到固定矩形（默认 1280x800，主屏左上角）。操作或截图实验软件前先调它，能保证截图可比、相对坐标可复用、图片更小省 token。',
        parameters: {
          windowTitle: { type: 'string', description: '窗口标题关键字，例如 eNSP' },
          process: { type: 'string', description: '进程名关键字，可与标题二选一' },
          width: { type: 'number', description: '目标宽度，默认 1280' },
          height: { type: 'number', description: '目标高度，默认 800' },
        },
        async execute(args) {
          await parkPetForWork(store.currentMode())
          const result = await overlayCall('/place', {
            title: String(args.windowTitle || ''),
            process: String(args.process || ''),
            width: Number(args.width) || 1280,
            height: Number(args.height) || 800,
          })
          return result
        },
      })

      tool({
        name: 'lab_desktop_screenshot',
        description: '真实截取目标软件窗口（PrintWindow），保存进实验档案 screenshots 目录。截图是真实画面，不合成。截图期间会自动隐藏所有桌宠窗口（截完恢复），避免宠物入镜。默认会先把窗口归位到固定矩形，保证多张截图基准一致。',
        parameters: {
          experimentId: { type: 'string', description: '实验编号' },
          windowTitle: { type: 'string', description: '窗口标题关键字，可省略' },
          process: { type: 'string', description: '进程名关键字，可省略' },
          place: { type: 'boolean', description: '截图前是否先归位窗口，默认 true' },
          width: { type: 'number', description: '归位宽度，默认 1280' },
          height: { type: 'number', description: '归位高度，默认 800' },
        },
        async execute(args) {
          await parkPetForWork(store.currentMode())
          const experiment = store.getExperiment(String(args.experimentId || ''))
          if (args.place !== false) {
            // 归位失败不阻断截图，只是位置不保证一致
            try {
              await overlayCall('/place', {
                title: String(args.windowTitle || ''),
                process: String(args.process || ''),
                width: Number(args.width) || 1280,
                height: Number(args.height) || 800,
              })
            } catch { /* 忽略 */ }
          }
          const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
          const out = join(experiment.workDir, 'screenshots', `desktop-${stamp}.png`)
          const result = await overlayCall('/screenshot', {
            title: String(args.windowTitle || ''),
            process: String(args.process || ''),
            out,
          })
          if (result.ok) {
            result.next = '这是真实截图。用它核对结果后，调用 lab_experiment_record_result 写入该步骤的实测值与是否通过。'
          }
          return result
        },
      })

      tool({
        name: 'lab_page_map_capture',
        description: '读取目标软件窗口里 UIA 能看到的控件（名称/类型/位置），存成该软件版本的页面地图，供后续指引复用。',
        parameters: {
          software: { type: 'string', description: '软件名，例如 eNSP、医院通' },
          version: { type: 'string', description: '软件版本，可省略' },
          windowTitle: { type: 'string', description: '窗口标题关键字' },
          process: { type: 'string', description: '进程名关键字，可省略' },
          max: { type: 'number', description: '最多读取控件数，默认 200' },
        },
        async execute(args) {
          const windowTitle = String(args.windowTitle || '')
          const processName = String(args.process || '')
          if (!windowTitle && !processName) return { ok: false, error: '需要 windowTitle 或 process' }
          const payload = { title: windowTitle, process: processName, max: Number(args.max) || 200 }
          const result = await overlayCall('/inspect', payload)
          if (!result.ok) return result
          const data = {
            software: String(args.software || 'unknown'),
            version: String(args.version || 'latest'),
            windowTitle: result.title,
            process: result.process,
            controls: result.controls,
            capturedAt: new Date().toISOString(),
          }
          const file = savePageMap(data)
          return {
            ok: true,
            file,
            software: data.software,
            version: data.version,
            windowTitle: data.windowTitle,
            controlCount: data.controls.length,
            controls: data.controls.slice(0, 40).map((item) => `${item.type}「${item.name}」`),
            truncated: data.controls.length > 40,
            note: '页面地图已保存。指引时用 lab_page_map_guide 按 controlName 定位。',
          }
        },
      })

      tool({
        name: 'lab_page_map_guide',
        description: '用已保存的页面地图指引某软件的某个控件：自动按 controlName 重新定位实时位置，桌宠移动、画框、出气泡。',
        parameters: {
          software: { type: 'string', description: '软件名' },
          controlName: { type: 'string', description: '页面地图里的控件名称' },
          text: { type: 'string', description: '气泡讲解文字' },
          version: { type: 'string', description: '软件版本，可省略（默认最近一次采集）' },
          durationMs: { type: 'number', description: '展示时长毫秒，默认 8000' },
        },
        async execute(args) {
          const maps = listPageMaps(String(args.software || ''))
          if (!maps.length) return { ok: false, error: `还没有 ${args.software} 的页面地图，先用 lab_page_map_capture 采集。` }
          const map = JSON.parse(readFileSync(maps[0].file, 'utf8'))
          const controlName = String(args.controlName || '')
          const known = (map.controls || []).some((item) => item.name === controlName)
          const result = await overlayCall('/guide', {
            title: map.windowTitle,
            process: String(map.process || ''),
            control: controlName,
            text: String(args.text || ''),
            durationMs: Number(args.durationMs) || 8000,
          })
          if (result.ok && !known) {
            result.note = '该控件名不在已保存的页面地图里，本次按 UIA 实时名称定位。'
          }
          return result
        },
      })

      tool({
        name: 'lab_page_map_list',
        description: '列出已保存的软件页面地图。',
        parameters: {
          software: { type: 'string', description: '按软件名过滤，可省略' },
        },
        async execute(args) {
          return { ok: true, maps: listPageMaps(args.software ? String(args.software) : '') }
        },
      })

      tool({
        name: 'lab_environment_probe',
        description: '只读检查 Windows 软件安装迹象。可传 software 指定要检查的软件（逗号分隔，例如 “eNSP, Wireshark, MySQL”）；不传时检查 eNSP 依赖组合。不会安装、卸载或修改系统。',
        parameters: {
          software: { type: 'string', description: '要检查的软件名称或目录别名，逗号分隔；可省略' },
        },
        async execute(args) {
          const probe = await probeEnvironment({ software: String(args.software || '') })
          return {
            ok: probe.ok,
            probe,
            next: '先根据发现项核对课程要求的版本组合；任何修复动作必须由用户明确确认。',
          }
        },
      })

      // ---- 统一入口工具 ----
      const ACTION_DOC = `实验助手（大肥鱼）。

【什么时候必须用它】用户说「按要求生成实验报告」「做实验报告」「按这个要求做实验」「生成报告」，
或贴来实验要求文件/实验指导书时 —— 立刻调用本工具，不要凭空手写报告。
标准起手式：workflow 取回流程 → experiment_list/get 找档案（没有就 experiment_create）→ 按流程执行。

【硬规则】
0. 粒度跟文档走：先按使用者给的 PDF/指导书数清「文档自己分成几步」，就按那个粒度执行与截图。
   文档分成 7 节就 7 步 7 图；文档一段话讲完并说一次性执行，就按一段来；拿不准先问一句。
   判断依据是文档，不是「我觉得哪步值得截」。
   命令类步骤要让终端回显（追加 show tables / 加 -v / echo 分段），空提示符的截图不算证据。
1. 报告只写真实记录：每步必须桌面点击/命令行执行后立即截图校验，通过才 experiment_record_result。
2. 生成后必须把 pending（待补）逐条解释原因写给用户，不能只丢一个文件；能补先补，补不了才说清为什么。
3. 同一软件开工前先 note_list 读经验；收工后 note_add 记下新踩的坑。

【模式契约】档案里的 mode 是硬约束（点击工具会真的拒绝）：
  guided    新手指引：绝不代点（desktop_click 直接拒绝，除非 force:true）。
            用 desktop_guide 一步一步指：黄色高亮框 + 桌宠指着 + 大肥鱼口吻气泡，
            讲清"这一步做什么、为什么"。学生自己动手。默认顺手截图存证，
            超过 1 秒会返回 remindUserToScreenshot，请让学生自己截图。
  automatic 连续执行不打断，只在失败或不可逆操作前停下（快，风险高）
  mixed     默认：只读/可逆操作直接做，删除、清空、覆盖等不可逆操作先确认

选一个 action，其余参数直接平铺传（也接受包在 args 对象里）。
  workflow 取回标准执行流程（八步 + 被挡时怎么办）
status 状态总览
environment_probe(software?) 只读探测已安装软件
software_catalog(query?) 软件目录
note_add(software, kind, text) 记软件经验（坑/位置/技巧）
note_list(software?) 读软件经验（做同类实验前先读）
compatibility_advise(software?, version?) 兼容性建议
experiment_create(title, course?, software?, mode?) 新建实验档案
experiment_clone(sourceId, title?) 复制上一份实验的步骤骨架（结果清空）
experiment_list(status?) 列出档案
experiment_get(id) 读一份档案
experiment_update(id, ...) 更新档案
experiment_record_result(id, stepId?, ...) 记录步骤结果
repair_plan / repair_record 修复方案与记录
report_template / report_plan 报告模板与提纲
report_generate 生成 Word+Markdown 报告
desktop_status 桌宠进程状态
desktop_pet(action, x?, y?, name?) 桌宠显示/隐藏/移动/改名
desktop_place(windowTitle|process, width?, height?) 把实验软件窗口归位到固定矩形
desktop_click(x, y, confirm?) 在窗口内点击；默认真点，传 confirm:false 只预演不点
desktop_guide / desktop_screenshot 桌面指引与截图（截图前会自动归位）
desktop_tutorial / tutorial_claims 教学循环：学生点桌宠→跑到校验命令→通过就自动下一步
page_map_capture / page_map_guide / page_map_list 页面地图`
      const actionNames = [...collected.keys()]
        .map((name) => name.replace(/^lab_assistant_/, '').replace(/^lab_/, ''))

      // 记录注册结果，便于排查宿主为什么不接受合并入口
      const writeRegisterLog = (text) => {
        try {
          writeFileSync(join(store.homeDir, 'register.log'), `${new Date().toISOString()}\n${text}\n`, 'utf8')
        } catch { /* 日志写不进去也不能影响插件 */ }
      }

      const registerLegacyTools = (reason) => {
        const names = []
        for (const spec of collected.values()) {
          try {
            ctx.tools.register(defineTool({
              ...spec,
              parameters: spec.parameters,
              output: textOutput,
              async execute(args, exec) {
                return safe(await spec.execute(args || {}, exec))
              },
            }))
            names.push(spec.name)
          } catch (error) {
            writeRegisterLog(`legacy 注册失败 ${spec.name}: ${error && error.message}`)
          }
        }
        writeRegisterLog(`合并入口注册失败，已回退为 ${names.length} 个独立工具\n原因: ${reason}\n已注册: ${names.join(', ')}`)
        return names.length
      }

      let mergedToolOptions = null
      try {
        mergedToolOptions = defineTool({
        name: 'lab_assistant',
        description: ACTION_DOC,
        // 注意：这里必须传「属性映射」（{ 参数名: schema }），不能传完整 JSON Schema。
        // 宿主的 defineTool 会把每个 key 当参数名编译，传 {type:'object',...} 会报
        // "parameters.type must be a value schema object"。
        // 参数对象是隐式开放的，其余字段无需声明即可透传。
        parameters: {
          action: { type: 'string', description: `要执行的动作，取值：${actionNames.join(', ')}` },
        },
        output: textOutput,
        async execute(input) {
          const raw = input || {}
          const action = String(raw.action || '').trim().replace(/^lab_/, '')
          const spec = collected.get(`lab_${action}`) || collected.get(`lab_assistant_${action}`)
          if (!spec) {
            return {
              ok: false,
              error: `未知 action: ${action || '(空)'}`,
              actions: actionNames,
            }
          }
          // 参数既可以平铺（{action:'page_map_capture', software:'eNSP'}），
          // 也可以包在 args 里（{action:'...', args:{software:'eNSP'}}），两种都支持。
          const nested = raw.args && typeof raw.args === 'object' ? raw.args : {}
          const args = { ...nested }
          for (const key of Object.keys(raw)) {
            if (key === 'action' || key === 'args') continue
            args[key] = raw[key]
          }
          try {
            return safe(await spec.execute(args))
          } catch (error) {
            return {
              ok: false,
              action,
              error: String((error && error.message) || error),
              expectedArgs: Object.keys(spec.parameters || {}),
            }
          }
        },
        })
      } catch (error) {
        mergedToolOptions = null
        registerLegacyTools(String((error && error.stack) || error))
      }

      if (mergedToolOptions) {
        try {
          ctx.tools.register(mergedToolOptions)
          writeRegisterLog('合并入口注册成功: lab_assistant')
        } catch (error) {
          registerLegacyTools(String((error && error.stack) || error))
        }
      }

      const json = (res, status, value) => sendJson(res, status, value)
      const fail = (res, error, status = 400) => json(res, status, { ok: false, error: String(error?.message || error || '请求失败') })

      async function api(req, res, pathname, searchParams) {
        if (req.method === 'GET' && pathname === '/dsh-lab/api/status') {
          return json(res, 200, { ok: true, plugin: 'dsh-lab-assistant', version: packageVersion(), ...store.status(), assets: assetStatus(), catalog: catalogHighlights(), homeDir: store.homeDir, experimentsDir: store.experimentsDir })
        }
        if (pathname === '/dsh-lab/api/settings') {
          if (req.method === 'GET') return json(res, 200, { ok: true, settings: store.getSettings() })
          if (req.method === 'PUT' || req.method === 'PATCH') {
            const body = await readJsonBody(req)
            const settings = store.updateSettings(body)
            // 改了数据目录就地重建 store，新实验立即落到新位置（旧数据不动）
            if ('dataDir' in (body || {})) store = new ExperimentStore(baseHome)
            return json(res, 200, { ok: true, settings: store.getSettings(), experimentsDir: store.experimentsDir })
          }
          return json(res, 405, { ok: false, error: '只支持 GET、PUT 或 PATCH' })
        }
        if (pathname === '/dsh-lab/api/experiments') {
          if (req.method === 'GET') {
            return json(res, 200, {
              ok: true,
              experiments: store.listExperiments({
                status: searchParams.get('status') || '',
                query: searchParams.get('q') || '',
              }),
            })
          }
          if (req.method === 'POST') {
            const body = await readJsonBody(req)
            const experiment = store.createExperiment(body)
            petMood('happy', '新实验档案建好啦，主人加油～')
            return json(res, 201, { ok: true, experiment })
          }
          return json(res, 405, { ok: false, error: '只支持 GET 或 POST' })
        }
        const deleteExperimentMatch = /^\/dsh-lab\/api\/experiments\/([^/]+)$/.exec(pathname)
        if (deleteExperimentMatch && req.method === 'DELETE') {
          try {
            const removed = store.deleteExperiment(decodeURIComponent(deleteExperimentMatch[1]))
            return json(res, 200, { ok: true, ...removed, note: '已移入 _trash，需要时可手动恢复' })
          } catch (error) {
            return json(res, 400, { ok: false, error: error.message })
          }
        }
        const deleteTemplateMatch = /^\/dsh-lab\/api\/report\/templates\/([^/]+)$/.exec(pathname)
        if (deleteTemplateMatch && req.method === 'DELETE') {
          try {
            const removed = deleteTemplate(store.homeDir, decodeURIComponent(deleteTemplateMatch[1]))
            return json(res, 200, { ok: true, ...removed, note: '已移入 _trash，需要时可手动恢复' })
          } catch (error) {
            return json(res, 400, { ok: false, error: error.message })
          }
        }
        const resultMatch = /^\/dsh-lab\/api\/experiments\/([^/]+)\/results$/.exec(pathname)
        if (resultMatch && req.method === 'POST') {
          const body = await readJsonBody(req, 16 * 1024)
          return json(res, 200, { ok: true, experiment: store.recordStepResult(decodeURIComponent(resultMatch[1]), body) })
        }
        const experimentMatch = /^\/dsh-lab\/api\/experiments\/([^/]+)$/.exec(pathname)
        if (experimentMatch) {
          const id = decodeURIComponent(experimentMatch[1])
          if (req.method === 'GET') return json(res, 200, { ok: true, experiment: store.getExperiment(id) })
          if (req.method === 'PATCH') {
            const body = await readJsonBody(req)
            return json(res, 200, { ok: true, experiment: store.updateExperiment(id, body) })
          }
          return json(res, 405, { ok: false, error: '只支持 GET 或 PATCH' })
        }
        if (req.method === 'GET' && pathname === '/dsh-lab/api/desktop/visible') {
          const status = await overlayStatus()
          return json(res, 200, { ok: true, running: Boolean(status.running) })
        }
        if (req.method === 'GET' && pathname === '/dsh-lab/api/catalog') {
          return json(res, 200, {
            ok: true,
            ...searchCatalog({
              discipline: searchParams.get('discipline') || '',
              priority: searchParams.get('priority') || '',
              query: searchParams.get('q') || '',
            }),
          })
        }
        if (req.method === 'POST' && pathname === '/dsh-lab/api/advise') {
          const body = await readJsonBody(req, 16 * 1024)
          return json(res, 200, {
            ok: true,
            ...(await adviseCompatibility({
              software: String(body.software || 'ensp'),
              currentlyWorking: body.currentlyWorking === true,
            })),
          })
        }
        if (req.method === 'POST' && pathname === '/dsh-lab/api/repair') {
          const body = await readJsonBody(req, 16 * 1024)
          return json(res, 200, await planRepair({
            software: String(body.software || 'ensp'),
            symptom: String(body.symptom || ''),
            homeDir: store.homeDir,
          }))
        }
        if (req.method === 'POST' && pathname === '/dsh-lab/api/repair/record') {
          const body = await readJsonBody(req, 16 * 1024)
          return json(res, 200, recordRepair(store.homeDir, body))
        }
        if (pathname === '/dsh-lab/api/report/templates' && req.method === 'GET') {
          return json(res, 200, { ok: true, templates: listTemplates(store.homeDir) })
        }
        if (req.method === 'POST' && pathname === '/dsh-lab/api/report/template') {
          const body = await readJsonBody(req, 16 * 1024)
          if (!body.path) return json(res, 200, { ok: true, templates: listTemplates(store.homeDir) })
          return json(res, 200, { ok: true, template: importTemplate({ filePath: String(body.path), name: String(body.name || ''), homeDir: store.homeDir }) })
        }
        if (req.method === 'POST' && pathname === '/dsh-lab/api/report/plan') {
          const body = await readJsonBody(req, 16 * 1024)
          return json(res, 200, await reportPlanFor(body))
        }
        if (req.method === 'POST' && pathname === '/dsh-lab/api/report/generate') {
          const body = await readJsonBody(req, 16 * 1024)
          try {
            const plan = await reportPlanFor(body)
            const output = generateReport({
              plan,
              student: { name: String(body.studentName || ''), studentId: String(body.studentId || '') },
            })
            petMood('happy', '报告生成好啦，记得核对【待补】的地方～')
            return json(res, 200, {
              ...output,
              template: plan.template,
              drafts: plan.drafts,
              pending: plan.sections.filter((item) => item.coverage === 'partial' || item.coverage === 'pending').map((item) => item.title),
            })
          } catch (error) {
            petMood('confused', '报告生成出错了，我看看哪里不对…')
            throw error
          }
        }
        if (req.method === 'POST' && pathname === '/dsh-lab/api/probe') {
          const body = await readJsonBody(req, 16 * 1024)
          return json(res, 200, { ok: true, probe: await probeEnvironment({ software: String(body.software || '') }) })
        }
        return json(res, 404, { ok: false, error: '接口不存在' })
      }

      const route = {
        kind: 'prefix',
        path: '/dsh-lab',
        handler: async (req, res) => {
          if (!isTrustedLocalRequest(req)) {
            return json(res, 403, { ok: false, error: '只允许从本机 DSH 界面访问' })
          }
          let parsed
          try {
            parsed = new URL(req.url || '/', 'http://127.0.0.1')
          } catch {
            return json(res, 400, { ok: false, error: '请求地址无效' })
          }
          try {
            if (parsed.pathname.startsWith('/dsh-lab/api/')) {
              return await api(req, res, parsed.pathname, parsed.searchParams)
            }
            return json(res, 404, { ok: false, error: '路径不存在' })
          } catch (error) {
            return fail(res, error)
          }
        },
      }
      disposers.push(ctx.webServer.register(route))

      ctx.effect(() => () => {
        for (const dispose of disposers) {
          try { dispose() } catch { /* 单个路由清理失败不阻断 */}
        }
        stopOverlay().catch(() => {})
        try { if (ipcServer) ipcServer.close() } catch { }
      })
    })
  },
}
