# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
本项目是开发版，**只记录用户能感知的变化与安全修复**，不逐条列内部重构。

## [Unreleased]

## [0.16.0] - 2026-11-11

**WorkBuddy 侧补齐桌面体验，并做到「一个链接、两边各装各的」。** 之前 WorkBuddy 只有 25 个 MCP 工具、没有桌宠面板，用户得靠对话下指令；这版把大肥鱼和「实验助手」面板也搬了过来。

### 新增
- **桌面启动器 `desktop/start.mjs`**：独立起一个只监听 127.0.0.1 + 随机 token 的本地 API，拉起桌宠与面板；`--status` / `--stop` / `--no-pet` 可管理，退出时清发现文件、关桌宠、关 API。
- **托盘常驻**：独立启动器下（`--tray`）任务栏多一个图标，双击/右键开面板、勾「开机自动启动」、点「退出实验助手」干净收尾。关面板不退出桌宠。自启**默认关闭**，只有勾选才写用户级注册表 Run 项；DSH 下行为不变，「再来一只桌宠」也不会多出托盘图标。
- **MCP 转发（单一写入点）**：启动器在跑时，MCP 把 25 个工具调用转成 `POST /dsh-lab/api/tool` 发给它，由它唯一持有 store/core；启动器没开则退回本地模式；**发现文件在但服务无响应时明确报错，绝不静默降级**，避免两个进程同时写同一份档案互相覆盖。
- **共享 `lib/api.mjs`**：把 `index.js` 里 149 行的 `api()` 闭包抽出来，DSH 与桌面启动器共用同一份路由（模板单复数、dataDir 保护等已修问题不会再分叉）。转发方法名受 `CORE_METHODS` 白名单约束。
- **代码分类**：新增 `INSTALL_DSH.md`、`INSTALL_WORKBUDDY.md`（后者是写给 WorkBuddy Agent 的可执行安装指令）、`docs/ARCHITECTURE.md`（共享 / DSH 专属 / WorkBuddy 专属三层归属表）。README 顶部按宿主分岔。不拆包：DSH 按 `main` 只加载插件本体，WorkBuddy 由 Agent 读安装说明装 MCP + 启动器，**同一个 GitHub 链接即可**。
- `package.json` 新增 `lab-assistant-desktop` 命令入口。

### 修复
- 桌面启动器换数据目录时会连带重建 core，避免 DSH 侧「改了 dataDir 后 core 仍持旧 store」的历史问题（DSH 行为保持不变）。
- MCP 会清理被强杀的启动器留下的发现文件残留，之后安全降级本地。

### 验证
- 原有：78 单测 / 3 自检 / catalog 140 项 / pack / 发布扫描 / 面板契约 11 项 / DSH 工具契约 / MCP 契约 / 容错 / 基础回归 / 两条端到端模板链路。
- 新增：`temp/desktop-smoke.mjs`（启动器 12 项：token 校验、面板路由、转发白名单、同一份档案、`--status`/`--stop`、清理）、`temp/bridge-smoke.mjs`（MCP 与面板并发各 6 次建实验 → 12 条不丢；转发导模板/绑模板/出 docx+md；强杀后安全降级；僵死桥拒绝写入）、`temp/tray-smoke.mjs`（真实启动带托盘桌宠、自启默认关、退出后进程与发现文件全清）、`temp/build-check-roslyn.mjs`（Roslyn 与旧 framework csc 两条编译路径都 exit=0）。
- 已知环境限制：`reg.exe` 在 WorkBuddy 工具沙箱里被安全策略黑名单拦截，因此「写入开机自启项」这一步**无法在沙箱内端到端验证**；托盘读状态已改成读本地文件、不再触发它。用户手动双击启动的程序不走该沙箱，不受此限制。

## [0.15.26] - 2026-11-11

一轮独立的「基础功能全面复查」（不只看模板上传，按真实 HTTP 把面板/工具两条路径都打一遍）。
在 0.15.25 之上又抓出 **4 个真问题**，全部修掉并加回归测试。

### 修复
- **模板标题被当成章节**：真实老师模板（正文塞在表格里）首个「实验报告」段落被解析成一个章节，
  生成时多出一节【待补：实验报告】。现在首个标题前的段落只当文档标题/封面，不再单独成章
  （真实模板：7 节 → 6 节，假章节消失）
- **`一、实验目的` 被当成文档标题吞掉**：加了「首个标题本身是章节名就不当标题」的保护，
  `.md` 模板恢复为 2 节（之前被吞成 1 节）
- **`1. 打开软件` 这类编号正文被提升成章节**：数字编号现在必须带章节关键词（目的/原理/步骤/结果…）
  才提升，中文编号与已知章节名不受影响
- **面板建的实验记不了结果**：面板不录步骤，`recordStepResult` 遇到「找不到该步骤」直接报错，
  等于把记录功能堵死。现在给了标题就自动补一条步骤再记录；连标题都没有才报错
- **重复导入模板会堆同名副本**：同一个源文件重复导入改为覆盖原条目，并**保留原 id**
  （已有实验的模板绑定不会失效）；不同文件同名仍各自保留

### 新增
- 无标题模板真正回退内置七节（之前只写了一条警告，却生成了一份「零章节」的空报告）
- `report_generate` 返回 `templateSections`：可直接核对「模板到底生效没有」

### 测试
- 新增 `test/template-import.test.mjs`（5 条）：标题不成章、章节名不被吞、无标题回退、
  同源覆盖且保留 id、异源同名各自保留
- 全量 **78 单测 + 3 自检 + catalog 自检 + 33 项 HTTP 独立验收** 全绿


## [0.15.25] - 2026-11-11

### 基础功能全面复查（用户要求：把「上传模板」这类基础功能查干净）
上一版只修了用户报的那条链路。这一轮把面板的**每个按钮**和**每个工具**都按真实请求打了一遍，
又抓出 9 处基础功能缺陷：

- **`POST /experiments` 绕过 core**：面板新建实验直接调 `store.createExperiment`，
  `templateId` 的别名补齐不生效 —— 档案里只有 `reportTemplate`，按 ID 找模板会落空。改走 `core.experimentCreate`。
- **空 `dataDir` 会清空用户设置**：面板启动竞态时数据目录框是空的，此时点「保存设置」会把自定义目录写成空。
  现在空值直接忽略，要恢复默认必须显式传 `resetDataDir: true`。
- **打开目录未加引号**：`Process.Start("explorer.exe", dir)` 在路径含空格（OneDrive、自定义目录）时会打开错误位置。
- **4xx/5xx 原因被吞**：面板只显示「远程服务器返回错误: (500)」，看不到后端给的
  「找不到该模板」「请求体过大」。现在读 `WebException.Response` 里的 JSON body。
