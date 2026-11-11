# 跨学科软件最小验证记录

日期：2026-10-28  
测试系统：Windows 11 x64 10.0.26200，AMD Ryzen 7 7840HS，约 28 GB 内存  
沙箱目录：`D:\lab-assistant-lab`

> 这是单机最小验证，不是“所有用户、所有课程都可用”的证明。商业软件、GUI 自动化和许可网络尚未验证。

## 已验证

### 1. Python 3.12.10

- 来源：NuGet 官方 `python` 包 `3.12.10`（14 MB）
- SHA-256：`0eb85c2dfccccf1b17352de4c397f69194035b7d37149eacc16f1147d93de3b8`
- 方式：便携解压，不写 PATH、不写注册表
- 实验：标准库 `statistics`、`platform`、`sqlite3`
- 命令：

```text
apps\python-3.12.10\tools\python.exe data\smoke_python.py
```

- 结果：

```json
{
  "python": "3.12.10",
  "platform": "Windows-11-10.0.26200-SP0",
  "sqlite": "3.49.1",
  "mean": 87.6,
  "stdev": 6.58,
  "database_sum": 438,
  "database_count": 5
}
```

- 可支持到什么程度：可做 Python 基础语法、标准库和 SQLite 最小实验。
- 尚不能证明：第三方库、CUDA、Anaconda 环境、不同 Python 位数/版本的兼容性。

### 2. Weka 3.8.7 + JDK 17

- 来源：本机已有安装，不改动
- weka.jar SHA-256：`af190b26a22051aeafc0483772faebf4b378d0ebda7b338feb3c34206b812b24`
- 实验：命令行加载 10 条 mini iris ARFF，运行 J48 十折交叉验证
- 结果：正确分类 9/10，正确率 90%，输出混淆矩阵
- 可支持到什么程度：证明 Weka 3.8.7 的 Java 入口、ARFF 读取和 J48 分类流程可用。
- 尚不能证明：Weka 3.9/4.x、其他算法、图形界面操作和 GPU/大内存场景。

### 3. MySQL 8.0.46 隔离实例

- 来源：本机已有 MySQL Community Server 二进制，配置和 data 写入沙箱
- 方式：独立端口 `33307`，独立 `datadir`，不注册服务，不使用系统 `3306`
- 实验：`CREATE DATABASE`、`CREATE TABLE`、`INSERT`、`COUNT/AVG/MAX`、正常 `shutdown`
- 结果：

```text
version: 8.0.46
total: 3, average: 90.33, best: 96
mysqld is alive
```

- 可支持到什么程度：可证明 MySQL 8.0.46 在 Windows x64 上可配置成可删除的独立实例。
- 尚不能证明：生产权限、远程访问、MySQL 9.x、服务化安装和复杂字符集/认证插件。

### 4. ImageJ 1.54f + Java 17

- 来源：ImageJ 官方 `ij.jar` 2.4 MB
- SHA-256：`f5bd833cb38e407362c0a601a892036e02e0271eca1af8a8945743e9dd4b9d87`
- 方式：无 GUI 的 `-batch` 宏模式，Java 17 运行
- 实验：生成 256×256 图像、填椭圆、读取像素、测量、分析粒子
- 结果：

```text
centerPixel=255
imageArea=65536
imageMean=50.1627
particleCount=1
particleArea=12892
```

- 可支持到什么程度：可证明 ImageJ 1.54f 的批处理、宏、基础测量流程可运行。
- 尚不能证明：Fiji 专属插件、显微镜厂商插件、3D/GPU、GUI 交互和医学真实影像。

## 没完成或不该假装完成

- Logisim Evolution 5.0.0：GitHub 下载网络返回 502/中断，未完成。
- ImageJ 完整 Windows Java 包：下载多次中断，改用官方 `ij.jar` + Java 17 完成最小实验。
- 没有安装任何商业软件；没有测试 MATLAB、SPSS、ChemDraw、AutoCAD、ANSYS 等授权和服务器依赖。
- 没有把单机结果写成“适用于所有电脑”。不同 Windows 版本、显卡、权限、校园许可和课程模板仍可能失败。

## 清理策略

- Python、ImageJ、MySQL 数据和所有下载均在 `D:\lab-assistant-lab`。
- MySQL 使用独立数据目录，停止后再删除；不触碰系统 3306 实例。
- 不修改系统 PATH，不创建系统服务，不写用户插件目录。
- 清理时只删除该沙箱，不删除 Weka、eNSP、系统 MySQL 或其他用户目录。

## 清理结果

- `D:\lab-assistant-lab`：已彻底删除，未进入回收站。
- 沙箱 MySQL 端口 `33307`：无监听进程。
- 沙箱 Python、ImageJ 进程：无残留。
- `D:\Weka`、`D:\MySQL`、`D:\eNSP`：均保留，未删除、未卸载。
- 系统现有 MySQL 服务（3306）未被沙箱操作改变。
- 测试证据已整理进本文档；原始沙箱日志随沙箱一并删除。

## 附：0.2.1 换版本引擎验证（同日）

这一节验证的是**决策逻辑**，不是又装了几套软件。

已验证：

- 报错“启动设备失败，错误代码 40，AR_Base 无法启动”能匹配到 `ensp-device-start-fail`，输出 3 个候选版本与安装顺序；
- 记录某版本 `failed` 后，该版本立刻沉到候选末位，不再被推荐；
- 记录某版本 `worked` 后，该版本升到第一，标签变为“本机经验库已记录可用”；
- 同一版本重复记录只累计次数（3 次记为 1 条，`hits=3`）；
- 信息不足（“就是不好使”）时不猜版本，返回采集清单；
- 换一台系统 build 不同的电脑，`proven-this-machine` 自动降级为“他机实测通过”，不会冒充本机保证；
- 真实环境探测能读到本机 `eNSP V1.3.00.100` 与 `VirtualBox 7.2.22`（只读注册表，未启动 eNSP）。

没有验证：

- 没有实际卸载现有 VirtualBox，也没有安装 `6.1.44`、`5.2.44`；
- 因此这两个候选仍标注“社区经验（未验证）”，不是已通过；
- `7.2.22` 的“本机可用”来自用户本人反馈，不是本轮自动化测试重新跑通拓扑；
- 其他 66 项软件没有失败特征表，遇到报错只会输出采集清单。

测试命令：

```text
node --test test/remedy.test.mjs     # 8 通过
node --test test/*.test.mjs          # 20 通过
node test/selfcheck.mjs              # 3 通过
node test/ui-check.mjs               # 浏览器流程通过
```


## 附：0.3.0 实验报告引擎验证（同日）

验证的是“读模板 → 对档案 → 出初稿”的链路，不是替你写实验结论。

已验证：

- 自研 zip 读写可生成合法 zip，Python `zipfile` 可解；
- 生成的 docx 可被 `python-docx` 打开：标题样式、表格、内嵌图片数量均正确（示例：36 段、2 表、2 图，图片宽 5.8 英寸）；
- 导入 .docx 模板能识别 7 个章节、结果表 4 列、封面字段 5 项；
- 封面字段保留原顺序：实验名称自动填、姓名/学号自动填、班级和指导教师标【待补】；
- 生成计划正确区分 auto / partial / pending：环境、步骤、结果、问题自动填；目的、拓扑、总结标【待补】；
- 生成的 Markdown 与 docx 都含【待补】清单，未出现编造的正确率、通过率等数字；
- 浏览器端从“实验报告”入口生成成功，界面显示覆盖度、Word 路径和待补章节。

没有验证：

- 未用真实学校模板（带页眉页脚、公式、自动编号）做适配，只验证了结构与表格；
- 未测试扫描版 PDF 模板（不支持）；
- 未在 Word 中人工打开检查排版，只用 `python-docx` 与自研解析器验证结构；
- 未做多学期、多课程模板的批量回归。

