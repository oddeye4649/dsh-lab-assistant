#!/usr/bin/env node
// WorkBuddy MCP 适配器：把 dsh-lab-assistant 的核心能力暴露成 MCP 工具。
// 零依赖，手写 JSON-RPC 2.0 over stdio（换行分隔）。
//
// 与 DSH 插件的关系：复用同一套 lib/core.mjs 业务门面，数据目录默认也共用
// ~/.dsh/lab-assistant（可用 LAB_ASSISTANT_HOME 覆盖），所以两边看到的是同一批实验档案。
// 若 WorkBuddy 桌面启动器在跑，工具调用会转发给它，由它作为唯一写入点。
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'

import { ExperimentStore } from '../lib/store.mjs'
import { KnowledgeBase } from '../lib/knowledge.mjs'
import { createCore } from '../lib/core.mjs'
import { isPidAlive, readDiscoveryFile } from '../lib/discovery.mjs'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

const HOME = process.env.LAB_ASSISTANT_HOME || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'lab-assistant')

let store
let core
try {
  store = new ExperimentStore(HOME)
  const knowledge = new KnowledgeBase(store)
  core = createCore({
    store,
    version: VERSION,
    assetsRoot: join(PACKAGE_ROOT, 'assets'),
    hostNotes: ['通过 WorkBuddy MCP 适配器调用；若桌面启动器在运行，写操作由它统一执行'],
    overlay: null,
    knowledge,
  })
} catch (error) {
  process.stderr.write(`[lab-assistant-mcp] 初始化失败：${error?.message || error}\n`)
  process.exit(1)
}