- **新建实验卡片被模板库卡片盖住 60px**：`cardNew` 高 222 却从 270 排到 492，`cardTpl` 从 432 开始。
  已把 `cardTpl` 下移到 536、`cardPet` 到 704，面板内容底部 900 < 980，不触发滚动。
- **姓名/学号输入框从未创建**：`nameBox`/`studentBox` 只有声明没有控件，面板生成的报告永远拿不到姓名学号。
  已补控件，并写进 `config.json`，重开面板不用重填。
- **失败时抛异常而不是返回可读错误**：`experimentGet`/`experimentUpdate`/`reportTemplate` 在档案不存在、
  文件损坏时直接抛，变成 HTTP 500。现在统一 `{ok:false, error}`。
- **不回退当前实验**：`experimentGet`/`tutorialClaims`/`reportPlanFor` 省略编号就失败。
  现在依次回退 `experimentId → id → 当前实验`（与 MCP 适配器一致）。
- **`experimentDelete` 只认 `experimentId`**：传 `id` 报「无效的实验编号」。现在两个都认。

### 新增文档
- **[docs/PANEL_CONTRACT.md](docs/PANEL_CONTRACT.md)**：面板 9 条调用 → 后端路由 → 读取字段的对照表、
  三类易踩坑（单复数路径 / 字段名 / 空值覆盖）、5 个回归脚本怎么跑、面板卡片坐标约束、已知限制。

### 发布工具修复
- `scripts/publish-check.mjs` 在 Windows 上扫 `.tgz` 会被 GNU tar 把 `D:\...` 当成远程主机
  （`Cannot connect to D: resolve failed`）直接报错退出，「检查已打包产物」这条路等于不可用。
  改为从 stdin 喂文件内容，tar 不再解析带盘符的路径；扫目录与扫 tgz 两条入口都实测通过。

### 验证
- **73 单测 + 3 自检 + catalog 自检** 全绿
- **面板契约** 11 项（真实 HTTP，逐字段断言）全过
- **DSH 工具契约** 25 个 action 全过
- **MCP 工具契约** 25 个工具全过
- **结构容错**：损坏档案 / 损坏模板 / 损坏 docx / 超长标题 / 空目录 均不崩、有可读错误
- **面板 C# 5 兼容**：用系统自带旧编译器编译 `exit=0`（只有未使用字段警告）

## [0.15.24] - 2026-11-11

### 修复（用户报告「上传模板一直失败」，三个缺陷叠加）
- **面板导入模板 100% 返回 404**：桌面面板发 `POST /dsh-lab/api/report/templates`（复数），
  后端只注册了单数 `/report/template`，请求落到兜底分支回「接口不存在」，
  面板显示「模板导入失败：远程服务器返回错误: (404) 未找到」。
  现已让模板 GET/POST 同时接受单数与复数；**面板不用改、不用重编译**，更新插件即恢复。
  全项目 9 条面板路径里只有这一处不一致，所以症状表现为「只有模板上传坏，其他按钮正常」。
- **模板绑定被静默丢弃，生成报告仍套内置模板**：面板新建实验写 `reportTemplate`（值为模板 ID），
  而 `reportPlanFor()` 只认显式 `args.templateId`，从不读实验档案。结果是
  `templateMissing=false`（以为有模板）但实际用 `builtinProfile()`——**不报错、格式全错**。
  现在模板查找顺序为 `args.templateId → args.templatePath → experiment.templateId → experiment.reportTemplate`
  （支持按 ID / 名称 / 源文件路径匹配），`store` 也新增一等字段 `templateId`；
  `experimentCreate` 把 `templateId` 与 `reportTemplate` 当互为别名写入档案。
  `templateMissing` 改为「只有真加载到模板才算有」，模板被删后会如实回到 `needTemplate:true`。
- **正文编号步骤被误判成章节**：`promoteHeadings()` 的 `\S{2,40}` 不允许空格，
  导致 `1. 打开 eNSP。` 算正文、`2. 拖入交换机。` 却算标题——真实 Word 模板解析出 5 章而不是 4 章，
  报告结构错位。现在数字编号且以 `。；;！？` 结尾的段落不再提升为标题。
- 新增诊断记录 [docs/DIAGNOSIS_template-upload.md](docs/DIAGNOSIS_template-upload.md)：复现命令、三个根因、
  边界实测（中文文件名 / 重复导入 / 损坏 docx / 非支持格式 / 缺文件）、以及「用户再报同类问题时的排查顺序」。

### 测试
- `test/knowledge-host.test.mjs`：真实 HTTP 钉住「面板复数路径导入必须 200」且列表能查到。
- `test/core.test.mjs`：钉住「档案只写 reportTemplate 时，plan 章节必须来自老师模板而非内置 7 节」，
  以及「模板删掉后回到 needTemplate」。
- 全量 **73 单测 / 3 自检 / catalog 自检** 全绿。

## [0.15.23] - 2026-11-11

### 新增
- **WorkBuddy MCP 适配器** `mcp/server.mjs`：零依赖手写 JSON-RPC 2.0，把 core 的 **25 个能力**暴露成 MCP 工具（实验创建/读取/记录结果/克隆/删除、报告模板/大纲/生成/增量更新、经验查询/设置、兼容建议、修复计划/记录、环境只读探测、软件目录、工作流）。默认与 DSH 插件共用 `~/.dsh/lab-assistant` 数据目录，可用 `LAB_ASSISTANT_HOME` 覆盖。已写进 `~/.workbuddy/mcp.json`。
- **Logisim Evolution 3.8.0 → `verified-run`**：找到可判定路径 `-b <circ> -w <circuit> <vec>`。实测最小直通电路 `Passed: 2, Failed: 0`，两次一致。目录 **12 → 13 项 `verified-run`**。

### 修复（代码审查发现，含 4 个高危）
- **MCP 工具映射错 8 处**，导致一半工具实际不可用：`recordResult` 方法名错（core 叫 `experimentRecordResult`）、`step` 参数没换算成 `stepId`、clone 要 `sourceId`、delete 要 `experimentId`+`confirm`、knowledge_settings 要 `action` 而不是 `autoCapture`、repair_record 要 `version`+`outcome`、`pageMapList` 收字符串而非对象、`experimentGet`/`noteAdd` 缺当前实验回退。现已加 `normalizeArgs()` 归一化层 + **启动自检**（工具映射对不上 core 会立刻打 stderr）。
- **`lib/overlay.mjs` spawn 未接 `error`**：ENOENT/EACCES（杀软拦、exe 损坏）会以未捕获事件**崩掉宿主进程**。现在转成 `{ok:false, reason:'spawn-failed'}`，并检查 `pid` 是否为整数再 kill。
- **`package.json` 漏 `mcp`**：不打包进去的话，发出去的适配器直接缺失。已加 `files` 与 `bin`。
- **JSON-RPC 通知**：未知/通知类消息（`notifications/*` 或没 id）不再回 error 响应；stdin 关闭时等 in-flight 调用写完再退（最多 5 秒），避免截断；stdout 挂 EPIPE 兜底。

