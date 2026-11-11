# 跨学科实验软件知识目录

> 更新时间：2026-11-10  
> 机器可读目录：`coursepacks/software-catalog.json`  
> 当前覆盖：14 个学科方向、140 项代表软件。

## 先说清楚“学习”是什么意思

本目录不是“已支持”清单。当前 eNSP 完成了只读安装检测；Python 3.12.10、Weka 3.8.7、MySQL 8.0.46、ImageJ 1.54f、SWMM 5.2.4、EPANET 2.3.5 已在单台 Windows 11 x64 完成最小实验（**SWMM / EPANET 只验了命令行求解器，GUI 与课程级模型未验证**）。其他软件仅完成学科归类、常见用途、授权方式和优先级整理，不能据此宣称已支持所有用户配置。完整证据见 [VERIFICATION_2026-10-28.md](VERIFICATION_2026-10-28.md)。

对每一项软件，真正达到可交付支持必须通过四道门：

1. **能发现**：识别安装位置、版本和必要依赖；
2. **能启动**：通过最小运行测试，不只看安装目录；
3. **能验证**：课程步骤能产生真实、可检查的结果；
4. **能恢复**：失败时知道如何停下、保留证据并回退。

不能因为软件“听说过”或“安装包能下载”就写进课程包。商业授权、校园授权、服务器版和网页版还必须单独记录访问方式，不能默认学生个人电脑有安装权限。

## 优先级

| 优先级 | 含义 | 典型对象 |
|---|---|---|
| P0 | 免费或容易获取、课程常见、通常可安全验证 | Python、Git、MySQL、Wireshark、QGIS、ImageJ、Logisim |
| P1 | 校园授权或商业软件，安装与界面适配成本中等 | Multisim、Packet Tracer、AutoCAD、Revit、SPSS、ChemDraw |
| P2 | 重型计算、专业授权、依赖硬件或自动化风险高 | ANSYS、Abaqus、COMSOL、ArcGIS Pro、Quartus、Vivado、SAP ERP |

P0 不等于已经支持；它只是适合下一批验证。

## 学科软件分布

> 下面按学科列出目录里全部条目，括号内是优先级与当前支持状态。
> **只有标注「已完成最小实验 / 已实现只读检测」的条目才有真实测试记录，其余均为仅归类。**
> 授权方式、平台、控制方式和备注在 `coursepacks/software-catalog.json` 里，文档不重复。

### 1. 计算机 · 软件工程 · 人工智能

- Python（P0，已完成最小实验）
- Visual Studio Code（P0）
- Git（P0）
- Jupyter Notebook / JupyterLab（P0）
- MySQL（P0，已完成最小实验）
- Docker（P1）
- R / RStudio（P0，已完成最小实验）
- Weka（P0，已完成最小实验）
- PyCharm（P1）
- IntelliJ IDEA（P1）
- Visual Studio（P1）
- DBeaver（P1）
- Oracle VirtualBox（P0）
- TeX Live / MiKTeX（P1）

课程关联：程序设计、数据结构、数据库、操作系统、软件工程、机器学习。

> 这一组最容易先做命令行、文件、端口和最小运行验证，应作为通用能力底座。

### 2. 网络工程 · 通信工程 · 网络安全

- eNSP（P0，已实现只读检测）
- Cisco Packet Tracer（P1）
- Wireshark（P0）
- Kali Linux（P1）
- GNS3（P1）
- H3C HCL 模拟器（P1）
- Oracle VirtualBox（P0）

课程关联：计算机网络、网络安全、通信原理、路由交换、渗透测试。

> eNSP 是首个已验证案例；商业化模拟器和虚拟机依赖授权镜像，不能分发镜像文件。

### 3. 电子 · 电气 · 自动化 · 嵌入式