测试命令：

```text
node --test test/report.test.mjs    # 8 通过
node test/ui-check.mjs              # 含报告生成流程
```


## 附：0.3.1 文字章节自动草稿

- 目的、原理、分析、总结改为生成草稿：依据仅限实验标题、课程、软件目录信息、步骤与预期、截图/数据文件数量、数据文件真实摘录、本机排错记录。
- 草稿开头带“（自动草稿，请核对……）”，总结不写“已验证成功”。
- 结果表自动预填“测试项/预期结果”，实际结果与结论仍为【待补】。
- 样例：7 节模板中 5 节 auto（含拓扑自动插图）、2 节草稿、0 节待补，覆盖度 93%。
- 单元测试 10 条通过；`python-docx` 复核：目的区含真实步骤、总结区不含虚构结论。


## 附：0.4.0 实测值与权限

- 步骤支持 `actual`/`passed`/`evidence` 字段，`lab_experiment_record_result` 写入，结果表“实际结果/结论”只取真实记录。
- 报告正文已验证不含“自动草稿”“模板要求”“提交前检查”字样；`lab-assistant-report` 与样例 docx 均复核。
- ~~一次性管理员权限~~：0.4.1 应用户要求整体移除——它对截图和操控软件没有实际作用，需要驱动级操作时由使用者自行以管理员运行 DSH。历史实现见 Git 提交 4f24ed3。

测试：单元 35 通过、自检 3、浏览器通过。


## 附：0.5.0 桌面伴随进程（P0）

- 新增 `overlay/LabPet.cs`（WinForms，约 700 行）与 `app.manifest`（PerMonitorV2）。
- 协议：`/status /pet /guide /clear /screenshot /inspect /quit`，127.0.0.1 + token。
- `overlayRequest` 用 mock HTTP 服务验证：token 校验、JSON 往返、连接失败降级。
- 自检（DSH_LAB_OVERLAY=0）验证工具降级路径：未启动时 `lab_desktop_pet` 明确报“桌面伴随进程不可用”，`lab_page_map_list` 返回空列表。
- **未能在开发沙箱验证编译与运行**：沙箱安全策略拦截了系统编译器（等同 Add-Type 类规则）。首次在用户机器运行时会自动编译；失败时 `lab_desktop_status` 会显示 compile-failed 并给出 build.log。
- icon.png 已替换为“大肥鱼”头像（第 6 张素材）。

测试：单元 32 通过（新增 overlay 协议 1 条）、自检 3、浏览器通过。


## 附：0.6.0 单桌宠 + 桌面实验助手面板

- DSH 网页注入通道整体移除：`/dsh-lab/pet.js` 返回 404，页面无 `#dsh-lab-root`、无 `window.LabAssistant`（集成测试改为断言“不存在”）。
- 点桌面桌宠弹出 WinForms 版“实验助手”面板：实验列表（含打开实验目录）、新建实验、生成报告（姓名/学号/模板浏览）、桌宠设置（称呼/大小/显示）。
- 面板数据通过插件新开的仅本机 token IPC 端口调用同一套 `/dsh-lab/api/*`，DSH 卸载时一并关闭。
- 实验列表摘要新增 workDir，供面板“打开实验目录”。
- 网页表面检查（test/ui-check.mjs）改为：页面无注入 + pet.js 404 + API 冒烟（建档案/生成报告）。
- 单元 32 通过、自检 3 通过、网页表面检查通过、真实 DSH 0.6.0 加载通过；伴随进程编译链路仍需用户机器首跑验证（沙箱拦截编译器）。

## 附：0.14.3 发布前回归（2026-10-31）

环境：Windows 11 x64，Node 24.21.0；仓库 `D:\lab-assistant`，分支 `release-clean`（单提交 `a2e129f`），工作区干净。

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `node --test test/*.test.mjs` | **32 通过 / 0 失败**（1.9 s） |
| 自检 | `node test/selfcheck.mjs` | **3 通过 / 0 失败**（5.9 s） |
| 打包检查 | `node scripts/pack-check.mjs` | `pack check ok: dsh-lab-assistant@0.14.3 icon=256x256` |
| 发布扫描 | `node scripts/publish-check.mjs` | 31 个待发文件，**未发现密钥 / 口令 / 本机路径** |

关键用例（都与“不伪造”有关）：

- `生成计划会区分自动填充与待补，不编造结果`
- `生成 md 与 docx，占位符明确且不含伪造数据`
- `模板封面字段会保留，姓名学号自动填，空缺仍标待补`
- `步骤可记录实测值与是否通过，重复记录会合并证据`
- `跨站请求被拒绝`（本机 HTTP 的跨站防护）

发布包：`dsh-lab-assistant-0.14.3.tgz`（13.2 MB / 88 个文件），对包内 31 个文本文件复扫同样干净。

本轮**未验证**（不要当成已证明）：

- **安装回归**：没把 tgz 装到干净的 DSH 上跑一遍；
- `scripts/publish-check.mjs` 只扫文本，`docs/screenshots/*.png` 等二进制需人工目检；
- `test/ui-check.mjs` 未执行（需要起预览服务）；
- 桌宠进程本轮未重新编译验证（本机跑的还是 0.14.1 的 `LabPet.exe`，重启 DSH 后才会换成新构建）。

---

## 0.15.0 – 0.15.5 回归（2026-11-03）

来源：2026-11-03 用 eNSP 做「实验四 生成树基础实验」时整理的问题清单
（`05-WorkBuddy/.../实验助手插件问题清单.md`）+ 一份真实实验报告模板。

### 一、桌面能力（对应问题清单 1–6）

| 项 | 结论 | 证据 |
|---|---|---|
| 截图不再拍到桌宠 | ✅ | 启动 `LabPet.exe` 后调 `/screenshot`：`petHidden=true, petRestored=true`；截图前可见窗口 `lab-pet`，截图后仍可见（只藏一瞬） |
| 桌宠停泊 | ✅ | `/pet park` → 位置 (2141,1091)，6 秒后仍 (2141,1091)；`/pet unpark` → 恢复走动 (2048,1058) |
| 找不到窗口时给候选 | ✅ | `/click` 用一个不存在的标题：`candidates` 返回 6 个可见窗口（进程名 / 标题 / 尺寸） |
| 窗口枚举改用 EnumWindows | ✅ | 修复 UWP 程序（Win11 记事本）`MainWindowHandle=0` 永远找不到的问题 |
| DPI 统一 | ✅ | 150% 缩放下 `/screenshot` 返回 `dpi=144, scale=1.5, coordSpace=physical`，物理 1168×624 ↔ 逻辑 779×416 |
| UIPI 提权检测 | ✅ | `/click` 预演返回 `elevated=false, targetElevated=false`；目标为管理员而自身不是时直接报错，不再假 `clicked:true` |
| 归位兜底 | ✅ | 记事本 `applied=true`；拒绝改尺寸的程序走 `fallback=maximize` |

### 二、模板与报告（对应问题清单 2、7、8、9）

