// 共享本地 HTTP API。
//
// 这段代码原先是 index.js 插件 setup 里的闭包 `api()`，桌宠面板的 11 条调用全走它。
// 做 WorkBuddy 桌面启动器时把它抽出来，让 DSH 插件和独立启动器复用同一份路由，
// 避免「DSH 修了模板上传，独立版又坏掉」这种分叉。
//
// 新增 POST /dsh-lab/api/tool：MCP 适配器把 25 个工具调用转发到这里，
// 由本进程（唯一持有 store/core 的进程）执行，从根上避免两个进程同时写同一份档案。
//
// 调用方传入 deps（对象，可变）：
//   store / core / knowledge / homeDir / version / assetStatus() /
//   petMood(state, text) / overlayStatus() / replaceStore(newStore)
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ExperimentStore } from './store.mjs'
import { probeEnvironment } from './probe.mjs'
import { catalogHighlights, searchCatalog } from './catalog.mjs'
import { adviseCompatibility } from './advisor.mjs'
import { planRepair, recordRepair } from './remedy.mjs'
import { deleteTemplate } from './report.mjs'
import { readJsonBody, sendJson } from './http.mjs'

// MCP 工具允许调用的核心方法白名单。不要用「任意 core 属性」当入口，
// 否则 construct / __proto__ 之类的名字会被当成方法执行。
// temp/contract-core-methods.mjs 会断言它与 mcp/server.mjs 的 TOOLS 完全一致。
export const CORE_METHODS = Object.freeze([
  'status', 'workflow', 'softwareCatalog',
  'experimentCreate', 'experimentGet', 'experimentList', 'experimentUpdate',
  'experimentRecordResult', 'experimentClone', 'experimentDelete',
  'noteAdd', 'noteList',
  'reportTemplate', 'reportPlan', 'reportGenerate', 'reportUpdate', 'reportFragmentAdd',
  'knowledgeQuery', 'knowledgeSettings',
  'compatibilityAdvise', 'repairPlan', 'repairRecord',
  'pageMapList', 'tutorialClaims', 'environmentProbe',
])
const CORE_METHOD_SET = new Set(CORE_METHODS)

const noop = () => {}
const noOverlay = async () => ({ running: false })

// 桌宠素材状态。DSH 版原来在 index.js 里算，桌面启动器也要用，统一放这里。
export function assetStatus(assetsRoot) {
  const petDir = join(assetsRoot || '', 'pet')
  let files = []
  try { files = readdirSync(petDir) } catch { files = [] }
  const countGroup = (base) => files.filter((name) => name === `${base}.png` || (name.startsWith(`${base}_`) && name.endsWith('.png'))).length
  const groups = ['idle', 'swim', 'dash', 'point', 'happy', 'confused']
  return {
    states: Object.fromEntries(groups.map((name) => [`${name}.png`, countGroup(name) > 0])),
    frames: Object.fromEntries(groups.map((name) => [name, countGroup(name)])),
    icon: existsSync(join(assetsRoot || '', 'icon.png')),
    note: '桌宠素材由桌面伴随进程直接读取本地文件；网页内不再注入桌宠。',
  }
}