### 已知未修（记录在案，下轮处理）
- `index.js` 换 `dataDir` 后 core 仍持有旧 store（需重构为惰性取 store）。
- `lib/store.mjs` 的 `writeJsonAtomic` 是读-改-写且无锁，DSH 与 MCP 同时写会互相覆盖。
- `lib/knowledge.mjs` 的 `slice(-limit)` 在 `limit=0` 时返回全部；`rebuildUsage` 与实时口径不一致。
- `lib/core.mjs` 的 `reportUpdate` 图片计数恒为 0；`configured` 判断里 `step.notes` 是死条件。
- `currentStep` 0 基与描述「从 1 开始」不一致。
- 其余 10 条低危（端口抢占、桌宠进程回收、id 撞号、坏 dataDir 起不来等）。

## [0.15.22] - 2026-11-11

### 新增验证
- **Praat 6.4.50 → `verified-run`**：`--run` 脚本生成 440 Hz 正弦（1 s / 44100 Hz）→ `To Pitch` 取 0.5 s 基频，实测 **PITCH:440.00**、PITCH 帧数 97，两次运行输出逐字节一致。目录 **11 → 12 项 `verified-run`**。
- **Logisim Evolution 3.8.0 → `verified-diagnose`**：用清华镜像取的 **Temurin JRE 21.0.13** 启动成功，窗口 `SunAwtFrame`、标题 `main of Untitled · Logisim-evolution v3.8.0`。CLI 确认存在可判定的 `-b,--test-circuit`（返回 Success/fail），但缺测试向量样本，本次**没有**升到 `verified-run`。
- 记录两个坑：① `--run` **不把 Info 窗口内容打到 stdout**，判定必须脚本自己 `writeFileLine`；② 5.0.0 的 jar 经多次续传后**大小正确但 CRC 损坏**（`too many length or distance symbols`），「字节数对上」不等于文件完整，改用一次下完的 3.8.0。

### 说明
- 换网后实测各源：**清华镜像 7.3 MB/s**、阿里云 PyPI 可用；微软 CDN 0.18 MB/s、GitHub ~30 KB/s、osgeo **11 KB/s**。结论：新网络对国内镜像友好、对境外源极慢，大文件一律先找国内镜像。
- **PyMOL 改判为「wheel 不完整」**：cp313 wheel 能装（78 MB），但包内无任何 PyMOL 依赖 DLL，`import pymol2` 报 `DLL load failed while importing _cmd`，加 `add_dll_directory` 后仍失败。不再算网络问题。

## [0.15.21] - 2026-11-11

### 新增
- **目录 `verify` 自检器** `scripts/check-catalog-verify.mjs`（`npm run catalog:check`，已并入 `npm run verify`）：检查「标了 `verified-run` 必须有 `verify`」「`catalog-only` 不得带 `verify`」「`verified-diagnose` 不得带命令」「expect 不能为空」「timeoutMs 在 5s~30min」「cmd 里不许写死盘符路径」「占位符必须在白名单」。首次运行就抓出 4 个漏字段的条目。
- **补齐 4 个历史条目的 `verify`**：Python（stdlib+SQLite 五个数值）、Weka（J48 十折 90%）、MySQL（隔离实例 `total/average/best`）、ImageJ（四个整数测量）。补的都是验证档案里记录过的真实命令与数值，没有新造。

### 说明
- **Praat 被网络阻塞**：GitHub release 走 ghproxy 反复截断（8.1 MB 缺中央目录 → 续传到 18 MB 仍 `BadZipFile` → 完整重下 200s 超时）。未安装、未验证，临时目录已删。

## [0.15.20] - 2026-11-11

### 修复
- **150% 缩放下桌宠面板底部被裁 48 px**（P5 实测）：`TogglePanel` 把 `ClientSize` 设成 620×980，WinForms 按字体/DPI 又放大成 660×1036，位置却仍按 980 算，整窗顶出工作区。现在改为按「真实外框」回算并重新贴边。修复后同一台机器上面板 `inside_workarea` 由 `false` 变 `true`，溢出 48 → 0。

### 新增验证
- **Git → `verified-run`**：固定 `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`/身份/内容后，两次独立仓库得到同一 commit `3b53206b…`。目录状态 10 → **11 项 `verified-run`**。
- **平台线 P2 完成**：真实切换浅色 ↔ 深色。任务栏亮度 **214 → 45**，但窗口内容区 242.29 → 242.22——**Windows 深色模式只改系统 chrome，不重绘已开的 Win32 窗口**。主题值已恢复，恢复偏差 0.1（噪声）。

### 结论更正
- **P1 不能做**：`SystemParametersInfoW(SPI_SETLOGICALDPIOVERRIDE)` 返回成功，但 `LogPixels` 与逻辑分辨率都不变，Win11 已弃用该 API。改缩放只能走设置界面或注销，**原计划写的「2~3 分钟、不注销」是错的**，已改为受阻项。
- **深色模式的影响被重新界定**：此前把「系统主题」与「应用自带深色主题」混为一谈。实测系统主题只影响任务栏/系统 UI；应用内容是否反色取决于应用自身的主题设置。

### 说明
- **Jupyter 被环境阻塞**：`jupyter nbconvert --execute` 启动 kernel 时 60 秒无响应，加长到 240 秒后报 `Kernel died before replying to kernel_info`；Python 3.13 venv 里装包也异常落到 Anaconda 的 site-packages。核心能力未验证，**不升级 `catalog-only`**。
- P3（双屏）无硬件、P5（四档 DPI）只能测 150% 一档，均如实标注未完成。
- 本轮清理：删除 ISO 8.0 GB + 虚拟机 20 GB + 各类安装包与临时目录，卸载本次安装的 MiKTeX（目录 495 MB + PATH 条目 + 13 项注册表），**VirtualBox 本体与用户原有 5 个虚拟机未动**。

## [0.15.19] - 2026-11-11

