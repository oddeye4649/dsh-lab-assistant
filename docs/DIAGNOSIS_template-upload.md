# 故障诊断：「上传模板一直失败」

- 报告时间：2026-11-11
- 影响范围：桌面面板「模板库 → 导入…」
- 修复版本：0.15.24
- 结论：**三个独立缺陷叠加**。其中第一个让上传 100% 失败；后两个让「上传成功」也等于没用。

---

## 一、复现方式（不是靠读代码猜的）

在测试宿主里起真实的 HTTP 服务，按面板实际发出的请求打一遍：

```text
GET  /dsh-lab/api/report/templates          -> 200 {"ok":true,"templates":[]}
POST /dsh-lab/api/report/templates          -> 404 {"ok":false,"error":"接口不存在"}   ← 面板走这条
POST /dsh-lab/api/report/template           -> 200 {"ok":true,"template":{...}}        ← 后端只认这条
```

面板因此显示：

```text
模板导入失败：远程服务器返回错误: (404) 未找到。
```

---

## 二、根因 1：面板与后端的路径不一致（必然失败）

| 位置 | 实际写法 |
| --- | --- |
| `overlay/LabPet.cs` → `ImportTemplate()` | `Api("POST", "/report/templates", body)`（复数） |
| `index.js` 路由 | `if (req.method === 'POST' && pathname === '/dsh-lab/api/report/template')`（单数） |

面板的 `ApiBase` 是 `http://127.0.0.1:<port>/dsh-lab/api`，拼出来的就是
`/dsh-lab/api/report/templates`。后端只注册了单数 POST，请求落到兜底分支返回 404。

`Api()` 内部 `GetResponse()` 遇到 404 会抛 `WebException`，被 catch 成
`{ok:false,error:"远程服务器返回错误: (404) 未找到。"}`，所以面板只显示这一句，
看不出是路径问题。

**同一批路径里只有这一处不一致**（其余 8 条 GET/POST/DELETE 都能对上），
所以症状是「只有模板上传坏，别的按钮都好」。

**修复**：`index.js` 的模板 GET/POST 同时接受单数与复数。
保留单数是为了不破坏已有调用方；面板侧不用改、也不用重新编译 exe。

---

## 三、根因 2：面板绑定的模板被字段白名单丢掉（上传成功也没用）

面板 `CreateExperiment()` 写的是：

```csharp
{ "reportTemplate", templateBox.Text.Trim() },   // 值其实是模板库里的 ID
```

而 `ExperimentStore.createExperiment()` 的 manifest 只收
`reportTemplate`（240 字符文本），没有 `templateId` 字段 —— 这一层没问题。

问题在后面：`reportPlanFor()` 取模板时只认

```js
let profile = args.templateId ? loadTemplate(...) : null
if (args.templatePath) profile = importTemplate(...)
```

**从不读实验档案里的 `reportTemplate`。** 于是：

```text
导入模板 → 新建实验（reportTemplate = tpl-xxx）
→ 会话里说「生成报告」（agent 只传 experimentId）
→ hasTemplate = true（因为 reportTemplate 非空）
→ profile 却是 builtinProfile()  ← 内置 7 章节
→ 生成成功、不报错、格式全错
```

实测对比（同一份 4 章节的老师模板）：

| 场景 | plan.sections |
| --- | --- |
| 修复前 | 一、实验目的 / 二、实验环境与器材 / 三、实验步骤 / 四、实验结果与数据 / 五、结果分析 / 六、问题与解决 / 七、实验总结（内置） |
| 修复后 | 一、实验目的 / 二、实验原理 / 三、实验步骤 / 四、实验结果（老师模板） |

这比直接报错更糟：用户以为模板生效了，交上去才发现格式对不上。

**修复**：

1. `store` 新增一等字段 `templateId`（建/改/克隆都带）。
2. `core.experimentCreate` 把 `templateId` 与 `reportTemplate` 当互为别名，一起写入档案。
3. `core.reportPlanFor` 的模板查找顺序改为：
   `args.templateId` → `args.templatePath` → `experiment.templateId` → `experiment.reportTemplate`
   最后这一项支持按 ID / 名称 / 源文件路径匹配，文件存在时自动导入。
4. `templateMissing` 改为「**只有真加载到模板**才算有」，模板被删掉后会如实回到 `needTemplate:true`，
   不再假装有模板。

---

## 四、根因 3：正文编号步骤被误判成章节

`promoteHeadings()` 用 `HEADING_TEXT_RE` 把编号段落提升为标题，规则里
`\S{2,40}` 不允许空格，导致判定不一致：

| 文本 | 旧行为 |
| --- | --- |
| `1. 打开 eNSP。` | 正文（因含空格逃过正则） |
| `2. 拖入交换机。` | **标题**（不含空格，被提升） |

真实 Word 模板（python-docx 生成、含 4 个 Heading1 + 编号正文）实测解析出 **5 个章节**，
多出来的假章节是「2. 拖入交换机。」，会让报告结构错位、正文被切断。

**修复**：数字编号且以 `。；;！？` 结尾的段落不再提升为标题。
修复后同一份模板解析为 4 章节，`1. 打开 eNSP。` 和 `2. 拖入交换机。` 都正确归入「三、实验步骤」的正文提示。

（`3. 完成配置` 这类不带句号的编号段落仍有歧义，维持原判定，不做激进改动。）

---

## 五、边界情况实测

| 场景 | 结果 |
| --- | --- |
| 中文 + 空格文件名 `实验报告模板 （计网） .docx` | 正常导入，落盘名 `实验报告模板-（计网）-xxxxxx.json` |
| 同一文件重复导入 | 生成不同 ID，不覆盖旧模板 |
| 损坏的 docx | `不是有效的 zip/docx 文件` |
| 传 `.pdf` | `只支持 .docx、.md、.txt 模板` |
| 文件不存在 | `找不到模板文件：<路径>` |
| 模板被删除后再生成 | `templateMissing:true` + `needTemplate:true`（不再静默出通用报告） |

---

## 六、回归测试

| 测试 | 位置 | 钉住什么 |
| --- | --- | --- |
| 面板复数路径导入必须成功 | `test/knowledge-host.test.mjs` | 真实 HTTP：`POST /report/templates` 返回 200，且 GET 列表能查到 |
| 面板绑定的模板必须真被用上 | `test/core.test.mjs` | 档案里只写 `reportTemplate` 时，plan 章节必须是老师模板的，不是内置 7 节；模板删掉后回到 `needTemplate` |

全量：**73 单测 / 3 自检 / catalog 自检** 全绿。

---

## 七、如果用户仍报同类问题，按这个顺序查

1. `POST /dsh-lab/api/report/templates` 返回什么状态码（404 = 版本没更新到 0.15.24）。
2. 模板库目录里有没有 `report-templates/*.json`（没有 = 导入没落盘）。
3. 实验档案 `experiments/<id>/experiment.json` 里 `templateId` / `reportTemplate` 是否有值。
4. `lab_report_plan` 返回的 `sections` 与模板章节是否一致（不一致 = 又回到了内置模板）。
5. 面板日志/状态栏原文：`接口不存在` 是路由问题，`(404) 未找到` 是面板收到的结果，
   `只支持 .docx…` 是格式问题，`不是有效的 zip/docx` 是文件损坏。
