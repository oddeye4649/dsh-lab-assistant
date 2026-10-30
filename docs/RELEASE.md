# GitHub 发布步骤

当前项目已经在本地完成源码、测试和打包准备，但远程发布需要 GitHub 仓库权限。

## 1. 创建空仓库

在 GitHub 新建一个空仓库，例如：

```text
dsh-lab-assistant
```

不要勾选自动生成 README、LICENSE 或 .gitignore。

## 2. 关联远程仓库

在 `<本仓库目录>` 执行，替换 `<owner>`：

```bash
git remote add origin https://github.com/<owner>/dsh-lab-assistant.git
git push -u origin main
```

如果已经配置了 SSH，也可以使用：

```bash
git remote add origin git@github.com:<owner>/dsh-lab-assistant.git
```

## 3. 补充仓库元数据

把实际地址加入 `package.json`：

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/<owner>/dsh-lab-assistant.git"
},
"homepage": "https://github.com/<owner>/dsh-lab-assistant#readme",
"bugs": {
  "url": "https://github.com/<owner>/dsh-lab-assistant/issues"
}
```

## 4. 发布版本

```bash
git add .
git commit -m "release: v<版本号>"
git tag v<版本号>          # 与 package.json 的 version 完全一致，例如 v0.15.0
git push origin main
git push origin v<版本号>
```

> 分支名不是 `main`（例如洗过历史、用了 `release-clean`）时，用
> `git push origin <你的分支>:main`；**不要用 `git push --all`**，那会把还没洗干净的
> 旧分支一起推上去。详见第 8 节。

推送标签后，GitHub Action 会：

1. 在 Windows 上运行测试和插件自检；
2. 执行 `npm pack`；
3. 创建 GitHub Release；
4. 上传 `dsh-lab-assistant-<版本号>.tgz`。

## 5. 上架 DSH 插件市场

DSH 桌面端的「插件市场」不是自己收条目，它每次打开都实时拉取
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的
`plugins.json`。**上架 = 去那个仓库提一个 PR，在列表里加一条**（站点与市场通常一天内收录）。

一条最低限度的条目长这样（字段名以对方仓库实际模板为准）：

```yaml
- name: dsh-lab-assistant
  owner: <你的 GitHub 账号>
  url: https://github.com/<owner>/dsh-lab-assistant
  category: workflow          # 实验流程自动化；也可考虑 tools
  description:
    zh: 面向高校实验课程的 DSH 桌宠式插件：实验档案、只读环境诊断、按报错找版本、报告引擎与桌面指引。
    en: Desktop-pet lab assistant for DSH: experiment records, read-only environment probing, version repair plans, report generation and on-screen guidance.
  npm: dsh-lab-assistant      # 走 npm 分发就填；只发 GitHub Release 则留空并填 tarball
  install: dsh plugin --profile desktop add dsh-lab-assistant
  capabilities: [shell, fs-write, fs-read, env]   # 本插件会拉起伴随进程、读写实验档案、读环境变量
```

注意两点：

- `capabilities` 要如实写。本插件会**启动一个本地伴随进程并执行校验命令**（`shell`），会写实验档案（`fs-write`），
  还会读注册表/已装软件信息（`fs-read`、`env`），没有联网行为（不写 `network`）。
- 市场里的 `install` 命令按 profile 区分：本插件只在 **Windows 桌面端**有意义，示例用 `--profile desktop`。

## 6. 安装包分发

发布后，用户可以通过 GitHub Release 下载 `.tgz`，或在 DSH 桌面端用内置 `plugin_manager` 安装该包。

如果后续发布到 npm，需要先确认包名可用，并执行：

```bash
npm publish --access public
```

npm 与 GitHub 是两条独立分发渠道；不要同时混装同名的 npm 版和 GitHub 版。

## 7. 发布前检查

```bash
npm run verify        # test + selfcheck + pack:check + publish:check
npm pack --dry-run
```

`publish:check` 做两件事：

1. **版本一致性**：`package.json` 的 `version` 必须在 `CHANGELOG.md` 里有对应的
   `## [<版本>]` 小节，否则直接失败。这是为了逼着写变更记录 —— 见下一节「为什么不能省 CHANGELOG」。
