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
- `test/ui-check.mjs` 仍未执行（需要 puppeteer-core）
- 桌宠停泊只测了坐标不动，没有验证「待机动画仍在播」
