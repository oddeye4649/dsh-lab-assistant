// 按「验证成本」给目录里尚未实测的软件分档，生成 docs/VERIFICATION_DIFFICULTY_RANKING.md
// 用法：node scripts/rank-verify-difficulty.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CAT = join(ROOT, 'coursepacks', 'software-catalog.json')
const OUT = join(ROOT, 'docs', 'VERIFICATION_DIFFICULTY_RANKING.md')

const data = JSON.parse(readFileSync(CAT, 'utf8'))
const rows = data.software.filter((s) => s.support !== 'verified-run')

// ---------------- 评分维度 ----------------
const cliScore = (c) => {
  const v = String(c).toLowerCase()
  if (v.includes('web') && !v.includes('cli')) return 3
  if (v.includes('cli')) return 0
  if (/(script|python|api|java|tcl|syntax)/.test(v)) return 1
  return 2
}
const LIC = {
  0: ['free', 'open-source', 'freeware', 'free/commercial-terms', 'free/commercial', 'free/commercial-gui', 'open-source/web', 'open-source/commercial-build'],
  1: ['account/free-tier', 'free/registration', 'commercial/free-edition', 'commercial/open-source-variant'],
  2: ['campus/vendor', 'commercial/campus', 'campus/subscription', 'account/campus'],
  3: ['subscription', 'vendor'],
}
const licScore = (l) => {
  const v = String(l).toLowerCase()
  for (const [k, list] of Object.entries(LIC)) if (list.includes(v)) return Number(k)
  return 2
}
const platScore = (ps) => {
  const p = ps.join(' ').toLowerCase()
  if (p.includes('web') && !p.includes('windows')) return 3
  if (p.includes('虚拟机')) return 3
  if (p.includes('windows')) return 0
  if (p.includes('linux')) return 2
  return 1
}
const HEAVY = ['三维CAD', 'BIM', '有限元', '结构分析', '工程制图', '化工流程模拟', '三维动画', '三维建模',
  '数值计算与仿真', '视频剪辑', '建筑渲染', '量子化学', '粒子输运仿真', '气象模式', '水力学模型',
  '排水管网模拟', 'FPGA/EDA', '电路设计与PCB', '分子动力学', '材料模拟']
const MID = ['GIS', '遥感', '统计', '数据分析', '图像处理', '数据库', '分子可视化', '序列分析',
  '晶体结构', '医学影像', 'DICOM', '交互式计算', '系统仿真', '计量', '网络仿真', '网络抓包',
  '电路仿真', '电路与单片机', '数字逻辑', '嵌入式', '行为实验', '测试测量', '流程自动化', '造价',
  '结构计算', '岩土', '地形地籍', '摄影测量', '实景建模', '大气扩散']
const sizeScore = (cat) => (HEAVY.some((k) => cat.includes(k)) ? 2 : MID.some((k) => cat.includes(k)) ? 1 : 0)
const PRI = { P0: 0, P1: 1, P2: 2 }

// 授权可得性：决定「能不能开始」，比难度更硬
const AVAIL = {
  free: '直接下载', 'open-source': '直接下载', freeware: '直接下载',
  'free/commercial': '直接下载', 'free/commercial-terms': '直接下载', 'free/commercial-gui': '直接下载',
  'open-source/web': '直接下载', 'open-source/commercial-build': '直接下载（开源版）',
  'account/free-tier': '需注册账号', 'free/registration': '需注册账号',
  'commercial/free-edition': '有免费试用版', 'commercial/open-source-variant': '有免费试用版',
  'campus/vendor': '需院校授权', 'commercial/campus': '需院校授权',
  'campus/subscription': '需院校授权', 'account/campus': '需院校授权',
  subscription: '需订阅', vendor: '需厂商授权',
}
const availOf = (l) => AVAIL[String(l).toLowerCase()] || '需院校授权'
const tierOf = (n) => (n <= 2 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : 5)

