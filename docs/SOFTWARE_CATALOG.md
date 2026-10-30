# 跨学科实验软件知识目录

> 更新时间：2026-10-28  
> 机器可读目录：`coursepacks/software-catalog.json`  
> 当前覆盖：14 个学科方向、67 项代表软件。

## 先说清楚“学习”是什么意思

本目录不是“已支持”清单。当前 eNSP 完成了只读安装检测；Python 3.12.10、Weka 3.8.7、MySQL 8.0.46、ImageJ 1.54f 已在单台 Windows 11 x64 完成最小实验。其他软件仅完成学科归类、常见用途、授权方式和优先级整理，不能据此宣称已支持所有用户配置。

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

### 1. 计算机 · 软件工程 · 人工智能

- Python（P0）
- Visual Studio Code（P0）
- Git（P0）
- Jupyter Notebook / JupyterLab（P0）
- MySQL（P0）
- R / RStudio（P0）
- Weka（P0）
- Docker（P1）

课程关联：程序设计、数据结构、数据库、操作系统、软件工程、机器学习。

### 2. 网络工程 · 通信工程 · 网络安全

- eNSP（P0，已实现只读检测）
- Cisco Packet Tracer（P1，需 NetAcad 账号）
- Wireshark（P0）
- Kali Linux（P1，仅限授权靶场）
- GNS3（P1，依赖设备镜像授权）

课程关联：计算机网络、网络安全、通信原理、路由交换、渗透测试。

### 3. 电子 · 电气 · 自动化 · 嵌入式

- NI Multisim（P1）
- Proteus（P1）
- Keil MDK / µVision（P1）
- Intel Quartus Prime（P2）
- AMD/Xilinx Vivado（P2）
- NI LabVIEW（P2）
- Logisim / Logisim Evolution（P0）

课程关联：电路分析、模拟电子、数字电子、单片机、EDA、信号与系统。

### 4. 机械 · 车辆 · 航空

- SOLIDWORKS（P2）
- AutoCAD（P1）
- ANSYS（P2）
- Abaqus（P2）

课程关联：机械设计、工程力学、有限元、流体力学、车辆工程。

### 5. 土木 · 建筑 · 城乡规划 · 测绘

- Autodesk Revit（P1）
- AutoCAD（P1）
- SketchUp（P1）
- STAAD.Pro（P2）
- ArcGIS Pro（P2）
- QGIS（P0）

课程关联：建筑制图、BIM、结构力学、城乡规划、地理信息系统。

### 6. 化学 · 化工 · 材料

- ChemDraw / ChemOffice（P1）
- Origin / OriginPro（P1）
- Gaussian（P2）
- VESTA（P1）
- Aspen Plus / HYSYS（P2）
- Python（P0）

课程关联：有机化学、分析化学、物理化学、化工原理、计算材料。

### 7. 生物 · 食品 · 农林 · 生态

- ImageJ / Fiji（P0）
- PyMOL（P1）
- MEGA（P1）
- QIIME 2（P2）
- R / RStudio（P0）
- Python（P0）

课程关联：生物化学、分子生物学、微生物、生态学、食品分析、生物信息。

### 8. 医学 · 护理 · 药学 · 公共卫生

- 3D Slicer（P0）
- OsiriX / Horos（P2，主要面向 macOS）
- FSL（P2）
- ImageJ / Fiji（P0）
- IBM SPSS Statistics（P1）
- R / RStudio（P0）

课程关联：系统解剖、医学影像、生理学、护理实训、流行病学、药学。

注意：真实病例影像必须本地匿名化，默认不得上传。虚拟仿真平台通常是院校采购，目录未把它们误写成免费软件。

### 9. 经济 · 金融 · 会计 · 管理

- IBM SPSS Statistics（P1）
- Stata（P1）
- EViews（P1）
- R / RStudio（P0）
- AnyLogic（P2）
- 用友 U8（P2，通常为院校服务器版）
- Python（P0）

课程关联：计量经济学、统计学、金融分析、会计信息化、ERP、运营管理。

### 10. 心理学 · 社会学 · 教育学

- E-Prime（P2）
- PsychoPy（P0）
- NVivo（P1）
- ATLAS.ti（P2）
- IBM SPSS Statistics（P1）
- R / RStudio（P0）

课程关联：实验心理学、认知心理学、社会调查、质性研究、教育测量。

E-Prime 等刺激呈现软件对时间精度敏感，**不应使用通用 GUI 自动点击**，优先做环境检查、项目文件校验和数据导出验证。

### 11. 地理 · 环境 · 地质 · 气象

- ArcGIS Pro（P2）
- QGIS（P0）
- SWAT（P2）
- HEC-RAS（P1）
- MODFLOW（P2）
- WRF（P2）
- Python（P0）

课程关联：水文学、地下水、环境建模、气象学、遥感、生态规划。

### 12. 数学 · 统计 · 物理

- MATLAB / Simulink（P2）
- Wolfram Mathematica（P2）
- LaTeX / Overleaf（P0）
- Geant4（P2）
- Python（P0）
- R / RStudio（P0）

课程关联：数值计算、数学建模、概率统计、计算物理、核物理实验。

### 13. 新闻传播 · 数字媒体 · 艺术设计

- Adobe Photoshop（P1）
- Adobe Premiere Pro（P1）
- Blender（P0）
- Unity（P1）
- Figma（P0）

课程关联：摄影摄像、影视后期、动画、游戏设计、交互设计。

### 14. 语言 · 人文 · 法学

- AntConc（P0）
- Praat（P1）
- NVivo（P1）
- 北大法宝（P1）
- Westlaw / LexisNexis（P2）

课程关联：语料库语言学、语音学、法律检索、模拟法庭、定性研究。

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
