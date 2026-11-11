# 宿主契约（Host Contract）

> 状态：**22/22 已迁移到 `lib/core.mjs`（0.15.8）**。工具层与面板 HTTP 报告接口统一走 core。
> T1 产出：盘点 `index.js` 里全部工具，划出「宿主无关」与「依赖桌宠」的边界。
> 目标：以后加 MCP / WorkBuddy 适配时，只实现这份契约，不碰业务代码。

## 0. 盘点结论

- 实际工具数 **33 个**（早期文档写的 21 已过时），另有 1 个统一入口 `lab_assistant`。
- **22 个宿主无关**（只读写本地档案/模板/报告/探测），**11 个依赖桌宠**（高亮、截图、点击、引导）。
- **没有任何工具执行体直接使用 `ctx`、`webServer`、`defineTool`**；DSH 耦合集中在三处：
  1. `apply()` 里的工具注册
  2. 面板用的 `/dsh-lab/api/*` HTTP 路由
  3. 桌宠进程的启动/停止与 token
- 因此 core 抽离的实质是：把 22 个业务的闭包逻辑搬进 `lib/core.mjs`，注入 `store / probe / advisor / report / overlayBridge`，工具层只做参数校验与转发。

## 1. 宿主无关（22）

| 工具 | 依赖 | 建议 core 方法 |
| --- | --- | --- |
| `lab_workflow` | 常量 | `workflow()` |
| `lab_assistant_status` | store + catalog + 素材目录 | `status()` |
| `lab_experiment_create` | store | `experimentCreate(args)` |
| `lab_experiment_delete` | store | `experimentDelete(id)` |
| `lab_experiment_clone` | store | `experimentClone(sourceId, patch)` |
| `lab_experiment_list` | store | `experimentList(filter)` |
| `lab_experiment_get` | store | `experimentGet(id)` |
| `lab_experiment_update` | store | `experimentUpdate(id, patch)` |
| `lab_experiment_record_result` | store（可选桌宠 /clear） | `experimentRecordResult(args)` |
| `lab_note_add` | store | `noteAdd(args)` |
| `lab_note_list` | store | `noteList(args)` |
| `lab_software_catalog` | 静态目录 | `softwareCatalog(query)` |
| `lab_compatibility_advise` | advisor | `compatibilityAdvise(args)` |
| `lab_repair_plan` | store | `repairPlan(args)` |
| `lab_repair_record` | store | `repairRecord(args)` |
| `lab_report_template` | store | `reportTemplate(path)` |
| `lab_report_plan` | report | `reportPlan(experimentId)` |
| `lab_report_generate` | store + report | `reportGenerate(experimentId, options)` |
| `lab_report_update` | report | `reportUpdate(args)` |
| `lab_tutorial_claims` | store | `tutorialClaims(args)` |
| `lab_page_map_list` | 文件系统 | `pageMapList()` |
| `lab_environment_probe` | probe | `environmentProbe(software)` |

## 2. 依赖桌宠（11，保留为可选能力）

| 工具 | 依赖 | 说明 |
| --- | --- | --- |
| `lab_desktop_status` | overlay | 桌宠是否在运行 |
| `lab_desktop_pet` | overlay | 显示/隐藏/移动/改名 |
| `lab_desktop_guide` | overlay + store | 高亮窗口/控件并讲解 |
| `lab_desktop_tutorial` | overlay + store | 教学循环启动 |
| `lab_desktop_tutorial_step` | overlay | 教学单步推进 |
| `lab_desktop_clear` | overlay | 清掉高亮与气泡 |
| `lab_desktop_click` | overlay + store | 点击/坐标回退 |
| `lab_desktop_place` | overlay | 把桌宠移到指定位置 |
| `lab_desktop_screenshot` | overlay + store | 截图并归档为证据 |
| `lab_page_map_capture` | overlay | 采集页面控件地图 |
| `lab_page_map_guide` | overlay | 按页面地图指引 |

这些能力不放进 core 的业务门面，而是通过 `overlayBridge` 注入；宿主没有桌宠时，core 的业务方法必须仍能工作（只是没有指引/截图）。

## 3. core 门面签名（草案）

```js
createCore({ homeDir, settings, store, probe, advisor, report, overlay })
// 返回对象，方法均为 async，统一返回 { ok: true, ... } 或 { ok: false, error, code? }

core.status()
core.workflow()
core.experimentCreate({ title, course, software, mode, reportTemplate, notes })
core.experimentClone(sourceId, { title, notes })
core.experimentDelete(id)
core.experimentList({ status, query })
core.experimentGet(id)
core.experimentUpdate(id, patch)
core.experimentRecordResult({ id, stepId, title, actual, passed, evidence })
core.noteAdd({ software, kind, text })
core.noteList({ software })
core.softwareCatalog(query)
core.compatibilityAdvise({ software, currentlyWorking })
core.repairPlan({ software, errorText })
core.repairRecord({ ... })
core.reportTemplate(path)
core.reportPlan(experimentId)
core.reportGenerate(experimentId, { useBuiltin, ... })
core.reportUpdate({ experimentId, sections })
core.tutorialClaims({ ... })
core.pageMapList()
core.environmentProbe(software)
```

约定：

- core 不读 `process.env.DSH_*`，不 import DSH 包。
- core 的输入输出只用 JSON 可序列化对象。
- 需要桌宠的动作通过 `overlay` 参数调用；`overlay` 缺失时静默跳过（与现在 `try/catch` 行为一致）。
- 错误统一 `{ ok:false, error:string, code?:'need-template'|'not-found'|'invalid-args' }`。

## 4. T2 迁移顺序建议

1. `status / workflow / softwareCatalog / pageMapList`（无状态，先跑通门面）
2. `experimentCreate / List / Get / Update / Delete / Clone`（纯 store）
3. `experimentRecordResult / noteAdd / noteList / tutorialClaims`（store + 可选 overlay）
4. `environmentProbe / compatibilityAdvise / repairPlan / repairRecord`
5. `reportTemplate / reportPlan / reportGenerate / reportUpdate`（最大块，放最后）
