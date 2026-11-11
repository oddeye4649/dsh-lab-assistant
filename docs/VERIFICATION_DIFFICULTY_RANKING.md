# 软件验证难度分级

> 目的：验证成本差异极大——有的 20 分钟能出数值断言，有的要装驱动、要许可服务器、要 Linux 集群。
> 这份表用来排后续测试批次，避免「挑了个最难的先做」。

> 生成方式：`node scripts/rank-verify-difficulty.mjs`（按 catalog 字段自动计算 + 人工修正表）。

## 一、评分口径

总分 = CLI 可判定性 + 授权门槛 + 平台可得性 + 优先级 + 体积/依赖，再映射到 T1~T5。

| 维度 | 0 分 | 1 分 | 2 分 | 3 分 |
| --- | --- | --- | --- | --- |
| CLI 可判定性 | 有 `cli` / 批处理 | 有脚本/API 入口 | 纯 GUI | 纯网页 |
| 授权门槛 | 免费/开源 | 免费但要注册/教育版 | 校园授权 | 订阅制/需许可服务器 |
| 平台可得性 | 有 Windows 版 | 其他 | 仅 Linux | 仅网页/仅虚拟机 |
| 优先级 | P0 | P1 | P2 | — |
| 体积/依赖 | 轻 | 中（GIS/统计/影像） | 重（CAD/CAE/三维/EDA） | — |

**分数线**：≤2 → T1，3~4 → T2，5~6 → T3，7~8 → T4，≥9 → T5。

> 机械打分只能当**初排**。比如 Wireshark 的 `control` 是 `cli/gui`、授权是开源，算出来 T1，但它要装 Npcap 驱动，实际是 T4。所以下面附了人工修正表。

## 二、五档总览

| 档 | 含义 | 单个耗时 | 能验到什么 | 判定原则 |
| --- | --- | --- | --- | --- |
| **T1 · 容易**（3 个） | 免安装或小安装 + 有 CLI/批处理 + 输出可数值判定 | 20~40 分钟 | 可进 verify，有数值/文本断言 | 能写一条命令、能比一个数，就能验 |
| **T2 · 中等**（28 个） | 免费但要装、或有 CLI 但输入文件复杂、或包体 1GB 级 | 40~90 分钟 | 可进 verify，需自备输入样本 | 能验，但要先准备输入样本 |
| **T3 · 偏难**（47 个） | 需校园授权 / 纯 GUI 只能验"启动+截图" / 中等体积 | 1.5~3 小时 | 多数只能到 verified-diagnose | 多半只能验到 diagnosed，验不出数值 |
| **T4 · 困难**（46 个） | 要驱动或内核组件、要许可服务器、体积巨大、或需特定硬件 | 3~6 小时 | 多半只能验"装得上/能启动" | 先把"装得上"验清楚，别指望跑通实验 |
| **T5 · 不建议自动化**（7 个） | 网页服务、Linux 集群专属、或时间精度敏感 | 不排期 | 不投入，保持 catalog-only | 做只读识别即可，不投入验证 |

## 二·补 授权可得性（比难度更硬的约束）

| 授权可得性 | 条目数 | 含义 |
| --- | --- | --- |
| 需院校授权 | 60 | **没有校园许可就验不了**，除非找到试用版 |
| 直接下载 | 40 | 本机可直接下载，能马上验 |
| 有免费试用版 | 14 | 有学生版或试用，需要申请 |
| 需注册账号 | 10 | 要注册/登录，通常几分钟 |
| 需订阅 | 5 | **订阅制，本机拿不到** |
| 需厂商授权 | 1 | 需联系厂商 |
| 直接下载（开源版） | 1 | 开源版可直接下载，但功能有删减 |

> 这一栏决定「能不能开工」。131 个里有相当一部分是校园授权软件——**没有许可就等于验不了**，不是难度问题。

## 三、按档清单

### T1 · 容易（3 个）

