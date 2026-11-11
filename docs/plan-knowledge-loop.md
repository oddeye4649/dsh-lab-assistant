# 经验闭环方案（接口知识 + 报告加速）

> 目标：**第一次做完实验后，第二次同软件实验更快、更准、报告质量更高。**
> 本文是实施计划，不是已完成功能。配套决策见 [decisions-verification.md](decisions-verification.md) 的 D9。

---

## 一、要解决的问题

### 问题 A：经验只在事后被读到，从没在事前被用上

现状（已核实）：

| 环节 | 是否用经验 | 代码位置 |
| --- | --- | --- |
| `report_generate` 写 `handoff.md` | ✅ 自动读 | `lib/core.mjs:348` 调 `store.listSoftwareNotes(exp.software)` |
| 报告**正文** | ❌ 不读 | 正文用的是 `experiment.notes`（实验备注），不是经验库 |
| 实验开始 / 每步执行 | ⚠️ 只靠 `workflow` 第 2 步的一句文字提示 | 代码不强制 |

**后果**：agent 不调 `workflow`、或调了跳过第 2 步、或没走到生成报告，经验就完全不参与——等于不存在。

### 问题 B：三套数据互不认识

| 资产 | 有 | 缺 |
| --- | --- | --- |
| `guide-presets.json` | `{coord:'window', x, y, w, h, pad, software, title, process, located, uses}` | **没有控件名**，不知道框的是什么 |
| `page-maps/*.json` | `{software, version, windowTitle, controls[], capturedAt}`（UIA 实时位置） | **不记历史坐标**，且只覆盖 UIA 读得到的软件 |
| `notes.json` → `where[]` | 自由文本“导出在文件菜单下” | **不可执行**，agent 还得自己找 |

结论：要做的事不是“再加一个库”，而是**把这三套合成一张可执行的界面地图**。

### 补充：坐标复用其实已经有了，但粒度太粗

`index.js:561` 生成 preset 键：

```js
presetKey = `${software || title || process}::${title || process}`.toLowerCase()
```

`index.js:563` 起：**`desktop_guide` 不传 `x/y` 时会自动查上次位置并复用**（`usedPreset`）。

所以“复用”这半截是通的——**问题在粒度只到「软件::窗口」**：同一个窗口里第二次要指**另一个按钮**时，会复用上一个按钮的坐标，框到错误的位置。

L1 要做的就是把这个键从「窗口级」下沉到「控件级」：`<software>::<window>::<controlName>`。

---

## 二、总体架构

```text
采集层（事件驱动，自动落盘，不靠 agent 自觉）
  actions/<expId>.jsonl        每次 guide / click / shot / record 一条
  interface/<software>.json    控件条目（合并 UIA + 历史坐标 + 文本经验）
  failures/<software>.jsonl    失败反例
  usage/<software>.json        热区统计
        │
        ▼
查询层（唯一入口）
  knowledgeFor({ software, stepId?, limit }) →
    { controls[], pitfalls[], failures[], hot[] }
        │
        ▼
注入层（塞进必然发生的调用里）
  experiment_get / experiment_create 的返回带 knowledge 摘要
  desktop_guide 支持 software + controlName 直查
        │
        ▼
产出层
  report_fragments（句式骨架）
```

**设计原则**：一个库（interface）+ 两类动作（record 自动写、guide 自动查）+ 一个注入点（档案读取）。不搞六套独立实现。

---

## 三、任务拆解

### L1 控件条目（地基，最高优先）

**存哪**：`<homeDir>/interface/<software>.json`

```json
{
  "software": "eNSP",
  "version": "1.3.00.100",
  "updatedAt": "2026-11-10T...",
  "controls": [
    {
      "key": "ensp::主窗口::btnExport",
      "name": "btnExport",
      "alias": ["导出", "Export"],
      "purpose": "导出设备配置",
      "window": "主窗口",
      "rect": { "x": 420, "y": 96, "w": 88, "h": 28 },
      "coord": "window",
      "dpi": 150,
      "source": "uia|preset|manual",
      "versionSeen": ["1.3.00.100"],
      "hits": 7,
      "ok": 6,
      "fail": 1,
      "lastOkAt": "..."
    }
  ]
}
```

