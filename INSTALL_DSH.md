# 在 DSH 里安装

**给用户的说明**：把下面这个仓库链接交给 DSH 的插件安装入口即可。

```
https://github.com/oddeye4649/dsh-lab-assistant
```

也可以用 Release 里的 `.tgz` 包安装（`dsh-lab-assistant-<版本>.tgz`）。

## 安装后会发生什么

DSH 按 `package.json` 的 `main: index.js` 加载插件，并按 `dsh.bundle.patch` 声明的 `cordis.patch.yml` 自动挂载，不用手改 profile 配置。

仓库里还带着 `mcp/`（WorkBuddy MCP 适配器）和 `desktop/`（WorkBuddy 桌面启动器），**这些文件会被一起下载，但在 DSH 下完全不加载**：不启动进程、不占端口、不写数据。DSH 只跑自己的插件本体。这是「一个链接两边各装各的」里的 DSH 那一半。

安装后：

1. 重启 DSH，桌面右下角出现大肥鱼（首次启动会自动用系统自带的 .NET Framework 编译器编译伴随进程，约几秒）。
2. 点大肥鱼 → 打开「实验助手」面板：实验档案列表、新建实验、模板库、桌宠设置。
3. **生成报告在对话里说「按要求生成实验报告」**；要对某软件做指位引导，先说「给 XX 采集页面地图」。
4. 报告落在 `<数据目录>/experiments/<实验编号>/reports/`，面板可一键打开所在文件夹。

数据目录默认 `~/.dsh/lab-assistant`，可用 `DSH_HOME` 或 `LAB_ASSISTANT_HOME` 改。

## 边界

- 桌宠、UIA 控件树、截图、点击穿透高亮这些能力依赖 DSH 桌面宿主，只有这一侧完整可用。
- 插件只读诊断环境，不代替你点击软件，不编造实验数据，不在后台安装/卸载软件。

更完整的工具与流程说明见 [README.md](README.md)，架构归属见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