| 软件 | 优先级 | 类别 | 控制方式 | **授权可得性** | 平台 |
| --- | --- | --- | --- | --- | --- |
| Git | P0 | 版本控制 | `cli` | 直接下载 | Windows/macOS/Linux |
| Jupyter Notebook / JupyterLab | P0 | 交互式计算 | `browser/cli` | 直接下载 | Windows/macOS/Linux |
| TeX Live / MiKTeX | P1 | 学术排版 | `cli` | 直接下载 | Windows/macOS/Linux |

### T2 · 中等（28 个）

| 软件 | 优先级 | 类别 | 控制方式 | **授权可得性** | 平台 |
| --- | --- | --- | --- | --- | --- |
| 3D Slicer ⚠️ | P0 | 医学影像 | `gui/python` | 直接下载 | Windows/macOS/Linux |
| Logisim / Logisim Evolution | P0 | 数字逻辑仿真 | `gui` | 直接下载 | Windows/macOS/Linux |
| OpenSesame | P0 | 行为实验 | `gui` | 直接下载 | Windows/macOS/Linux |
| Power BI | P0 | 数据分析与绘图 | `gui` | 直接下载 | Windows |
| QGIS ⚠️ | P0 | GIS | `gui/python` | 直接下载 | Windows/macOS/Linux |
| RadiAnt DICOM Viewer | P0 | DICOM影像 | `gui` | 有免费试用版 | Windows |
| Visual Studio Code ⚠️ | P0 | 代码编辑器 | `gui/plugin` | 直接下载 | Windows/macOS/Linux |
| Avogadro | P1 | 分子可视化 | `gui` | 直接下载 | Windows/macOS/Linux |
| DBeaver | P1 | 数据库 | `gui` | 直接下载 | Windows/macOS/Linux |
| H3C HCL 模拟器 | P1 | 网络仿真 | `gui` | 直接下载 | Windows |
| IntelliJ IDEA | P1 | 代码编辑器 | `gui` | 需注册账号 | Windows/macOS/Linux |
| Keil MDK / µVision | P1 | 嵌入式开发 | `gui/cli` | 有免费试用版 | Windows |
| Kinovea | P1 | 视频处理 | `gui` | 直接下载 | Windows |
| MEGA | P1 | 序列分析 | `gui` | 直接下载 | Windows/macOS/Linux |
| OVITO | P1 | 分子可视化 | `gui` | 直接下载 | Windows/macOS/Linux |
| Praat ⚠️ | P1 | 语音分析 | `gui/script` | 直接下载 | Windows/macOS/Linux |
| PyCharm | P1 | 代码编辑器 | `gui` | 需注册账号 | Windows/macOS/Linux |
| PyMOL ⚠️ | P1 | 分子可视化 | `gui/cli` | 直接下载（开源版） | Windows/macOS/Linux |
| SAS | P1 | 统计分析 | `gui/cli` | 需注册账号 | Windows/Linux |
| VESTA | P1 | 晶体结构可视化 | `gui` | 直接下载 | Windows/macOS/Linux |
| Visual Studio | P1 | 代码编辑器 | `gui` | 需注册账号 | Windows |
| AERMOD | P2 | 数值计算与仿真 | `cli` | 直接下载 | Windows |
| GAMS | P2 | 系统仿真 | `cli/gui` | 有免费试用版 | Windows/Linux |
| LAMMPS | P2 | 数值计算与仿真 | `cli` | 直接下载 | Windows/Linux |
| ModelSim | P2 | 数字逻辑仿真 | `cli/gui` | 有免费试用版 | Windows/Linux |
| MODFLOW ⚠️ | P2 | 地下水模型 | `cli/gui` | 直接下载 | Windows/Linux |
| SPM | P2 | 神经影像分析 | `gui` | 直接下载 | Windows/macOS/Linux |
| SWAT | P2 | 流域水文模型 | `cli/gui` | 需注册账号 | Windows/Linux |

### T3 · 偏难（47 个）