- NI Multisim（P1）
- Proteus（P1）
- Keil MDK / µVision（P1）
- Intel Quartus Prime（P2）
- AMD/Xilinx Vivado（P2）
- NI LabVIEW（P2）
- Logisim / Logisim Evolution（P0）
- Altium Designer（P1）
- LTspice（P0，已完成最小实验）
- 立创EDA（P1）
- ModelSim（P2）

课程关联：电路分析、模拟电子、数字电子、单片机、EDA、信号与系统。

> GUI 仿真软件版本和库文件差异大，先做安装检测、版本采集和示例工程启动测试。

### 4. 机械 · 车辆 · 航空

- SOLIDWORKS（P2）
- AutoCAD（P1）
- ANSYS（P2）
- Abaqus（P2）
- CATIA（P2）
- Siemens NX（P2）
- PTC Creo（P2）
- Fusion 360（P1）
- COMSOL Multiphysics（P2）

课程关联：机械设计、工程力学、有限元、流体力学、车辆工程。

> 授权成本高、安装体积大，需优先识别已有校园授权和许可证服务器。

### 5. 土木 · 建筑 · 城乡规划 · 测绘

- Autodesk Revit（P1）
- SketchUp（P1）
- STAAD.Pro（P2）
- ArcGIS Pro（P2）
- QGIS（P0）
- AutoCAD（P1）
- PKPM（P1）
- 盈建科（P2）
- 广联达（P2）
- SAP2000（P2）
- ETABS（P2）
- MIDAS Civil / Gen（P2）
- PLAXIS（P2）
- Lumion（P2）
- Rhino + Grasshopper（P1）
- AutoCAD Civil 3D（P2）
- EPA SWMM（P0，已完成最小实验）
- EPANET（P0，已完成最小实验）
- 南方 CASS（P2）
- Autodesk 3ds Max（P2）

课程关联：建筑制图、BIM、结构力学、城乡规划、地理信息系统。

> BIM 与 GIS 软件对显卡、许可证和文件版本敏感，课程包应强绑定模板版本。

### 6. 化学 · 化工 · 材料

- ChemDraw / ChemOffice（P1）
- Origin / OriginPro（P1）
- Gaussian（P2）
- VESTA（P1）
- Aspen Plus（P2）
- Python（P0，已完成最小实验）
- Materials Studio（P2）
- MDI Jade（P2）
- Avogadro（P1）
- VASP（P2）
- LAMMPS（P2）
- OVITO（P1）
- Aspen HYSYS（P2）
- COMSOL Multiphysics（P2）

课程关联：有机化学、分析化学、物理化学、化工原理、计算材料。

> 计算化学与过程模拟往往依赖服务器、队列和许可证，桌面端只应负责准备与结果整理。

### 7. 生物 · 食品 · 农林 · 生态

- ImageJ / Fiji（P0，已完成最小实验）
- PyMOL（P1）
- MEGA（P1）
- QIIME 2（P2）
- R / RStudio（P0，已完成最小实验）
- Python（P0，已完成最小实验）
- GraphPad Prism（P1）
- SnapGene（P2）
- DPS 数据处理系统（P1）
- SAS（P1）
- Zotero（P0）

课程关联：生物化学、分子生物学、微生物、生态学、食品分析、生物信息。

> 序列数据库和分析流程版本变化快，必须记录数据库版本与参数，不能只记软件名。

### 8. 医学 · 护理 · 药学 · 公共卫生

- 3D Slicer（P0）
- OsiriX / Horos（P2）
- FSL（P2）
- ImageJ / Fiji（P0，已完成最小实验）
- IBM SPSS Statistics（P1）
- R / RStudio（P0，已完成最小实验）
- GraphPad Prism（P1）
- SAS（P1）
- RadiAnt DICOM Viewer（P0）
- Complete Anatomy（P2）
- SPM（P2）
- NoteExpress（P0）
- CAJViewer（P0）
- Zotero（P0）

课程关联：系统解剖、医学影像、生理学、护理实训、流行病学、药学。

> 医学数据隐私要求最高；真实病例影像不得默认上传，匿名化和本地保存应成为默认。

