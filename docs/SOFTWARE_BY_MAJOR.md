# 全国高校各专业「需要在电脑上安装并动手操作」的软件清单

> 用途：为实验助手的软件目录（`docs/SOFTWARE_CATALOG.md`）扩充候选，以及判断哪些专业/软件值得优先适配。
> 数据来源：国内高校公开的教学软件清单（上海财经大学教学网、广东金融学院金融实验中心、武汉工商学院会计学实验课程清单、天津大学北洋维基专业软件表）、美国工学院硬件/软件要求页（Missouri、Waterloo 系），以及各软件厂商教育授权页。
> **注意**：这份清单是「常见情况」，不是「每所学校都这样」。同一专业不同学校差异很大，最终以课程大纲为准。

---

## 0. 先看结论：真正「必须装、必须动手」的只有 5 个簇

大量所谓「专业软件」其实是通用工具（Office、Zotero、PDF 阅读器）。按「课程会考操作、作业必须交文件」这个标准筛，真正吃重的只有五类：

| 簇 | 代表软件 | 覆盖专业 | 特点 |
| --- | --- | --- | --- |
| **编程 / 数据** | Python(Anaconda)、R/RStudio、VS Code、MATLAB | 几乎全部理工 + 经管 + 社科 | 免费为主，跨平台 |
| **绘图 / 建模** | AutoCAD、SolidWorks、Revit、SketchUp、Rhino、CATIA、UG/NX | 机械、土木、建筑、电气、材料、工业设计 | **绝大多数 Windows only**，吃显卡 |
| **仿真 / 计算** | ANSYS、Abaqus、COMSOL、Aspen Plus、Multisim、Proteus、Keil、Vivado | 力学、化工、电子、电气、通信 | 院校授权为主，安装包巨大 |
| **统计 / 计量** | SPSS、Stata、EViews、SAS、Mplus、AMOS、NVivo | 经管、社科、心理、教育、医学、农学 | Windows 为主，授权贵 |
| **专业分析 / 成像** | ArcGIS、ENVI、ImageJ、ChemDraw、Origin、PyMOL、3D Slicer | 地学、环境、生物、化学、材料、医学 | 一半免费一半商业 |

**判断适配优先级时，这五簇之外的基本可以先不做。**

---

## 1. 通用底座（所有专业都要，不算「专业软件」）

| 软件 | 说明 | 授权 |
| --- | --- | --- |
| Microsoft Office / WPS Office | Word 长文档、Excel 数据、PPT | 学校多提供 Office 365 |
| Zotero / EndNote / Mendeley | 文献管理，写论文必备 | Zotero 免费；EndNote 多为院校授权 |
| PDF 阅读器（Acrobat / Foxit / SumatraPDF） | 读文献、填表 | 免费 |
| 浏览器 + 解压 + 截图（7-Zip / Snipaste） | 基础设施 | 免费 |
| LaTeX（TeX Live / MiKTeX） | 数学、物理、计算机论文排版 | 免费 |

> 很多学校还有「正版软件平台」，学生用校园账号免费下载 MATLAB、SPSS、Stata、SAS、Windows、Office。**这是最容易忽略的一点：先查学校平台，别自己买。**

---

## 2. 理学

### 2.1 数学 / 统计
| 软件 | 用途 | 授权 / 平台 |
| --- | --- | --- |
| MATLAB | 数值计算、矩阵、建模 | 院校授权；Win/Mac/Linux |
| Mathematica / Maple | 符号计算、微积分 | 院校授权 |
| R / RStudio | 统计、绘图 | **免费**，跨平台 |
| LaTeX | 论文排版 | 免费 |
| SAS | 统计（大型） | 院校授权 / SAS OnDemand 免费云端 |
| Python (Anaconda) | 数值、机器学习 | 免费 |

### 2.2 物理
MATLAB、Mathematica、**COMSOL Multiphysics**（多物理场仿真）、**LabVIEW**（虚拟仪器、实验数据采集）、Origin（作图）、Multisim（电路部分）、LaTeX。
> LabVIEW 在物理实验课里很常见，且**只有 Windows**，是常被忽略的一项。