### 修复
- **没装 Visual Studio 的机器首次编译必失败**（P4b 实机抓到）：`findReferenceLib()` 只查 `Reference Assemblies\Microsoft\Framework\.NETFramework`，而这个目录只有装了 VS/SDK 才有。干净 Win11 上没有它，`-lib` 为空，编译器直接报 3 个 `CS0006`（UIAutomationClient / UIAutomationTypes / WindowsBase），桌宠根本编不出来。现在找不到 Reference Assemblies 时回退到 `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\WPF`（再退 `Framework`）。**P4a 因为在有 VS 的开发机上跑，没能暴露这条**。
- 单测 69 → 71：新增两条回归，断言 `-lib` 指向真实存在的目录、且在没有 Reference Assemblies 时必须落在 WPF 目录。

### 验证
- **P4b（干净系统）**：VirtualBox 7.2.22 + Windows 11 企业评估版 26H2（10.0.26300.9457）。客户机实测 `VS-NO`、`DOTNET-CLI-NO`、`.NET 4.8.1`、Defender 运行。修复前编译失败（3×CS0006），修复后 **exit=0、84,992 字节、仅 6 条未使用字段警告**；二次编译 SHA-256 一致；桌宠进程运行、`/status` 返回 200 且 `visible:true`。
- **MiKTeX 25.12**：`test.tex`（article + amsmath + equation + tabular）→ 1 页 PDF；设 `SOURCE_DATE_EPOCH` + `FORCE_SOURCE_DATE` 后两次编译**逐字节一致**（sha256 `abbe299c…`）。`texlive` 由 `catalog-only` 升为 `verified-run`。

### 说明
- **P4b-full 未做**：没有在虚拟机里装 DSH 主程序与插件 tgz，只证明了编译与进程链路。虚拟机截图 API 因透明置顶窗口返回 `E_FAIL`，以进程 + HTTP 响应为准。
- **QGIS / Logisim 被挡**：QGIS 610 MB 只下到 23 MB 后连续 6 轮 502 放弃；Logisim Evolution 5.0 需 Java 21（本机只有 JDK 17），经典版下载源 404/502。均按「条件阻塞」记录，不假装验过。

### 文档更正（同一轮 P4b 开工实测）
- **只更正 `docs/plan-remaining-verification.md`，代码未改动**。四处旧结论按实机证据作废：
  - ISO 直链**不用过表单**，微软 `fwlink LinkId=2382601` 跟 302 即得；此前写「必须走浏览器表单」是错的。
  - 镜像实际 **8,548,628,480 B ≈ 7.96 GiB**（26H2 企业版评估），不是 5.4 GB。
  - 评估中心**没有公开 SHA-256**（页面里的 hash 是访客追踪哈希），只能核对官方域名 + 精确字节数 + 本机 SHA-256 留档，记录里要写明「未做官方哈希比对」。
  - **本机已装 VirtualBox 7.2.22r175245 与 5 个原有虚拟机**。「要装内核驱动、需单独批准」作废；「用完卸载 VirtualBox」是会误删用户原有环境的错误方案，改为**只删本次新增、绝不动原有 VM**，清理清单与复核项已写死。
- 补：下载中实测出现代理 `CONNECT tunnel failed 502`、两个下载 20 秒零增长，改用 `temp/p4b/download.mjs`（断点续传 + 最多 40 轮重试 + 每轮落盘进度），不做单次挂到底的下载。
- 补：P4b 分 **core（干净系统里跑一次真实首次编译，必做）/ full（VM 内装 DSH + 插件，尽力）** 两级验收，避免全有或全无。
- 补：环境链路预检已跑通——建临时 VM → EFI + 虚拟 TPM 2.0 → headless 启动 → 关闭删除 → 原有 5 个 VM 数量与名字不变。

## [0.15.18] - 2026-11-11

### 修复
- **首次编译可以强制走旧编译器**：新增 `DSH_LAB_FORCE_FRAMEWORK_CSC=1`，只影响「选 Roslyn 还是系统自带的 .NET Framework 编译器」，不改编译参数。`build.log` 记录本次用的编译器类型与路径，`startOverlay` 返回值也带 `compiler`，排错时不用猜。
- **编译日志中文乱码**：旧编译器在中文系统输出 GBK，原来按 UTF-8 落盘，警告整段变成乱码、学生排错时等于看不到信息；给编译器加 `-utf8output` 后警告可读。这条是 P4a 验证时才暴露的。

### 验证
- **P4a（编译器回退）**：强制回退 991 ms / 84992 B，Roslyn 1379 ms / 82432 B，两条路径都 `exit=true`、都能启动桌宠（`/status` 返回 `running`、`state: swim`、宠物可见），编译后无残留进程。证据 `temp/p4a/`（本机，不进包）。
- 单测 68 → 69（新增编译器选路用例，断言「强制时绝不选 Roslyn」）。

### 说明
- 本机装了 VS 2022，默认永远走 Roslyn，旧编译器路径此前**从未执行**；而多数学生机器没装 VS，走的正是这条路。P4a 补上了这个盲区。
- **不是干净系统**：杀软拦截、缺 .NET Framework、只读目录首次编译仍留给 P4b。

## [0.15.17] - 2026-11-10

### 新增
- **后续验证计划** `docs/plan-remaining-verification.md`：把「还验什么、谁先谁后、什么算验完、什么永远不验」写成可执行清单。
  - **基线表**：9 项 `verified-run` + 1 项 `verified-diagnose` 各自代表哪种验证形态，用来判断新批次是否只是重复同一结论。
  - **软件线**：按「能验到什么」分 11 批（不按字母序），T1 收尾 + T2 全量 31 项，T3/T4 各抽检 2 个并强制标注「同类外推」，T5 七项永久不排期。含八步固定流程、判定规则、证据要求、批次卡模板。
  - **平台线**：按执行顺序排 **P1 改缩放 → P2 切主题 → P3 双屏混合 DPI → P5 高 DPI 面板 → P4 首次编译（最后做）**。P4 拆成 **P4a 强制回退编译器，零下载可先做** / **P4b 干净系统，需 ISO 或第二台机器**。每条写明现象、现有代码怎么处理、没验的部分、具体测法、通过标准、失败后果、修复方向。
  - **P4b 的 ISO 流程**：取 8 MB 样本测速、预估超过 2~3 小时就不下（实测官方静态 CDN 单连接 1.14 MB/s、4 并发 1.12 MB/s，沙箱出口代理锁住总带宽，5.4 GB 约 82 分钟）；优先 Windows 11 企业版评估版（官方、有公开 SHA-256）；来源只认官网/学校正版平台；能拿到官方 SHA-256 就比对，拿不到就写明「来源可信但未做哈希比对」。本机是 Win11 家庭版，没有 Hyper-V 与 Windows Sandbox，虚拟机只能 VirtualBox / VMware（会装内核驱动，需单独批准），零安装方案是第二台真机。
  - **下载物清理流程写死**：删前先列清单与大小，卸载虚拟化软件并核查驱动/服务/注册表残留，**彻底删除不进回收站**，删完报删前/删后可用空间，只保留哈希、`build.log` 与结论。
  - **P4a 是实施时才查出来的真缺口**：本机装了 VS 2022，`findRoslynCsc()` 一直命中 Roslyn，`%WINDIR%\Microsoft.NET\Framework64\v4.0.30319` 那条只支持 C# 5 的回退路径**从未被执行**；而学生机器大多没装 VS，走的正是这条路。
  - **明确不做**：T5 全量、T3/T4 全量、跨用户汇总、自动点击回放、为「看起来能用」放宽锚点阈值、反色锚点匹配。
  - **拍板项**：第 0 批三个是否开工、P1/P2/P5 是否允许动本机显示设置、P4b 用 ISO 还是第二台真机、是否要通用验证运行器。
