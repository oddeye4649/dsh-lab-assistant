# 代码分类与架构

一个仓库、一个链接，服务两个宿主。**目录按「共享 / DSH 专属 / WorkBuddy 专属」分开**，不是按功能混在一起。

## 三层

```
                    ┌─────────────────────────────┐
                    │  lib/   共享核心（无宿主依赖） │
                    │  store / core / report /      │
                    │  knowledge / api / overlay …  │
                    └──────────┬──────────────────┘
                 ┌──────────────┴───────────────┐
                 │                              │
      ┌──────────▼──────────┐        ┌─────────▼─────────────────┐
      │ DSH 适配器           │        │ WorkBuddy 适配器            │
      │ index.js             │        │ mcp/server.mjs   （对话入口）│
      │ cordis.patch.yml     │        │ desktop/start.mjs（桌面入口）│
      └──────────┬──────────┘        └─────────┬─────────────────┘
                 │                              │
        DSH 工具 + 网页路由            MCP 工具 / 本地 HTTP API
                 │                              │
                 └──────────────┬───────────────┘
                                │
                     ┌──────────▼───────────┐
                     │ overlay/LabPet.cs     │
                     │ 桌宠 + 「实验助手」面板 │  ← 两边共用，C# 源码只有一份
                     └──────────────────────┘
```

## 文件归属

| 目录 / 文件 | 归属 | 说明 |
|---|---|---|
| `lib/store.mjs` `lib/core.mjs` `lib/report.mjs` `lib/knowledge.mjs` `lib/anchor.mjs` … | 共享 | 档案、报告、经验库、兼容建议等全部业务能力，不依赖任何宿主 |
| `lib/api.mjs` | 共享 | 桌宠面板用的 11 条本地 HTTP 路由，从 `index.js` 的闭包抽出；外加 MCP 转发用的 `/dsh-lab/api/tool` |
| `lib/overlay.mjs` | 共享 | 编译并拉起桌宠伴随进程；`tray: true` 时给独立启动器加托盘 |
| `overlay/LabPet.cs` `overlay/app.manifest` | 共享 | WinForms 桌宠 + 面板源码，两个宿主用的是同一份，编译产物按数据目录缓存 |
| `assets/` `coursepacks/` | 共享 | 桌宠图片、图标、课程包 |
| `index.js` `cordis.patch.yml` | **DSH 专属** | 插件入口、31→1 合并工具、DSH 网页路由、bundle 挂载声明 |
| `mcp/server.mjs` | **WorkBuddy 专属** | 零依赖 JSON-RPC over stdio，25 个工具 |
| `desktop/start.mjs` | **WorkBuddy 专属** | 独立桌面启动器：本地 API + 桌宠 + 托盘 + 发现文件 |
| `scripts/` `test/` `docs/` `temp/` | 开发 | 构建、验证、文档、临时脚本；`temp/` 不进发布包 |

## 一个链接，两边各装各的

仓库不拆包，`package.json` 的 `files` 是一份白名单，两边下载到的文件完全相同。区别在于**谁加载什么**：

- **DSH**：按 `main: index.js` + `dsh.bundle.patch` 加载插件本体。`mcp/`、`desktop/` 只是文件躺着，不启动进程、不占端口。
- **WorkBuddy**：不是包管理器安装，是 Agent 读 [`INSTALL_WORKBUDDY.md`](../INSTALL_WORKBUDDY.md) 后执行 clone → 追加 `mcp.json` → 启动 `desktop/start.mjs`。所以两边给**同一个链接**就行，不需要记两个地址。

## 数据单一写入点

`ExperimentStore` 每次读整个 JSON → 改 → 原子写回，没有内存缓存也没有跨进程锁。两个进程各开一份同时写，会静默丢掉其中一次修改。

WorkBuddy 侧的解法：

1. `desktop/start.mjs` 是**唯一**持有 `store` / `core` 的进程，监听 `127.0.0.1` 随机端口 + 随机 token。
2. 它把 `{pid, port, token, version}` 写到 `<数据目录>/desktop.json`（发现文件，权限 0600）。
3. `mcp/server.mjs` 每次工具调用都读发现文件：
   - 进程活着 → 把调用转成 `POST /dsh-lab/api/tool`（方法名受 `lib/api.mjs` 的 `CORE_METHODS` 白名单约束）；
   - 文件不存在 / 进程已死 → 清掉残留并退回本地模式（此时也只有它一个写入点）；
   - **进程活着但服务无响应 → 明确报错，绝不降级本地**，否则就会造成双写。
4. 启动器退出时清发现文件、关桌宠、关 API；桌宠托盘点「退出」后启动器检测到进程结束，跟着一起收尾。

DSH 侧不受影响：插件本身就是单一进程，桌宠面板走它自己的 `ipcServer`。

## 关键约定

- **面板路由**：`/dsh-lab/api/*`，模板导入同时接受 `/report/template` 与 `/report/templates`（面板发复数，历史 bug 见 `docs/DIAGNOSIS_template-upload.md`）。
- **工具白名单**：`lib/api.mjs` 的 `CORE_METHODS` 必须与 `mcp/server.mjs` 的 `TOOLS[].method` 完全一致，由 `temp/contract-core-methods.mjs` 断言，防止新增工具时转发漏掉。
- **数据目录**：默认 `~/.dsh/lab-assistant`，`LAB_ASSISTANT_HOME` 可覆盖；DSH 与 WorkBuddy 默认共用同一批档案。
- **平台边界**：桌宠是 WinForms + .NET Framework，仅 Windows；MCP 适配器跨平台。UIA 控件树、截图、指位高亮依赖 DSH 宿主，WorkBuddy 侧不提供。