| 项 | 结论 | 证据 |
|---|---|---|
| 缺模板时先拦下 | ✅ | `report_generate` 无模板返回 `ok:false, needTemplate:true, askUser…`；`useBuiltin:true` 才用内置模板 |
| 真实模板解析 | ✅ | `124524035钱伟豪 实验四…docx`：修改前只识别 1 个章节，修改后 7 个（实验目的/实验平台/实验内容/实验步骤/实验结果及分析/实验拓展） |
| 模板无旧内容残留 | ✅ | 用该模板生成：含本次实测标记 `STP-MYTEST-001`；不含原作者「钱伟豪」、学号「124524035」、不含模板正文原句 |
| 原报告未被修改 | ✅ | 全程用副本；原文件 SHA256 前后一致（`B5C8BCF6…`），mtime 未变 |
| 段落式封面 | ✅ | 读到封面字段 `课程名称/专业年级/学期/学号/姓名`；「医学信息工程学院 制」未被误抓 |
| 无模板时默认封面 | ✅ | 生成封面表：课程名称=课程、专业年级=【待补】、学期=【待补】、学号/姓名来自 student 参数 |
| 补图后同步 | ✅ | 新增 `report_update`，返回 `figuresBefore/figuresNow/added` |
| 待补提醒 | ✅（只走返回值） | `placeholderCount=11, pendingSections=7, note="⚠ 未完成…"`；**文档本身不加任何警示条**（0.15.5 按用户要求撤回） |
| 结果分析/问题与解决 | ✅ | 从 `actual` 与失败步骤自动汇总；单测覆盖 |

### 三、面板（0.15.1）

- 实验档案列表与模板库都加了「删除…」，二次确认后移到 `homeDir/_trash`（可恢复）
- 实测：`deleteExperiment` 后目录消失、`_trash` 内出现备份、当前实验被清空；`deleteTemplate` 后模板列表归零
- 面板重排时两个删除按钮右对齐，不被下拉框遮挡（截图核对）

### 四、本轮未验证（不要当成已证明）

- **Release 附件**：v0.15.3/v0.15.4 附件已确认可下载；0.15.0–0.15.2 的附件是推送后异步出现的，未逐个下载校验内容
- **真实 GUI 场景**：eNSP（管理员进程）+ 150% DPI 的端到端截图/点击，只验证了接口字段与坐标，没有在 eNSP 上真点一次
### 五、2026-11-03 晚间补测（0.15.6）

- **停泊时待机动画** ✅：连续 12 帧采样，自由状态 12 个位置/11 次明显变化；`park` 后 **1 个位置**
  （2141,1091 不变）、仍有 11/11 帧像素变化；`unpark` 后恢复走动（12 个位置）
- **`test/ui-check.mjs` 跑通** ✅：puppeteer-core 25.16 + 本机 Chrome 无头
  运行方式：`PUPPETEER_CORE_PATH=<…/puppeteer-core/lib/puppeteer/puppeteer-core.js> CHROME_PATH=<chrome.exe> node test/ui-check.mjs`
  断言：页面无注入 UI、`/dsh-lab/pet.js` 返回 404、`/api/status` 正常、建实验成功、
  **缺模板时 `ok:false, needTemplate:true`**、`useBuiltin:true` 时生成成功且返回 `pendingSections`、无页面异常
- 顺带修掉一个真问题：HTTP API 之前绕过模板检查，已与工具行为对齐（0.15.6）

## 附：0.15.10 SWMM 与 EPANET 求解器验证（2026-11-10）

这次验的是**水文/水力模拟**这一类软件，选它们的理由：免费、官方提供纯命令行求解器、输入输出都是文件，天然适合做教学循环的 `verifyCmd`。

### 一、方式：零安装

**没有运行任何安装程序，没有提权，没有写注册表、PATH、开始菜单、服务和计划任务。** 两个都是官方免安装压缩包，用 7-Zip 解到 `D:/lab-verify/` 直接跑。

| 软件 | 版本 | 来源 | 压缩包 SHA-256 | 大小 |
| --- | --- | --- | --- | --- |
| EPA SWMM | 5.2.4 (Build 5.2.4) | `USEPA/Stormwater-Management-Model` release `v5.2.4` 的 `swmm-solver-5.2.4-win64.zip` | `3939095028f06b569605eb1f34a63958582d1fd6c1399a2f6f00d6cab4f54696` | 0.87 MB |
| EPANET | 2.3.5 | `OpenWaterAnalytics/EPANET` release `v2.3.5` 的 `EPANET_2_3_5_WIN_32_64.zip` | `6f88b46310713a05856e7323b5ec5da93a074d3d64e80eec6949afb1d265d55d` | 0.63 MB |

- SWMM 压缩包**自带 VC++ 运行时**（`vcruntime140.dll`、`msvcp140.dll` 等），不依赖系统已装运行时
- EPANET 压缩包内含 32/64 位两套，只用了 `64bit\`

### 二、测试模型

| 软件 | 模型 | 来源 |
| --- | --- | --- |
| SWMM | `swmm_example.inp`（14 013 B） | PySWMM `docs/source/examples/swmm_example.inp` |
| EPANET | `Net1.inp`（6 043 B） | OWA EPANET `example-networks/Net1.inp` |

> 用的是**上游官方示例**，不是自己手搓的最小模型——避免"模型写错"被误当成"软件有问题"。

### 三、命令与结果

**SWMM**

```text
runswmm.exe swmm_example.inp swmm_example.rpt swmm_example.out
```

标准输出含 `Simulation complete`，exit 0，耗时约 50 ms，产出 `.rpt` 9 966 B + `.out` 40 076 B。

```text
  Runoff Quantity Continuity     acre-feet        inches
  Total Precipitation ......         1.250         5.000
  Evaporation Loss .........         0.000         0.000
  Infiltration Loss ........         0.519         2.077
  Surface Runoff ...........         0.726         2.904
  Final Storage ............         0.005         0.019
  Continuity Error (%) .....        -0.003
```

**EPANET**

```text
runepanet.exe Net1.inp Net1.rpt
```

标准输出含 `EPANET ran successfully`，exit 0，耗时约 36 ms，产出 `.rpt` 3 052 B。

```text
  Total Inflow:          1052.159
  Consumer Demand:       1100.000
  Total Outflow:         1100.000
  Flow Ratio:               1.000

  Mass Ratio:         1.00000