| 软件 | 优先级 | 类别 | 控制方式 | **授权可得性** | 平台 |
| --- | --- | --- | --- | --- | --- |
| AntConc ⚠️ | P0 | 语料库分析 | `gui` | 直接下载 | Windows/macOS/Linux |
| JASP | P0 | 统计分析 | `gui` | 直接下载 | Windows/macOS/Linux |
| NoteExpress | P0 | 文献管理 | `gui` | **需院校授权** | Windows |
| Oracle VirtualBox ⚠️ | P0 | 虚拟化 | `gui` | 直接下载 | Windows/macOS/Linux |
| Zotero ⚠️ | P0 | 文献管理 | `gui` | 直接下载 | Windows/macOS/Linux |
| 立创EDA | P1 | 电路设计与PCB | `gui/web` | 直接下载 | Windows/web |
| Adobe After Effects | P1 | 动效合成 | `gui` | **需院校授权** | Windows/macOS |
| Adobe Illustrator | P1 | 矢量设计 | `gui` | **需院校授权** | Windows/macOS |
| Adobe Photoshop | P1 | 图像处理 | `gui/plugin` | **需院校授权** | Windows/macOS |
| AutoCAD | P1 | 工程制图 | `gui/cli` | **需院校授权** | Windows/macOS |
| ChemDraw / ChemOffice | P1 | 化学结构绘制 | `gui` | **需院校授权** | Windows/macOS |
| Cinema 4D | P1 | 三维动画 | `gui` | 有免费试用版 | Windows/macOS |
| Cisco Packet Tracer | P1 | 网络仿真 | `gui` | **需院校授权** | Windows/macOS/Linux |
| Docker ⚠️ | P1 | 容器环境 | `cli` | 直接下载 | Windows/macOS/Linux |
| DPS 数据处理系统 | P1 | 统计分析 | `gui` | **需院校授权** | Windows |
| ENVI | P1 | 遥感图像处理 | `gui` | **需院校授权** | Windows |
| EViews | P1 | 计量经济学 | `gui` | **需院校授权** | Windows |
| Fusion 360 | P1 | 三维CAD | `gui` | 需注册账号 | Windows/macOS |
| GraphPad Prism | P1 | 数据分析与绘图 | `gui` | **需院校授权** | Windows/macOS |
| HEC-RAS | P1 | 水力学模型 | `gui` | 直接下载 | Windows |
| IBM SPSS Amos | P1 | 统计分析 | `gui` | **需院校授权** | Windows |
| IBM SPSS Statistics | P1 | 统计分析 | `gui/syntax` | **需院校授权** | Windows/macOS |
| NI Multisim | P1 | 电路仿真 | `gui` | **需院校授权** | Windows |
| NVivo | P1 | 质性分析 | `gui` | **需院校授权** | Windows/macOS |
| Origin / OriginPro | P1 | 数据分析与绘图 | `gui/script` | **需院校授权** | Windows |
| PKPM | P1 | 结构计算 | `gui` | **需院校授权** | Windows |
| Proteus | P1 | 电路与单片机仿真 | `gui` | **需院校授权** | Windows |
| Rhino + Grasshopper | P1 | 三维建模 | `gui` | 有免费试用版 | Windows/macOS |
| SketchUp | P1 | 三维建模 | `gui` | 直接下载 | Windows/macOS |
| Stata | P1 | 计量与统计 | `gui/cli` | **需院校授权** | Windows/macOS/Linux |
| Tableau | P1 | 数据分析与绘图 | `gui` | 需注册账号 | Windows/macOS |
| Unreal Engine | P1 | 实时交互 | `gui` | 直接下载 | Windows/macOS |
| Adobe Audition | P2 | 音频处理 | `gui` | **需院校授权** | Windows/macOS |
| Adobe InDesign | P2 | 版面排版 | `gui` | **需院校授权** | Windows/macOS |
| AMD/Xilinx Vivado | P2 | FPGA/EDA | `gui/tcl` | 有免费试用版 | Windows/Linux |
| AnyLogic | P2 | 系统仿真 | `gui/java` | **需院校授权** | Windows/macOS/Linux |
| ArcGIS Pro | P2 | GIS | `gui/python` | **需院校授权** | Windows |
| Gaussian | P2 | 量子化学 | `cli/gui` | **需院校授权** | Windows/Linux |
| Maple | P2 | 符号计算 | `gui` | **需院校授权** | Windows/macOS/Linux |
| MATLAB / Simulink | P2 | 数值计算与仿真 | `gui/cli` | **需院校授权** | Windows/macOS/Linux |
| MAXQDA | P2 | 质性分析 | `gui` | **需院校授权** | Windows/macOS |
| Mplus | P2 | 统计分析 | `cli/gui` | **需院校授权** | Windows |
| Pix4Dmapper | P2 | 图像处理 | `gui` | 有免费试用版 | Windows |
| QIIME 2 ⚠️ | P2 | 微生物组分析 | `cli` | 直接下载 | Linux/WSL/conda |
| SnapGene | P2 | 序列分析 | `gui` | 有免费试用版 | Windows/macOS |
| UiPath | P2 | 流程自动化 | `gui` | 需注册账号 | Windows |
| Wolfram Mathematica | P2 | 符号计算 | `gui/script` | **需院校授权** | Windows/macOS/Linux |