### 2.3 化学 / 应用化学
| 软件 | 用途 | 授权 |
| --- | --- | --- |
| **ChemDraw / ChemOffice** | 画分子结构式、反应式（行业标准） | 商业，院校授权 |
| **Origin / OriginPro** | 实验数据作图与拟合（几乎必用） | 商业，有学生版 |
| **Gaussian / GaussView** | 量子化学计算 | 商业 |
| **VESTA** | 晶体结构可视化 | **免费** |
| Materials Studio | 材料模拟 | 商业，院校授权 |
| MDI Jade | XRD 谱图分析 | 商业 |
| PyMOL | 蛋白结构 | 开源版免费 |
| Avogadro | 分子建模 | 免费 |

### 2.4 生物 / 生物科学
| 软件 | 用途 | 授权 |
| --- | --- | --- |
| **ImageJ / Fiji** | 显微图像定量分析（通用） | **免费** |
| **PyMOL** | 蛋白/分子三维结构 | 开源免费 |
| MEGA | 系统发育树 | 免费 |
| SnapGene / Benchling | 分子克隆设计 | 商业 / 云端免费版 |
| QIIME 2 | 微生物组分析（Linux/Docker） | 免费 |
| GraphPad Prism | 生物统计作图 | 商业 |
| R / Python | 生物信息 | 免费 |

---

## 3. 工学

### 3.1 机械 / 车辆 / 工业设计
| 软件 | 用途 | 平台 |
| --- | --- | --- |
| **SolidWorks** | 参数化三维建模（机械标配） | **Windows only** |
| **AutoCAD** | 二维工程图 | Win/Mac |
| CATIA / UG NX / Creo | 高端 CAD（航空航天、汽车） | Windows |
| ANSYS / Abaqus | 有限元分析 | Windows |
| Fusion 360 | 建模 + CAM | 跨平台，教育免费 |
| Origin | 实验数据 | 商业 |
| 3ds Max / KeyShot | 渲染 | Windows |

### 3.2 电气 / 电子 / 通信
| 软件 | 用途 | 授权 |
| --- | --- | --- |
| **MATLAB / Simulink** | 信号处理、控制系统 | 院校授权 |
| **Multisim** | 电路仿真 | NI，院校授权，Windows |
| **Proteus** | 单片机 + 电路仿真 | 商业，有学生版 |
| **Keil MDK / uVision** | 单片机开发 | 免费评估版（2KB 限制）/ 商业 |
| **Altium Designer** | PCB 设计 | 商业，**学生可申请免费** |
| 立创 EDA | 国产 PCB，免费 | 免费，网页/客户端 |
| Vivado / Quartus | FPGA | 免费 Web Edition |
| LTspice | 模拟电路仿真 | **免费** |
| Modelsim | 数字仿真 | 商业 |
| NI LabVIEW | 仪器控制 | 商业 |

### 3.3 计算机 / 软件 / 人工智能
VS Code、PyCharm、IntelliJ IDEA、Visual Studio、JDK、Python(Anaconda)、Git/GitHub Desktop、Docker、VMware/VirtualBox、Navicat / DBeaver、Postman、Linux（WSL 或虚拟机）、Jupyter。
> 这一簇**几乎全免费**，是适配成本最低、也最适合先做的。

### 3.4 土木 / 建筑 / 城乡规划
| 软件 | 用途 | 平台 |
| --- | --- | --- |
| **AutoCAD** | 制图基础 | Win/Mac |
| **Revit** | BIM 建模 | **Windows only**，教育版免费 |
| **SketchUp** | 方案建模 | 有免费网页版 |
| Rhino + Grasshopper | 参数化设计 | Windows |
| **PKPM / 盈建科** | 中国结构计算（国产，课程常用） | Windows only |
| **广联达** | 造价、算量 | Windows only |
| SAP2000 / ETABS / MIDAS | 结构分析 | Windows |
| ANSYS / Abaqus / PLAXIS | 有限元、岩土 | Windows |
| Lumion / Enscape / Twinmotion | 渲染与漫游 | Windows，吃显卡 |
| Blender | 建模渲染（免费替代） | 免费 |

### 3.5 给排水 / 环境工程
| 软件 | 用途 | 授权 |
| --- | --- | --- |
| **SWMM** | 城市排水管网、海绵城市 | **免费** |
| **EPANET** | 供水管网水力 | **免费** |
| **HEC-RAS** | 河道一维/二维洪水 | **免费** |
| ArcGIS / ArcGIS Pro | 汇水区划分、专题图 | 院校授权 |
| MIKE / InfoWorks | 商业水模拟 | 商业 |
| AERMOD / CALPUFF | 大气扩散 | 免费/商业 |