- `README` 验证段落补上该计划入口。

## [0.15.16] - 2026-11-10

### 新增
- **归档压缩**：实验状态设为 `archived` 时，`actions` 明细压成聚合摘要 + gzip 副本；原始明细完整保留，重复归档可刷新摘要。
- **报告片段按软件细分**：`report_fragment_add` 支持 `software`，同课不同软件不串稿；专属优先、课程通用兜底，仍禁带数值、不进正文、不标已核对。不传 `software` 时按当前实验档案自动归属（显式传空串才写课程通用），避免细分静默失效。
- **锚点匹配可诊断**：`matchAnchor(..., {diagnose:true})` 返回降级原因与粗/精搜中间值；正常调用仍严格返回 `null`。

### 修复（真实 GUI 验证发现，合成图测不出来）
- 视觉锚点打分从「去均值 SAD / 固定分母」改为**归一化互相关 NCC**：修掉真实界面重复纹理**误框到别的按钮**、纯色空白窗口**不降级**、主题反色误报。
- 粗搜保留 6 个候选逐个精搜、精搜枚举完整尺度集：修掉正确位置在粗搜排第 2 被丢弃、1:1 模板被估成 1.1 导致自匹配分数掉到 0.58。
- 尺度集收窄到 0.9~1.5、新增双峰歧义检测，重复按钮一律降级（指错比不指更坏）。

### 验证
- 真实桌宠 + 真实 Notepad / Weka 窗口端到端**两遍 15/15**（自匹配 / 平移 / 1.25 倍缩放 / 改尺寸均命中且坐标精确；反色 / 空白 / 坏数据全部降级）；证据 `temp/gui/run1.json`、`run2.json`（本机，不进包）。
- 68 单测 + 3 自检、pack-check、publish-check、合成基准全过。

### 决策
- 待办 C（C# 面板开关 + 热区展示）**删除**（零新增价值，`LabPet.cs` 未动）；锚点触发策略 D **维持保守**，依据真实 GUI 数据。

## [0.15.15] - 2026-11-10

### 新增
- **经验闭环落地**：`docs/plan-knowledge-loop.md` 的五个批次全部实现，版本从「方案」变成「功能」。
  - **经验前置**：`experiment_create` / `experiment_get` 的返回自动带 `knowledge`（坑 5 / 控件 8 / 失败 3 硬限流）；`workflow` 第 2 步从「先调 note_list」改成「档案里已带，直接看」。不调 workflow、跳过第 2 步、换会话接手都不会丢经验。
  - **控件级指引**：`interface/<软件>.json` 合并页面地图、历史坐标与文本经验；`desktop_guide(controlName)` 按「软件::窗口::控件」定位，同窗口换按钮不再串位。新增 `usedSource` 埋点（live / history / drift / preset-window / anchor / none），能算出命中率。
  - **操作即记录**：`guide` / `click` / `screenshot` / `record_result` 成功后自动落 `actions.jsonl`，通过的步骤把指引序列摘要钉进档案，`experiment_clone` 会复制；热区按命中率排序。只录指引，**不录点击回放**。
  - **失败反例**：`passed:false` 自动写入，下次 `knowledge` 把同一步的失败顶到最前。
  - **报告片段**：`report_fragment_add` 按课程+章节沉淀句式骨架；含任何数值直接拒绝，只给改写参考，不自动进报告正文、不得标「已核对」。
  - **视觉锚点**：零依赖 PNG 编解码 + 多尺度模板匹配，只裁控件周边；匹配不到一律降级整窗高亮。
  - **新工具**：`knowledge_query` / `knowledge_settings` / `report_fragment_add` / `anchor_capture` / `anchor_locate`。
  - **隐私说明** `docs/knowledge-data.md`（已随包分发）：采集了什么、存哪、`knowledge_settings(off)` 怎么关、怎么删（手动删目录是彻底删除，不进回收站）。

### 修正
- 按代码与实测证据修订方案的三处事实错误：`software`/`controlName` 参数本就存在；合并 page-maps 必须用相对整窗的 `rel` 而非屏幕绝对 `rect`；`page_map_guide` 需一并改走 interface。详见方案第九节、决策 **D10**。
- 验收指标「报告 pending 章节数下降」经三轮实测（`3→3→3`）证伪，替换为可测的命中率 / 可靠命中率 / 片段覆盖指标。

### 验证
- 全量单测 **60+**、自检 **3/3**、pack-check 通过，每批次重复跑过多遍。
- 合成基准 `npm run bench:knowledge`：13 个控件，第一次命中 0 / 需量坐标 13 次，第二次命中 12（可靠 10、降级 2）→ 命中率 **92.3%**、可靠命中率 **76.9%**、量坐标下降 **92.3%**。

## [0.15.14] - 2026-11-10

### 新增
- **经验闭环方案** `docs/plan-knowledge-loop.md`：解决「经验只在事后被读到」的缺口，把六个能力点（L1~L6）收敛成「一个库 + 两类动作 + 一个注入点」，而不是六套独立实现。
  - **L1 控件条目**：把 `page-maps`（控件名）、`guide-presets`（历史坐标）、`notes.where`（文本）合成一张 `interface/<software>.json`
  - **L2 操作序列**：`guide` / `click` / `screenshot` / `record_result` 成功后由代码自动落盘，只录指引不录点击回放
  - **L3 视觉锚点**（排最后，可选）：UIA 读不到时用模板匹配兜底，必须有降级
  - **L4 失败反例**：`passed:false` 自动写，下次同步骤先提示
  - **L5 报告片段**：只给句式骨架，禁止携带数值
  - **L6 热区统计**：按命中率排序，供查询限流与面板展示
- 决策 **D9**：采集自动化 + 注入前置 + 三表合并。