**合并规则**（按可信度）：

1. `page-maps` 的 UIA 控件 → 导入为 `source:'uia'`，带实时 rect
2. `guide-presets` 的历史坐标 → 按「同软件 + 同窗口 + 时间接近」绑定到控件；**没有控件名的孤立 preset 保留为 `source:'preset'` 的匿名条目**（下次可提示“这里上次框过”）
3. `notes.where` 文本 → 按名称模糊匹配挂到同名控件；挂不上的保留在 `pitfalls/where` 里做人工参考

**查询优先级**：同版本 UIA 实时 > 同版本历史 rect > 跨版本 rect（标 `versionDrift: true`）> 文本描述

**兼容**：读时兼容旧 `page-maps/` 与 `guide-presets.json`，**不迁移、不删除**。另外两条实施中发现的兼容要求：

- 旧 `guide-presets` 的键常是「窗口标题::窗口标题」（旧版把窗口标题当 `software` 用），只按 `<软件名>::` 前缀匹配会漏掉。实现里额外做包含匹配，并把孤立 preset 导成 `__window__` 匿名条目，由 `findWindowPreset()` 统一读取。
- `desktop_guide` 写入 preset 的键**必须保持旧公式**（用显式 `args.software`），否则「software 缺省推断到当前实验档案」会让老数据读不到。

**坐标基准（原方案漏写，照字面做会整体框偏）**：`/inspect` 每个控件同时返回 `rect`（屏幕绝对坐标）和 `rel`（相对整窗）。而 `guide` / `screenshot` / `click` 一律以**整窗左上角**为基准（`client:false`）。因此导入控件坐标**只认 `rel`**；只有 `rect` 没 `rel` 的旧地图只导控件名、不导坐标，标 `needsRevalidate`。证据：`overlay/LabPet.cs` 的 `InspectControls()` 与 `HandleGuide()`。

**文件名净化**：`<software>` 直接当文件名有风险（中文、空格、`/`、`:` 都可能出现）。统一规则：小写 → 非 `[a-z0-9-_]` 替换为 `-` → 截断 40 字符 → 空则用哈希前 8 位。原始软件名作为 JSON 内的 `software` 字段保留，文件名只作索引。

> **实施加固**：实测「软件:A/B」会被压成 `a-b`，不同软件名可能撞到同一文件。因此**含非 ASCII 字符或净化后短于 3 字符**的名字追加哈希后缀（如 `a-b-86f7785c`）。规则可复算，读写两端一致；纯 ASCII 名（如 `R / RStudio` → `r-rstudio`）不变。

**为什么这能解决问题**：现在 `desktop_guide` 的复用粒度是「软件::窗口」，同窗口换一个按钮就会框错；下沉到控件级之后，同一个窗口的不同按钮各有各的坐标。

---

### L2 操作序列（自动录制）

**存哪**：`<homeDir>/actions/<experimentId>.jsonl`

```json
{"at":"...","stepId":"step-3","action":"guide","window":"主窗口","controlName":"btnExport","rect":{"x":420,"y":96,"w":88,"h":28},"source":"interface","ok":true,"ms":180}
```

**谁来写**：`index.js` 在 `desktop_guide` / `desktop_click` / `desktop_screenshot` / `experiment_record_result` **成功后自动写**，不需要 agent 调用。

**怎么用**：`record_result(passed:true)` 时，把该步骤的动作序列摘要（窗口 + 控件顺序）写进 `experiment.steps[i].actions`；`experiment_clone` 时随骨架一起复制。

> **硬约束**：录的是**指引**（框在哪、说什么），不是**点击回放**。`guided` 模式本来就禁止代点，L2 不得绕过这条。

