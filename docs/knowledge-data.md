# 经验闭环：采集了什么、存在哪、怎么关、怎么删

> 适用版本：0.15.15 起。全部数据**只在本机**，不上传、不跨用户共享、不进云端。
> 配套方案：[plan-knowledge-loop.md](plan-knowledge-loop.md)，实施结论见其第九节。

## 一、为什么要采集

第二次做同一软件的实验时，插件不该再让 agent 重新截图量一遍按钮位置。为此它把「哪一步指过哪个控件、成没成、上次哪里挂了」记下来，下次在 `experiment_get` 和 `desktop_guide` 里自动带上。

**采集的是指引，不是点击回放。** `guided` 模式禁止代点这条硬约束没有变化；记录里没有可自动重放的鼠标动作序列。

## 二、数据清单

所有路径都在插件的 homeDir 下（默认 `~/.dsh/lab-assistant`，可在 `lab_knowledge_settings(status)` 里看到实际路径）。

| 目录 / 文件 | 内容 | 什么时候写 | 可能含什么敏感信息 |
| --- | --- | --- | --- |
| `interface/<软件>.json` | 控件名、相对窗口的坐标、用途文本、命中/失败次数、锚点路径 | 每次成功指引、`note_add` 带控件名、`page_map_capture` | 控件名可能来自软件界面文本 |
| `interface/anchors/<软件>/<key>.png` | **只裁控件周边 + 8px**，不是整窗截图 | 主动调用 `anchor_capture` | 控件周围的少量界面像素 |
| `interface/_windows.json` | 软件名 → 最近一次 `desktop_place` 的窗口宽高 | `desktop_place` / 自动归位成功 | 无 |
| `actions/<实验编号>.jsonl` | 每次 guide / click / shot / record_result 的时间、步骤、窗口、控件名、来源、成败、耗时 | 自动，一行一条 | 步骤 ID、控件名 |
| `actions/<实验编号>.summary.json` | 归档后的聚合摘要：按控件/步骤的命中次数、时间范围；**不含坐标、不含可回放点击** | `experiment_update(status:"archived")` | 步骤 ID、控件名 |
| `actions/<实验编号>.jsonl.gz` | 上一条明细的 gzip 副本（只是额外文件，**不替换、不删除 jsonl**） | 同上 | 与明细相同 |
| `failures/<软件>.jsonl` | 失败步骤、控件名、**报错原文**、证据截图相对路径 | `record_result(passed:false)` | 报错文字、截图路径可能含姓名/学号 |
| `usage/<软件>.json` | 每个控件的命中/失败次数（可由 actions 重建） | 自动累加 | 无 |
| `report-fragments/<课程>.json` | 课程通用章节句式骨架（**禁止含数字**） | 用户主动 `report_fragment_add` | 无 |
| `report-fragments/<课程>__<软件>.json` | 该软件专属句式骨架（同样禁止含数字） | `report_fragment_add` 带 `software` | 无 |

旧的 `software-notes.json`、`guide-presets.json`、`page-maps/` 保持原样，**不迁移、不删除**，只作为导入源被读取。

实验本身的截图、报告、实测值仍在原来的 `<实验>/screenshots`、`reports`、`experiment.json` 里，不属于经验库。

## 三、怎么关

```
lab_knowledge_settings(action:"off")     # 停止一切自动写入
lab_knowledge_settings(action:"on")      # 恢复
lab_knowledge_settings(action:"status")  # 看当前状态与各目录文件数
```

也可以走本机 API：`PUT /dsh-lab/api/settings` 带 `{"autoCapture": false}`。

**开关只管自动采集**：`desktop_guide` / `desktop_click` / `desktop_screenshot` / `record_result` 触发的写入会停。用户**主动**调用 `note_add`、`anchor_capture`、`report_fragment_add`、`knowledge_settings(rebuild)` 仍然有效——那是你明确让插件记的，不该被开关挡住。

关闭后已有数据保留，不会自动删。

## 四、怎么删

关闭采集后，直接删掉对应目录即可：

| 想删什么 | 删哪个 |
| --- | --- |
| 全部经验数据 | `interface/`、`actions/`、`failures/`、`usage/`、`report-fragments/` 五个目录 |
| 某个软件的控件与锚点 | `interface/<软件>.json` 与 `interface/anchors/<软件>/` |
| 某次实验的操作记录 | `actions/<实验编号>.jsonl`、`.summary.json`、`.jsonl.gz` 三个文件一起删 |
| 失败反例 | `failures/<软件>.jsonl` |
| 热区统计 | `usage/<软件>.json`（删掉后可用 `knowledge_settings(action:"rebuild-usage")` 从 actions 重建） |

> ⚠️ **手动删目录是彻底删除，不进回收站，不可恢复。** 删之前先复制一份到别处备份。
> 插件自身不提供删除经验库的工具，也不会在你关闭采集时自动清空。

## 五、明确的边界

- **不上传**：没有任何网络请求把这些数据发出去。
- **不跨用户**：经验库随 homeDir 走，换账号不会串。
- **不写进报告正文**：句式骨架只在 `handoff.md` 与 `report_generate` 返回值里作为改写参考，报告正文仍只写档案里真实存在的实测值。
- **不伪造**：控件坐标是真实指引/采集留下的，不是模型推断的；没有坐标的控件会标 `needsRevalidate`，指引时提示重新定位。
- **不代点**：`desktop_click` 的 `force` 参数不受经验库影响，模式硬约束照旧。

## 六、已知限制

1. **L3 视觉锚点已完成真实 GUI 端到端验证**（0.15.16，两遍 15/15：真实桌宠 + Notepad / Weka 窗口 + 真实 PrintWindow PNG），并据此把打分改为 NCC。仍**未做系统级 DPI / 主题实时切换**（本轮用图像变换模拟）；这类突变下可能失效，匹配不到一定降级为整窗高亮，不会假装命中。单次匹配 0.4~1.4 秒。
2. ~~归档压缩未做~~ → **0.15.16 已做**。注意「压缩」指**信息压缩**：聚合摘要 + gzip 副本是新增文件，原始 `jsonl` 完整保留；要真正释放磁盘空间需手动删明细（彻底删除，不进回收站，先备份）。归档后又补记动作时，重新调一次 `experiment_update(status:"archived")` 会刷新摘要。
3. **面板按钮未做**：C# 桌宠面板没有加复选框，开关走工具与设置 API（本机无法编译验证面板改动）。
4. **追问次数 / 失败重复率**需要真人做两次同软件实验才能测，合成基准只能给代理指标，见 `scripts/benchmark-knowledge.mjs` 与 `temp/benchmark-knowledge/result.json`。