### 3.6 化工 / 制药工程
| 软件 | 用途 | 授权 |
| --- | --- | --- |
| **Aspen Plus / HYSYS** | 流程模拟（化工标配） | 商业，院校授权 |
| PRO/II、ChemCAD | 流程模拟替代 | 商业 |
| MATLAB | 过程控制 | 院校授权 |
| Origin | 数据作图 | 商业 |
| ChemDraw | 结构式 | 商业 |

### 3.7 材料
Materials Studio、VASP（**Linux**）、LAMMPS（Linux）、OVITO、MDI Jade（XRD）、Origin、ChemDraw、VESTA、ImageJ（金相/电镜图）。
> 计算材料方向基本在 Linux 服务器上跑，本地只装可视化和作图工具——**这类「本地不装主软件」的情况要单独识别**。

### 3.8 测绘 / 地信 / 遥感
ArcGIS / ArcGIS Pro、**QGIS（免费）**、ENVI、ERDAS、南方 CASS（国产成图）、Pix4D / ContextCapture（倾斜摄影）、MATLAB。
> 测绘专业 Windows + 大内存，且常配加密狗。

### 3.9 能源 / 核工程
MATLAB、ANSYS Fluent、RELAP5、MCNP（Linux）、Aspen、EBSILON。

---

## 4. 农学

| 软件 | 用途 |
| --- | --- |
| **DPS** | 国产农业试验统计（课程常用） |
| SAS / SPSS / R | 试验设计与统计 |
| ArcGIS / QGIS | 农业区划、遥感 |
| ENVI | 作物遥感 |
| ImageJ | 植物表型测量 |

---

## 5. 医学

| 软件 | 用途 | 授权 |
| --- | --- | --- |
| **SPSS** | 医学统计（几乎每校都开课） | 院校授权 |
| **GraphPad Prism** | 统计作图（论文常用） | 商业 |
| **EndNote / Zotero** | 文献管理 | 院校/免费 |
| **3D Slicer** | 医学影像三维重建 | **免费** |
| FSL / SPM | fMRI 处理（Linux/MATLAB） | 免费 |
| RadiAnt DICOM Viewer | 看 CT/MRI | 免费 |
| Complete Anatomy / Visible Body | 三维解剖 | 商业，机房常见 |
| ImageJ | 病理/细胞图像 | 免费 |
| R | 流行病学统计 | 免费 |

> 医学影像涉及真实病例，**数据必须本地匿名化，默认不上传**。

---

## 6. 经济 / 管理

| 软件 | 用途 | 授权 |
| --- | --- | --- |
| **Excel（高级）** | 财务建模、透视表、VBA | Office |
| **SPSS** | 统计分析 | 院校授权 |
| **Stata** | 计量经济学（经管标配） | 院校授权 |
| **EViews** | 时间序列、宏观经济 | 商业 |
| **SAS** | 大型统计 | 院校授权 / 免费云端 |
| **R / RStudio** | 计量、金融数据分析 | 免费 |
| **Python (Anaconda)** | 数据分析、爬虫、机器学习 | 免费 |
| **Tableau / Power BI** | 数据可视化 | 学生免费 / 免费桌面版 |
| **用友 U8 / 金蝶** | 会计信息化、ERP（多为院校服务器版） | 院校采购 |
| **网中网 / 新道 沙盘** | 企业经营沙盘、财务共享 | 院校采购，多为网页 |
| **RPA（UiPath / 来也）** | 财务机器人 | 免费社区版 |
| Wind / 同花顺 / Choice | 金融数据终端 | 院校订阅 |
| AnyLogic / GAMS | 运筹、系统仿真 | 商业，有学习版 |

> 经管类有个特点：**很多"软件"其实是院校采购的网页平台（沙盘、实训系统）**，学生端不用装东西，只用浏览器。这类不适合做桌面自动化，适配价值低。

---

## 7. 心理学 / 社会学 / 教育学