### 已核实的关键事实（写进方案）
- `report_generate` **确实会自动读经验**（`core.mjs:348` → `handoff.md`），但**报告正文不读**、**实验开始时也不读**
- `desktop_guide` **已有坐标复用**（`index.js:563`，键是 `软件::窗口`），但**粒度只到窗口**——同窗口换按钮就会框错，这是 L1 要下沉到控件级的原因

### 方案自检发现 13 个问题
含 3 个会导致「做完也证明不了有效」的隐性坑：
- 没有 `usedSource` 埋点就测不出发命中率 → 该改动要排在 L1 之前
- 窗口尺寸变化会让旧坐标失效 → 需同时记 `windowSize`
- L5 会「抄自己」写出与本次数据不符的结论 → 片段禁止携带数值

## [0.15.13] - 2026-11-10

### 新增
- **验证难度分级表** `docs/VERIFICATION_DIFFICULTY_RANKING.md`：把 131 个未验证条目按「验证成本」分成 T1~T5，用于排后续测试批次。
  - 生成器 `scripts/rank-verify-difficulty.mjs`，按 catalog 字段自动算分 + 31 条人工修正（每条写明理由）
  - 分布：**T1 3 / T2 28 / T3 47 / T4 46 / T5 7**
  - 新增「授权可得性」维度：**60 个需院校授权**、40 个可直接下载、14 个有免费试用版、10 个需注册、5 个需订阅
- 决策 D7：**后续按难度分层推进，不再按 P0/P1/P2 优先级排序**。理由是优先级反映教学重要性而非验证成本，同批里可能既有 20 分钟的 Git 也有 6 小时的 SOLIDWORKS。

### 说明
- 两条硬规则会覆盖机器分：许可拿不到（需院校授权/订阅/厂商授权）→ 最低 T3；包体过大 → 最低 T3。
- 机械打分只能当初排，例如 Wireshark 的 `control` 是 `cli/gui`、开源，算出来 T1，但要装 Npcap 驱动，实际 T4（已人工修正）。

## [0.15.12] - 2026-11-10

### 验证
- **LTspice 26.1.1 重试成功**，状态由 `verified-diagnose` 提升为 `verified-run`，并挂上 `verify`。
  - 根因确认：上次「批处理跑不通」是**首次启动的遥测授权对话框**挡住，不是不支持 `-b`
  - 用桌宠 `/click` 点掉对话框（单选框 `(47,183)`、OK `(576,293)`）后，`-b` 2 秒内产出 1.5 MB `.raw`
  - RC 低通瞬态：10 030 点 × 6 变量，`V(out)` 峰值 **4.966310**＝理论 `5×(1-e^-5)`，末端放电到 0.0335
  - 两次运行 60 180 个数值**最大差 0**（但不能比文件哈希，`.raw` 头部含日期）
- 版本更正：日志显示是 **LTspice 26.1.1**，此前记录的「24.x」是估的

### 修复
- **注册表残留不再依赖 `reg.exe`**（该程序在本机黑名单里）。改用 Python `winreg` 直读，已核实 `HKCU\Software\ADI`、`HKCU\Software\LTspice`、`R-core` 及卸载表均无残留。**不需要修改任何安全设置。**

### 文档
- `docs/VERIFICATION_2026-10-28.md` 追加「LTspice 重试成功」一节，明确作废上一节的错误结论，并记录 4 个新坑（断言写错会误判软件、峰值是 4.9663 不是 5、ASCII raw 解析、批处理是异步的）

## [0.15.11] - 2026-11-10

### 新增
- **软件目录 `schemaVersion` 升到 2**，新增 `verify` 字段（`cmd` / `expect` / `reportContains` / `artifactExpect` / `timeoutMs` / `deterministic` / `note`）与 `verifyLegend`。
  教学循环可以直接消费机读校验命令，不必再从文档里人肉抄。
- SWMM、EPANET、R、Blender 四个条目挂上 `verify`，均有实测断言。

### 验证
- **R 4.6.2** 与 **Blender 4.5.0** 状态提升为 `verified-run`
  - R：`Rscript --vanilla` 跑内置 `mtcars` 回归，`COEF_WT -5.3445`、`R2 0.7528`，两次输出完全一致
  - Blender：headless CPU Cycles 渲 128×128，**像素级可复现**（字节不同是因为 PNG 元数据）
- **LTspice 24.x** 提升为 `verified-diagnose`：GUI 可启动、可被桌宠定位并真实截图，但 `-b` 批处理被首启遥测对话框阻塞，不产出 `.raw/.log`，**不挂 verify**
- **首次做 GUI 层验证**：桌宠定位 + 高亮 + 截图对三个软件 3/3 通过

### 文档
- 新增 `docs/decisions-verification.md`：六个验证策略决策（每轮 3 个、允许隔离安装、GUI 只验指路与截图、verify 入库、验完即删、verified-run 不硬卡可复现性）
- `docs/VERIFICATION_2026-10-28.md` 追加本轮记录，含 7 个踩坑（如 LTspice MSI 忽略 `INSTALLDIR`、R 窗口标题是 `RGui`）

## [0.15.10] - 2026-11-10

### 验证
- **SWMM 5.2.4 与 EPANET 2.3.5 的官方命令行求解器完成最小实验**，状态由 `catalog-only` 提升为 `verified-run`。
  - 方式：官方免安装 zip + 7-Zip 解压直接运行，**未执行任何安装程序、未提权、未写注册表/PATH/服务/计划任务/开始菜单**
  - SWMM：上游示例模型跑通，`Total Precipitation 1.250 / Surface Runoff 0.726 / Infiltration Loss 0.519`（acre-feet），连续性误差绝对值 < 1%
  - EPANET：`Net1.inp` 跑通，24 步水力全部收敛，`Flow Ratio 1.000`、`Mass Ratio 1.00000`、`Total Outflow 1100.000`
  - 可复现：SWMM 的 `.out` 两次运行**逐字节相同**；两份 `.rpt` 去掉时间戳后逐字符一致
  - 局限：**只验了命令行求解器**，GUI 版、课程级模型、桌面指引/截图均未验证

### 文档
- `docs/VERIFICATION_2026-10-28.md` 追加本次记录，含可直接复用的 `verifyCmd` 断言表与 4 个踩坑（例如「不能 grep `ERROR`，SWMM 报告里正常就有 5 处」）
- 目录 `disclaimer` 与 `README` 同步更新已验证清单

## [0.15.9] - 2026-11-10

