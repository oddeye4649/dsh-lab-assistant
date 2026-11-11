# 干净环境首次运行验证（2026-11-10）

> 目标：验证「别人的机器从零装 DSH + 插件」是否可复现。
> 结论：**插件打包、加载、首次编译、桌宠启动全部通过**；真正的 Windows 虚拟机因镜像下载受限未完成，见「限制」。

## 0.15.8 端到端复测（2026-11-10）

- 干净 `DSH_HOME` 加载 0.15.8：状态 `0.15.8`，`frames` swim 8 / dash 3
- `POST /dsh-lab/api/experiments` 建档案成功（`exp-20261110-072652-ka01`）
- `POST /dsh-lab/api/report/generate`（`useBuiltin:true`）返回 `ok:true`，生成：
  - `干净环境测试实验-20261110.md`（1195 B）
  - `干净环境测试实验-20261110.docx`（3007 B）
  - `reports/handoff.md`
- 说明：报告链路在 core 重构后仍正常，`pending` 6 项按预期返回

## 环境

- Windows 10 Home China（当前用户，非管理员）
- DSH 桌面版 0.15.x（`D:\dsh`），使用其内置 CLI
- 全新 `DSH_HOME`：`D:\lab-assistant\temp\clean-test\dsh-home`（空目录起步）
- 插件包：`dsh-lab-assistant-0.15.6.tgz`（`npm pack` 重新生成）

## 步骤与结果

| 步骤 | 结果 |
| --- | --- |
| `dsh plugin --profile web add <tgz>` | **失败**：pnpm 全局 store 在 `D:\MoveToD\02-DevCaches\pnpm-store`，被权限/沙箱拒绝（EPERM） |
| 手工解包到 `profiles/web/node_modules/dsh-lab-assistant` 并写入 bundle 列表 | 成功 |
| `dsh --profile web --dump-config` | 成功识别：`# == dsh-lab-assistant` / `id: lab-assistant` / `config: enabled, displayName, petSize` |
| `dsh --profile web --port 3987` 启动 | 成功 |
| `GET /dsh-lab/api/status` | `ok:true`，version `0.15.6`，默认设置正确，实验数 0 |
| 桌宠首次编译 | 成功：`<DSH_HOME>/lab-assistant/overlay/LabPet.exe`，仅 CS0169/CS0649 警告 |
| 桌宠进程启动 | 成功：`LabPet.exe` 运行，约 135 MB |

## 发现的问题（0.15.7 已修）

1. **`assetStatus()` 仍按单张 `swim.png` 判断** → 已改为「单张或 `动作_序号`」，并返回 `frames`。验证：`swim.png: true`、`frames.swim = 8`、`frames.dash = 3`。
2. **插件包携带预编译 `overlay/LabPet.exe`** → `files` 已排除 `overlay/*.exe`、`*.pdb`、`*.log`；0.15.7 的 tgz 中确认无 exe，干净 profile 下重新编译成功。
3. **pnpm 全局 store EPERM** → 已写进 README「安装排错」，给出 profile 级 `.npmrc` 覆盖 `store-dir` 的做法。

## 限制（未验证）

- **不是真正的 Windows 虚拟机**：仍是当前用户/同一台机器，无法验证缺失 .NET/字体/杀软策略
- **DSH 本身未重装**：用的是已安装的 `D:\dsh`，只验证了插件在全新 DSH_HOME 下的安装与加载
- **未装 eNSP**：只读探测未验证
- **未改 DPI**：150% 缩放下的面板/气泡未验证
- 虚拟机方案受阻：微软官方 ISO 实测 ~30KB/s，5.4GB 约 50 小时；本机无 `install.wim/esd`，也无 Windows VM
  - **2026-11-11 更正**：30KB/s 是个例，已作废。官方静态 CDN 实测 1.14 MB/s（4 并发无提升，出口代理锁总带宽），5.4 GB 约 82 分钟。速度不再是阻碍，剩的是虚拟机选型（家庭版无 Hyper-V/Sandbox）与系统级驱动变更的批准。

## 建议下一步

1. 修 `assetStatus()` 的素材判断（`swim_*` 通配）
2. `package.json` 的 `files` 排除 `overlay/*.exe`，强制用户机器首次编译
3. 在安装文档中补充 pnpm store 权限排错
4. 等有可用 ISO/VM 时，再补「真·干净系统 + eNSP + 150% DPI」三项验证