| 软件 | 用途 | 授权 |
| --- | --- | --- |
| **E-Prime** | 刺激呈现、反应时实验（毫秒级） | 商业，院校授权 |
| **PsychoPy** | 同类实验，开源替代 | **免费** |
| OpenSesame | 同类实验 | 免费 |
| **SPSS** | 统计分析 | 院校授权 |
| **AMOS** | 结构方程模型（随 SPSS） | 商业 |
| **Mplus** | 潜变量建模 | 商业 |
| **NVivo / ATLAS.ti** | 质性研究编码 | 商业 |
| R (lavaan) / JASP | 免费统计替代 | 免费 |
| Qualtrics / 问卷星 | 在线问卷 | 院校/免费 |

> **E-Prime 这类软件对时间精度极敏感**，绝对不能用"通用 GUI 自动点击"去操作它，会污染数据。这类只适合做环境检查、项目文件校验、数据导出验证。

---

## 8. 艺术学 / 传媒

| 软件 | 用途 | 授权 |
| --- | --- | --- |
| **Photoshop / Illustrator / InDesign** | 平面、排版（设计类核心） | Adobe 教育版 |
| **Premiere Pro** | 视频剪辑 | Adobe 教育版 |
| **After Effects** | 动效、合成 | Adobe 教育版 |
| **Cinema 4D** | 三维动画（国内教学常用） | 商业，有学生版 |
| Maya / 3ds Max | 三维动画 | 教育版免费 |
| **Blender** | 三维全能（免费替代） | 免费 |
| Houdini | 高级特效 | 免费 Apprentice |
| Nuke | 影视合成 | 非商业版免费 |
| **Unity / Unreal Engine** | 游戏、虚拟现实、建筑可视化 | 免费 |
| SketchUp / Rhino | 空间与产品 | 教育版 |
| Audition / Audacity | 音频 | 商业 / 免费 |
| Figma / Sketch | UI 设计 | 免费/商业 |

> 艺术类是**授权最贵、盗版最普遍**的一类。教育版申请门槛低，但安装包大、吃显卡。

---

## 9. 法学 / 人文

| 软件 | 用途 |
| --- | --- |
| 北大法宝 / 威科先行 / Westlaw / LexisNexis | 法律数据库（多为网页，校内 IP 访问） |
| NoteExpress / EndNote | 文献管理 |
| NVivo / MAXQDA | 质性文本分析 |
| 中国知网 CAJViewer | 读硕博论文 |

> 这一类的"软件"绝大多数是**网页数据库**，本地只装阅读器和文献管理，几乎没有实验操作环节。

---

## 10. 教育学 / 体育

SPSS、AMOS、Mplus、NVivo、问卷星、微课制作（Camtasia / 剪映）、教学平台（超星学习通、雨课堂）。
体育：运动生物力学（**Kinovea** 免费视频分析、Vicon 商业）、Body Composition 体成分分析。

---

## 11. 对实验助手的意义：适配优先级建议

按「装得上 + 能验证 + 有报告需求」三条打分：

| 优先级 | 软件簇 | 理由 |
| --- | --- | --- |
| **P0（先做）** | Python、R/RStudio、MySQL/数据库、ImageJ、VS Code、QGIS、SWMM/EPANET/HEC-RAS | 免费、易装、命令行或文件可校验，已验证过 4 个（Python/Weka/MySQL/ImageJ） |
| **P1（次做）** | eNSP、Wireshark、SPSS、Stata、Origin、ChemDraw、ArcGIS、AutoCAD | 教学面最广，但授权/安装有坑，需要经验库支撑 |
| **P2（慎做）** | SolidWorks、ANSYS、Abaqus、Aspen、Revit、PKPM、广联达 | 安装包巨大、授权复杂、GUI 深度耦合 |
| **P3（不建议）** | E-Prime、LabVIEW、院校网页沙盘、法律数据库 | 时间精度敏感 / 不用装 / 纯网页 |

**两个反直觉的结论：**

1. **软件最多的不是计算机专业，是机械、土木、建筑和艺术**——一台机器上可能同时要装 8~12 个大型软件，冲突和版本问题最集中，也最需要"兼容性适配 + 经验库"。
2. **很多专业其实"不用装"**：法学、人文、部分经管的核心工具是网页数据库和院校平台。这些专业不该做桌面自动化，做了也没人用。