// ---------------- 人工修正（机器分排错的） ----------------
const OVERRIDE = {
  wireshark: [4, '要装 Npcap 驱动，需管理员；抓包还要求网卡权限。CLI 再强也过不了驱动这关'],
  docker: [3, 'Windows 上要 WSL2/Hyper-V，基本等同管理员 + 重启'],
  virtualbox: [3, '要装虚拟网卡驱动，与 Hyper-V 冲突，需管理员'],
  unity: [4, '安装器数 GB 且必须登录 Unity ID 才有授权'],
  gns3: [4, '需要设备镜像 + 虚拟机，镜像本身不能分发'],
  'kali-linux': [5, '本质是虚拟机镜像，不是「装个软件」'],
  geant4: [4, '要自己编译 C++ 并配数据包，构建时间以小时计'],
  qiime2: [3, 'conda/Linux 环境，装起来比用起来难'],
  antconc: [3, '纯 GUI，没有可判定的输出，只能验「能启动 + 能截图」'],
  cajviewer: [4, '纯 GUI 阅读器，无任何可自动判定的产物'],
  psychopy: [4, '时间精度必须在真机显示器上实测，pip 依赖链也长'],
  eprime: [4, '毫秒级刺激呈现，绝不能用通用 GUI 自动化去操作'],
  labview: [4, '要装运行时 + 仪器驱动，且需要真实硬件才能验出东西'],
  'cisco-packet-tracer': [4, '要 NetAcad 账号才能下载'],
  ensp: [4, '依赖 VirtualBox + 虚拟网卡驱动，需管理员'],
  vasp: [5, '只能在 Linux 集群跑，本地装不了'],
  fsl: [4, 'Linux/WSL 专属，且要 FSL 数据包'],
  wrf: [5, '气象模式，需要 MPI + 编译 + 大量地形数据'],
  pymol: [2, 'Windows 开源版要走 conda/wheel，不是普通安装包'],
  qgis: [2, 'qgis_process 可判定，但安装包 1GB+ 且官网版本定位不稳'],
  '3d-slicer': [2, '可用 Python 控制台脚本化，但包体 1GB+'],
   praat: [2, '有 Praat 脚本可批处理音频，判定可靠'],
   zotero: [3, 'GUI 为主，但数据库是 SQLite，可间接校验'],
  vscode: [2, '`code --version` 能验，但离「课程可用」还差扩展与调试配置'],
  modflow: [2, 'CLI 强，但输入文件多、需配套预处理工具'],
  'latex-overleaf': [5, 'Overleaf 是网页服务；本地等价的 TeX Live 单独列为 T1'],
  figma: [5, '纯网页协作工具，没有本地可验证产物'],
  'pkulaw': [5, '网页数据库，只能验检索，不该做桌面自动化'],
  'westlaw': [5, '同上，且依赖院校订阅 IP'],
  'yonyou-u8': [4, '通常是院校服务器版，学生端只是浏览器'],
  lumion: [4, '纯 GUI + 吃显卡，无 CLI 可判定'],
  'complete-anatomy': [4, '订阅制教材类应用，无实验可做'],
}

const BLOCKED = new Set(['需院校授权', '需订阅', '需厂商授权'])
const HUGE = new Set(['jasp', 'unreal-engine', 'unity', '3d-slicer', 'qgis', 'arcgis-pro', 'pix4d'])

const scored = rows.map((s) => {
  const base = cliScore(s.control) + licScore(s.license) + platScore(s.platforms) +
    (PRI[s.priority] ?? 2) + sizeScore(s.category)
  const ov = OVERRIDE[s.id]
  return {
    id: s.id, name: s.name, pri: s.priority, cat: s.category, control: s.control,
    license: s.license, plat: s.platforms.join('/'),
    score: base, tier: tierOf(base),
    finalTier: (() => {
      if (ov) return ov[0]
      let t = tierOf(base)
      // 拿不到许可 / 包体过大，无论算多少分都不能算「中等」
      if (BLOCKED.has(availOf(s.license))) t = Math.max(t, 3)
      if (HUGE.has(s.id)) t = Math.max(t, 3)
      return t
    })(),
    why: ov ? ov[1] : '',
    adjusted: Boolean(ov),
  }
})