```

### 四、可直接复用的校验断言

这套断言已经跑通，可以照搬成教学循环里的 `verifyCmd` / `verifyExpect`：

| 软件 | 断言 | 判据 |
| --- | --- | --- |
| SWMM | 跑完 | stdout 含 `Simulation complete`，exit 0 |
| SWMM | 版本正确 | 报告含 `VERSION 5.2` 与 `Build 5.2.4` |
| SWMM | 真的产流 | `Total Precipitation 1.250`、`Surface Runoff 0.726`、`Infiltration Loss 0.519` |
| SWMM | 数值稳定 | 所有 `Continuity Error (%)` 绝对值 < 1.0 |
| EPANET | 跑完 | stdout 含 `EPANET ran successfully`，exit 0 |
| EPANET | 版本正确 | 报告含 `Version 2.3.05` |
| EPANET | 全部收敛 | `Balanced after` ≥ 24 次，且无 `unbalanced` |
| EPANET | 质量守恒 | `Flow Ratio: 1.000`、`Mass Ratio: 1.00000`、`Total Outflow: 1100.000` |

### 五、可复现性

同一输入连跑两次：

- SWMM 的 `.out` **二进制完全一致**（40 076 B 逐字节相同）
- SWMM 的 `.rpt` 与 EPANET 的 `.rpt` 去掉时间戳后**逐字符一致**

结论：这两个求解器在固定版本 + 固定输入下结果确定，**适合做自动判对错**，不会因为"跑两次结果不同"误判。

### 六、踩到的坑（写进经验库）

1. **不能 grep `ERROR`**。SWMM 报告里正常就有 5 处 `ERROR`：4 处是 `Continuity Error (%)` 指标名，1 处是表头 `Inflow / Occurrence / Error`。naive 判断会 100% 误报。正确做法是判断具体失败串，或判断连续性误差的**数值范围**。
2. **径流行叫 `Surface Runoff`，不叫 `Total Runoff`**。按想当然的字段名写断言会失败。
3. **报告里带运行时间戳**，直接整文件比对会误判"结果不一致"。要么比 `.out` 二进制，要么先把时间戳归一化。
4. **EPANET 的 `Net1.inp` 默认 `Summary No`**，报告只有水力状态和质量平衡两张表，没有逐节点结果。要节点结果得在 `[REPORT]` 里加 `NODES ALL`。

### 七、零污染核查

跑完后逐项确认：

| 检查 | 结果 |
| --- | --- |
| `C:/Program Files\SWMM` / `EPANET` | 不存在 |
| `%APPDATA%` / `%LOCALAPPDATA%` 下相关目录 | 无 |
| 开始菜单快捷方式 | 无 |
| Windows 服务 | 无 |
| 计划任务 | 无 |
| 残留进程（`swmm` / `runswmm` / `runepanet`） | 无 |

全部文件只在 `D:/lab-verify/`（5.4 MB），验证结束后整目录删除。

### 八、本次**没有**证明的

- **GUI 版本**（SWMM 的 `epaSWMM.exe`、EPANET 的 `epanet2w.exe`）没有验证：这次只验命令行求解器
- **课程级模型**没有验证：只跑了上游官方示例，没跑过任何学校的真实作业模型
- **插件侧的自动化指引**没有验证：`desktop_guide` 高亮、`desktop_screenshot` 截图、桌宠定位在这两个 GUI 上都没测
- **版本兼容性**：只验了 SWMM 5.2.4 / EPANET 2.3.5，其他版本行为未知
- 因此这两个软件的状态提升为 **`verified-run`（求解器层面）**，不等于"GUI 和课程都可用"

## 附：0.15.11 R / Blender / LTspice 验证（2026-11-10）

本轮按 [decisions-verification.md](decisions-verification.md) 的 D1 选了三个**不同形态**的软件：脚本语言（R）、便携批处理（Blender）、GUI + 批处理（LTspice）。同时第一次做了 **GUI 层验证**（D3）。

### 一、来源与校验

| 软件 | 版本 | 下载源 | 大小 | SHA-256 |
| --- | --- | --- | --- | --- |
| R | 4.6.2 (2026-10-29 ucrt) | `mirrors.aliyun.com/CRAN/bin/windows/base/R-4.6.2-win.exe` | 91 363 600 B | `b0b0053baa1963b6d8a28c9642d50107ef9ce2f41c8b9a90e952846c8918b38a` |
| Blender | 4.5.0 LTS | `mirrors.tuna.tsinghua.edu.cn/blender/release/Blender4.5/blender-4.5.0-windows-x64.zip` | 399 946 398 B | `2ee75e9466d293a784fdf020f60fe1309c1e0610ecf73c64f1fc09b01e5eec56` |
| LTspice | 24.x（ADI 版） | `ltspice.analog.com/software/LTspice64.msi` | 144 698 880 B | `f22163f15420e43a2d5c66440e038ef031a9f019a181f396b95edcef5eebc357` |

三个文件都用 7-Zip `t` 或尺寸比对确认完整。Blender 包解开后 5 519 个文件、925 MB。

### 二、安装方式（三种都试了）

| 软件 | 方式 | 结果 |
| --- | --- | --- |
| R | Inno 静默安装 `R-4.6.2-win.exe /VERYSILENT /DIR="D:\lab-verify\r" /NOICONS` | ✅ 成功，不需要管理员 |
| Blender | 官方 zip 直接解包，不安装 | ✅ 成功 |
| LTspice | MSI 静默安装 | ⚠️ 见下，**属性名不是 INSTALLDIR** |

**LTspice 的坑**：`msiexec /i LTspice64.msi INSTALLDIR=...` 返回 `EXITCODE=0` 却什么都没装到指定目录。查日志才发现 MSI 里有个动作 `SET_TARGETDIR_TO_APPDIR`，把 `TARGETDIR` 强制设成
`%LOCALAPPDATA%\Programs\ADI\LTspice`。也就是说 **它是 per-user 安装，自定义目录要走 `TARGETDIR`，`INSTALLDIR` 被忽略**。

### 三、命令行验证

**R 4.6.2**

```text
Rscript --vanilla smoke.R
```

```text
R_VERSION:R version 4.6.2 (2026-10-29 ucrt)
MEAN:5.0000
SD:2.13809
COEF_INT:37.2851
COEF_WT:-5.3445
R2:0.7528
NROW:32
SETSEED:0.914806
```

用内置 `mtcars` 做 `mpg ~ wt` 回归，系数与 R² 是数据集固有属性，与机器无关。**两次运行输出完全一致。**

**Blender 4.5.0**

```text
blender -b --factory-startup -P smoke.py
```

```text
BL_VERSION: 4.5.0
RENDER_PATH: ...\cube.png
RENDER_EXISTS: True 6018
OBJECTS: 3
VERTS: 8
ENGINE: CYCLES
RENDER_DONE
```

CPU Cycles 8 采样、128×128、透明背景，产出 6 018 B PNG，alpha 非零占比 15.77%（确认不是空白图）。

**LTspice：批处理没跑通**

```text
LTspice.exe -b -ascii rc_lowpass.net
```

不产出 `.raw` / `.log`，进程挂在 GUI 上不退出。解包版和 MSI 安装版表现一致。

根因在 GUI 验证时暴露：`/guide` 定位到的窗口标题是 **「Anonymously Share LTspice Usage Data」**——**首次启动会弹遥测授权对话框**，批处理也被它挡住。这个对话框不点掉，`-b` 就永远等在那里。

### 四、GUI 层验证（本轮新增）

起真实的桌宠进程（`LabPet.exe`，首次用系统自带的 .NET Framework 编译器编译通过），对三个软件各做一次「定位窗口 + 画高亮框 + 真实截窗」，**不做点击**。

| 软件 | 定位到的窗口 | 窗口尺寸 | 截图 | 截图内容 |
| --- | --- | --- | --- | --- |
| LTspice | `Anonymously Share LTspice Usage Data` | 677×341 | 19 792 B | 遥测对话框（灰度均值 216、212 种颜色） |
| Blender | `(Unsaved) - Blender 4.5.0` | 2582×1550 | 1 230 527 B | 主界面（79 332 种颜色） |
| R | `RGui` | 2585×1553 | 91 623 B | R 控制台（2 125 种颜色） |

3/3 通过：定位、高亮、截图、截图后自动恢复桌宠都正常。

**一个反直觉发现**：R 的图形界面窗口标题是 **`RGui`**，不是 `R Console`。按标题找会失败，必须按**进程名** `Rgui` 定位。这类「窗口标题和软件名不一致」的情况，`desktop_guide` 应该优先用进程名。

### 五、可直接复用的断言（已写进 catalog 的 `verify` 字段）

| 软件 | cmd | 关键 expect | deterministic |
| --- | --- | --- | --- |
| R | `Rscript --vanilla {script}` | `MEAN:5.0000` `COEF_WT:-5.3445` `R2:0.7528` | ✅ |
| Blender | `blender -b --factory-startup -P {script}` | `RENDER_DONE` `BL_VERSION: 4.5.0` | ✅（像素级） |
| SWMM | `runswmm.exe {inp} {rpt} {out}` | `Simulation complete` | ✅ |
| EPANET | `runepanet.exe {inp} {rpt}` | `EPANET ran successfully` | ✅ |
| LTspice | —（未跑通，不挂 verify） | — | ✗ |

### 六、踩到的坑

1. **LTspice 的 MSI 忽略 `INSTALLDIR`**，真实属性是 `TARGETDIR`，且被自定义动作强制指向 AppData（per-user）。不看安装日志会以为「装成功了但文件不见了」。
2. **LTspice 首启遥测对话框会阻塞批处理**，`-b` 不产出任何文件也不退出。GUI 层能定位到它，但无法在不点击的前提下关掉。
3. **R 的 GUI 窗口标题是 `RGui` 而不是 `R Console`**，按标题定位会失败，要按进程名。
4. **Blender 的 PNG 不能比字节**：两次渲染像素完全一致（最大像素差 0），但文件 SHA-256 不同——差异在 PNG 元数据块。判分必须比像素或比特征值。
5. **`/screenshot` 有路径白名单**：只允许写到名为 `screenshots` 的目录、系统临时目录、或桌宠配置目录，否则返回 `out 必须位于…`。
6. **R 的 `--vanilla` 在 Windows 上会刷 `LC_*` 警告**（stderr），不影响 stdout 结果，判定时要忽略 stderr。
7. **Blender 无 GPU 时别用 EEVEE**，headless 下不可靠；改用 `CYCLES` + `device=CPU`。

### 七、本次**没有**证明的

- **RStudio 桌面端**没有单独验证，只验了 R 本体
- **LTspice 的仿真能力没有验证**（被首启对话框挡住），它只是「能被发现、能被定位、能被截图」
- **GUI 只验了指路和截图，没验点击**（`guided` 模式本来就禁止代点）
- **Blender 只验了 CPU 渲染**，EEVEE、GPU、课程级工程文件、插件依赖都没验

## 附：0.15.12 LTspice 重试成功（2026-11-10 晚）

> 上一节把 LTspice 判为「批处理跑不通」。本节是修正：**只要点掉首启对话框，`-b` 就完全正常。**
> 上一节的结论作废，以本节为准。

### 一、根因确认

上一节只做到了「GUI 能定位到 `Anonymously Share LTspice Usage Data` 这个窗口」，没有点它。这次做了一次点击：

1. 起桌宠 → 启动 LTspice → `/guide` 定位到对话框
2. `/screenshot` 截图，量出**单选框**（「No, do not send my usage data」）在窗口内 `(47, 183)`、**OK 按钮**在 `(576, 293)`
3. `/click` 两次（`relative: true`，坐标相对整窗）—— 返回 `clicked: true`
4. 关掉 GUI，再跑 `-b`

结果：**`.raw` 立刻就出来了，2 秒内 1.5 MB**。

所以正确结论是：**LTspice 首次启动的遥测授权对话框会阻塞批处理；这个选择是持久化的，点一次之后 `-b` 永久可用。** 不是"LTspice 不支持批处理"。

### 二、版本更正

上一节写「24.x」是估的。日志里明确是：

```text
LTspice 26.1.1 for Windows
solver = Normal
Maximum thread count: 16
Total elapsed time: 0.263 seconds.
Total iterations: 20062
```

### 三、批处理结果

```text
LTspice.exe -b -ascii rc_lowpass.net
```

网表是一个 RC 低通：`V1 in 0 PULSE(0 5 0 1n 1n 5m 10m)` / `R1 1k` / `C1 1uF` / `.tran 0 10m 0 1u`。

| 项 | 值 |
| --- | --- |
| `.raw` 大小 | 1 508 834 B |
| `.log` 大小 | 393 B |
| 绘图类型 | Transient Analysis |
| 变量数 | 6（time / V(in) / V(out) / I(C1) / I(R1) / I(V1)） |
| 采样点 | 10 030 |
| 耗时 | 0.263 s，20 062 次迭代 |

**数值断言（14 条全过）**：

```text
V(in) 首点            = 0
V(out) 峰值           = 4.966310   ← 理论 5×(1-e^-5) = 4.966310
V(out) 在 t=5ms       = 4.966310
V(out) 末端（10ms）    = 0.033463   ← 脉冲 5ms 已落回 0，电容放电
前 50 点单调上升       = 是
log 中无 error/failed = 是
```

### 四、两次运行比对

60180 个数值（10030 点 × 6 变量）**最大差 0.0，完全相同**。

> 但 `.raw` 文件头含 `Date: Tue Nov 10 17:56:43 2026`，所以**不能整文件比哈希**，要按数值比。这和 Blender 的 PNG 是同一类陷阱。

### 五、新踩的坑

1. **断言写错会把软件判成有问题**。我第一版断言写「V(out) 末端 = 5V」，结果 0.0334，看起来像 LTspice 算错了——实际是我的网表里脉冲 5ms 就落回 0，末端本来就该接近 0。
2. **峰值不是 5V 而是 4.9663V**。5 个时间常数只充到 99.33%，`5×(1-e^-5)=4.966310`。断言必须按理论值写，不能按"应该到 5V"写。
3. **ASCII `.raw` 的解析容易翻车**：头部是 `No. Variables:` / `No. Points:`，变量表要跳过 `Variables:` 行逐行读，数据区 `Values:` 之后每行的列数不固定（有的行是「索引+值」，有的是单值）。按行数除以变量数去猜会错。
4. **批处理是异步的**：`spawn` 之后要轮询 `.raw` 是否出现，不能等 process exit（LTspice 是 GUI 子系统程序，退出码不可靠）。

### 六、零污染与清理

| 检查 | 结果 |
| --- | --- |
| `msiexec /x` 卸载 | 返回 0，目录只剩 1 个测试网表 |
| `%APPDATA%\LTspice.ini` | 残留 38 B，已手工删除 |
| 注册表 `HKCU\Software\ADI` / `LTspice` | **不存在**（用 Python `winreg` 核实） |
| 卸载表（HKLM/HKCU Uninstall） | 无 LTspice / R 相关项 |
| `D:\lab-verify` | 已整目录删除 |

> 上一节说「注册表残留无法核实，因为 `reg.exe` 在黑名单」。这次改用 Python 的 `winreg` 模块直读注册表，**不需要改任何安全设置**，并且证实了 R 与 LTspice 的卸载都没留注册表项。这条限制已经解除。

## 附：0.15.18 P4a 编译器回退验证（2026-11-11）

### 一、为什么要单独验

桌宠首次运行要现场编译 `overlay/LabPet.cs`，代码里有两条编译器路径：

1. 装了 Visual Studio 的机器，用它的 Roslyn（支持新语法，诊断好）；
2. 没装的，退回 `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319` 的系统自带编译器（**只支持 C# 5**）。

**问题**：本机装了 VS 2022 Community，`findRoslynCsc()` 一直命中 Roslyn，**第 2 条路从来没被执行过**。而大多数学生机器没装 VS，走的正是这条没验过的路——一旦 `LabPet.cs` 混进 C# 6+ 语法，我这边永远编得过，学生的桌宠永远出不来。

### 二、做法

新增 `DSH_LAB_FORCE_FRAMEWORK_CSC=1`，只改「选哪条编译器」，不改任何编译参数；`startOverlay` 把选中的编译器类型写进 `build.log`，并在返回值和 `resolveCompiler()` 里暴露，便于测试与排错。

### 三、结果

| 路径 | 编译器 | 耗时 | 产物 | 启动 | `/status` |
| --- | --- | --- | --- | --- | --- |
| 强制回退 | `Framework64\v4.0.30319` | 991 ms | 84992 B，sha256 `e75126e1…` | 成功 | `running` / `state: swim` / 宠物可见 |
| 默认 | Roslyn（VS 2022） | 1379 ms | 82432 B，sha256 `87dbe7e4…` | 成功 | `running` / `state: swim` / 宠物可见 |

- 两条路径都 **exit=true**，只有 `CS0649 / CS0169` 警告（未使用字段），无错误。
- 旧编译器能编过，说明 `LabPet.cs` 目前确实保持 C# 5 兼容。
- 证据：`temp/p4a/build-framework.log`、`temp/p4a/build-roslyn.log`、`temp/p4a/result.json`（本机，不进包）。
- 两次编译后 `LabPet` 进程均为 0，无残留。

### 四、顺手修掉的缺陷

旧编译器在中文系统下输出 **GBK**，原来的 `build.log` 按 UTF-8 写入导致警告全是乱码（`��δ���ֶ�`），学生排错时等于看不到信息。给编译器加 `-utf8output` 后中文警告正常可读。这条是 P4a 才暴露出来的。

### 五、边界（不要当成已证明）

- **不是干净系统**：本机仍装 VS 与 .NET Framework 4.8，只证明了「选路正确 + 旧编译器能编出可运行的 exe」。
- 未验证：杀软拦截编译、精简系统缺 .NET Framework、非中文代码页、只读目录首次编译。
- 这些属于 P4b，需要 ISO 或第二台机器。

---

## P4b · 干净系统首次编译（2026-11-11）

**目的**：验证「没装 Visual Studio、没有 .NET SDK 的干净 Windows 11」上，插件首次运行时能不能自己把桌宠编出来。这是学生机器的真实形态。

### 一、环境

| 项 | 值 |
| --- | --- |
| 宿主 | Windows 11 家庭版 25H2 build 26200，VirtualBox 7.2.22r175245（本机原有，未安装/未卸载） |
| 客户机 | Windows 11 企业评估版 26H2，**10.0.26300.9457**，zh-CN |
| ISO | `26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_zh-cn.iso`，**8,548,628,480 B**，SHA-256 `b37a06d5121eee017826c0b133250bbd21bec694c2d607c60edd29090e667a84`（本机留档；评估中心未公开官方哈希） |
| VM 配置 | 4 vCPU / 8192 MB / 60 GB 动态 VDI / EFI + 虚拟 TPM 2.0 / NAT / 无音频 |
| 安装方式 | `VBoxManage unattended install`（应答文件自动生成），自动登录用户 `p4b` |

**客户机实测状态**（脚本探测，非推断）：

```text
VS-NO / VSX86-NO                 ← 没有 Visual Studio
DOTNET-CLI-NO                    ← 没有 .NET SDK
.NET Release 0x82405 (533253)    ← .NET Framework 4.8.1（系统自带）
Framework64\v4.0.30319\csc.exe   存在
Framework32\v4.0.30319\csc.exe   存在
Reference Assemblies 目录        不存在
Defender                         RUNNING
Node                             未安装
```

### 二、首次编译：**先失败，后修复**

用 `lib/overlay.mjs` 原有的编译参数（`-r:` 引用 UIAutomationClient / UIAutomationTypes / WindowsBase）在客户机执行：

```text
error CS0006: 未能找到元数据文件"UIAutomationClient.dll"
error CS0006: 未能找到元数据文件"UIAutomationTypes.dll"
error CS0006: 未能找到元数据文件"WindowsBase.dll"
EXITCODE=1
EXE-MISSING
```

**根因**：`findReferenceLib()` 只查 `Reference Assemblies\Microsoft\Framework\.NETFramework`——那个目录**只有装了 VS/SDK 的机器才有**。干净机器上它不存在，`-lib` 为空，三个程序集找不到，编译直接失败。

**为什么 P4a 没抓到**：P4a 在有 VS 的开发机上强制走旧编译器，`findReferenceLib()` 仍然命中了 VS 的 Reference Assemblies，所以照样编得过。**只换编译器、不换机器，验证不到这条路径。**

**程序集真实位置**（客户机实测）：

```text
UIAutomationClient.dll  -> %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\WPF  (WPF-HAS)
UIAutomationTypes.dll   -> 同上                                          (WPF-HAS)
WindowsBase.dll         -> 同上                                          (WPF-HAS)
System.Windows.Forms.dll    -> v4.0.30319 根目录                          (ROOT-HAS)
System.Web.Extensions.dll   -> v4.0.30319 根目录                          (ROOT-HAS)
```

**修复**：`findReferenceLib()` 在 Reference Assemblies 找不到时，回退到
`%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\WPF`（再退 `Framework`）。编译参数不变。

### 三、修复后复测（客户机内）

| 项 | 结果 |
| --- | --- |
| 编译退出码 | `EXITCODE=0` |
| 产物 | `LabPet.exe`，**84,992 字节**（与开发机上旧编译器产物大小一致） |
| 警告 | 仅 6 条 CS0649/CS0169（未使用字段），无错误 |
| 二次编译 | 同样 exit=0，SHA-256 `e515f0eb32de76bc8d5677776df2f1c1c5612eee71aa3b67a1f661640591d464` |
| 启动 | 进程运行（PID 5440 / 3292，22~34 MB），带 `--port/--token/--pet/--config` 启动 |
| HTTP `/status` | `200`，`{"ok":true,"name":"主人","pet":{"x":696,"y":450,"w":256,"h":268,"visible":true},"state":"swim","version":"1.0.0"}` |
| 截图 | **失败**：`controlvm screenshotpng` 返回 `E_FAIL`（透明置顶分层窗口 + VirtualBox 截图 API），未取到画面；以进程 + HTTP 响应为准 |

**结论**：P4b-core（干净系统真实首次编译 + 启动 + API）**通过**。

### 四、边界（如实标注）

- **P4b-full 未做**：没有在客户机里装 DSH 主程序与插件 tgz，走完整「安装 → 启动 → 桌宠出现」。只证明了编译与进程链路。
- 未覆盖：非中文代码页、精简版系统缺 .NET、企业 EDR 主动拦截、只读 `%LOCALAPPDATA%`。
- 虚拟机无法验证多屏与真 DPI（那是 P3，另需硬件）。
- 客户机为评估版（90 天），不代表长期运行状态。

---

## 平台线 P1 / P2 · 运行中改显示设置（2026-11-11）

### P2 · 浅色 ↔ 深色实时切换

**做法**：改 `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize` 的
`AppsUseLightTheme` / `SystemUsesLightTheme`（1→0），用 `SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, "ImmersiveColorSet")` 广播，等 4 秒后取屏幕像素统计；再改回 1 并广播。全程只统计亮度，不保存任何屏幕图像。

| 区域 | 浅色 | 深色 | 变化 |
| --- | --- | --- | --- |
| 任务栏 | 214.05 | **44.89** | **-169.16** |
| 窗口内容区（屏幕中心） | 242.29 | 242.22 | -0.07 |
| 全局平均 | — | — | -7.54 |
| 恢复后任务栏 | 214.05 | — | 与切前差 **0.1**（噪声） |

**结论（修正原有假设）**：Windows 深色模式**只改任务栏与系统 chrome**，**不会把已打开的 Win32 窗口内容反色**。所以：

- 锚点若落在**任务栏 / 标题栏 / 系统对话框**上，切深色后会失效（亮度差 169，NCC 必然不匹配）；
- 锚点若落在**应用内容区**，系统主题切换**不影响**它；
- 真正需要担心的是**应用自带深色主题**（如编辑器切 Dark+），那属于应用内重绘，和系统主题是两件事。原文档把两者混为一谈，已更正。

**恢复**：`restore_diff_vs_before = 0.1`（灰度 0~255 尺度），主题值复核回 `(1, 1)`。

### P1 · 运行中改缩放 —— **API 路径不通，已如实记录**

**做法**：调 `SystemParametersInfoW(SPI_SETLOGICALDPIOVERRIDE, 0, -1, SPIF_UPDATEINIFILE|SPIF_SENDCHANGE)` 试图从 150% 降到 100%。

**实测**：

```text
before        logpixels=144  logical=(2560,1600)
after_100     logpixels=144  logical=(2560,1600)   ← 没有变化
after_restore logpixels=144  logical=(2560,1600)
```

API 返回成功，但 **`LogPixels` 与逻辑分辨率都不变**。结论：**Win11 上这个老 API 已不生效**，改缩放只能走「设置 → 系统 → 显示 → 缩放」界面，或改 `PerMonitorSettings` 后**注销/重启**才生效。

**因此更正计划文档里的错误估计**：P1 不是「不锁屏不注销、2~3 分钟」。真实成本是**需要注销或手动点设置界面**，会打断用户当前会话。在「不打扰用户」的前提下，这条**做不了**，已标记为受阻而非「待做」。

### P3 / P5

- **P3（双屏混合 DPI）**：本机只有一块内置屏，做不了，维持「等硬件」。
- **P5（高 DPI 面板布局）**：只能在当前 150% 档测一档；100/125/200% 依赖 P1 的切换手段，同样受阻。

---

### P5 · 150% 缩放下面板与气泡布局（2026-11-11，发现并修复真缺陷）

**方法**：单进程内启动桌宠 → `/pet {"action":"panel","open":true}` 打开面板 → `EnumWindows` 按 PID 枚举可见窗口 → `GetWindowRect` + `SPI_GETWORKAREA` 判断是否越界 → 关闭面板 → 退出。

**修复前（150% 缩放，工作区 2560×1540）**：

```text
面板  660×1036  at (1528, 540)   inside_workarea = false   overflow_bottom = 48
桌宠  256×268   at (2158,1197)   inside_workarea = true
```

**根因**：`TogglePanel` 把 `ClientSize` 设成 620×980，但 WinForms 按字体/DPI 又放大了外框（实际 660×1036），而位置仍按 980 计算 → 底部顶出工作区 48 px，最下面一排按钮看不见。代码注释里已提到「Show() 后再赋一次尺寸」，但没处理**赋值后外框又被放大**这一层。

**修复**：`Show()` + 设置 `ClientSize` 之后，读取**真实外框** `Panel.Width/Height`；若超出工作区，则按外框反算缩小客户区；最后按真实高度重新贴边。

**修复后（同一台机器、同一 150% 缩放）**：

```text
面板  660×1036  at (1530, 484)   inside_workarea = true    overflow 全为 0
桌宠  256×268   at (2160,1198)   inside_workarea = true
```

面板整体上移 56 px（48 溢出 + 8 边距），底部不再被裁。

**边界**：只测了 150% 一档。100 / 125 / 200% 依赖改缩放手段（见 P1，当前受阻），未覆盖。气泡（BubbleForm）的越界未单独测，只测了面板。

---

## Logisim Evolution 3.8.0 · 最小实验（2026-11-11）

**运行时**：本机只有 Weka 自带 JDK 17，而 Evolution 的 class 版本要求更高。从**清华 Adoptium 镜像**取到 `OpenJDK21U-jre_x64_windows_hotspot_21.0.13_9.zip`（49,106,397 B，7.3 MB/s，6.7 秒），解压后 `java -version` = `21.0.13 (Eclipse Adoptium)`。

**5.0.0 的坑**：54,448,596 B 的 jar 经历多次断点续传，**大小正确但 CRC 解压失败**（`too many length or distance symbols`）。说明「字节数对上」不等于文件完整，续传拼接可能产生坏块。改用 3.8.0（26,342,945 B，一次下完，`testzip` 无坏块）。

**可判定路径**（试出来的）：

```text
 -b,--test-circuit <file>   Open up a circ file and start the test bench within it.
 -w,--test-vector <args>    Test vector. Arguments: <circuit> <test_vector>