### 9. 经济 · 金融 · 会计 · 管理

- IBM SPSS Statistics（P1）
- Stata（P1）
- EViews（P1）
- R / RStudio（P0，已完成最小实验）
- AnyLogic（P2）
- 用友 U8（P2）
- Python（P0，已完成最小实验）
- SAS（P1）
- Power BI（P0）
- Tableau（P1）
- Wind 金融终端（P2）
- 同花顺 iFinD（P2）
- 东方财富 Choice（P2）
- UiPath（P2）
- GAMS（P2）

课程关联：计量经济学、统计学、金融分析、会计信息化、ERP、运营管理。

> 很多课程依赖于院校购买的实验平台和沙盘，不能假设学生个人电脑拥有授权。

### 10. 心理学 · 社会学 · 教育学

- E-Prime（P2）
- PsychoPy（P0）
- NVivo（P1）
- ATLAS.ti（P2）
- IBM SPSS Statistics（P1）
- R / RStudio（P0，已完成最小实验）
- Mplus（P2）
- IBM SPSS Amos（P1）
- JASP（P0）
- OpenSesame（P0）
- MAXQDA（P2）
- Kinovea（P1）

课程关联：实验心理学、认知心理学、社会调查、质性研究、教育测量。

> 刺激呈现对时间精度和硬件敏感，自动操作必须避免打断实验窗口或改变计时。

### 11. 地理 · 环境 · 地质 · 气象

- ArcGIS Pro（P2）
- QGIS（P0）
- SWAT（P2）
- HEC-RAS（P1）
- MODFLOW（P2）
- WRF（P2）
- Python（P0，已完成最小实验）
- EPA SWMM（P0，已完成最小实验）
- EPANET（P0，已完成最小实验）
- ENVI（P1）
- 南方 CASS（P2）
- Pix4Dmapper（P2）
- AERMOD（P2）

课程关联：水文学、地下水、环境建模、气象学、遥感、生态规划。

> 模型软件版本、数据坐标系和输入格式强耦合，结果必须保留参数和原始数据。

### 12. 数学 · 统计 · 物理

- MATLAB / Simulink（P2）
- Wolfram Mathematica（P2）
- LaTeX / Overleaf（P0）
- Geant4（P2）
- Python（P0，已完成最小实验）
- R / RStudio（P0，已完成最小实验）
- LAMMPS（P2）
- OVITO（P1）
- SAS（P1）
- GAMS（P2）
- JASP（P0）
- NoteExpress（P0）
- CAJViewer（P0）
- Zotero（P0）
- COMSOL Multiphysics（P2）
- Maple（P2）
- TeX Live / MiKTeX（P1）

课程关联：数值计算、数学建模、概率统计、计算物理、核物理实验。

> 优先用脚本和可复现环境；GUI 工具只用于展示或结果确认。

### 13. 新闻传播 · 数字媒体 · 艺术设计

- Adobe Photoshop（P1）
- Adobe Premiere Pro（P1）
- Blender（P0，已完成最小实验）
- Unity（P1）
- Figma（P0）
- Rhino + Grasshopper（P1）
- Adobe Illustrator（P1）
- Adobe InDesign（P2）
- Adobe After Effects（P1）
- Cinema 4D（P1）
- Autodesk Maya（P2）
- Autodesk 3ds Max（P2）
- Houdini（P2）
- Nuke（P2）
- Unreal Engine（P1）
- Adobe Audition（P2）

课程关联：摄影摄像、影视后期、动画、游戏设计、交互设计。

> 工程文件和素材体积大，自动保存截图之外还要管理版本、缓存和代理文件。

### 14. 语言 · 人文 · 法学

- AntConc（P0）
- Praat（P1）
- 北大法宝（P1）
- Westlaw / LexisNexis（P2）
- NVivo（P1）
- MAXQDA（P2）
- NoteExpress（P0）
- CAJViewer（P0）
- Zotero（P0）
- TeX Live / MiKTeX（P1）