### 新增
- **软件目录从 67 项扩到 140 项**，覆盖的学科方向仍是 14 个，但补进了此前缺失的课程常见软件：
  - 电子电气：Altium Designer、LTspice、立创EDA、ModelSim
  - 机械：CATIA、Siemens NX、Creo、Fusion 360
  - 土木建筑：PKPM、盈建科、广联达、SAP2000、ETABS、MIDAS、PLAXIS、Lumion、Rhino + Grasshopper、Civil 3D
  - 给排水环境：SWMM、EPANET、AERMOD
  - 测绘遥感：ENVI、南方 CASS、Pix4D
  - 化学材料：Materials Studio、MDI Jade、Avogadro、VASP、LAMMPS、OVITO、Aspen HYSYS
  - 生物医药：GraphPad Prism、SnapGene、DPS、SAS、RadiAnt DICOM、Complete Anatomy、SPM
  - 经管：Power BI、Tableau、Wind、同花顺 iFinD、Choice、UiPath、GAMS
  - 心理社科：Mplus、Amos、JASP、OpenSesame、MAXQDA、Kinovea
  - 人文：NoteExpress、CAJViewer、Zotero
  - 传媒设计：Illustrator、InDesign、After Effects、Cinema 4D、Maya、3ds Max、Houdini、Nuke、Unreal Engine、Audition
  - 数理：COMSOL、Maple、TeX Live / MiKTeX
  - 网络：H3C HCL；计算机：PyCharm、IntelliJ IDEA、Visual Studio、DBeaver、VirtualBox

> 以上全部标记为 `catalog-only`（仅资料归类）。**没有任何一项因为"写进目录"就变成已支持**，仍需实际启动和最小实验验证后才能提升状态。

### 变更
- `docs/SOFTWARE_CATALOG.md` 改为由 `coursepacks/software-catalog.json` 生成，避免两份清单对不上。
- 新增 `docs/SOFTWARE_BY_MAJOR.md`：按学科门类整理的「需要在电脑上安装并动手操作」的软件清单，含授权、平台与适配优先级建议。

## [0.15.8] - 2026-11-10

### 变更（内部，用户无感）
- **抽出宿主无关的 `lib/core.mjs`**：22 个业务方法（实验 CRUD、经验笔记、兼容建议、修复、报告、教学回执、环境探测、页面地图列表）集中到 core；
  `index.js` 只保留 DSH 适配层（工具注册、面板 HTTP、桌宠生命周期），从 1670 行降到 1191 行
- 工具层与面板的 `/dsh-lab/api/report/*` 统一调用 core，避免工具与面板两套报告逻辑分叉
- 新增 `test/core.test.mjs`：不依赖 DSH mock 直接测 core（workflow/status/catalog、实验 CRUD、pageMapList）

## [0.15.7] - 2026-11-10

### 修复
- **素材状态误报**：`assetStatus()` 仍按单张 `swim.png` 判断，实际素材是 `swim_1..8.png`，
  状态接口会把走路素材报成缺失。现在按「单张 或 动作_序号」判断，并新增 `frames` 字段返回每组帧数
- **包里带预编译桌宠**：`files` 未排除 `overlay/*.exe`，安装包会带上构建机编译的 `LabPet.exe`，
  用户可能绕过首次编译。现在排除 `overlay/*.exe`、`*.pdb`、`*.log`，强制在用户机器首次编译

### 文档
- 安装章节补充排错：`dsh plugin add` 的 pnpm store `EPERM`、桌宠首次编译失败、Web profile 无桌宠、素材帧数查看

### 验证
- 全新 `DSH_HOME` + 空 profile：`dsh --dump-config` 正确识别插件，`/dsh-lab/api/status` 返回 0.15.7，
  `states` 全部 true，`frames` 为 swim 8 / dash 3，桌宠从零编译并启动

## [0.15.6] - 2026-11-03

### 修复
- **HTTP API 与工具行为不一致**：`/dsh-lab/api/report/generate`（面板/预览页走这条）之前不做模板检查，
  会悄悄用内置模板；现在与 `lab_report_generate` 一致，缺模板返回 `needTemplate`，除非传 `useBuiltin:true`

### 测试
- `test/ui-check.mjs` 终于跑起来了（puppeteer-core + 本机 Chrome 无头）：页面无注入 UI、`/dsh-lab/pet.js` 404、
  状态接口正常、建实验、缺模板被拦、`useBuiltin` 生成并返回待补清单，全部断言通过
- 补测「停泊时待机动画仍在播」：停泊 6 秒 11/11 帧有像素变化、位置 0 位移


## [0.15.5] - 2026-11-03

### 变更
- **撤回 0.15.4 在文档里加警示条的做法**：最终 Markdown / Word 保持原样，不再插入任何红字或横幅
  （用户要求：不要乱改最终报告）
- 待补提醒改为**只在工具返回值里**：`placeholderCount` / `pendingSections` / `note` 以「⚠ 未完成」开头，
  由 DSH 在会话回复里逐条说明缺什么、为什么缺，并明确提醒不要直接提交


## [0.15.4] - 2026-11-03

### 新增
- **【待补】无法被忽略**：只要报告里还有占位符，生成的 **Markdown 顶部**和 **Word 首段**都会插入
  `⚠ 未完成：本报告有 N 处【待补】，请勿直接提交`（Word 里是红色加粗居中），并列出缺口章节
- `report_generate` 返回值新增 `pendingSections`，`note` 直接以「⚠ 未完成」开头，DSH 必须逐条解释
- `workflow` 第 7 步明确要求：告诉用户「这份报告还不能交」，补全后重新生成警示才会消失


## [0.15.3] - 2026-11-03

### 新增
- **段落式封面解析**：模板封面写成 `课程名称：…` / `学 号：…` 这类段落时也能识别（白名单 20 个字段），
  「XX学院 制」这种落款不会被误抓；真实模板验证读到 5 项（课程名称/专业年级/学期/学号/姓名）
- **没模板时的默认封面**改成学校实验报告那套：课程名称 / 专业年级 / 学期 / 学号 / 姓名
  （课程、姓名、学号能自动填；专业年级、学期留【待补】，不瞎编）
- `workflow` 增加「1.5 确认模板」：动手前先在会话里问用户要模板；用户说没有再走内置封面

### 变更
- `report_generate` 缺模板时返回 `askUser` 提示，明确要求 DSH 先问用户要模板文件，而不是直接套通用模板


## [0.15.2] - 2026-11-03

### 修复
- **真实模板只识别出 1 个章节**：中文实验报告常把正文塞进表格、并写成「实验目的：正文」的内联形式。
  现在会先把这类表格摊平、按中文节名拆成「标题 + 正文」，再用中文编号/常见节名提升为章节
  （真实模板验证：1 → 7 个章节，实验目的/实验平台/实验内容/实验步骤/实验结果及分析/实验拓展）
- 只摊平「含节名的表」：封面信息表（姓名/学号/班级）和结果表（测试项/预期/实际）保留，避免 meta 与表头丢失

