# 面板与后端契约（基础功能回归依据）

> 背景：0.15.24 修掉的「上传模板一直失败」，根因不是业务逻辑，而是**面板发的请求和后端注册的接口对不上**。
> 这类问题读代码很难发现（两边各自都「看起来对」），必须在真实 HTTP 层验证。
> 本文固定面板的每个按钮对应哪条接口、读哪些字段，作为以后加按钮/改字段的检查清单。

---

## 一、面板发出的 9 条调用（唯一事实来源）

`overlay/LabPet.cs` 里所有 `Api(method, path, body)` 调用，`ApiBase` 是
`http://127.0.0.1:<port>/dsh-lab/api`（仅本机 + token）。

| # | 面板动作 | 方法 + 路径 | 请求体关键字段 | 面板读取的响应字段 |
| --- | --- | --- | --- | --- |
| 1 | 刷新列表 | `GET /status` | - | `experimentsDir` |
| 2 | 刷新列表 | `GET /experiments` | - | `experiments[]`，每项 `id/title/status/totalSteps/currentStep/updatedAt/workDir` |
| 3 | 创建实验 | `POST /experiments` | `title/course/software/mode/datasetPath/reportTemplate` | `ok`、`error`、`experiment.title` |
| 4 | 模板下拉 | `GET /report/templates` | - | `templates[]`，每项 `id/name` |
| 5 | 导入模板 | `POST /report/templates` | `path` | `ok`、`error`、`template.id/name` |
| 6 | 删除模板 | `DELETE /report/templates/<id>` | - | `ok`、`error` |
| 7 | 删除实验 | `DELETE /experiments/<id>` | - | `ok`、`error` |
| 8 | 保存设置 | `PUT /settings` | `dataDir` | `ok`、`error`、`experimentsDir` |
| 9 | 生成报告（遗留） | `POST /report/generate` | `experimentId/templateId/templatePath/requirementPath/useBuiltin` | `ok`、`error`、`files.docx`、`placeholderCount` |

**注意**：面板当前**没有**「生成报告」按钮（`GenerateReport()` 只有定义没有调用），
报告在设计上是在对话里生成的。第 9 条保留是为了不破坏旧面板/未来入口。

---

## 二、容易踩的三类坑

### 1. 单数 / 复数路径

后端历史上有 `/report/template`（单数，POST 导入）和 `/report/templates`（复数，GET 列表、DELETE 删除）。
面板发的是复数。0.15.24 起 **GET 与 POST 都同时接受两种写法**，新增调用方随便用哪个都行，
但**不要再引入第三个别名**。

### 2. 请求字段名

| 语义 | 面板/C# | DSH 工具 | MCP 工具 | core 内部 |
| --- | --- | --- | --- | --- |
| 实验编号 | `id`（列表行） | `id` / `experimentId` | `id` | 都认 |
| 删除实验 | `id`（URL 路径） | `experimentId` | `id`（转换后） | 都认 |
| 模板 | `reportTemplate`（值是模板 ID） | `reportTemplate` / `templateId` | 同左 | 互为别名写入档案 |

`core.experimentCreate` 会把 `templateId` 与 `reportTemplate` **互相补齐**，
`core.experimentDelete` / `experimentGet` / `experimentUpdate` 都同时接受 `id` 与 `experimentId`。

### 3. 空值覆盖

`PUT /settings { dataDir: "" }` **不会**清空已设置的数据目录（面板启动竞态时框是空的）。
要恢复默认必须显式传 `resetDataDir: true`。

---

## 三、回归怎么跑

```bash
# 1) 面板契约：真实 HTTP 打 9 条调用，逐字段断言
node temp/panel-contract.mjs

# 2) DSH 工具契约：25 个不依赖桌宠的 action 全调一遍
node temp/tools-contract.mjs

# 3) MCP 工具契约：25 个工具全调一遍
node temp/mcp-contract.mjs

# 4) 结构容错：损坏档案 / 损坏模板 / 超长文本 / 空目录
node temp/fault-tolerance.mjs

# 5) 面板 C# 5 兼容编译（旧编译器路径）
node temp/build-check.mjs
```

`temp/` 下的脚本不进发布包，属于本机验证工具；对应的固定断言已经固化进
`test/knowledge-host.test.mjs`（复数路径导入 200）和 `test/core.test.mjs`（模板绑定必须生效）。

---

## 四、面板布局约束（改卡片时看这里）

面板 `ClientSize = 620×980`（150% 下实际渲染 660×1036，WinForms 会再放大，见 P5 修复）。

| 卡片 | Top | Height | 底部 |
| --- | --- | --- | --- |
| 实验档案 `cardList` | 72 | 192 | 264 |
| 新建实验 `cardNew` | 270 | 254 | 524 |
| 模板库 `cardTpl` | 536 | 156 | 692 |
| 桌宠设置 `cardPet` | 704 | 196 | 900 |

`cardPet` 底部 900 < 980，不触发滚动。**加控件必须同时调后面的 Top**，
否则会像 0.15.23 之前那样：新建实验卡片下半部分被模板库卡片盖住 60px（实测）。

---

## 五、本轮（0.15.25）修掉的基础功能问题

| 问题 | 后果 | 修法 |
| --- | --- | --- |
| `POST /experiments` 直接调 `store`，绕过 `core` | 面板新建时空 `templateId` 不落盘，之后按 ID 找模板会落空 | 改走 `core.experimentCreate` |
| `PUT /settings` 接受空 `dataDir` | 面板启动竞态时点保存会清空用户自定义目录 | 空值忽略，清空需 `resetDataDir:true` |
| `Process.Start("explorer.exe", dir)` 未加引号 | 路径含空格（OneDrive/自定义目录）会打开错误位置 | `"\"" + dir + "\""` |
| 面板 4xx/5xx 只显示「(500) 内部服务器错误」 | 用户和排查都看不到真实原因 | 读 `WebException.Response` 的 JSON body |
| `cardNew` 与 `cardTpl` 重叠 60px | 新建实验卡片底部提示被盖住 | `cardTpl` 下移到 536，`cardPet` 704 |
| `nameBox` / `studentBox` 只有声明没有控件 | 面板生成的报告永远没有姓名学号 | 补控件 + 存进 `config.json`，重开面板不用重填 |
| `experimentGet` / `experimentUpdate` / `reportTemplate` 失败时抛异常 | HTTP 500，调用方拿到「未知错误」 | 统一返回 `{ok:false, error}` |
| `tutorialClaims` / `experimentGet` / `reportPlanFor` 不回退当前实验 | agent 省略编号时直接失败 | 依次回退 `experimentId → id → 当前实验` |
| `experimentDelete` 只认 `experimentId` | 传 `id` 时报「无效的实验编号」 | 两个都认 |

---

## 六、仍然存在、但已记录的限制

| 限制 | 影响 | 为什么先不动 |
| --- | --- | --- |
| `store` 写文件无锁 | 两个请求同时改同一份档案会丢更新 | 面板操作是串行点击；DSH 单会话也串行。多会话并发才触发，改动需要引入文件锁，风险大于收益 |
| `requirementBox` 仍未创建 | 面板不能选「实验要求文件」 | 对话里可以传 `requirementPath`，面板不是唯一入口 |
| `GenerateReport` / `btnGenerate` / `btnOpenReport` 是死代码 | 无 | 面板已改为对话内生成报告，删掉可能影响旧面板，保留观察 |
| MCP 与 DSH 的数据目录 | 若用户手动改过 `DSH_HOME`，两者可能不一致 | 默认都读 `~/.dsh/lab-assistant`，且 MCP 也读同一份 `settings.json` 的 `dataDir` |