> **失效条件**：`rect` 是相对整窗的坐标，窗口移动不影响；但**窗口尺寸变了就失效**。所以每条动作要同时记 `windowSize:{w,h}`，尺寸不一致时降级为“按控件名重新定位”，不能直接套旧坐标。

---

### L3 视觉锚点（最后做，可选）

**存哪**：`<homeDir>/interface/anchors/<software>/<controlKey>.png`

- 从实验截图裁目标区域 + 8px padding，**只存控件周边，不存整窗**（防隐私）
- UIA 读不到时（eNSP / Qt 类）用多尺度模板匹配，限定在窗口内做金字塔搜索
- **失败必须降级**：匹配不到就退回整窗高亮，不能卡住

> 成本最高、最容易失效（DPI、主题、缩放都会影响）。**排在最后**，先看 L1+L2 够不够用。

---

### L4 失败反例

**存哪**：`<homeDir>/failures/<software>.jsonl`

```json
{"at":"...","expId":"exp-...","stepId":"step-5","window":"主窗口","controlName":"btnStart","rect":{...},"error":"启动设备失败，错误代码 40","shot":"screenshots/014.png"}
```

- 来源：`record_result(passed:false)` 自动写
- 用途：下次走到同一步先提示“上次这里挂了，原因是 X，当时的框在 (x,y)”

---

### L5 报告片段（品质线，独立可并行）

**存哪**：`<homeDir>/report-fragments/<course>.json`

```json
{
  "course": "计算机网络",
  "sections": [
    { "section": "结果分析", "pattern": "本实验通过……观察到……说明……", "samples": ["..."], "maxLen": 300 }
  ]
}
```

- 生成报告时按章节提供**句式骨架**候选，agent 在此基础上改写
- **硬约束**：
  1. 片段**不含具体数值**，数值必须从 `record_result` 重新填
  2. 片段产出的章节**不得**标记为“已核对”，仍走 `【待补】` 或草稿标记
  3. 避免"抄自己"导致结论与本次数据不符

---

### L6 热区统计

**存哪**：`<homeDir>/usage/<software>.json`（由 `actions.jsonl` 聚合，可重建）

- 字段：`{controlKey: {hits, ok, fail, lastAt}}`
- **统计范围：仅本机当前使用者**。`actions.jsonl` 随 `homeDir` 走，不上传、不跨用户共享（见第七节隐私红线）——**看不到别人或全班的经验库**。
- 用途：①查询时按 `hits` 排序，只返回 top N；②面板显示「**你**在这个软件最常点的按钮」；③标记高失败率控件

---

### A 经验前置（注入层）

三处改动，让经验在**必然发生**的调用里出现：

| 位置 | 改什么 | 限流 |
| --- | --- | --- |
| `lab_experiment_get` | 返回增加 `knowledge` 字段 | 坑 5 条 / 控件 8 个 / 失败 3 条 |
| `lab_experiment_create` | 同软件有历史时返回 `knowledge.brief` | 坑 3 条 |
| `lab_desktop_guide` | **两个参数本来就有**（`index.js` 的 `parameters`）；实际改动是让 `controlName` 参与控件级查询、复用历史坐标，并加 `usedSource` 埋点 | — |
| `lab_workflow` 文本 | 第 2 步从“先调 note_list”改为“档案里已带 knowledge，直接看” | — |

**为什么这样能解决 A**：`experiment_get` 是 agent 开工必读的，`desktop_guide` 是每次指路必调的。经验藏在这两处，就不存在“忘了读”。

**两个实现细节**：

1. `software` 缺省推断：`desktop_guide` 的 `software` 现在是可选参数，只传 `controlName` 时应该回落到**当前实验档案的 `experiment.software`**，不要再要求 agent 显式传一次。
2. **加埋点才能验收**：`desktop_guide` 现在返回 `usedPreset`（布尔）。要扩展成 `usedSource`：

```text
interface-live     同版本 UIA 实时命中
interface-history  同版本历史坐标命中
interface-drift    跨版本命中（标了 versionDrift）
preset-window      只命中了窗口级旧 preset（粒度不足）
none               没命中，靠 agent 传的坐标
```

