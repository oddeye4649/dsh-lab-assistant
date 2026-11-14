# 实验助手插件 0.16.1 · 这次适配了 WorkBuddy

风格：趣味口语科普 · 面向零基础 · 单角色『大肥鱼』· 动作全部取自 assets/pet/
配音：zh-CN-XiaoyiNeural / rate +4% / pitch +12Hz（与 10-31 B 站演示片一致）
BGM：D:\git文件\4.mp3

## s01 [title] 开场

实验助手插件 0.16.1：这回也住进 WorkBuddy 了。

> 卡片：{"type": "big-quote", "style": "paper", "title": "实验助手 0.16.1", "body": "一个仓库 · 两个宿主 · 同一只大肥鱼"}

## s02 [solo] 开场

主人好呀，我是大肥鱼～今天讲讲实验助手插件。

## s03 [solo] 开场

你不是常说 WorkBuddy 能免费薅、所以也经常用嘛？

## s04 [solo] 开场

这回，咱们把它也适配上啦！走，看看它到底能干啥。

## s05 [demo] 插件能干啥

先说它是啥：一个管实验流程、帮写实验报告的高校实验插件。

> 卡片：{"type": "icon-list", "style": "paper", "items": ["实验档案：一次实验一份", "真实结果：只记你做过的", "报告生成：照老师模板来"]}

## s06 [demo] 插件能干啥

一次实验一个档案，能创建、能恢复，删了还进回收站。

> 卡片：{"type": "checklist", "style": "note", "items": ["创建 / 列表 / 读取 / 更新", "克隆实验，重复做不用重填", "删除移入 _trash，可恢复"]}

## s07 [demo] 插件能干啥

做过的结果如实记进去：实测值、通过没通过、截图路径。

> 卡片：{"type": "icon-list", "style": "window", "items": ["实测值", "通过 / 失败", "截图路径", "失败会变成本机反例"]}

## s08 [emphasis] 插件能干啥

报告里的数字只能来自真实记录，它不会替你编数据。

> 卡片：{"type": "big-quote", "style": "note", "title": "加速，但不编造", "body": "没有实测，就没有数字", "stamp": "硬规则"}

## s09 [focus] 插件能干啥

老师发的 Word 模板能导入，生成 Word 加 Markdown 两份报告。

> 卡片：{"type": "before-after", "style": "paper", "before": "老师给的 .docx / .md 模板", "after": "自动填好环境·步骤·截图 + Word / Markdown"}

## s10 [emphasis] 插件能干啥

缺的实测值、班级教师这些，留【待补】，不会瞎填。

> 卡片：{"type": "big-quote", "style": "note", "title": "【待补】", "body": "个人信息与真实测量值，留给你自己填", "stamp": "要核对"}

## s11 [empty] WorkBuddy 适配

好，基础能力摆这儿。这次的重点是——

## s12 [demo] WorkBuddy 适配

一个仓库、一个 GitHub 链接，DSH 和 WorkBuddy 各装各的那一半。

> 卡片：{"type": "before-after", "style": "paper", "before": "同一个 GitHub 链接", "after": "DSH 装插件本体 · WorkBuddy 配 MCP + 桌面启动器"}

## s13 [focus] WorkBuddy 适配

WorkBuddy 的对话入口是 25 个 MCP 工具，装上要在连接器里点一下信任。

> 卡片：{"type": "icon-list", "style": "window", "items": ["零依赖 JSON-RPC over stdio", "配好 ~/.workbuddy/mcp.json", "连接器页面点『信任』才生效", "建档案 / 模板 / 报告 / 笔记都能对话里做"]}

## s14 [demo] WorkBuddy 适配

桌面入口是个启动器：桌宠、面板、托盘都在，开机自启默认关。

> 卡片：{"type": "checklist", "style": "paper", "items": ["只监听 127.0.0.1 + 随机 token", "右键托盘：开面板 / 自启 / 退出", "--status / --stop 管理进程"]}

## s15 [focus] WorkBuddy 适配

面板能刷新、建档案、导模板、改设置；生成报告得在对话里喊工具。

> 卡片：{"type": "web-shot", "style": "polaroid", "src": "docs/screenshots/panel.png", "annotation": "真实面板截图 · 报告生成按钮并不在面板上"}

## s16 [emphasis] WorkBuddy 适配

关键在这：启动器开着时，MCP 会把调用转发过去，WorkBuddy 内部只有一个写入点。

> 卡片：{"type": "big-quote", "style": "note", "title": "转发，不是双写", "body": "桥活着却没响应会明确报错，不静默降级", "stamp": "重点"}

## s17 [focus] WorkBuddy 适配

两边共用同一份实验数据，默认放在用户目录里，看到的是同一批档案。

> 卡片：{"type": "before-after", "style": "paper", "before": "DSH 插件", "after": "WorkBuddy MCP → 同一份档案"}

## s18 [focus] 硬边界与实话

桌宠和面板只有 Windows 有；Mac、Linux 就只有那 25 个工具。

> 卡片：{"type": "before-after", "style": "paper", "before": "Windows：桌宠 + 面板 + 25 工具", "after": "Mac / Linux：只有 25 个 MCP 工具"}

## s19 [focus] 硬边界与实话

DSH 那边还多一套 GUI 本事：指路、真实截图、白名单校验、教学回执。

> 卡片：{"type": "web-shot", "style": "polaroid", "src": "docs/screenshots/guide.png", "annotation": "真实指引截图 · UIA 定位 + 高亮 + PrintWindow 截图"}

## s20 [emphasis] 硬边界与实话

别误会，140 项软件目录只是能认出来，不等于都支持。

> 卡片：{"type": "big-quote", "style": "note", "title": "目录 ≠ 已支持", "body": "认得出软件名，不代表跑得通实验", "stamp": "注意"}

## s21 [focus] 硬边界与实话

真跑过最小实验的 13 项，只读诊断的 1 项，其余 126 项还只是目录条目。

> 卡片：{"type": "icon-list", "style": "window", "items": ["13 项 verified-run · 单台 Win11 x64 最小实验", "1 项 verified-diagnose · eNSP 只读", "126 项 catalog-only · 仅能识别"]}

## s22 [demo] 硬边界与实话

还有几件实话：不自动更新、不后台装软件、数据不出本机。

> 卡片：{"type": "checklist", "style": "paper", "items": ["插件没有自动更新，也没新版本提醒", "兼容建议只是建议，不替你装", "经验库与热区只留在这台电脑"]}

## s23 [solo] 收尾

想用就 clone 仓库或下 Release 包，配一次 MCP，再启动桌面启动器。

> 卡片：{"type": "icon-list", "style": "note", "items": ["git clone 或 Release .tgz", "配 mcp.json 并点信任", "启动 desktop/start.mjs"]}

## s24 [ending] 收尾

主人，下次做实验，让大肥鱼陪你一起记，报告就不慌啦～