### 新增
- 桌宠「停泊」：自动执行/记录/生成报告时，桌宠停在屏幕右下角、不再四处走动，但仍做待机小动作
  （点击、截图、窗口归位前自动停泊；`desktop_guide` 时自动解除停泊，该去哪儿指路就去哪儿）


## [0.15.1] - 2026-11-03

### 新增
- **面板支持删除**：实验档案列表新增「删除…」，模板库新增「删除…」，都带二次确认
- 删除统一走「移到 `_trash`」而不是不可逆销毁：实验整份目录、模板 json 文件都能手工恢复
- 删掉的正好是「当前实验」时，自动清空当前选择，避免后续记录写进已删档案
- 新工具 `lab_experiment_delete`（必须传 `confirm:true`）；`lab_report_template` 支持 `deleteId`
- 面板布局随窗口宽度重排时，两个「删除…」按钮跟着右对齐，不会被下拉框或「导入…」盖住


## [0.15.0] - 2026-11-03

按 2026-11-03 真实使用（eNSP 生成树实验，150% DPI + 管理员进程）的问题清单修复。

### 修复
- **截图会把桌宠拍进图**：截图期间自动隐藏所有桌宠实例窗口，截完立刻 `SW_SHOW` 恢复；返回 `petHidden` / `petRestored` 可当场核对（用户要求：只藏一瞬，不是常驻隐藏）
- **只给实验要求、没给模板时直接套内置模板生成**：现在先拦下要模板（`needTemplate:true`），传 `useBuiltin:true` 才会用通用模板；避免整份报告返工
- **找不到窗口只会说「没找到」**：改为 `EnumWindows` 枚举，按「可见 + 面积 ≥ 60×40」过滤，支持 `pid:1234` 与 `/正则/`；找不到时返回**候选窗口列表**（进程名 / 标题 / 尺寸），并修复 UWP 程序（Win11 记事本）因 `MainWindowHandle=0` 永远找不到的问题
- **150% DPI 下坐标全乱**：所有桌面动作统一按**屏幕物理像素**，并在返回里给出 `coordSpace` / `dpi` / `scale` / `logicalW` / `logicalH`，截图、点击、归位同一基准
- **目标程序是管理员、DSH 不是时点了没反应**：点击前检测 UIPI（`TokenElevation`），直接报「请以管理员身份重启 DSH」，不再假报 `clicked:true`
- **eNSP 拒绝外部改窗口大小后没有兜底**：归位失败自动改「最大化」，返回 `fallback: maximize|none`，截图基准依然一致

### 新增
- `report_update`：报告生成后又补了截图时，只重新生成并回报图片数变化（`figuresBefore` / `figuresNow` / `added`）
- `status` 增加当前实验的**每步四态**：已执行 / 已配置 / 已记录 + 截图总数，多任务实验能一眼看出卡在哪

### 变更
- 报告「结果分析」从已录入的 `actual` 自动汇总实测结论，不再全是「对照……说明是否一致」的占位
- 报告「问题与解决」从失败/异常的步骤记录自动抽取现象，原因与处理仍留给本人补一句


## [0.14.3] - 2026-10-31

### 安全
- 教学校验命令加白名单，并拒绝 `& | < >` 串联；**白名单不是沙箱**，边界仍是 127.0.0.1 + token + 不联网（见 SECURITY.md）
- `/screenshot` 的 `out` 只能落在实验 `screenshots/`、临时目录或配置目录，避免覆盖任意文件
- PrintWindow 失败时用屏幕拷贝兜底，不再把白图当证据
- 教学校验命令的环境变量（如 `MYSQL_PWD`）由 DSH 经 `/tutorial` 的 `env` 传入，不落盘、不进命令行
- `config.json` 改为原子写；本机 HTTP 加读写超时与 2MB 请求体上限

### 修复
- 校验命令被白名单拒绝（或超时）时，不再因为 `expect` 恰好命中错误文字而被判为「通过」
- 教学校验命令统一走 UTF-8，`verifyExpect` 里的中文能正确匹配
- 生成的 Markdown 里截图改用正确相对路径；`/status` 如实返回桌宠位置

### 变更
- 指引坐标基准统一为**整窗**（与截图、点击一致），旧的位置经验自动作废重学
- 三张文档截图重拍（原来是预览页 + 已移除的网页注入面板）

## [0.14.0] - 2026-10-30

### 新增
- **教学循环**：DSH 把步骤计划（含每步校验命令）交给桌宠；学生做完**点一下桌宠**，桌宠自己跑校验命令判断对错，通过就自动指下一步。回执写 `<实验>/tutorial-claims.jsonl`，DSH 事后正式记账
- 新工具：`desktop_tutorial` / `desktop_tutorial_step` / `tutorial_claims`

## [0.13.0] - 2026-10-30

### 变更
- 指引框默认 200×56 + `pad 36`，自动夹紧在窗口内；相对坐标按客户区计算
- `sticky:true` 钉住，直到该步记完或调 `desktop_clear`；`record_result(passed)` 自动清除
- `guide-presets.json` 记录每个窗口的框位置与次数，下次不给坐标直接复用

## [0.12.5] - 2026-10-30

### 文档
- README 增加「执行规则（硬性）」：粒度跟文档走、截图必须有回显内容、没截图不许写实测值

## [0.12.4] - 2026-10-30

### 修复
- 同一张截图被多个章节各插一遍（一次生成 24 张）→ 去重，图号全篇连续

## [0.12.3] - 2026-10-30

### 新增
- `report_generate` 支持 `sectionTexts`：DSH 可把「目的 / 环境 / 内容 / 分析 / 总结」亲笔写进对应章节
- 按表名匹配到步骤后，把该步骤的截图证据插进本节

## [0.12.2] - 2026-10-30

### 修复
- 模板章节按标识符（表名等）匹配已完成步骤：覆盖率 74% → 88%，待补 8 处 → 1 处

## [0.12.1] - 2026-10-30

### 变更
- 面板去掉「生成报告」卡片，改为「模板库」（下拉切换 + 导入…）
- 报告生成移到对话里：说「按要求生成实验报告」即可

## [0.12.0] - 2026-10-30

### 新增
- 三种模式成为**代码级硬约束**：`guided` 下 `desktop_click` 直接拒绝代点
- `desktop_guide` 支持相对坐标、黄色描边（教学）、引导前把目标窗口提到最前

## [0.12 之前]

早期版本（0.1–0.11）未逐条记录，主要变化：实验档案与证据目录、只读环境探测、
失败驱动找版本、报告引擎（读 .docx 模板）、桌面伴随进程（桌宠）、面板、
多桌宠与单只关闭、`desktop_place` / `desktop_click`、`where` 位置字段、`experiment_clone`。