没有这个字段，“首次指引命中率 ≥70%”根本测不出来。

---

## 四、执行批次（有依赖，不能乱序）

| 批次 | 任务 | 依赖 | 产出 |
| --- | --- | --- | --- |
| **1** | L1 存储与合并 + A 注入 + `desktop_guide` 支持 controlName | 无 | 经验第一次能在事前被用上 |
| **2** | L2 自动录制 + L6 热区聚合 | L1 | 数据开始自己长 |
| **3** | L4 失败反例 | L2 | 坑不重复踩 |
| **4** | L5 报告片段 | 无（可并行） | 报告质量线 |
| **5** | L3 视觉锚点 | L1 | UIA 读不到时的兜底 |

批次 1 单独就能解决问题 A，**价值最高**。批次 5 最后做，做不出来也不影响闭环。

---

## 五、自检：这个方案有什么问题

以下是自查发现的问题和处理方式，不是装饰。

### 1. L1 会和 `page-maps` 重复建设 ⚠️
- **问题**：`page_map_capture` 已经存了控件名和位置，L1 再存一套就是两份真相。
- **处理**：**合并**。`page-maps` 降级为“导入源 + 版本快照”，不再作为查询主路径；L1 的 `interface/` 是唯一查询入口。过渡期双写，`page_map_list` 返回里附带 interface 摘要。
- **实施补漏**：原方案只提 `page_map_list`，但 `page_map_guide` 原本直接 `readFileSync(maps[0].file)` 读旧地图——不改它就会留下第二套查询路径。实现里已把 `page_map_guide` 改为走 `knowledge.findControl()`，并在返回里带 `usedSource`。

### 2. L2 有“代点回放”的嫌疑 ⚠️
- **问题**：录制操作序列，很容易被理解成“下次自动点一遍”，这违反 `guided` 硬约束。
- **处理**：写明 L2 只录**指引**（框位置 + 气泡文案 + 成败），**不录点击回放**；`desktop_click` 的 `force` 参数不受 L2 影响。

### 3. L3 成本高、易失效 ⚠️
- **问题**：模板匹配对 DPI / 主题 / 缩放敏感，全图搜索还慢。
- **处理**：排最后；限定窗口内 + 金字塔搜索；**必须有降级**（匹配不到就整窗高亮）。如果 L1+L2 已经够用，L3 可以不做。

### 4. L5 会“抄自己”写出错结论 ⚠️
- **问题**：直接复用上次的分析文字，但这次数据不同，会生成看似合理实则错误的结论。
- **处理**：片段只提供句式骨架，**禁止携带数值**；生成后不得标记“已核对”；测试里加一条“片段不得包含数字”的结构校验。

### 5. 注入会撑爆 agent 上下文 ⚠️
- **问题**：一个软件积累几十条经验后，`experiment_get` 返回会大到影响推理。
- **处理**：硬限流（5/8/3）+ 可配置；超出的按 `hits` 和 `lastOkAt` 排序截断；提供 `lab_knowledge_query` 供 agent 按需深挖。

### 6. 自动采集的隐私边界 ⚠️
- **问题**：录制操作 = 记录用户行为；失败截图可能含学号、姓名、真实数据。
- **处理**：①`knowledge_settings(off/on)` 与 `/dsh-lab/api/settings` PUT 提供总开关，默认开启；②L3 锚点图**只裁控件周边**，不存整窗；③所有数据只在本机，不上传；④见 [knowledge-data.md](knowledge-data.md)。
- **实施偏差（待确认）**：原方案写「面板提供总开关」，本轮**没有改 C# 桌宠面板**。原因：面板改动需要重新编译 `overlay/LabPet.cs`，本机沙箱无法完成编译验证；改了却不能验证的 UI 不如不改。开关改由工具与已有设置 API 提供，agent/用户都能关。是否需要真正加一个面板复选框，列为后续确认项。

