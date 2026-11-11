# 收敛方案：单宿主 · 单课程 · 内部 core 边界

> 前提：DSH 宿主，计算机网络 + eNSP，维护 ≤5 小时/周，UI 随插件分发，数据只留本机。
> 本方案只做「结构收敛」，不加新功能、不改用户可见行为。

## 一、为什么不是现在做 MCP

- WorkBuddy 适配的真实需求尚未出现（GitHub 0 fork / 最新 release 6 次下载）。
- 抽独立 MCP 服务 = 多一个进程、多一套安装与排错，5 小时/周撑不住。
- 先让 `index.js` 变薄、业务逻辑集中到 `lib/core.mjs`；将来做 MCP 只需在 core 外套一层协议壳，不用重写业务。

## 二、目标结构

```text
index.js                 DSH 适配层：注册统一工具、面板 HTTP API、桌宠进程生命周期
lib/core.mjs             业务门面：12 个宿主无关方法（见下）
lib/store.mjs            实验档案读写（已有）
lib/probe.mjs            只读环境探测（已有）
lib/advisor.mjs          兼容性建议（已有）
lib/report.mjs           模板解析与报告生成（已有）
lib/remedy.mjs           故障修复方案（已有）
lib/overlay.mjs          桌宠进程管理（已有）
overlay/                 WinForms 桌宠 + 面板（已有，不动）
```

**core 门面方法（未来 MCP 只需暴露这些）**

1. `status()`
2. `experimentCreate(args)`
3. `experimentList(filter)`
4. `experimentGet(id)`
5. `experimentUpdate(id, patch)`
6. `experimentRecordResult(id, stepId, result)`
7. `environmentProbe(software)`
8. `compatibilityAdvise(software, version)`
9. `reportTemplate(path)`
10. `reportPlan(experimentId)`
11. `reportGenerate(experimentId, options)`
12. `pageMapList()` / `pageMapGuide()`

core 里**禁止**出现：`ctx`、`webServer`、`defineTool`、`/dsh-lab/api`、桌宠 HTTP 调用。

## 三、任务清单（按依赖顺序，不按周）

总工时约 10 小时，可拆成任意多次；T2 依赖 T1，T4 依赖 T2/T3，T5 依赖 T4。

| 编号 | 任务 | 工时 | 产出 / 完成标准 |
| --- | --- | --- | --- |
| T1 | 盘点 `index.js` 的全部工具（实为 33 个，不是 21），标记「纯业务 / 依赖 DSH / 依赖桌宠」 | 1.5h | **已完成**：22 个宿主无关、11 个依赖桌宠；结论写入 `docs/host-contract.md` |
| T2 | 新建 `lib/core.mjs`，先迁 10 个方法（workflow/status/catalog/pageMapList + 6 个实验 CRUD） | 2h | **已完成**：core 可脱离 DSH 调用 |
| T3 | 为 core 补单测；现有测试保持绿 | 1.5h | **已完成**：新增 `test/core.test.mjs`（3 个用例），总计 35 个测试全绿 |
| T4 | 迁移剩余 12 个方法（记录/笔记/建议/修复/报告/回执/探测） | 2h | **已完成**：22 个宿主无关方法全部进 core |
| T5 | `index.js` 退化为适配层，面板报告接口也走 core；跑全量回归 | 1.5h | **已完成**：index.js 1670 → 1191 行；35 单测 + 3 自检通过；干净 profile 端到端生成 docx |
| T6 | 写 `docs/host-contract.md`：方法签名、错误码、数据边界 | 1h | **已完成**：标注 22/22 已迁移 |
| T7 | 干净环境验证（虚拟机从零安装） | 0.5h | **部分完成**：干净 DSH_HOME 下插件加载/首次编译/桌宠启动通过；真 VM 因 ISO 下载受限待补。见 `docs/verify-clean-install.md` |

## 四、虚拟机验证方案

目标：验证「别人的 Windows 机器从零装 DSH + 插件」能不能跑通，不是验证功能本身。

1. **环境**：VirtualBox 7.2 + Windows 10/11 评估版 ISO（约 5~6 GB），4 核 / 8 GB / 60 GB 磁盘
2. **安装**：`VBoxManage unattended install` 自动装（无人值守），约 30~60 分钟
3. **快照**：装完先打快照，后续每次测试从快照恢复
4. **测试步骤**（在虚拟机内）：
   - 装 DSH 桌面端 → `plugin_manager` 安装 tgz
   - 首次启动：观察桌宠编译、面板打开、150% DPI、杀软拦截
   - 建档案 → 点桌宠校验 → 生成报告，全链路走一遍
5. **记录**：每步耗时、报错原文、缺失依赖（Node/.NET/VC++ 运行库）

> 注意：虚拟机没有 eNSP 时，只能验证插件安装与报告链路；eNSP 只读探测需要另装 eNSP（约 600MB + VirtualBox 依赖），可放到第二轮。

## 五、WorkBuddy 的触发条件

满足任一条再启动适配（预计 1 周）：

- ≥3 个真实用户明确说「我只有 WorkBuddy」
- 课程统一要求使用 WorkBuddy
- 需要把报告能力接到非 DSH 的批处理流程

适配方式：`bin/lab-mcp.mjs`（stdio MCP）调 `lib/core.mjs`，不重写业务。

## 六、明确不做

- 不做豆包（公网 relay 与数据本机冲突）
- 不做独立安装包（UI 随插件）
- 不做多课程/多软件
- 不做云端同步、账号体系、多人协作
