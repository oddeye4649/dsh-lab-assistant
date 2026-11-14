# 事实来源（本期讲解视频）

本期讲的是本机自有项目，事实全部来自 `D:\lab-assistant` **0.16.1 源码逐文件核对**（2026-11-12），不是外部资料，因此无需联网查证。每一条数据对应的出处如下，便于复核。

| 片中说法 | 源码 / 依据 |
|---|---|
| 版本 0.16.1 | `package.json` `version`、`CHANGELOG.md`、GitHub tag `v0.16.1` |
| 一个仓库、两个宿主 | `README.md` 顶部分岔表、`INSTALL_DSH.md`、`INSTALL_WORKBUDDY.md` |
| 25 个 MCP 工具 | `mcp/server.mjs` 中 `name: 'lab_...'` 计数；`docs/ARCHITECTURE.md` |
| DSH 38 个 action 合成单一工具（片中未展开） | `index.js` `tool({name: ...})` 计数 |
| 实验档案：创建/列表/读取/更新/克隆/删除、`_trash` 可恢复 | `lib/store.mjs`、`lib/core.mjs` `experiment*`、`SECURITY.md` |
| 记录真实结果：实测值 / 通过失败 / 截图路径 / 失败反例 | `core.experimentRecordResult`、`lib/knowledge.mjs` `failures` |
| 模板 `.docx/.md/.txt`，生成 Word + Markdown | `lib/report.mjs`、`lib/docx-write.mjs`、`core.reportGenerate` |
| 【待补】、不编造、无模板要模板 | `lib/report.mjs` `modelOf()`、`core.reportPlanFor()`、`lib/core.mjs:27` 之外以代码为准 |
| Windows 才有桌宠/面板 | `overlay/LabPet.cs` 为 C# WinForms；`lib/overlay.mjs` 用 .NET Framework `csc.exe` 编译 |
| 桌面启动器：127.0.0.1 + token、托盘、自启默认关、`--status/--stop` | `desktop/start.mjs`、`lib/overlay.mjs` `tray/autostart` |
| MCP 转发、单一写入点、桥无响应明确报错 | `mcp/server.mjs` `readBridge()/callTool()`、`lib/api.mjs` `POST /dsh-lab/api/tool` |
| 面板按钮清单（**没有生成报告按钮**） | `overlay/LabPet.cs` 的 `Click +=` 绑定；`GenerateReport()` 无按钮绑定 |
| 软件目录 14 学科 140 项：13 / 1 / 126 | `coursepacks/software-catalog.json` 实际计数、`supportLegend` |
| 不自动更新、无新版本提醒 | `README.md`「升级与查看版本」章节（手动 `git pull --ff-only`） |
| 经验库只在本机、数据不出本机 | `lib/knowledge.mjs`、`SECURITY.md` |
| 真实界面截图 | `docs/screenshots/panel.png`、`guide.png`（2026-10-31 采集） |

## 音色来源（用户指定）

- 目标视频：`https://b23.tv/h6coRgE` → `BV1KQxy6qEJn`，《把实验报告交给桌宠？DSH 实验助手插件演示｜环境检查·步骤校验·自动写报告》，B 站 API 返回时长 **72 秒**。
- 本机工程：`D:\lab-assistant\temp\video\`（10-31 20:32~20:47），`mix_v2.wav` = **71.624 秒**、`video_silent.mp4` = 71.6 秒，与线上时长吻合，确认为同一版。
- 配音参数：`scripts/promo_audio_v2.py:23,46` → `zh-CN-XiaoyiNeural`, `rate="+4%"`, `pitch="+12Hz"`；`scripts/promo_tts.py:16,39` 同参数。
- 交叉验证：用原片第一句台词 + 同一参数重合成，时长 **7.49s**，原片 `v2_hook.mp3` 也是 **7.49s**（`video/tools/make_match_voice.py`）。

## 片中刻意没有出现的说法（避免虚假）

1. WorkBuddy 面板能点「生成报告」——实际无按钮（README / INSTALL 文档写错）。
2. 报告里有红色警示条——文件内没有，只有返回值 `note` 提醒。
3. `lab_report_update` 是增量更新——实际整份重生成。
4. 完全不改注册表——用户显式勾选自启时会写 HKCU Run 项。
5. 完全不代替用户点击——DSH 的 `desktop_click` 在 mixed/automatic 会真点（片中未展开此细节）。
6. 两边同时写也不冲突——只保证 WorkBuddy 内部转发，DSH 与 WorkBuddy 并存无跨进程锁。
7. 31 个工具——实际 38 个 action（片中未提此数）。