### 7. 软件版本漂移 ⚠️
- **问题**：软件升级后控件位置变，历史坐标直接命中会框错。
- **处理**：条目带 `versionSeen[]`；跨版本命中标 `versionDrift: true`，气泡里提示“版本可能变了，请核对”，并**降低优先级**。

### 8. 数据膨胀与并发写 ⚠️
- **问题**：`actions.jsonl` 一个实验可能几百条；多操作并发写可能写坏。
- **处理**：按实验分文件；写入用追加 + 行级原子（单进程内串行化），读时逐行容错（坏行不影响其余）；`interface` / `usage` 用 `writeJsonAtomic`。
- **已补做（0.15.16 / 第四轮）**：`experiment_update(status:"archived")` 触发 `archiveActions()`，把明细压成 `actions/<expId>.summary.json`（按控件/步骤聚合）+ `.jsonl.gz` 副本；**原始明细不删不改**。`rebuildUsage()` 读摘要 + 归档后新增的尾部行，避免双计/漏计（单测覆盖）。

### 9. 旧数据兼容 ⚠️
- **问题**：已有用户有 `guide-presets.json` 和 `page-maps`，不能让他们丢数据。
- **处理**：读时兼容，**不迁移、不删除**；新数据写新位置；面板提供“重建 interface”按钮做手动导入。

### 10. 验收标准模糊 ⚠️
- **问题**：容易做成“功能上线了但没变快”。
- **处理**：定义可测指标，见下节。

### 11. 没有埋点就测不出命中率 ⚠️
- **问题**：`desktop_guide` 现在只返回 `usedPreset`（布尔），分不清“命中的是控件级还是窗口级”，验收指标根本无法计算。
- **处理**：先加 `usedSource` 枚举（见「A 经验前置」），**这个改动要排在 L1 之前**，否则做完也证明不了有效。

### 12. 窗口尺寸变化会让旧坐标失效 ⚠️
- **问题**：`rect` 相对整窗，窗口一改大小（最大化/分屏/不同分辨率）坐标就偏了。
- **处理**：每条动作/控件条目同时记 `windowSize`；尺寸不一致时降级为按控件名重新定位，不套旧坐标。

### 13. 文件名净化 ⚠️
- **问题**：`<software>` 含中文、空格、`/`、`:` 时直接当文件名会出错。
- **处理**：统一净化规则（小写 → 非 `[a-z0-9-_]` 换 `-` → 截断 40 → 空则哈希前 8 位），原始名保留在 JSON 字段里。

---

## 六、验收指标（不是“做完”，是“变快”）

> **实施后修订**：原表的「报告 pending 数下降」经三轮实测证明测不出知识库效果，已替换。证据见本节末尾。

| 指标 | 怎么测 | 目标 | 能否自动测 |
| --- | --- | --- | --- |
| 控件级命中率 | 第二次实验 `desktop_guide` 不传 `x/y`，`usedSource` ∈ {live, history, drift, anchor} 的比例 | ≥ 70% | ✅ `scripts/benchmark-knowledge.mjs` |
| **可靠命中率** | 其中 `usedSource` ∈ {interface-live, interface-history} 的比例（排除需核对的降级命中） | ≥ 50% | ✅ 同上 |
| 量坐标次数 | 第一次 vs 第二次需要 agent 传坐标的控件数 | 下降 ≥ 50% | ✅ 同上 |
| 经验前置覆盖率 | `experiment_create` / `experiment_get` 返回里带出坑、控件、失败记录 | 100% | ✅ 单测 + 基准 |
| 片段候选覆盖 | `report_generate` 返回 `fragmentHints`，且片段不含任何数字 | 有片段时 ≥ 1 条 | ✅ 单测 |
| 追问次数 | 真人两次实验里 agent 向用户提问次数 | 下降 | ❌ 需真人 |
| 失败重复率 | 同一 `(软件, 步骤, 控件)` 的失败是否重复 | 第二次不重复 | ❌ 需真人；代理指标＝失败提示可见率 |

