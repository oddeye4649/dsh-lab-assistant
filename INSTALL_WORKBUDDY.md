# 在 WorkBuddy 里安装（给 Agent 的执行指令）

**用户把本仓库链接发给你、说「按这个链接装一下」时，按下面步骤做。**
这份文档是写给 **WorkBuddy 里的 Agent** 的，不是给用户手动照抄的命令清单；用户手动装看文末「附：手动安装」。

目标：装好 ① MCP 适配器（25 个工具，对话里可直接调用）和 ② 桌面启动器（桌宠 + 「实验助手」面板 + 本地 API）。两者共用同一份实验档案。

```
https://github.com/oddeye4649/dsh-lab-assistant
```

## 硬性要求

- **不要改仓库源码**，不要提交任何东西回仓库。
- **不要覆盖**用户已有的 `~/.workbuddy/mcp.json` 里的其他 `mcpServers` 条目，只追加 `lab-assistant` 一条。
- **不要写死任何绝对路径**（尤其不要写 `D:\lab-assistant`）；所有路径用你实际 clone 出来的目录。
- 每一步做完再报结果；**没验证成功的步骤不要说成已完成**。

## 步骤

### 1. 前置检查

```bash
node --version
```

要求 **>= 22**（`package.json` 里 `engines.node >= 22`）。不满足就告诉用户先装 Node 22，别继续硬装。

Windows 才支持桌宠面板；**非 Windows 只做 MCP 部分，跳过第 4 步**，并如实说明桌宠不可用。

### 2. 拿代码

```bash
git clone https://github.com/oddeye4649/dsh-lab-assistant.git <仓库目录>
```

`<仓库目录>` 建议放在用户主目录下（例如 `~/dsh-lab-assistant`）。公开仓库，不需要账号。
确认这几个文件都在：`package.json`、`mcp/server.mjs`、`desktop/start.mjs`、`overlay/LabPet.cs`。

### 3. 配置 MCP

读 `~/.workbuddy/mcp.json`；文件不存在就新建 `{"mcpServers": {}}`。在 `mcpServers` 里**追加**：

```jsonc
"lab-assistant": {
  "command": "node",
  "args": ["<仓库目录>/mcp/server.mjs"],
  "env": {}
}
```

- Windows 路径请用**正斜杠**（`C:/Users/.../dsh-lab-assistant/mcp/server.mjs`）。
- 只有 `node` 不在 PATH 时，才把 `command` 换成 node.exe 的绝对路径。
- 告诉用户：**重启 WorkBuddy → 连接器页面找到 `lab-assistant` → 点「信任」**，否则不会生效。

### 4. 启动桌面启动器（仅 Windows）

先看是不是已经在跑：

```bash
node "<仓库目录>/desktop/start.mjs" --status
```

返回 `"running": false` 就用宿主的**后台任务机制**启动它（不要用会一直阻塞前台的方式）：

```bash
node "<仓库目录>/desktop/start.mjs"
```

首次启动会自动编译桌宠（系统自带 .NET Framework `csc.exe`，约几秒），之后桌面出现大肥鱼，任务栏右下角多一个托盘图标：

- 左键双击 / 右键「打开实验助手面板」→ 面板和 DSH 里一样，能点着建实验、导模板、生成报告。
- 右键「开机自动启动」→ 可勾选，**默认关闭**，勾选才写用户级注册表 Run 项（不需要管理员）。
- 右键「退出实验助手」→ 桌宠、面板、本地 API 一起干净退出。

停止服务用 `node "<仓库目录>/desktop/start.mjs" --stop`。

启动器在跑时，MCP 会**自动把工具调用转发给它**，由它作为唯一的数据写入点，避免对话和面板同时改同一份档案时互相覆盖。启动器没开时 MCP 会独立运行，功能一样可用。

### 5. 验证（必须做完再回复用户）

1. `node "<仓库目录>/desktop/start.mjs" --status` → `"running": true`（非 Windows 跳过）。
2. 用户点完「信任」后，**新开一个对话**，让它列出 `lab-assistant` 的工具 → 应有 **25 个**。
3. 说「用实验助手看一下当前状态」→ 能返回状态对象，不是「找不到工具」。
4. 说「帮我建一个实验档案，标题《安装自测》」→ 返回 `ok: true` 和实验 ID。
5. 若 Windows 且启动器在跑，打开面板刷新一下，应能看到刚建的那条实验（证明两边是同一份档案）。

任何一步失败，如实告诉用户卡在哪一步、报什么错，不要含糊带过。

## 边界（必须告诉用户）

- 数据默认只在本机 `~/.dsh/lab-assistant`，可用 `LAB_ASSISTANT_HOME` 改；**不上传、不跨用户共享**。
- 桌宠面板只有 Windows；Mac / Linux 只能用 MCP 那 25 个工具。
- **指位高亮、UIA 控件树、PrintWindow 截图、逐步引导**这些依赖 DSH 宿主的能力，在 WorkBuddy 下不可用；面板里的建实验 / 模板 / 报告 / 设置都可用。
- 插件不代替用户点击软件，不编造实验数据，报告里的正文是标了「需核对」或【待补】的草稿。

架构与文件归属见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，对话用法见 [README.md](README.md) 的「在 WorkBuddy 里使用」章节。

---

## 附：手动安装（用户自己看）

不想让 Agent 代劳的话，四步：

1. 装 Node 22+，`git clone` 上面的链接。
2. 在 `~/.workbuddy/mcp.json` 的 `mcpServers` 里追加第 3 步那条配置。
3. 重启 WorkBuddy → 连接器页面点「信任」。
4. 双击/后台运行 `node <仓库目录>/desktop/start.mjs`，桌宠和面板就出来了。

第一次用可以在对话里直接说：

> 用实验助手（lab-assistant）帮我做《XXX》实验：先读标准流程，然后建实验档案，导入我给的模板文件，最后按老师模板生成报告草稿。