### T4 · 困难（46 个）

| 软件 | 优先级 | 类别 | 控制方式 | **授权可得性** | 平台 |
| --- | --- | --- | --- | --- | --- |
| CAJViewer ⚠️ | P0 | 文献阅读 | `gui` | 直接下载 | Windows |
| eNSP ⚠️ | P0 | 网络仿真 | `gui` | **需厂商授权** | Windows |
| PsychoPy ⚠️ | P0 | 行为实验 | `gui/python` | 直接下载 | Windows/macOS/Linux |
| Wireshark ⚠️ | P0 | 网络抓包 | `cli/gui` | 直接下载 | Windows/macOS/Linux |
| Adobe Premiere Pro | P1 | 视频剪辑 | `gui` | **需院校授权** | Windows/macOS |
| Altium Designer | P1 | 电路设计与PCB | `gui` | **需院校授权** | Windows |
| Autodesk Revit | P1 | BIM | `gui/plugin` | **需院校授权** | Windows |
| GNS3 ⚠️ | P1 | 网络仿真 | `gui/remote` | 直接下载 | Windows/macOS/Linux |
| Unity ⚠️ | P1 | 实时交互 | `gui/cli` | 直接下载 | Windows/macOS |
| 东方财富 Choice | P2 | 数据分析与绘图 | `gui` | **需订阅** | Windows |
| 广联达 | P2 | 工程造价 | `gui` | **需院校授权** | Windows |
| 南方 CASS | P2 | 工程制图 | `gui` | **需院校授权** | Windows |
| 同花顺 iFinD | P2 | 数据分析与绘图 | `gui` | **需订阅** | Windows |
| 盈建科 | P2 | 结构计算 | `gui` | **需院校授权** | Windows |
| 用友 U8 ⚠️ | P2 | ERP实训 | `web/gui` | **需院校授权** | Windows/Server |
| Abaqus | P2 | 有限元分析 | `gui/python` | **需院校授权** | Windows/Linux |
| ANSYS | P2 | 有限元/CFD仿真 | `gui/script` | **需院校授权** | Windows/Linux |
| Aspen HYSYS | P2 | 化工流程模拟 | `gui` | **需院校授权** | Windows |
| Aspen Plus | P2 | 化工流程模拟 | `gui` | **需院校授权** | Windows |
| ATLAS.ti | P2 | 质性分析 | `gui/web` | **需院校授权** | Windows/macOS/web |
| AutoCAD Civil 3D | P2 | 工程制图 | `gui` | **需院校授权** | Windows |
| Autodesk 3ds Max | P2 | 三维建模 | `gui` | **需院校授权** | Windows |
| Autodesk Maya | P2 | 三维动画 | `gui` | **需院校授权** | Windows/macOS/Linux |
| CATIA | P2 | 三维CAD | `gui` | **需院校授权** | Windows |
| Complete Anatomy ⚠️ | P2 | 三维解剖 | `gui` | **需订阅** | Windows/macOS |
| COMSOL Multiphysics | P2 | 数值计算与仿真 | `gui` | **需院校授权** | Windows/macOS/Linux |
| E-Prime ⚠️ | P2 | 行为实验 | `gui` | **需院校授权** | Windows |
| ETABS | P2 | 结构分析 | `gui` | **需院校授权** | Windows |
| FSL ⚠️ | P2 | 神经影像分析 | `cli` | 需注册账号 | Linux/macOS/WSL |
| Geant4 ⚠️ | P2 | 粒子输运仿真 | `cli` | 直接下载 | Linux/macOS/Windows |
| Houdini | P2 | 三维动画 | `gui` | 有免费试用版 | Windows/Linux |
| Intel Quartus Prime | P2 | FPGA/EDA | `gui` | 有免费试用版 | Windows/Linux |
| Lumion ⚠️ | P2 | 建筑渲染 | `gui` | 有免费试用版 | Windows |
| Materials Studio | P2 | 数值计算与仿真 | `gui` | **需院校授权** | Windows |
| MDI Jade | P2 | 晶体结构可视化 | `gui` | **需院校授权** | Windows |
| MIDAS Civil / Gen | P2 | 结构分析 | `gui` | **需院校授权** | Windows |
| NI LabVIEW ⚠️ | P2 | 测试测量与图形化编程 | `gui` | **需院校授权** | Windows |
| Nuke | P2 | 视频剪辑 | `gui` | 有免费试用版 | Windows/macOS/Linux |
| OsiriX / Horos | P2 | DICOM影像 | `gui` | 有免费试用版 | macOS |
| PLAXIS | P2 | 岩土有限元 | `gui` | **需院校授权** | Windows |
| PTC Creo | P2 | 三维CAD | `gui` | **需院校授权** | Windows |
| SAP2000 | P2 | 结构分析 | `gui` | **需院校授权** | Windows |
| Siemens NX | P2 | 三维CAD | `gui` | **需院校授权** | Windows |
| SOLIDWORKS | P2 | 三维CAD | `gui/api` | **需院校授权** | Windows |
| STAAD.Pro | P2 | 结构分析 | `gui` | **需院校授权** | Windows |
| Wind 金融终端 | P2 | 数据分析与绘图 | `gui` | **需订阅** | Windows |