**合成基准实测（0.15.15）**：13 个控件，第一次命中 0 / 需量坐标 13 次；第二次命中 12（可靠 10、降级 2）/ 需量坐标 1 次 → 命中率 **92.3%**、可靠命中率 **76.9%**、量坐标下降 **92.3%**；`usedSource` 分布 `live:2, history:8, drift:2, none:1`。结果落在 `temp/benchmark-knowledge/result.json`。

**为什么删掉「报告 pending 下降」**（反复检验过，不是凭感觉）：

1. 实测：连续三次 `report_generate`（无片段 / 2 条片段 / 3 条片段）得到 `pending 3→3→3`、占位符 `7→7→7`。
2. 代码：`lib/report.mjs` 的 `generateReport({ plan, student, outputDir })` 不接收 `knowledge`；pending 完全由模板覆盖度、步骤与实测值决定。
3. 结论：原指标把「报告质量」和「报告结构缺口」混为一谈，测不出经验库效果。

报告质量的合理代理指标改为：**片段候选数 + 片段不得含数值 + 产出不得标已核对**（都已有单测拦住）。

---

## 七、明确不做

- **点击回放**：违反 `guided` 禁止代点的硬约束
- **跨用户共享经验**：隐私红线
- **云端同步**
- **把经验写进报告正文冒充实测**：违反"不伪造"原则

---

## 八、与现有决策的关系

- **D8**（不做 T3~T5 全量验证）：省下的时间投到这里，因为**经验沉淀的复利比多验几个软件高**。
- **D9**（本方案）：见 [decisions-verification.md](decisions-verification.md)。
- **D10**（实施结论）：见下节。

---

## 九、实施后核查与修订（0.15.15）

这一节记录「方案写错 / 方案漏写 / 实施偏差」，每条都给可复核的证据，不是凭印象改。

### A. 方案事实错误（已确认并改）

| # | 原方案说法 | 实际情况 | 证据 |
| --- | --- | --- | --- |
| 1 | `desktop_guide` 需「新增 `software` + `controlName` 参数」 | 两个参数在 0.14.x 就存在，且 `controlName` 已传给 `/guide` 走 UIA 实时定位 | `index.js` 的 `lab_desktop_guide.parameters`；`overlay/LabPet.cs:HandleGuide` 的 `FindControl` |
| 2 | 合并 `page-maps` 时导入控件位置 | `/inspect` 的 `rect` 是**屏幕绝对**坐标，`rel` 才是相对整窗；`guide`/`click`/`shot` 用整窗基准，直接导 `rect` 会整体框偏 | `overlay/LabPet.cs:InspectControls()` 同时产出 `rect` 与 `rel`；`HandleGuide()` 用 `GetWindowRect` 作原点 |
| 3 | 「page-maps 降级为导入源」但只安排改 `page_map_list` | `page_map_guide` 原本直接读旧文件，不改会留第二套查询路径 | 原 `index.js:845` 起的 `readFileSync(maps[0].file)` |

### B. 方案指标无效（反复检验后替换）

「报告 pending 章节数下降」测不出知识库效果：三轮生成 `pending 3→3→3`、占位符 `7→7→7`；`generateReport()` 不接收 `knowledge`。已换成「片段候选数 / 不含数值 / 不得标已核对」等可测指标，详见第六节。**「追问次数」「失败重复率」需要真人两次实验，合成基准只能给代理指标。**

### C. 实施中发现并补上的坑

