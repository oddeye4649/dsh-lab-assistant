#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""dsh-lab-assistant 安全与稳定性补丁（可重复执行，正则锚点，抗缩进变化）

修 creator 模式审出的 6 项：
  P0  校验命令白名单（不再对任意命令开放）
  P1  截图 out 路径限制 + PrintWindow 失败时用屏幕拷贝兜底 + 最小化先恢复
  P1  校验命令异步读双管道 + 15 秒超时 kill（防桌宠假死）
  P1  连接读写超时 + 请求体上限
  P2  指引坐标默认与截图/点击一致（整窗）
  P2  config.json 原子写

用法：python apply-0.14.3-security.py [仓库根目录]   # 默认 D:\\lab-assistant
"""
import io
import os
import re
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else r"D:\lab-assistant"
CS = os.path.join(ROOT, "overlay", "LabPet.cs")

applied, skipped, failed = [], [], []


def apply(label, pattern, repl, sentinel=None):
    if not os.path.exists(CS):
        failed.append((label, "LabPet.cs 不存在"))
        return
    s = io.open(CS, encoding="utf-8").read()
    if sentinel and sentinel in s:
        skipped.append(label)
        print("[SKIP] %s（已应用）" % label)
        return
    m = re.search(pattern, s, re.S)
    if not m:
        # 已应用判定：repl 里的特征串已存在
        probe = re.sub(r"\\\d", "", repl)[:40]
        if probe and probe in s:
            skipped.append(label)
            print("[SKIP] %s（已应用）" % label)
        else:
            failed.append((label, "锚点未找到"))
            print("[FAIL] %s —— 锚点未找到" % label)
        return
    new_text = m.expand(repl) if "\\" in repl else repl
    s = s[:m.start()] + new_text + s[m.end():]
    io.open(CS, "w", encoding="utf-8", newline="").write(s)
    applied.append(label)
    print("[OK]   %s" % label)


# ───────────────── P0：校验命令白名单 ─────────────────
WHITELIST = '''// 本机 HTTP 不能被当成任意命令执行口：只放行常见实验/开发命令
        private static readonly string[] VerifyAllowed = new string[]
        {
            "mysql", "mysqladmin", "mysqldump", "python", "py", "pip", "git", "dotnet",
            "java", "javaw", "node", "npm", "dir", "type", "findstr", "echo", "ver", "whoami", "ping",
        };

        private static bool VerifyCommandAllowed(string command)
        {
            string text = (command ?? "").Trim();
            if (text.Length == 0) return false;
            int space = text.IndexOf(' ');
            string exe = (space > 0 ? text.Substring(0, space) : text).Trim('"');
            string bare = System.IO.Path.GetFileNameWithoutExtension(exe);
            foreach (string allow in VerifyAllowed)
            {
                if (string.Equals(bare, allow, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static string RunVerify(string command)
        {
            if (!VerifyCommandAllowed(command))
            {
                return "ERR 命令不在白名单内，已拒绝：" + (command ?? "");
            }
            try
            {
'''
apply("P0 校验命令白名单",
      r"private static string RunVerify\(string command\)\s*\{\s*try\s*\{",
      WHITELIST,
      sentinel="VerifyCommandAllowed")

# ───────────────── P1：校验命令异步 + 超时 ─────────────────
ASYNC = '''// 两个管道都要异步读：先 ReadToEnd(stdout) 再读 stderr，输出 >4KB 会互相等死
                    var output = new System.Text.StringBuilder();
                    var errorText = new System.Text.StringBuilder();
                    process.OutputDataReceived += delegate (object sender, System.Diagnostics.DataReceivedEventArgs e)
                    { if (e.Data != null) lock (output) output.AppendLine(e.Data); };
                    process.ErrorDataReceived += delegate (object sender, System.Diagnostics.DataReceivedEventArgs e)
                    { if (e.Data != null) lock (errorText) errorText.AppendLine(e.Data); };
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                    if (!process.WaitForExit(15000))
                    {
                        try { process.Kill(); } catch { }
                        return "ERR 校验命令超时（15 秒），已终止：" + command;
                    }
                    string outputText;
                    lock (output) lock (errorText) outputText = output.ToString() + errorText.ToString();
                    return outputText;'''
apply("P1 校验命令异步读+超时",
      r"string output = process\.StandardOutput\.ReadToEnd\(\) \+ process\.StandardError\.ReadToEnd\(\);\s*process\.WaitForExit\(15000\);\s*return output;",
      ASYNC,
      sentinel="BeginOutputReadLine")

# ───────────────── P1：截图 out 路径限制 ─────────────────
LIMIT_NEW = '''if (string.IsNullOrEmpty(output))
              {
                  return new Dictionary<string, object> { { "ok", false }, { "error", "缺少 out 保存路径" } };
              }
              // 只允许写到临时目录、实验 screenshots 目录或配置目录，避免任意文件被覆盖成 PNG
              string fullOut = null;
              try { fullOut = Path.GetFullPath(output); } catch { fullOut = null; }
              if (fullOut == null) return new Dictionary<string, object> { { "ok", false }, { "error", "out 路径非法" } };
              bool outAllowed = fullOut.IndexOf("screenshots", StringComparison.OrdinalIgnoreCase) >= 0
                  || fullOut.StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase)
                  || fullOut.StartsWith(Path.GetFullPath(Program.Config.Dir), StringComparison.OrdinalIgnoreCase);
              if (!outAllowed) return new Dictionary<string, object> { { "ok", false }, { "error", "out 必须位于临时目录、实验 screenshots 目录或配置目录内" } };
              output = fullOut;'''
apply("P1 截图 out 路径限制",
      r'if \(string\.IsNullOrEmpty\(output\)\)\s*\{\s*return new Dictionary<string, object> \{ \{ "ok", false \}, \{ "error", "缺少 out 保存路径" \} \};\s*\}',
      LIMIT_NEW,
      sentinel="string fullOut = null;")

# ───────────────── P1：PrintWindow 失败兜底 ─────────────────
FALLBACK = '''IntPtr hdc = graphics.GetHdc();
                  bool rendered = Native.PrintWindow(handle, hdc, Native.PW_RENDERFULLCONTENT);
                  graphics.ReleaseHdc(hdc);
                  if (!rendered)
                  {
                      // 最小化或被遮挡时 PrintWindow 会失败：恢复窗口 + 屏幕拷贝兜底，避免交出白图
                      Native.EnsureRestored(handle);
                      System.Threading.Thread.Sleep(250);
                      try { graphics.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height)); }
                      catch { }
                  }'''
apply("P1 PrintWindow 失败兜底",
      r"IntPtr hdc = graphics\.GetHdc\(\);\s*Native\.PrintWindow\(handle, hdc, Native\.PW_RENDERFULLCONTENT\);\s*graphics\.ReleaseHdc\(hdc\);",
      FALLBACK,
      sentinel="bool rendered = Native.PrintWindow")

# ───────────────── P1：连接超时 + 体上限 ─────────────────
apply("P1 连接读写超时",
      r"(using \(client\)\s*using \(var stream = client\.GetStream\(\)\))",
      "client.ReceiveTimeout = 10000;\n                client.SendTimeout = 10000;\n                \\1",
      sentinel="client.ReceiveTimeout = 10000;")

apply("P1 请求体上限 2MB",
      r"ms\.Length > 65536\) break;",
      "ms.Length > 2097152) break;   // 头部+体总上限 2MB，避免被塞爆内存",
      sentinel="2097152")

# ───────────────── P2：指引坐标默认整窗 ─────────────────
apply("P2 指引坐标默认整窗",
      r'bool useClient = !payload\.ContainsKey\("client"\) \|\| Convert\.ToBoolean\(payload\["client"\]\);',
      '''// 与 screenshot / click 保持一致：默认按整窗算，截图量出来的坐标可直接用
            bool useClient = payload.ContainsKey("client") && Convert.ToBoolean(payload["client"]);''',
      sentinel="&& Convert.ToBoolean(payload[\"client\"])")

# ───────────────── P2：config 原子写 ─────────────────
apply("P2 config 原子写",
      r"File\.WriteAllText\(file, Program\.Json\.Serialize\(data\)\);",
      '''string temp = file + ".tmp";
                   File.WriteAllText(temp, Program.Json.Serialize(data));
                   if (File.Exists(file)) File.Replace(temp, file, null);
                   else File.Move(temp, file);''',
      sentinel="File.Replace(temp, file, null)")

# ───────────────── P0b：校验命令的环境变量由 DSH 传入（口令不落盘、不进命令行）─────────────────
apply("P0b 教学口令字段",
      r'private static string tutorialClaimFile = "";',
      '''private static string tutorialClaimFile = "";
        // 由 DSH 通过 /tutorial 的 env 传入（如 MYSQL_PWD）；只在内存里，不写文件、不进命令行
        private static readonly Dictionary<string, string> tutorialEnv = new Dictionary<string, string>();''',
      sentinel="tutorialEnv = new Dictionary")

apply("P0b 解析 env",
      r'tutorialClaimFile = Get\(payload, "claimFile"\);',
      '''tutorialClaimFile = Get(payload, "claimFile");
            tutorialEnv.Clear();
            var envMap = payload.ContainsKey("env") ? payload["env"] as Dictionary<string, object> : null;
            if (envMap != null)
            {
                foreach (var kv in envMap)
                {
                    if (kv.Key == null) continue;
                    tutorialEnv[kv.Key] = kv.Value == null ? "" : Convert.ToString(kv.Value);
                }
            }''',
      sentinel="envMap = payload.ContainsKey")

apply("P0b 传给子进程",
      r'StandardErrorEncoding = System\.Text\.Encoding\.UTF8,\s*\};',
      '''StandardErrorEncoding = System.Text.Encoding.UTF8,
                };
                // 只把 DSH 显式传入的变量写给子进程（口令走内存，不进命令行）
                foreach (var envItem in tutorialEnv)
                {
                    try { info.EnvironmentVariables[envItem.Key] = envItem.Value; } catch { }
                }''',
      sentinel="只把 DSH 显式传入的变量写给子进程")

print()
print("=" * 60)
print("已应用 %d 项，跳过 %d 项，失败 %d 项" % (len(applied), len(skipped), len(failed)))
if failed:
    print("未能自动应用的（需人工看一下）：")
    for label, why in failed:
        print("  - %s：%s" % (label, why))
if applied:
    print("\n改完请编译：")
    print(r"  csc -target:winexe -langversion:latest -r:System.Windows.Forms.dll -r:System.Drawing.dll "
          r"-r:System.Web.Extensions.dll -r:UIAutomationClient.dll -r:UIAutomationTypes.dll "
          r"-r:WindowsBase.dll -win32manifest:overlay\app.manifest -out:LabPet.exe overlay\LabPet.cs")