### T5 · 不建议自动化（7 个）

| 软件 | 优先级 | 类别 | 控制方式 | **授权可得性** | 平台 |
| --- | --- | --- | --- | --- | --- |
| Figma ⚠️ | P0 | 界面与协作设计 | `web` | 需注册账号 | web/Windows/macOS |
| LaTeX / Overleaf ⚠️ | P0 | 学术排版 | `cli/gui/web` | 直接下载 | Windows/macOS/Linux/web |
| 北大法宝 ⚠️ | P1 | 法律数据库 | `web` | **需院校授权** | web |
| Kali Linux ⚠️ | P1 | 安全实验环境 | `cli/gui` | 直接下载 | 虚拟机 |
| VASP ⚠️ | P2 | 数值计算与仿真 | `cli` | **需院校授权** | Linux |
| Westlaw / LexisNexis ⚠️ | P2 | 法律数据库 | `web` | **需订阅** | web |
| WRF ⚠️ | P2 | 气象模式 | `cli` | 直接下载 | Linux/WSL |

## 四、人工修正表（机器排错的地方）

| 软件 | 机器分档 | 修正后 | 原因 |
| --- | --- | --- | --- |
| Visual Studio Code | T1 | **T2** | `code --version` 能验，但离「课程可用」还差扩展与调试配置 |
| QGIS | T1 | **T2** | qgis_process 可判定，但安装包 1GB+ 且官网版本定位不稳 |
| PyMOL | T1 | **T2** | Windows 开源版要走 conda/wheel，不是普通安装包 |
| 3D Slicer | T1 | **T2** | 可用 Python 控制台脚本化，但包体 1GB+ |
| MODFLOW | T1 | **T2** | CLI 强，但输入文件多、需配套预处理工具 |
| Praat | T1 | **T2** | 有 Praat 脚本可批处理音频，判定可靠 |
| Docker | T1 | **T3** | Windows 上要 WSL2/Hyper-V，基本等同管理员 + 重启 |
| QIIME 2 | T2 | **T3** | conda/Linux 环境，装起来比用起来难 |
| AntConc | T1 | **T3** | 纯 GUI，没有可判定的输出，只能验「能启动 + 能截图」 |
| Oracle VirtualBox | T1 | **T3** | 要装虚拟网卡驱动，与 Hyper-V 冲突，需管理员 |
| Zotero | T1 | **T3** | GUI 为主，但数据库是 SQLite，可间接校验 |
| eNSP | T3 | **T4** | 依赖 VirtualBox + 虚拟网卡驱动，需管理员 |
| Wireshark | T1 | **T4** | 要装 Npcap 驱动，需管理员；抓包还要求网卡权限。CLI 再强也过不了驱动这关 |
| GNS3 | T2 | **T4** | 需要设备镜像 + 虚拟机，镜像本身不能分发 |
| NI LabVIEW | T4 | **T4** | 要装运行时 + 仪器驱动，且需要真实硬件才能验出东西 |
| FSL | T3 | **T4** | Linux/WSL 专属，且要 FSL 数据包 |
| 用友 U8 | T4 | **T4** | 通常是院校服务器版，学生端只是浏览器 |
| E-Prime | T4 | **T4** | 毫秒级刺激呈现，绝不能用通用 GUI 自动化去操作 |
| PsychoPy | T1 | **T4** | 时间精度必须在真机显示器上实测，pip 依赖链也长 |
| Geant4 | T2 | **T4** | 要自己编译 C++ 并配数据包，构建时间以小时计 |
| Unity | T1 | **T4** | 安装器数 GB 且必须登录 Unity ID 才有授权 |
| Lumion | T4 | **T4** | 纯 GUI + 吃显卡，无 CLI 可判定 |
| Complete Anatomy | T4 | **T4** | 订阅制教材类应用，无实验可做 |
| CAJViewer | T1 | **T4** | 纯 GUI 阅读器，无任何可自动判定的产物 |
| Kali Linux | T2 | **T5** | 本质是虚拟机镜像，不是「装个软件」 |
| WRF | T3 | **T5** | 气象模式，需要 MPI + 编译 + 大量地形数据 |
| LaTeX / Overleaf | T1 | **T5** | Overleaf 是网页服务；本地等价的 TeX Live 单独列为 T1 |
| Figma | T2 | **T5** | 纯网页协作工具，没有本地可验证产物 |
| 北大法宝 | T5 | **T5** | 网页数据库，只能验检索，不该做桌面自动化 |
| Westlaw / LexisNexis | T5 | **T5** | 同上，且依赖院校订阅 IP |
| VASP | T4 | **T5** | 只能在 Linux 集群跑，本地装不了 |