- **坐标基准冲突**：C# 的 `/guide` 一旦 UIA 命中控件，`x/y` 会变成相对**控件矩形**而非整窗，且高亮框被夹在控件内。所以凡是用历史坐标/锚点坐标，**必须清空 `payload.control`**；只有 `interface-live`（实时 UIA 定位）才保留控件名。
- **旧 preset 兼容**：旧键常是「窗口标题::窗口标题」，按 `<软件名>::` 前缀会漏；且 `software` 缺省推断会改变写入键。已加包含匹配 + 保持旧写入公式 + `findWindowPreset()`。
- **文件名碰撞**：中文名被压成 `a-b` 这类短名，加哈希后缀加固。
- **`interface-live` 诚实校正**：桌宠返回 `located !== 'control'` 时不能算实时命中，自动退回历史坐标并把 `usedSource` 改为 drift。
- **自动采集边界**：开关只管「自动写入」（guide/click/shot/record 触发），用户主动调用 `note_add` / `anchor_capture` / `report_fragment_add` 不受影响。

### D. 实施偏差（需要用户确认，见最终清单）

1. C# 面板的总开关按钮未做，改用工具 + 设置 API（原因：无法在本机编译验证面板改动）。
2. ~~「实验归档时压缩 actions 摘要」未做~~ → **0.15.16 已做**（见第 8 节）。
3. ~~L3 只做了合成图验证~~ → **0.15.16 已做真实 GUI 端到端验证**（真实桌宠 + Notepad / Weka 真实 PrintWindow PNG，两遍 15/15）。验证**发现旧算法在真实重复纹理界面上会误框、纯色窗口不降级**，已改为 NCC + 多候选精搜；详见下方「E. 真实 GUI 验证发现的算法缺陷」。系统级 DPI/主题切换仍只是图像变换模拟，未做真机切换。
4. 验收里的「追问次数 / 失败重复率」需要真人两次同软件实验，本轮用合成数据只能测代理指标。
5. L6 原本还写了「面板显示最常点的按钮」，本轮只实现了数据层（`usage/<软件>.json` + `knowledge_query` 返回热区），**C# 面板未展示**。原因同第 1 条。
6. ~~L5 片段没有按软件细分~~ → **0.15.16 已做**：`report_fragment_add(software?)` + `fragmentHints(course, sections, software)`，专属优先、同章节去重、通用兜底；边界不变（禁数值 / 不进正文 / 不标已核对）。
7. ~~C# 面板开关与热区展示~~ → **已删除，不再做**（D11 第三轮：零新增价值；用户 20:19 拍板）。

### E. 真实 GUI 验证发现的算法缺陷（0.15.16，第四轮）

合成图只有一块纹理、背景纯色，**测不出真实界面的重复纹理与平坦区域**。真实 Notepad 截图（1200×760，DPI 144，UIA 32 控件）暴露：

| 缺陷 | 旧行为 | 根因 |
| --- | --- | --- |
| 平移后误框 | 期望 `(225,113)`，命中 `(1202,168)`，score 0.902 | `1 - 平均绝对差/255` 分母固定，不与模板/图块能量挂钩 |
| 纯色空白不降级 | 返回非 null | 同上，平坦区域虚高分 |
| 主题反色误报 | score 0.892 | 同上 |
| 精搜漏掉真实尺度 | 自匹配 NCC 掉到 0.58 | 粗搜把 1:1 模板估成 1.1，精搜只试 ±3%，没有 1.0 尺度 |

**修复**：NCC 打分（ΣI / ΣI² 双积分图，候选方差 ≥ 模板方差 12%）、尺度收窄到 0.9~1.5、粗搜保留 6 候选逐个精搜、精搜枚举完整尺度集、精搜后双峰歧义检测、`diagnose:true` 返回降级原因。**正常调用仍返回 `null`**，宿主降级逻辑不变。

**修复后两遍一致**：自匹配 / 平移 / 改尺寸 score 1.0 且坐标精确；1.25 倍缩放 score 0.8748、scale 1.25；反色 / 空白 / 坏 PNG / 低纹理全部降级；Weka Java 自绘窗口真实 PNG 自匹配 1.0。单次 0.4~1.4 s。证据 `temp/gui/run1.json` / `run2.json`（本机，不进包）。

**D 定案**：锚点触发策略**维持保守**（只在 `none` / `preset-window` 且存过锚点时兜底）。理由：命中已可靠，放宽只会增加 0.4~1.4 s 耗时与降级次数。