// 工具表：name 用 snake_case，映射到 core 的 camelCase 方法。
// inputSchema 采用宽松对象 + 在描述里写清关键参数，避免不同宿主对 schema 方言支持不一致。
const TOOLS = [
  {
    name: 'lab_status',
    method: 'status',
    description: '查看实验助手总体状态：版本、数据目录、当前实验、软件目录摘要、当前实验每一步的执行/记录情况。开始任何实验前先调这个。',
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'lab_workflow',
    method: 'workflow',
    description: '获取本插件的标准实验流程（几步、每步要求什么、什么算完成）。第一次用时先读它，避免跳步。',
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'lab_software_catalog',
    method: 'softwareCatalog',
    description: '查询软件知识目录：按关键词、学科、验证状态筛选。返回每项软件的 support 状态（verified-run=已实测最小实验可复现；verified-diagnose=只验证了能识别/启动；catalog-only=仅收录未验证）。不要向用户承诺 catalog-only 的软件一定能跑。',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，匹配名称/别名/分类' },
        discipline: { type: 'string', description: '学科筛选，如 computer / networking / electronics' },
        support: { type: 'string', description: '验证状态筛选：verified-run / verified-diagnose / catalog-only' },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'lab_experiment_create',
    method: 'experimentCreate',
    description: '创建一份实验档案（一次实验一个档案，可恢复）。参数至少给 title；建议同时给 course、software、steps（步骤数组）。返回值里带 knowledge（该软件的历史经验、失败案例、热区），**下一步必须用它**，不要忽略。',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '实验名称，如「RC 低通滤波器仿真」' },
        course: { type: 'string', description: '课程名' },
        software: { type: 'string', description: '使用的软件名，如 LTspice / Weka' },
        mode: { type: 'string', description: 'guided（跟着指引做）或 free（自由操作）' },
        templateId: { type: 'string', description: '已导入的报告模板 ID（先用 lab_report_template 导入；绑上之后生成报告才会用老师那份格式）' },
        reportTemplate: { type: 'string', description: '模板 ID / 名称 / .docx 绝对路径，与 templateId 等价' },
        steps: {
          type: 'array',
          description: '步骤数组，每项 {title, where?, notes?}',
          items: { type: 'object' },
        },
      },
      required: ['title'],
      additionalProperties: true,
    },
  },
  {
    name: 'lab_experiment_get',
    method: 'experimentGet',
    description: '读取一份实验档案（不传 id 则读当前实验）。返回值自动带 knowledge：该软件的历史控件位置、失败反例、热区、报告片段。**做实验前先看它**，能少走弯路。',
    schema: {
      type: 'object',
      properties: { id: { type: 'string', description: '实验 id，省略则用当前实验' } },
      additionalProperties: true,
    },
  },
  {
    name: 'lab_experiment_list',
    method: 'experimentList',
    description: '列出所有实验档案（标题、课程、软件、状态、步骤完成度）。',
    schema: {
      type: 'object',
      properties: { includeArchived: { type: 'boolean', description: '是否包含已归档实验' } },
      additionalProperties: true,
    },
  },
  {
    name: 'lab_experiment_update',
    method: 'experimentUpdate',
    description: '更新实验档案：标题、课程、软件、模式、状态、当前步骤、步骤清单、备注。状态设为 archived 时会把操作明细压成聚合摘要（原明细保留）。',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string', description: 'active / done / archived 等' },
        templateId: { type: 'string', description: '绑定的报告模板 ID（换上老师那份格式）' },
        reportTemplate: { type: 'string', description: '模板 ID / 名称 / 路径，与 templateId 等价' },
        currentStep: { type: 'number', description: '当前步骤序号（从 1 开始）' },
        steps: { type: 'array', items: { type: 'object' } },
        notes: { type: 'string' },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'lab_experiment_record_result',
    method: 'experimentRecordResult',
    description: '记录某一步的真实执行结果（实际值、是否通过、失败原因、截图路径）。这是「实验做过」的唯一凭据；没记录就等于没做。**不允许编造数据**。不传 id 时用当前实验，step 从 1 开始（会自动换算成步骤 id）。',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '实验编号；省略则用当前实验' },
        step: { type: 'number', description: '步骤序号，从 1 开始' },
        stepId: { type: 'string', description: '步骤 id（与 step 二选一，优先用这个）' },
        actual: { type: 'string', description: '实际观察到的结果/数值' },
        passed: { type: 'boolean', description: '该步是否通过' },
        failure: { type: 'string', description: '失败原因（passed=false 时填）' },
        controlName: { type: 'string', description: '涉及的控件名' },
        screenshot: { type: 'string', description: '截图文件路径' },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'lab_experiment_clone',
    method: 'experimentClone',
    description: '克隆一份实验档案（保留步骤结构、清空实测值），适合同类型实验重复做。',
    schema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: '被克隆的实验编号' },
        title: { type: 'string', description: '新实验名称' },
        notes: { type: 'string' },
      },
      required: ['sourceId'],
      additionalProperties: true,
    },
  },
  {
    name: 'lab_experiment_delete',
    method: 'experimentDelete',
    description: '删除实验档案：整份目录移到 homeDir/_trash（可恢复），不做不可逆销毁。**必须先向用户确认**，再带 confirm:true 调用。',
    schema: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: '要删除的实验编号' },
        confirm: { type: 'boolean', description: '必须显式传 true，表示已向用户确认' },
      },
      required: ['experimentId', 'confirm'],
      additionalProperties: true,
    },
  },
  {
    name: 'lab_note_add',
    method: 'noteAdd',
    description: '给实验加一条笔记（现象、坑、老师要求、待确认事项）。支持结构化字段 controlName / where 便于以后复用。',
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        kind: { type: 'string', description: 'note / pitfall / requirement 等' },
        software: { type: 'string', description: '软件名；不给则用当前实验的软件' },
        controlName: { type: 'string', description: '涉及的控件名' },
        where: { type: 'string', description: '在哪个界面/位置' },
      },
      required: ['text'],
      additionalProperties: true,
    },
  },
  {
    name: 'lab_note_list',
    method: 'noteList',
    description: '列出当前实验的笔记。',
    schema: { type: 'object', properties: {}, additionalProperties: true },
  },
  {
    name: 'lab_report_template',
    method: 'reportTemplate',
    description: '导入老师给的报告模板（.docx / .md / .txt）：解析章节结构、表格列、封面字段，**保存到本机模板库**并返回模板对象（含 id）。不传 path 时列出已导入模板；传 deleteId 可删除（移入 _trash）。生成报告前先用它对齐格式。',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '模板文件绝对路径；省略则列出已有模板' },
        name: { type: 'string', description: '模板名称，省略用文件名' },
        deleteId: { type: 'string', description: '要删除的模板 ID（移到 _trash，可恢复）' },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'lab_knowledge_query',
    method: 'knowledgeQuery',
    description: '查询本机经验库：某软件的控件位置、历史命中、失败反例、热区、报告片段。默认只查本机、不上传、不跨用户。',
    schema: {
      type: 'object',
      properties: {
        software: { type: 'string' },
        kind: { type: 'string', description: 'interface / failures / usage / fragments 等' },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'lab_knowledge_settings',
    method: 'knowledgeSettings',
    description: '查看或修改经验采集开关（autoCapture 默认开启，**不得静默改成默认关**）。action 取值：status（默认）/ on / off / rebuild / rebuild-usage。',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'status / on / off / rebuild / rebuild-usage' },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'lab_report_fragment_add',
    method: 'reportFragmentAdd',
    description: '录入一条报告句式骨架（按课程/章节）。禁带数值、不进正文、不标已核对，只作为改写参考。不传 software 时按当前实验档案归属。',
    schema: {
      type: 'object',
      properties: {
        course: { type: 'string' },
        section: { type: 'string', description: '章节名，如「实验结果」' },
        pattern: { type: 'string', description: '句式骨架' },
        software: { type: 'string', description: '软件名；不传则按当前实验推断' },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'lab_compatibility_advise',
    method: 'compatibilityAdvise',
    description: '按报错特征给出兼容性建议（例如 eNSP 启动设备失败）。返回候选版本与安装顺序，并标注哪些来自本机经验、哪些只是社区经验。',
    schema: {
      type: 'object',
      properties: { error: { type: 'string', description: '报错原文' }, software: { type: 'string' } },
      additionalProperties: true,
    },
  },
  {
    name: 'lab_repair_plan',
    method: 'repairPlan',
    description: '针对某软件给出修复方案（先只读诊断，再谈改动；高风险变更必须说明回退方式）。',
    schema: {
      type: 'object',
      properties: { software: { type: 'string' }, symptom: { type: 'string' } },
      additionalProperties: true,
    },
  },
  {
    name: 'lab_repair_record',
    method: 'repairRecord',
    description: '记录一次修复尝试的结果（成功/失败、改了什么、如何回退），写进本机经验。',
    schema: {
      type: 'object',
      properties: {
        software: { type: 'string', description: '软件名' },
        version: { type: 'string', description: '软件版本' },
        component: { type: 'string', description: '涉及组件，如 VirtualBox' },
        name: { type: 'string', description: '条目名/方案名' },
        symptom: { type: 'string', description: '症状' },
        outcome: { type: 'string', description: 'worked / failed' },
        notes: { type: 'string' },
      },
      required: ['software', 'version', 'outcome'],
      additionalProperties: true,
    },
  },
  {
    name: 'lab_page_map_list',
    method: 'pageMapList',
    description: '列出已保存的界面地图（某软件有哪些界面、每个界面记录了多少控件）。',
    schema: {
      type: 'object',
      properties: { software: { type: 'string' } },
      additionalProperties: true,
    },
  },
  {
    name: 'lab_tutorial_claims',
    method: 'tutorialClaims',
    description: '查看教程/指引内容里哪些说法是「已验证」、哪些是「未验证」。回答用户前用它避免把未验证的说法讲成事实。',
    schema: { type: 'object', properties: {}, additionalProperties: true },
  },
  {
    name: 'lab_environment_probe',
    method: 'environmentProbe',
    description: '只读探测本机环境：装了哪些软件、版本、路径、注册表痕迹。**不安装、不启动、不改配置**。开始实验前用它确认环境。',
    schema: {
      type: 'object',
      properties: {
        software: { type: 'string', description: '只查某个软件；省略则整体探测' },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'lab_report_plan',
    method: 'reportPlan',
    description: '生成报告大纲：按模板章节，把实验档案里的步骤/截图/实测值映射到各章节，并标出哪些还缺数据。**先看 plan 再生成**，避免整份返工。',
    schema: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: '实验编号；省略用当前实验' },
        templateId: { type: 'string', description: '模板 id；省略用已导入的默认模板' },
        useBuiltin: { type: 'boolean', description: '没有老师模板时用内置封面' },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'lab_report_generate',
    method: 'reportGenerate',
    description: '生成实验报告（Word + Markdown）。**只写档案里真实记录过的内容**：环境、步骤、截图、拓扑、故障记录自动填；目的/原理/分析/总结生成带「需核对」的草稿；个人信息与实测值留【待补】。不允许编造数据。',
    schema: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: '实验编号；省略用当前实验' },
        templateId: { type: 'string', description: '模板 id' },
        useBuiltin: { type: 'boolean', description: '没有老师模板时用内置封面' },
        outputDir: { type: 'string', description: '输出目录；省略用实验目录' },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'lab_report_update',
    method: 'reportUpdate',
    description: '在已生成的报告上做增量更新（补截图、改章节文字），不重新生成整份。',
    schema: {
      type: 'object',
      properties: {
        experimentId: { type: 'string' },
        section: { type: 'string', description: '要更新的章节名' },
        content: { type: 'string', description: '新内容' },
      },
      additionalProperties: true,
    },
  },
]

function ok(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function err(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

// 把 MCP 侧的友好参数归一化成 core 的真实签名。
// 这一层是为了让「工具描述」和「core 历史签名」解耦：core 里有 id/experimentId、
// sourceId、stepId 等历史差异，MCP 侧统一用清晰的名字，这里做转换。
function normalizeArgs(method, rawArgs) {
  const args = { ...(rawArgs || {}) }

  // pageMapList(software) 收的是字符串，不是对象
  if (method === 'pageMapList') return String(args.software || '')

  // recordResult: step(1 基) → stepId；缺 id 时用当前实验
  if (method === 'experimentRecordResult') {
    if (!args.id && !args.experimentId) {
      try { args.id = store.currentExperimentId() } catch { /* 保持空，让 core 报明确错误 */ }
    }
    if (args.step != null && !args.stepId) {
      const expId = String(args.id || args.experimentId || '')
      let exp = null
      try { exp = expId ? store.getExperiment(expId) : null } catch { exp = null }
      const idx = Number(args.step) - 1
      const step = exp?.steps?.[idx]
      if (step) args.stepId = step.id || step.title
      delete args.step
    }
    return args
  }

  // experimentGet: 空 id 回退当前实验
  if (method === 'experimentGet') {
    if (!String(args.id || '').trim()) {
      try { args.id = store.currentExperimentId() } catch { /* 交给 core 报错 */ }
    }
    return args
  }

  // clone: id → sourceId
  if (method === 'experimentClone' && args.id && !args.sourceId) {
    args.sourceId = args.id
    delete args.id
  }

  // delete: id → experimentId
  if (method === 'experimentDelete' && args.id && !args.experimentId) {
    args.experimentId = args.id
    delete args.id
  }

  // noteAdd: 缺 software 时按当前实验推断
  if (method === 'noteAdd' && !String(args.software || '').trim()) {
    try {
      const cur = store.currentExperimentId()
      const exp = cur ? store.getExperiment(cur) : null
      if (exp?.software) args.software = exp.software
    } catch { /* 推断失败就让 core 报错 */ }
  }

  // knowledgeSettings: 兼容旧写法 autoCapture:on/off
  if (method === 'knowledgeSettings') {
    if (args.action == null && args.autoCapture != null) {
      const v = args.autoCapture
      args.action = v === true || v === 'on' ? 'on' : v === false || v === 'off' ? 'off' : 'status'
    }
    delete args.autoCapture
  }

  // 报告三件套：缺 experimentId 时回退当前实验
  if (method === 'reportPlan' || method === 'reportGenerate' || method === 'reportUpdate') {
    if (!String(args.experimentId || '').trim()) {
      try { args.experimentId = store.currentExperimentId() } catch { /* 交给 core 报错 */ }
    }
    return args
  }

  return args
}

// ---- 桌面启动器转发桥 ----
// 发现文件存在且进程活着时，本 MCP 不直接写 store，而是把工具调用转给桌面启动器，
// 保证任何时刻只有一个写入点。启动器没开时退回本地模式（此时也只有本进程在写）。
const DISCOVERY_FILE = join(HOME, 'desktop.json')

function readBridge() {
  // 读侧对「文件存在但空/半截」做短重试，见 lib/discovery.mjs。
  // 启动器恰好正在写 discovery 时，旧实现会把它当成「没开」而退回本地写，形成双写入点。
  const d = readDiscoveryFile(DISCOVERY_FILE)
  if (!d) {
    // 文件在、重试后仍读不出：上次强杀留下的半截，或权限问题。
    // 不清掉的话，之后每次调用都要白等重试，永远回不到「干净地当没开」。
    // 正在写的启动器持有的是临时文件，删目标不影响它的 rename。
    try { if (existsSync(DISCOVERY_FILE)) unlinkSync(DISCOVERY_FILE) } catch { }
    return null
  }
  if (!Number.isInteger(d.port) || d.port <= 0 || !String(d.token || '')) return null
  if (!bridgeAlive(d)) {
    // 启动器被强杀 / 崩溃后，退出钩子来不及清理发现文件。
    // 进程确定已不在了，删掉残留，之后安全地退回本地模式。
    try { unlinkSync(DISCOVERY_FILE) } catch { }
    return null
  }
  return d
}
function bridgeAlive(d) {
  return isPidAlive(d && d.pid)
}
async function forwardToDesktop(d, methodName, args) {
  const url = `http://127.0.0.1:${d.port}/dsh-lab/api/tool?token=${encodeURIComponent(d.token)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: methodName, args }),
    signal: AbortSignal.timeout(60000),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body?.error || '桌面服务返回错误'}`)
  return body
}

async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return { isError: true, text: `未知工具：${name}` }
  if (typeof core[tool.method] !== 'function') {
    return { isError: true, text: `核心方法缺失：${tool.method}（版本不匹配？）` }
  }
  try {
    const normalized = normalizeArgs(tool.method, args)
    const bridge = readBridge()
    if (bridge && bridgeAlive(bridge)) {
      // 桥在就不降级：降级会让两个进程同时写同一份档案，静默丢数据比明确报错更糟。
      try {
        const result = await forwardToDesktop(bridge, tool.method, normalized)
        return { text: JSON.stringify(result, null, 2) }
      } catch (error) {
        return {
          isError: true,
          text: `桌面服务无响应（${error?.message || error}）。请看 node desktop/start.mjs --status，或执行 --stop 后重试。为避免两份数据互相覆盖，本次没有改动本地档案。`,
        }
      }
    }
    const result = await core[tool.method](normalized)
    return { text: JSON.stringify(result == null ? { ok: true } : result, null, 2) }
  } catch (error) {
    return { isError: true, text: `执行失败：${error?.message || error}` }
  }
}

async function handle(message) {
  const { id, method, params } = message || {}
  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'lab-assistant', version: VERSION },
    })
  }
  if (method === 'notifications/initialized' || method === 'initialized') {
    return null // 通知不需要回复
  }
  if (method === 'ping') {
    return ok(id, {})
  }
  if (method === 'tools/list') {
    return ok(id, {
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.schema,
      })),
    })
  }
  if (method === 'tools/call') {
    const name = params?.name
    const args = params?.arguments || {}
    const result = await callTool(name, args)
    if (result.isError) {
      return ok(id, { content: [{ type: 'text', text: result.text }], isError: true })
    }
    return ok(id, { content: [{ type: 'text', text: result.text }] })
  }
  // JSON-RPC：通知（无 id 或 notifications/*）不得回复
  if (typeof method === 'string' && method.startsWith('notifications/')) return null
  if (id === undefined || id === null) return null
  return err(id, -32601, `未知方法：${method}`)
}