## 五、建议的测试批次

每批 3 个，同档内选，避免一批里既有 20 分钟也有 6 小时的。

- **第 1 批（T1）**：TeX Live / MiKTeX、Jupyter Notebook / JupyterLab、Git
- **第 2 批（T2 起步）**：QGIS、Praat、MODFLOW
- **第 3 批（T2 中段）**：3D Slicer、PyMOL、GAMS
- **第 4 批（T3 授权类）**：IBM SPSS Statistics、Stata、Origin / OriginPro
- **第 5 批（T3 CAD 类）**：AutoCAD、SketchUp、ChemDraw / ChemOffice
- **第 6 批（T4 重型）**：SOLIDWORKS、ANSYS、Autodesk Revit

> 批次只是建议。真正开工时按「同档里挑体积最小、授权最简单」的原则重新选，因为同档内部差异仍然很大。

## 六、不排期的（T5）

这些做**只读识别**就够了，不值得投入验证成本：

- **Kali Linux**：本质是虚拟机镜像，不是「装个软件」
- **WRF**：气象模式，需要 MPI + 编译 + 大量地形数据
- **LaTeX / Overleaf**：Overleaf 是网页服务；本地等价的 TeX Live 单独列为 T1
- **Figma**：纯网页协作工具，没有本地可验证产物
- **北大法宝**：网页数据库，只能验检索，不该做桌面自动化
- **Westlaw / LexisNexis**：同上，且依赖院校订阅 IP
- **VASP**：只能在 Linux 集群跑，本地装不了