const TIER_DEF = {
  1: { label: 'T1 · 容易', time: '20~40 分钟', how: '免安装或小安装 + 有 CLI/批处理 + 输出可数值判定', rule: '能写一条命令、能比一个数，就能验', reach: '可进 verify，有数值/文本断言' },
  2: { label: 'T2 · 中等', time: '40~90 分钟', how: '免费但要装、或有 CLI 但输入文件复杂、或包体 1GB 级', rule: '能验，但要先准备输入样本', reach: '可进 verify，需自备输入样本' },
  3: { label: 'T3 · 偏难', time: '1.5~3 小时', how: '需校园授权 / 纯 GUI 只能验"启动+截图" / 中等体积', rule: '多半只能验到 diagnosed，验不出数值', reach: '多数只能到 verified-diagnose' },
  4: { label: 'T4 · 困难', time: '3~6 小时', how: '要驱动或内核组件、要许可服务器、体积巨大、或需特定硬件', rule: '先把"装得上"验清楚，别指望跑通实验', reach: '多半只能验"装得上/能启动"' },
  5: { label: 'T5 · 不建议自动化', time: '不排期', how: '网页服务、Linux 集群专属、或时间精度敏感', rule: '做只读识别即可，不投入验证', reach: '不投入，保持 catalog-only' },
}

const byTier = new Map()
for (const s of scored) {
  const t = s.finalTier
  if (!byTier.has(t)) byTier.set(t, [])
  byTier.get(t).push(s)
}

const lines = []
lines.push('# 软件验证难度分级')
lines.push('')
lines.push('> 目的：验证成本差异极大——有的 20 分钟能出数值断言，有的要装驱动、要许可服务器、要 Linux 集群。')
lines.push('> 这份表用来排后续测试批次，避免「挑了个最难的先做」。')
lines.push('')
lines.push('> 生成方式：`node scripts/rank-verify-difficulty.mjs`（按 catalog 字段自动计算 + 人工修正表）。')
lines.push('')
lines.push('## 一、评分口径')
lines.push('')
lines.push('总分 = CLI 可判定性 + 授权门槛 + 平台可得性 + 优先级 + 体积/依赖，再映射到 T1~T5。')
lines.push('')
lines.push('| 维度 | 0 分 | 1 分 | 2 分 | 3 分 |')
lines.push('| --- | --- | --- | --- | --- |')
lines.push('| CLI 可判定性 | 有 `cli` / 批处理 | 有脚本/API 入口 | 纯 GUI | 纯网页 |')
lines.push('| 授权门槛 | 免费/开源 | 免费但要注册/教育版 | 校园授权 | 订阅制/需许可服务器 |')
lines.push('| 平台可得性 | 有 Windows 版 | 其他 | 仅 Linux | 仅网页/仅虚拟机 |')
lines.push('| 优先级 | P0 | P1 | P2 | — |')
lines.push('| 体积/依赖 | 轻 | 中（GIS/统计/影像） | 重（CAD/CAE/三维/EDA） | — |')
lines.push('')
lines.push('**分数线**：≤2 → T1，3~4 → T2，5~6 → T3，7~8 → T4，≥9 → T5。')
lines.push('')
lines.push('> 机械打分只能当**初排**。比如 Wireshark 的 `control` 是 `cli/gui`、授权是开源，算出来 T1，但它要装 Npcap 驱动，实际是 T4。所以下面附了人工修正表。')
lines.push('')

lines.push('## 二、五档总览')
lines.push('')
lines.push('| 档 | 含义 | 单个耗时 | 能验到什么 | 判定原则 |')
lines.push('| --- | --- | --- | --- | --- |')
for (const t of [1, 2, 3, 4, 5]) {
  const d = TIER_DEF[t]
  const n = (byTier.get(t) || []).length
  lines.push(`| **${d.label}**（${n} 个） | ${d.how} | ${d.time} | ${d.reach} | ${d.rule} |`)
}
lines.push('')