```

**关键格式（踩了三次才通）**：

1. 电路里的组件必须写成 `<comp lib="0" loc="(x,y)" name="Pin">` + `<a name="label" val="a"/>`。
   **写成 `<a name="Pin" ...>` 会被静默丢弃**（文件能打开，但组件全没了）。
2. 测试向量是**独立文本文件**（`.vec`），不是 .circ 里的 XML；首行列名必须与 pin 的 `label` 完全一致。
3. `-b` **无论成败都返回 exit=0**，判定只能看 stdout 的 `Passed: N, Failed: 0`。

**最小直通电路**（Pin → wire → Pin）+ 2 行向量：

```text
Loading test vector "pass.vec" ...
Running 2 vectors ...
1 2 
Passed: 2, Failed: 0
```

两次运行结果完全一致。

**升级**：`logisim` 由 `catalog-only` → **`verified-run`**（不再只是 diagnose）。

**边界**：

- 只验证了「电路加载 → 引脚匹配 → 仿真执行 → 判定」这条链路；**AND 等复合组件的连线几何没搞定**（`inputs` 属性在 3.8.0 被忽略，默认 2 输入；`facing` 与坐标配错会出现 `out = U`）。要覆盖得用 GUI 生成样本。
- 窗口高 1600 与 150% 下屏幕高度相同，是否被任务栏挡住未测。
- GUI 交互、拖拽、保存、仿真时钟都未做。

---

## Praat 6.4.50 · 最小实验（2026-11-11）

**版本**：`Praat 6.4.50 (December 29 2025)`，官方 zip 便携解压，不写注册表、不改 PATH。

**脚本**（`--run` 无 GUI）：

```praat
Create Sound from formula: "tone", 1, 0, 1, 44100, "0.5*sin(2*pi*440*x)"
To Pitch: 0, 75, 600
f0 = Get value at time: 0.5, "Hertz", "nearest"
n = Get number of frames
writeFileLine: "...\out.txt", "PITCH:", fixed$(f0, 2)
appendFileLine: "...\out.txt", "FRAMES:", n
appendFileLine: "...\out.txt", "DONE"
```

**输出**：

```text
PITCH:440.00
FRAMES:97
DONE
```

生成的是 440 Hz 正弦波，测出 **440.00 Hz**，与理论值完全一致；两次运行输出**逐字节相同**。

**升级**：`praat` 由 `catalog-only` → **`verified-run`**。

**坑**：`--run` **不把 Info 窗口内容打到 stdout**，判定必须让脚本自己写文件（`writeFileLine` / `appendFileLine`）。第一次按 stdout 判断会误判为空。

**边界**：只验证了合成音与基频提取；真实录音、声道/采样率异常、Praat 脚本库的其余命令未覆盖。

---

## Git · 最小实验（2026-11-11）

**版本**：`git version 2.55.0.windows.3`（WorkBuddy 自带 PortableGit）。

**做法**：固定 `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE` = `2024-01-01T00:00:00+0000`、`user.name='Lab Test'`、`user.email=lab@example.com`、单文件 `a.txt` 内容 `hello\n`、message `init`，在两个独立目录各建一次仓库。

```text
第 1 次  3b53206b98e723e99ef0d1528b5ff4edc5843ff0
第 2 次  3b53206b98e723e99ef0d1528b5ff4edc5843ff0
```

两次 commit 哈希完全一致，`git status --porcelain` 为空。**升级 `git` → `verified-run`**。

**边界**：Windows 下 `core.autocrlf` 会输出 LF→CRLF 警告，不影响哈希（提交内容已规范化）。**此命令只用于一次性临时目录，禁止在任何用户仓库上自动提交。**

---

## Jupyter · 被环境阻塞（2026-11-11）

**已确认存在的部分**：

```text
D:\Anaconda            Python 3.7.0 (2018)
D:\Anaconda\Scripts\jupyter.exe         Jupyter 4.4.0
D:\Anaconda\Scripts\jupyter-nbconvert.exe  存在
ipykernel 4.10.0       可导入
```

**失败点**：`jupyter nbconvert --to notebook --execute` 启动 kernel 时：

```text
第一次（默认 60s）：RuntimeError: Kernel didn't respond in 60 seconds
第二次（startup_timeout=240）：RuntimeError: Kernel died before replying to kernel_info
```

kernel 进程启动后立即死亡。另在 Python 3.13 venv 里安装 `nbconvert`/`ipykernel` 时，pip 实际装进了 `D:\Anaconda\lib\site-packages`（venv 未隔离成功），同样卡在 kernel 启动。

**结论**：**本机环境下 Jupyter kernel 无法启动**（沙箱/进程与本地端口限制），核心能力「执行 notebook 并捕获输出」**未验证**。按规则**不升级 `catalog-only`**，如实标注为受阻。

**可确认的边界**：`jupyter.exe` 与 `nbconvert` 可执行文件存在、包元数据完整、`--version` 能输出；不能确认 notebook 能真实执行。

---

## MiKTeX 25.12 · 最小实验（2026-11-11）

**安装**：`basic-miktex-25.12-x64.exe --unattended --auto-install=yes`（当前用户安装，无需管理员）。
第一次静默安装 12 分钟未完成（仅 151 个 exe，缺 `pdflatex.exe`）；**第二次重跑 6 分 20 秒完成**，610 个 exe，`pdflatex.exe` 就位。结论：该安装器支持续装，首次中断可重跑收敛。

**最小实验**：`test.tex`（article + amsmath + equation + tabular），`-interaction=nonstopmode -halt-on-error`：

```text
Output written on test.pdf (1 page, 48187 bytes)
```

**确定性**：PDF 默认含 `CreationDate`/`ID`，每次不同。设 `SOURCE_DATE_EPOCH=1700000000` + `FORCE_SOURCE_DATE=1` 后，连续两次编译**逐字节一致**：

```text
sha256 abbe299c8f899938fa622db07a68dffe960882f61892f3cc87b4521c8da55cf4  test.pdf
size 48175  header %PDF-1.5  pages 1  CreationDate D:20231114221320Z  tail %%EOF
```

**升级**：`texlive`（TeX Live / MiKTeX）由 `catalog-only` → `verified-run`，`verify` 字段已写入命令行、期望输出、产物名、超时与确定性说明。

**边界**：只用英文与 amsmath；中文需 `ctex`，会额外联网拉包，未纳入本次最小实验。

---

## 0.15.26 基础功能复查（2026-11-11）

背景：有用户反馈「模板上传一直失败」，WorkBuddy 已在 0.15.24/0.15.25 修了三个根因。
本轮**不重复它的结论**，改为独立按真实 HTTP 把面板/工具两条路径全打一遍，再在它之上补漏。

### 一、模板上传矩阵（33 项全过）

| 场景 | 结果 |
|---|---|
| 面板路径 `POST /report/templates`（复数） | ✅ 200，返回模板 |
| 单数 `POST /report/template` | ✅ 200 |
| 中文 + 空格 + 全角括号文件名 | ✅ 正常落盘 |
| `.md` / `.txt` | ✅ 可导入（各自识别 2 节） |
| `.doc` / `.pdf` | ✅ 明确拒绝「只支持 .docx、.md、.txt」 |
| 损坏 docx | ✅ 报「不是有效的 zip/docx 文件」，不崩 |
| 文件不存在 | ✅ 明确报路径 |
| >10 MB | ✅ 报「模板超过 10 MB」 |
| 同源重复导入 | ✅ 覆盖原条目、保留 id（列表不堆副本） |
| 异源同名 | ✅ 各自保留 |
| 模板删除后生成 | ✅ 如实回到 `needTemplate:true` |

### 二、模板绑定与报告结构

- 面板风格（`reportTemplate`=id）与 `templateId` 都生效：plan 章节来自老师模板，不是内置 7 节
- 真实老师模板：**7 节 → 6 节**，多出来的假章节「实验报告」消失
- `.md` 模板：1 节 → 2 节（`一、实验目的` 不再被当文档标题吞掉）
- 无标题模板：回退内置七节（此前会生成零章节空报告）
- `report_generate` 新增 `templateSections`，可直接核对模板是否生效

### 三、基础功能

| 项 | 结果 |
|---|---|
| 新建 / 读取 / 更新 / 删除实验 | ✅ 删除后读取返回 400，不 500 |
| 记录结果（有步骤 / 按 stepId） | ✅ |
| **记录结果（面板建的空实验）** | ✅ 自动补步骤（此前 400「找不到该步骤」把记录堵死） |
| 无模板 + useBuiltin 生成 | ✅ 产出 docx |
| 空 dataDir 保存设置 | ✅ 不清空已有设置 |
| 状态 / 设置接口 | ✅ |
| 面板 9 条调用路径 vs 后端路由 | ✅ 一一对应 |

### 四、本轮未验证

- 面板 C# 改动后的**真机点按**（本轮只验 HTTP 契约，未点面板按钮）
- MCP 适配器的外部客户端联调（仅跑通项目自带工具契约测试）
- 断网 / 磁盘满 / 模板文件被 Word 占用等异常环境

---

## 0.16.0 / 0.16.1 双宿主验收（2026-11-11）

背景：WorkBuddy 适配完成（桌宠 + 「实验助手」面板在其宿主可用）。本轮验证两个宿主与面板的基础功能。

### 一、DSH 工具（38 个 action）

- 合并入口 `lab_assistant` 可列出 38 个 action，逐个调用**全部返回结构化结果、无未处理异常**
- 未知 action 返回 `ok:false` + 可用列表（不崩）
- 关键语义抽检：建实验、记录结果、模板绑定、报告生成（含 `templateSections` 回报）、删除后读取报错

### 二、MCP 适配器（25 个工具）

- `initialize` / `tools/list` = 25 / `tools/call` 均可；未知工具返回 `isError:true` 而非崩
- 参数映射：`lab_experiment_get` 的 `id` 与 `experimentId` 都认，缺 `arguments` 也能调
- **单写入点验证**：桌面服务运行时，MCP 调用被转发到桌面进程，实验出现在桌面服务列表（1 → 2）

### 三、桌面启动器

| 项 | 结果 |
|---|---|
| `--no-pet` 只起 API | ✅ 发现文件写入 `{pid,port,token,version,homeDir}` |
| 无 token 访问 | ✅ 403 |
| 带 token | ✅ status 正常 |
| `POST /tool` 转发 | ✅ 可调核心方法；未知名 400 |
| 带桌宠启动 | ✅ `LabPet.exe` 拉起、`lab-pet` 窗口可见（截图存证） |
| 单实例 | ✅ 第二次启动提示「已在运行」 |
| `--status` / `--stop` | ✅ 正确；退出后发现文件被清理、桌宠进程退出 |
| 脏发现文件（pid 已死） | ✅ 不阻塞新启动，覆盖为新 pid |

### 四、面板 9 条调用契约

① status ② experiments 列表（7 字段齐全）③ 建实验 ④ 模板列表 ⑤ 导入模板 ⑥ 删模板 ⑦ 删实验 ⑧ 保存设置 ⑨ 遗留生成接口 —— **全部通过**。

### 五、边界输入（15 项）

空/超长标题、非法 mode、路径穿越（实验 ID、模板名）、目录当模板、不存在实验生成、超大请求体（413）、
非法 JSON（400）、`/tool` 原型链方法（`__proto__`/`constructor`/`toString`）、非法 petSize/空白显示名 —— 全部有可读错误、不崩。

### 六、本轮未验证

- 面板「导入模板 / 删除」按钮的**真机点按**（只验了对应 HTTP 契约）
- 开机自启注册表写入（`--enable-autostart` 会改 HKCU Run，未执行）
- 断网 / 磁盘满 / 模板被 Word 占用等异常环境
- 非 Windows 平台（桌宠不可用，MCP 与 API 未在 mac/linux 实测）
- 面板按钮圆角仍有轻微黑边（PillButton 铺底后已改善，未逐像素核对）