课程关联：语料库语言学、语音学、法律检索、模拟法庭、定性研究。

> 多为网页数据库或轻量工具，重点在检索记录、引用来源和隐私，而非安装大型软件。

## 建议的适配建档顺序

> 这一节不是“安装清单”。真正的安装行为必须根据用户电脑环境和课程要求另行推荐、确认。配置适配规则见 [COMPATIBILITY_ENGINE.md](COMPATIBILITY_ENGINE.md)。

### 第一批：容易建立只读检测和版本规则

Weka、Python、Git、MySQL、Wireshark、Logisim、QGIS、ImageJ、PsychoPy、Blender、LaTeX。

这些工具大多可以命令行或脚本验证，适合先建立“发现版本 → 最小运行 → 结果证据”的通用适配骨架。

### 第二批：常见课程 GUI

Cisco Packet Tracer、Multisim、Proteus、Keil、AutoCAD、Revit、SketchUp、ChemDraw、Origin、SPSS、Stata、EViews、NVivo。

每一项先补充版本矩阵、依赖关系、安装顺序和课程文件版本，再选一个高校常见实验做指导模式，不直接承诺全自动。

### 第三批：授权、计算或硬件依赖重

ANSYS、Abaqus、COMSOL、MATLAB、LabVIEW、ArcGIS Pro、Quartus、Vivado、SAP ERP、E-Prime、FSL、WRF、SWAT、MODFLOW、Geant4。

这些软件的适配档案要记录校园许可网络、许可证服务器、显卡/内存要求、提交队列和服务器端版本，不能只写一个桌面安装包版本。

## 下一步

1. 按实际用户配置，为每一项建立版本约束、依赖顺序、冲突项和回退方案；
2. 先用只读检测判断“已装什么、版本是多少、当前是否可用”；
3. 能正常运行的环境优先保留，不为追求最新版而改动；
4. 只有经过真实启动和最小实验验证的方案，才从社区经验提升为本机已验证；
5. 未通过的项目继续保留在目录中，并写清失败原因和适用范围。

**“都学习”不是一次性把所有软件装进电脑，而是把每个软件的适用范围、版本组合、验证证据和维护状态持续记录清楚。助手要学的是配置判断和适配决策，不是盲目安装。**

## 目录资料来源

目录参考了高校实验室公开软件清单和软件官方资料，并做了课程化归类：

- 清华大学高性能计算中心软件资源：<https://hpcc.cs.tsinghua.edu.cn/jszy/rjzy.htm>
- 西北大学经济管理学院实验教学中心：<https://ems.nwu.edu.cn/info/1058/1027.htm>
- 河海大学经济与管理实验教学中心：<https://bslab.hhu.edu.cn/16713/list.htm>
- 江西农业大学经济管理综合实验中心：<https://jjglzhsyzx.jxau.edu.cn/zxhk/zxjj.htm>
- 汉口学院网络空间安全实验室：<https://sysbc.hkxy.edu.cn/2024_06/17_16/content-61392.html>
- 德国 WWU 软件清单：<https://www.wwu.de/NWZ/en/Angebot/Software/Softwareliste/index.html>
- PsychoPy 官方：<https://www.psychopy.org/>
- NVivo 中文站：<https://www.nvivo.cn/>
- Autodesk 土木工程软件：<https://autodesk.com.cn/industry/civil-engineering>

资料用于确定“常见软件范围”，不代表任何学校课程或版本组合已经验证。最终以实际课程指导书、授权方式和目标机器测试为准。

## 相关文档

- [SOFTWARE_BY_MAJOR.md](SOFTWARE_BY_MAJOR.md)：按学科门类整理的「需要在电脑上安装并动手操作」的软件清单，带授权、平台标注和适配优先级建议，用于判断哪些专业值得优先适配。
- [COMPATIBILITY_ENGINE.md](COMPATIBILITY_ENGINE.md)：配置适配与版本选择的判断规则。