const availCount = {}
for (const s of scored) {
  const a = availOf(s.license)
  availCount[a] = (availCount[a] || 0) + 1
}
lines.push('## 二·补 授权可得性（比难度更硬的约束）')
lines.push('')
lines.push('| 授权可得性 | 条目数 | 含义 |')
lines.push('| --- | --- | --- |')
for (const [k, v] of Object.entries(availCount).sort((a, b) => b[1] - a[1])) {
  const note = k === '直接下载' ? '本机可直接下载，能马上验'
    : k === '需注册账号' ? '要注册/登录，通常几分钟'
    : k === '有免费试用版' ? '有学生版或试用，需要申请'
    : k === '需院校授权' ? '**没有校园许可就验不了**，除非找到试用版'
    : k === '需订阅' ? '**订阅制，本机拿不到**'
    : k === '直接下载（开源版）' ? '开源版可直接下载，但功能有删减'
    : '需联系厂商'
  lines.push(`| ${k} | ${v} | ${note} |`)
}
lines.push('')
lines.push('> 这一栏决定「能不能开工」。131 个里有相当一部分是校园授权软件——**没有许可就等于验不了**，不是难度问题。')
lines.push('')

lines.push('## 三、按档清单')
for (const t of [1, 2, 3, 4, 5]) {
  const items = (byTier.get(t) || []).slice().sort((a, b) => a.pri.localeCompare(b.pri) || a.name.localeCompare(b.name, 'zh'))
  if (!items.length) continue
  lines.push('')
  lines.push(`### ${TIER_DEF[t].label}（${items.length} 个）`)
  lines.push('')
  lines.push('| 软件 | 优先级 | 类别 | 控制方式 | **授权可得性** | 平台 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const s of items) {
    const mark = s.adjusted ? ' ⚠️' : ''
    const a = availOf(s.license)
    const aMark = a === '需院校授权' || a === '需订阅' || a === '需厂商授权' ? `**${a}**` : a
    lines.push(`| ${s.name}${mark} | ${s.pri} | ${s.cat} | \`${s.control}\` | ${aMark} | ${s.plat} |`)
  }
}
lines.push('')

lines.push('## 四、人工修正表（机器排错的地方）')
lines.push('')
lines.push('| 软件 | 机器分档 | 修正后 | 原因 |')
lines.push('| --- | --- | --- | --- |')
for (const s of scored.filter((x) => x.adjusted).sort((a, b) => a.finalTier - b.finalTier)) {
  lines.push(`| ${s.name} | T${s.tier} | **T${s.finalTier}** | ${s.why} |`)
}
lines.push('')

lines.push('## 五、建议的测试批次')
lines.push('')
lines.push('每批 3 个，同档内选，避免一批里既有 20 分钟也有 6 小时的。')
lines.push('')
const batches = [
  ['第 1 批（T1）', ['TeX Live / MiKTeX', 'Jupyter Notebook / JupyterLab', 'Git']],
  ['第 2 批（T2 起步）', ['QGIS', 'Praat', 'MODFLOW']],
  ['第 3 批（T2 中段）', ['3D Slicer', 'PyMOL', 'GAMS']],
  ['第 4 批（T3 授权类）', ['IBM SPSS Statistics', 'Stata', 'Origin / OriginPro']],
  ['第 5 批（T3 CAD 类）', ['AutoCAD', 'SketchUp', 'ChemDraw / ChemOffice']],
  ['第 6 批（T4 重型）', ['SOLIDWORKS', 'ANSYS', 'Autodesk Revit']],
]
for (const [label, names] of batches) {
  lines.push(`- **${label}**：${names.join('、')}`)
}
lines.push('')
lines.push('> 批次只是建议。真正开工时按「同档里挑体积最小、授权最简单」的原则重新选，因为同档内部差异仍然很大。')
lines.push('')

lines.push('## 六、不排期的（T5）')
lines.push('')
lines.push('这些做**只读识别**就够了，不值得投入验证成本：')
lines.push('')
for (const s of (byTier.get(5) || [])) lines.push(`- **${s.name}**：${s.why || '网页服务或环境依赖不可控'}`)
lines.push('')

writeFileSync(OUT, lines.join('\n'), 'utf8')

const dist = [1, 2, 3, 4, 5].map((t) => `T${t}=${(byTier.get(t) || []).length}`).join(' ')
console.log(`已生成 ${OUT}`)
console.log(`未验证条目 ${scored.length}：${dist}`)
console.log(`人工修正 ${scored.filter((s) => s.adjusted).length} 条`)