2. **敏感信息扫描**：扫「将要打进包里的文件」有没有密钥、口令、本机路径。
   只扫文本，**截图等二进制要人工看**。

同时确认：

- **版本号三处一致**：`package.json.version` = `CHANGELOG.md` 的小节 = 要推的 `git tag`（`v<版本>`）；
- README 截图和当前界面一致（曾经出现过截图还是「预览页」且带着已移除的网页注入面板）；
- 正式桌宠图已替换，manifest 指向正确；
- 版本号和 DSH 兼容范围准确；
- 没有把 API key、实验报告或个人路径打进包；
- Release 说明写清“当前仅为开发版”和未实现边界。

### 为什么不能省 CHANGELOG

`release.yml` 用 `gh release create --notes-file RELEASE_NOTES.md`，说明**从 `CHANGELOG.md` 抽当前版本小节**。

不用 `--generate-notes` 的原因很具体：`--generate-notes` 靠提交历史生成，而本项目为了洗掉历史里的
口令与个人邮箱，**把历史压成了单个提交** —— 自动生成的说明会几乎为空。

两道闸：

- 本地 / CI：`npm run publish:check` 发现「版本在 CHANGELOG 里没有小节」→ 失败；
- 发布：`release.yml` 的 `Extract release notes from CHANGELOG` 步骤抽不到 → `exit 1`，不发 Release。

### 发一版的最小流程

```bash
# 1. 改版本 + 写变更（两处必须同时改）
#    package.json 的 version
#    CHANGELOG.md 加一节：## [0.15.0] - YYYY-MM-DD
npm run verify          # 版本一致性 + 敏感扫描 + 测试全过

# 2. 提交 + 打标签（标签名必须与版本号一致）
git add -A && git commit -m "release: v0.15.0"
git tag v0.15.0

# 3. 推送（见第 8 节，只推要发布的分支）
git push origin main && git push origin v0.15.0
```

标签推上去后 `release.yml` 会：跑 verify → 抽 CHANGELOG 段落 → `npm pack` → 建 GitHub Release 并附 `.tgz`。

## 8. 推送前后：历史与远端核对

历史里的敏感信息有**两条通道**，只查第一条会漏：

```bash
# ① 文件内容（能搜到 口令这类字面量）
git log --all --oneline -S "<可疑字符串>"   # 例如硬编码的数据库口令

# ② 提交者元数据（搜不到——只在 %ae 里）
git log --all --format='%ae' | sort -u    # 出现个人邮箱就说明会随推送公开
```

本地身份建议只在本仓库覆盖，不动全局配置：

```bash
git config --local user.name  "your-name"
git config --local user.email "you@users.noreply.github.com"
```

**如果历史已经脏了**（本项目 0.14.3 前就有过：文件里有明文口令、提交者是个人邮箱）：
最省事的是**孤儿分支 + 单提交**，旧历史留在本地另存：

```bash
git bundle create <备份目录>/history.bundle --all     # 先备份，出事能取回
git checkout --orphan release-clean
git add -A && git commit -m "feat: <版本>"
git branch -m main archive-old-history                # 旧分支改名，避免误推
```

推送时**只推要发的那条分支**，别用 `--all`（会把旧历史一起推上去）：

```bash
git push -u origin release-clean:main
git tag v<版本> && git push origin v<版本>
```

推完**克隆回来自己核一遍**——本地洗干净不等于远端干净：

```bash
git clone <仓库地址> /tmp/check && cd /tmp/check
git log --format='%ae' | sort -u          # 应只有你设的中性邮箱
git grep -l "<可疑字符串>"                        # 应无输出
git log --all --oneline -S "<可疑字符串>"   # 例如硬编码的数据库口令       # 应无输出
```

最后注意：**推送 `v*` 标签会触发 `.github/workflows/release.yml`**，它会跑
`npm test` 与 `pack:check` 并创建 GitHub Release。标签打错要删，需同时删本地与远端：

```bash
git tag -d v<版本> && git push origin :refs/tags/v<版本>
```