// 启动自检：任何工具的方法名对不上 core，直接报出来，避免上线后才发现整类工具不可用
const missing = TOOLS.filter((t) => typeof core[t.method] !== 'function')
if (missing.length) {
  process.stderr.write(`[lab-assistant-mcp] 以下工具映射的方法不存在：${missing.map((t) => `${t.name}→${t.method}`).join(', ')}\n`)
}
const bootBridge = readBridge()
if (bootBridge && bridgeAlive(bootBridge)) {
  process.stderr.write('[lab-assistant-mcp] 已连接桌面启动器，工具调用将转发给它（单一写入点）\n')
}

let inflight = 0
let closing = false

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  const text = line.trim()
  if (!text) return
  let message
  try {
    message = JSON.parse(text)
  } catch {
    send(err(null, -32700, 'JSON 解析失败'))
    return
  }
  inflight += 1
  handle(message)
    .then((reply) => {
      if (reply) send(reply)
    })
    .catch((error) => {
      send(err(message?.id ?? null, -32603, `内部错误：${error?.message || error}`))
    })
    .finally(() => {
      inflight -= 1
      if (closing && inflight === 0) process.exit(0)
    })
})

rl.on('close', () => {
  closing = true
  if (inflight === 0) {
    process.exit(0)
    return
  }
  // 还有调用在飞：最多等 5 秒把结果写完再退，避免截断
  setTimeout(() => process.exit(0), 5000).unref?.()
})

// 宿主关闭管道时不要让 EPIPE 崩掉进程
process.stdout.on('error', () => process.exit(0))

process.stderr.write(`[lab-assistant-mcp] v${VERSION} 已启动，数据目录 ${HOME}，工具 ${TOOLS.length} 个\n`)