export function createApiHandler(deps = {}) {
  const json = (res, status, value) => sendJson(res, status, value)
  const petMood = typeof deps.petMood === 'function' ? deps.petMood : noop
  const overlayStatus = typeof deps.overlayStatus === 'function' ? deps.overlayStatus : noOverlay
  const assetStatus = typeof deps.assetStatus === 'function' ? deps.assetStatus : () => ({})

  return async function api(req, res, pathname, searchParams) {
    const store = () => deps.store
    const core = () => deps.core

    if (req.method === 'GET' && pathname === '/dsh-lab/api/status') {
      return json(res, 200, {
        ok: true,
        plugin: 'dsh-lab-assistant',
        version: deps.version,
        ...deps.store.status(),
        assets: assetStatus(),
        catalog: catalogHighlights(),
        homeDir: deps.store.homeDir,
        experimentsDir: deps.store.experimentsDir,
      })
    }
    if (pathname === '/dsh-lab/api/settings') {
      if (req.method === 'GET') return json(res, 200, { ok: true, settings: deps.store.getSettings() })
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const body = await readJsonBody(req)
        // 空 dataDir 多半是面板还没拿到 /status（例如启动竞态），
        // 直接落盘会把用户自定义的数据目录清空。真要恢复默认必须显式传 resetDataDir:true。
        if (body && body.resetDataDir === true) body.dataDir = ''
        if (body && typeof body.dataDir === 'string' && !body.dataDir.trim()
          && deps.store.getSettings().dataDir && body.resetDataDir !== true) {
          delete body.dataDir
        }
        deps.store.updateSettings(body)
        // 改了数据目录就地重建 store，新实验立即落到新位置（旧数据不动）
        if ('dataDir' in (body || {})) {
          const next = new ExperimentStore(deps.homeDir)
          deps.store = next
          if (deps.knowledge) deps.knowledge.store = next
          if (typeof deps.replaceStore === 'function') deps.replaceStore(next)
        }
        return json(res, 200, { ok: true, settings: deps.store.getSettings(), experimentsDir: deps.store.experimentsDir })
      }
      return json(res, 405, { ok: false, error: '只支持 GET、PUT 或 PATCH' })
    }
    if (pathname === '/dsh-lab/api/experiments') {
      if (req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          experiments: deps.store.listExperiments({
            status: searchParams.get('status') || '',
            query: searchParams.get('q') || '',
          }),
        })
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req)
        // 走 core 而不是 store：core 会把 templateId / reportTemplate 归一成互为别名，
        // 面板只传 reportTemplate 也要在档案里落下 templateId，否则后续按 templateId 找模板会落空。
        // 空标题会静默变成「未命名实验 2026-11-11」，报告标题也跟着错，面板上很难发现
        if (!String(body?.title || '').trim()) {
          return json(res, 400, { ok: false, error: '实验标题不能为空' })
        }
        const created = core().experimentCreate(body)
        petMood('happy', '新实验档案建好啦，主人加油～')
        return json(res, 201, { ok: true, experiment: created.experiment, knowledge: created.knowledge })
      }
      return json(res, 405, { ok: false, error: '只支持 GET 或 POST' })
    }
    const deleteExperimentMatch = /^\/dsh-lab\/api\/experiments\/([^/]+)$/.exec(pathname)
    if (deleteExperimentMatch && req.method === 'DELETE') {
      try {
        const removed = store().deleteExperiment(decodeURIComponent(deleteExperimentMatch[1]))
        return json(res, 200, { ok: true, ...removed, note: '已移入 _trash，需要时可手动恢复' })
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message })
      }
    }
    const deleteTemplateMatch = /^\/dsh-lab\/api\/report\/templates\/([^/]+)$/.exec(pathname)
    if (deleteTemplateMatch && req.method === 'DELETE') {
      try {
        const removed = deleteTemplate(deps.store.homeDir, decodeURIComponent(deleteTemplateMatch[1]))
        return json(res, 200, { ok: true, ...removed, note: '已移入 _trash，需要时可手动恢复' })
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message })
      }
    }
    const resultMatch = /^\/dsh-lab\/api\/experiments\/([^/]+)\/results$/.exec(pathname)
    if (resultMatch && req.method === 'POST') {
      const body = await readJsonBody(req, 16 * 1024)
      return json(res, 200, { ok: true, experiment: store().recordStepResult(decodeURIComponent(resultMatch[1]), body) })
    }
    const experimentMatch = /^\/dsh-lab\/api\/experiments\/([^/]+)$/.exec(pathname)
    if (experimentMatch) {
      const id = decodeURIComponent(experimentMatch[1])
      if (req.method === 'GET') return json(res, 200, { ok: true, experiment: store().getExperiment(id) })
      if (req.method === 'PATCH') {
        const body = await readJsonBody(req)
        return json(res, 200, { ok: true, experiment: store().updateExperiment(id, body) })
      }
      return json(res, 405, { ok: false, error: '只支持 GET 或 PATCH' })
    }
    if (req.method === 'GET' && pathname === '/dsh-lab/api/desktop/visible') {
      const status = await overlayStatus()
      return json(res, 200, { ok: true, running: Boolean(status.running) })
    }
    // 仅本机 + token 可用：让 `desktop/start.mjs --stop` 或托盘「退出」干净收尾。
    if (req.method === 'POST' && pathname === '/dsh-lab/api/desktop/shutdown') {
      if (typeof deps.shutdown !== 'function') {
        return json(res, 501, { ok: false, error: '当前宿主不支持远程关闭' })
      }
      json(res, 200, { ok: true, message: '正在退出实验助手桌面服务' })
      setImmediate(deps.shutdown)
      return
    }
    // 开机自启开关，默认关闭；只有用户显式勾选才写 HKCU Run 项。
    if (pathname === '/dsh-lab/api/desktop/autostart') {
      if (typeof deps.getAutoStart !== 'function' || typeof deps.setAutoStart !== 'function') {
        return json(res, 501, { ok: false, error: '当前宿主不支持自启设置' })
      }
      if (req.method === 'GET') return json(res, 200, { ok: true, enabled: Boolean(deps.getAutoStart()) })
      if (req.method === 'POST' || req.method === 'PUT') {
        const body = await readJsonBody(req, 4 * 1024)
        try {
          const enabled = deps.setAutoStart(body?.enabled === true)
          return json(res, 200, { ok: true, enabled: Boolean(enabled) })
        } catch (error) {
          return json(res, 400, { ok: false, error: String(error?.message || error) })
        }
      }
      return json(res, 405, { ok: false, error: '只支持 GET、POST 或 PUT' })
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
        homeDir: deps.store.homeDir,
      }))
    }
    if (req.method === 'POST' && pathname === '/dsh-lab/api/repair/record') {
      const body = await readJsonBody(req, 16 * 1024)
      return json(res, 200, recordRepair(deps.store.homeDir, body))
    }
    // 模板接口同时接受单数与复数两种写法。
    // 桌面面板一直发的是复数 `/report/templates`（与 GET 列表、DELETE 删除保持一致），
    // 而这里早期只注册了单数 POST，导致面板「导入模板」稳定 404、用户看到
    // 「模板导入失败：…(404) 未找到」。保留单数是为了不破坏已发布的调用方，
    // 也为了让已编译的旧面板不必重装就能恢复。
    const isTemplatePath = pathname === '/dsh-lab/api/report/templates'
      || pathname === '/dsh-lab/api/report/template'
    if (isTemplatePath && req.method === 'GET') {
      return json(res, 200, await core().reportTemplate({}))
    }
    if (isTemplatePath && req.method === 'POST') {
      const body = await readJsonBody(req, 16 * 1024)
      return json(res, 200, await core().reportTemplate(body))
    }
    if (req.method === 'POST' && pathname === '/dsh-lab/api/report/plan') {
      const body = await readJsonBody(req, 16 * 1024)
      return json(res, 200, await core().reportPlan(body))
    }
    if (req.method === 'POST' && pathname === '/dsh-lab/api/report/generate') {
      const body = await readJsonBody(req, 16 * 1024)
      try {
        const result = await core().reportGenerate(body)
        if (result.ok) petMood('happy', '报告生成好啦，记得核对【待补】的地方～')
        return json(res, 200, result)
      } catch (error) {
        petMood('confused', '报告生成出错了，我看看哪里不对…')
        throw error
      }
    }
    if (req.method === 'POST' && pathname === '/dsh-lab/api/probe') {
      const body = await readJsonBody(req, 16 * 1024)
      return json(res, 200, { ok: true, probe: await probeEnvironment({ software: String(body.software || '') }) })
    }
    // MCP 转发专用：只允许白名单里的核心方法，参数由 MCP 侧 normalize 后原样送来。
    if (req.method === 'POST' && pathname === '/dsh-lab/api/tool') {
      const body = await readJsonBody(req, 64 * 1024)
      const method = String(body?.method || '')
      if (!CORE_METHOD_SET.has(method)) {
        return json(res, 400, { ok: false, error: '不支持的核心方法：' + method })
      }
      const fn = core()[method]
      if (typeof fn !== 'function') {
        return json(res, 500, { ok: false, error: '核心方法缺失：' + method })
      }
      const args = body?.args && typeof body.args === 'object' ? body.args : {}
      const result = await fn.call(core(), args)
      return json(res, 200, result == null ? { ok: true } : result)
    }
    return json(res, 404, { ok: false, error: '接口不存在' })
  }
}
