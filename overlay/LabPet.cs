// LabPet 桌面伴随进程（P0）
// 编译目标：.NET Framework 4.x（系统自带），单文件 WinForms。
// 能力：透明置顶桌宠（可拖动、可点开设置）、全屏点击穿透高亮层、
//       气泡文字、UIA 窗口/控件定位、PrintWindow 截图、本机 HTTP 控制接口。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Timer = System.Windows.Forms.Timer;

namespace LabPet
{
    internal static class Program
    {
        internal static Config Config;
        internal static PetForm Pet;
        internal static HighlightForm Highlight;
        internal static BubbleForm Bubble;
        internal static JavaScriptSerializer Json = new JavaScriptSerializer();
        internal static PanelForm Panel;
        internal static string ApiBase = "";
        internal static string ApiToken = "";
        internal static string PetPath = "";

        [STAThread]
        internal static void Main(string[] args)
        {
            int port = 0; string token = ""; string petPath = ""; string configDir = "";
            for (int i = 0; i < args.Length - 1; i++)
            {
                switch (args[i])
                {
                    case "--port": int.TryParse(args[i + 1], out port); break;
                    case "--token": token = args[i + 1]; break;
                    case "--pet": petPath = args[i + 1]; break;
                    case "--config": configDir = args[i + 1]; break;
                    case "--api": ApiBase = args[i + 1]; break;
                    case "--apitoken": ApiToken = args[i + 1]; break;
                }
            }
            if (port <= 0 || string.IsNullOrEmpty(token) || !File.Exists(petPath) || string.IsNullOrEmpty(configDir))
            {
                return; // 静默退出：参数由插件负责，缺参不弹窗打扰用户
            }
            Program.PetPath = petPath;
            Config = new Config(configDir, petPath);
            Server.Start(port, token);
            Highlight = new HighlightForm();
            Highlight.Show();
            Highlight.Hide();
            Bubble = new BubbleForm();
            Bubble.Show();
            Bubble.Hide();
            Pet = new PetForm(petPath);
            Application.Run(Pet);
        }

        internal static void InvokeOnPet(Action action)
        {
            if (Pet == null || Pet.IsDisposed) return;
            if (Pet.InvokeRequired) Pet.BeginInvoke(action);
            else action();
        }

        // 需要“取回值”时用同步版本：BeginInvoke 只是投递，Status() 会在回调执行前就返回，拿到的永远是空对象。
        internal static void InvokeOnPetSync(Action action)
        {
            if (Pet == null || Pet.IsDisposed) return;
            try
            {
                if (Pet.InvokeRequired) Pet.Invoke(action);
                else action();
            }
            catch { /* 桌宠正在关闭时忽略 */ }
        }

        internal static void TogglePanel(int petLeft, int petTop, int petSize)
        {
            if (Panel == null || Panel.IsDisposed) Panel = new PanelForm();
            if (Panel.Visible) { Panel.Hide(); return; }
            var area = Screen.FromControl(Pet).WorkingArea;
            // WinForms 首次显示时会按 DPI/字体自动缩放窗体（本机实测被压到 2/3），
            // 所以先按字面算出目标尺寸并摆好位置，Show() 之后再按字面赋一次。
            int wantW = Math.Min(620, area.Right - area.Left - 16);
            int wantH = Math.Min(980, area.Bottom - area.Top - 16);
            int x = petLeft - wantW - 10;
            if (x < area.Left + 8) x = petLeft + petSize + 10;
            x = Math.Max(area.Left + 8, Math.Min(x, area.Right - wantW - 8));
            int y = Math.Max(area.Top + 8, Math.Min(petTop, area.Bottom - wantH - 8));
            Panel.Location = new Point(x, y);
            Panel.Show();
            Panel.ClientSize = new Size(wantW, wantH);
            Panel.RefreshList();
        }

        // 桌宠挡住目标时自动挪开：挑离目标中心最远的角落，避免遮住要点的按钮
        internal static void MovePetAwayFrom(Rectangle target)
        {
            try
            {
                var pet = Pet;
                if (pet == null || pet.IsDisposed || !pet.Visible) return;
                var petRect = new Rectangle(pet.Left, pet.Top, pet.Width, pet.Height);
                if (!petRect.IntersectsWith(target)) return;
                var area = Screen.FromRectangle(target).WorkingArea;
                int cx = target.Left + target.Width / 2;
                int cy = target.Top + target.Height / 2;
                bool targetOnRight = cx > area.Left + area.Width / 2;
                bool targetOnBottom = cy > area.Top + area.Height / 2;
                int x = targetOnRight ? area.Left + 40 : area.Right - pet.Width - 40;
                int y = targetOnBottom ? area.Top + 40 : area.Bottom - pet.Height - 40;
                pet.Location = new Point(x, y);
            }
            catch { /* 让位失败不阻断操作 */ }
        }

        // 再养一只桌宠（纯吉祥物）：用空闲端口另起一个进程，共用同一份配置目录
        internal static void SpawnAnotherPet()
        {
            try
            {
                int port;
                var probe = new TcpListener(IPAddress.Loopback, 0);
                probe.Start();
                try { port = ((IPEndPoint)probe.LocalEndpoint).Port; }
                finally { probe.Stop(); }

                var args = new StringBuilder();
                args.Append("--port ").Append(port);
                args.Append(" --token ").Append(Guid.NewGuid().ToString("N"));
                args.Append(" --pet \"").Append(PetPath).Append('"');
                if (Config != null && !string.IsNullOrEmpty(Config.Dir))
                    args.Append(" --config \"").Append(Config.Dir).Append('"');
                if (!string.IsNullOrEmpty(ApiBase))
                {
                    args.Append(" --api ").Append(ApiBase);
                    args.Append(" --apitoken ").Append(ApiToken);
                }
                Process.Start(new ProcessStartInfo(Application.ExecutablePath, args.ToString())
                {
                    UseShellExecute = false,
                    WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory,
                });
            }
            catch { }
        }

        // 关闭「这一只」桌宠：只结束当前进程，不影响同时存在的其它桌宠
        internal static void QuitThisPet()
        {
            try { if (Panel != null && !Panel.IsDisposed) Panel.Close(); } catch { }
            new Thread(delegate () { Thread.Sleep(120); Application.Exit(); }).Start();
        }
    }

    internal class Config
    {
        public string name = "主人";
        public int petSize = 240;
        public bool hidden = false;
        public bool chatter = true;
        public bool wander = true;
        public int x = -1, y = -1;

        private readonly string file;
        internal string Dir;

        internal Config(string dir, string petPath)
        {
            Dir = dir ?? AppDomain.CurrentDomain.BaseDirectory;
            file = Path.Combine(Dir, "config.json");
            try
            {
                if (File.Exists(file))
                {
                    var loaded = Program.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file));
                    if (loaded != null)
                    {
                        if (loaded.ContainsKey("name")) name = Convert.ToString(loaded["name"]);
                        if (loaded.ContainsKey("petSize")) petSize = Convert.ToInt32(loaded["petSize"]);
                        if (loaded.ContainsKey("hidden")) hidden = Convert.ToBoolean(loaded["hidden"]);
                        if (loaded.ContainsKey("chatter")) chatter = Convert.ToBoolean(loaded["chatter"]);
                        if (loaded.ContainsKey("wander")) wander = Convert.ToBoolean(loaded["wander"]);
                        if (loaded.ContainsKey("x")) x = Convert.ToInt32(loaded["x"]);
                        if (loaded.ContainsKey("y")) y = Convert.ToInt32(loaded["y"]);
                    }
                }
            }
            catch { }
            if (petSize < 96) petSize = 96;
            if (petSize > 320) petSize = 320;
        }

        internal void Save()
        {
            try
            {
                var data = new Dictionary<string, object>
                {
                    { "name", name }, { "petSize", petSize }, { "hidden", hidden }, { "chatter", chatter }, { "wander", wander }, { "x", x }, { "y", y }
                };
                string temp = file + ".tmp";
                   File.WriteAllText(temp, Program.Json.Serialize(data));
                   if (File.Exists(file)) File.Replace(temp, file, null);
                   else File.Move(temp, file);
            }
            catch { }
        }
    }

    // 面板视觉：柔和蓝白配色，贴近大肥鱼桌宠的风格。
    internal static class Ui
    {
        internal static readonly Color Bg = Color.FromArgb(238, 246, 255);
        internal static readonly Color Card = Color.White;
        internal static readonly Color Border = Color.FromArgb(223, 234, 247);
        internal static readonly Color Accent = Color.FromArgb(96, 150, 214);
        internal static readonly Color AccentDark = Color.FromArgb(49, 92, 150);
        internal static readonly Color Text = Color.FromArgb(43, 58, 85);
        internal static readonly Color Muted = Color.FromArgb(126, 142, 166);
        internal static readonly Color Soft = Color.FromArgb(232, 243, 255);
        internal static readonly Color BubbleBg = Color.FromArgb(243, 249, 255);
        internal static readonly Color BubbleBorder = Color.FromArgb(164, 202, 240);
        internal static readonly Color BubbleText = Color.FromArgb(28, 58, 92);
        internal static readonly Color HeaderFrom = Color.FromArgb(88, 146, 214);
        internal static readonly Color HeaderTo = Color.FromArgb(146, 192, 240);

        internal static GraphicsPath Rounded(Rectangle rect, int radius)
        {
            var path = new GraphicsPath();
            int d = Math.Max(4, radius * 2);
            if (d > rect.Width) d = rect.Width;
            if (d > rect.Height) d = rect.Height;
            path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
            path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
            path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
            path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }
    }

    internal class PillButton : Button
    {
        internal bool Outline;
        private bool hover;

        internal PillButton()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
                | ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            ForeColor = Color.White;
            Font = new Font("Microsoft YaHei UI", 9f);
            Cursor = Cursors.Hand;
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            var rect = new Rectangle(0, 0, Width - 1, Height - 1);
            Color fill;
            Color text;
            if (Outline)
            {
                fill = hover ? Color.FromArgb(235, 243, 252) : Color.White;
                text = Ui.AccentDark;
            }
            else
            {
                fill = hover ? Color.FromArgb(112, 166, 226) : Ui.Accent;
                text = Color.White;
            }
            using (var path = Ui.Rounded(rect, Math.Min(10, Height / 2)))
            {
                using (var brush = new SolidBrush(fill)) e.Graphics.FillPath(brush, path);
                if (Outline)
                {
                    using (var pen = new Pen(Color.FromArgb(199, 219, 242))) e.Graphics.DrawPath(pen, path);
                }
            }
            TextRenderer.DrawText(e.Graphics, Text, Font, rect, text,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        }
    }

    internal class CardPanel : Panel
    {
        internal CardPanel()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
                | ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            var rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using (var path = Ui.Rounded(rect, 14))
            {
                using (var brush = new SolidBrush(Ui.Card)) e.Graphics.FillPath(brush, path);
                using (var pen = new Pen(Ui.Border)) e.Graphics.DrawPath(pen, path);
            }
            base.OnPaint(e);
        }
    }

    internal class PetForm : Form
    {
        private readonly Dictionary<string, List<Image>> frames = new Dictionary<string, List<Image>>();
        private readonly Stopwatch dragWatch = new Stopwatch();
        private ContextMenuStrip menu;
        private readonly Random rng = new Random();
        private readonly Timer tick = new Timer();
        private readonly string[] chatterLines = new string[]
        {
            "主人，今天做哪个实验呀？",
            "点我一下就能打开实验助手哦～",
            "记得把实测值记下来，报告才不会空着～",
            "我就待在这儿陪你，不吵你。",
            "做实验前先看看软件版本对不对，能少踩很多坑。",
            "要生成报告的话，先在列表里选一份实验哦。",
            "截图我会帮你存进实验档案里～",
            "累了就休息一下，实验不着急。",
        };
        // 每个待机小动作的专属台词，动作开始时随机说一句。
        private static readonly Dictionary<string, string[]> activityLines = new Dictionary<string, string[]>
        {
            { "drink", new string[] { "喝口咖啡，提提神～", "这个马克杯是鲸鱼图案的，可爱吧？" } },
            { "typing", new string[] { "我在帮你整理实验数据呢～", "键盘敲起来哒哒哒，好解压。" } },
            { "read", new string[] { "翻翻实验指导书，别漏了步骤。", "书里这段好像老师强调过。" } },
            { "stretch", new string[] { "坐久了要伸个懒腰～", "主人也起来活动一下吧。" } },
            { "wave", new string[] { "主人，看这里～", "我在这儿呢！" } },
            { "sleep", new string[] { "呼……就眯一小会儿……", "啊！我没睡着！" } },
            { "snack", new string[] { "偷偷吃块饼干，嘿嘿。", "主人要不要来一块？" } },
            { "music", new string[] { "听首歌，脑子清醒多了。", "这个节奏好上头～" } },
            { "wipe", new string[] { "做实验做出汗了……", "擦擦汗，继续加油。" } },
            { "spin", new string[] { "转个圈，心情变好啦～", "看我转得圆不圆？" } },
        };
        private Point dragStart;
        private bool dragging;
        private string state = "idle";
        private string lockedState = "";
        private int lockedUntil;
        private double phase;
        private double tilt;
        private Point wanderTarget = Point.Empty;
        private int pauseLeft;
        private int chatterLeft;
        private int frameIndex;
        private int frameClock;
        private readonly List<string> activities = new List<string>();
        private string activity = "";
        private int activityLeft;
        private int activityCooldown = 280;
        private bool facingLeft;
        private bool gliding;
        private Point glideTarget;
        private double glideStepX;
        private double glideStepY;
        private int glideTicks;

        internal PetForm(string petPath)
        {
            LoadStates(petPath);
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            ShowInTaskbar = false;
            Text = "lab-pet";
            AllowTransparency = true;
            BackColor = Color.FromArgb(1, 2, 3);
            TransparencyKey = BackColor;
            DoubleBuffered = true;
            int size = Program.Config.petSize;
            Size = new Size(size + 16, size + 28);
            var screen = Screen.PrimaryScreen.WorkingArea;
            if (Program.Config.x >= 0 && Program.Config.y >= 0)
            {
                Location = new Point(Program.Config.x, Program.Config.y);
            }
            else
            {
                Location = new Point(screen.Right - size - 40, screen.Bottom - size - 30);
            }

            // 允许多只桌宠并存：已有别的实例在跑时错开位置，避免完全重叠
            try
            {
                int existing = 0;
                foreach (var other in Process.GetProcessesByName("LabPet"))
                {
                    if (other.Id != Process.GetCurrentProcess().Id) existing++;
                }
                if (existing > 0)
                {
                    int offset = 72 * existing;
                    int nx = Left + offset;
                    int ny = Top + 44 * existing;
                    if (nx + Width > screen.Right) nx = screen.Left + offset;
                    if (ny + Height > screen.Bottom) ny = screen.Top + 40 * existing;
                    Location = new Point(nx, ny);
                }
            }
            catch { }

            menu = new ContextMenuStrip();
            var miOpen = new ToolStripMenuItem("打开实验助手");
            miOpen.Click += delegate { Program.TogglePanel(Left, Top, Program.Config.petSize); };
            var miAnother = new ToolStripMenuItem("再来一只桌宠");
            miAnother.Click += delegate { Program.SpawnAnotherPet(); };
            var miClose = new ToolStripMenuItem("关闭这只桌宠");
            miClose.Click += delegate { Program.QuitThisPet(); };
            menu.Items.Add(miOpen);
            menu.Items.Add(miAnother);
            menu.Items.Add(miClose);
            if (Program.Config.hidden) Hide();
            chatterLeft = 500 + rng.Next(700);
            tick.Interval = 60;
            tick.Tick += delegate { OnTick(); };
            tick.Start();
        }

        internal string CurrentState { get { return state; } }

        private void LoadStates(string petPath)
        {
            string dir = Path.GetDirectoryName(petPath);
            try
            {
                string[] files = Directory.GetFiles(dir, "*.png");
                Array.Sort(files);
                for (int i = 0; i < files.Length; i++)
                {
                    string name = Path.GetFileNameWithoutExtension(files[i]);
                    string baseName = name;
                    int under = name.LastIndexOf('_');
                    if (under > 0)
                    {
                        int number;
                        if (int.TryParse(name.Substring(under + 1), out number)) baseName = name.Substring(0, under);
                    }
                    if (!frames.ContainsKey(baseName)) frames[baseName] = new List<Image>();
                    try { frames[baseName].Add(Image.FromFile(files[i])); } catch { }
                }
            }
            catch { }
            if (!frames.ContainsKey("idle") || frames["idle"].Count == 0)
            {
                if (!frames.ContainsKey("idle")) frames["idle"] = new List<Image>();
                try { frames["idle"].Add(Image.FromFile(petPath)); } catch { }
            }
            // 预设待机小动作；只要 assets/pet 里有对应图片就会自动参与随机播放。
            string[] preferred = new string[] { "drink", "typing", "read", "stretch", "wave", "sleep", "snack", "music", "wipe", "spin" };
            for (int i = 0; i < preferred.Length; i++)
            {
                List<Image> list;
                if (frames.TryGetValue(preferred[i], out list) && list.Count > 0) activities.Add(preferred[i]);
            }
            foreach (string key in frames.Keys)
            {
                if (key == "idle" || key == "swim" || key == "dash" || key == "point" || key == "happy" || key == "confused") continue;
                if (!activities.Contains(key) && frames[key].Count > 0) activities.Add(key);
            }
        }

        private Image CurrentImage()
        {
            List<Image> list;
            if (frames.TryGetValue(state, out list) && list.Count > 0) return list[frameIndex % list.Count];
            if (frames.TryGetValue("idle", out list) && list.Count > 0) return list[frameIndex % list.Count];
            return null;
        }

        private bool HasFrames(string name)
        {
            List<Image> list;
            return frames.TryGetValue(name, out list) && list.Count > 0;
        }

        private bool MultiFrame(string name)
        {
            List<Image> list;
            return frames.TryGetValue(name, out list) && list.Count > 1;
        }

        private Point PickTarget()
        {
            var area = Screen.FromControl(this).WorkingArea;
            int margin = 40;
            int minX = area.Left + margin;
            int minY = area.Top + margin;
            int maxX = Math.Max(minX, area.Right - Width - margin);
            int maxY = Math.Max(minY, area.Bottom - Height - margin);
            return new Point(rng.Next(minX, maxX + 1), rng.Next(minY, maxY + 1));
        }

        private bool TryStartActivity()
        {
            if (!Program.Config.chatter || activities.Count == 0 || activityCooldown > 0 || activity.Length > 0) return false;
            if (rng.Next(100) >= 3) return false;
            activity = activities[rng.Next(activities.Count)];
            List<Image> list;
            int count = frames.TryGetValue(activity, out list) && list.Count > 0 ? list.Count : 1;
            activityLeft = Math.Max(80, count * 4 * 2);
            state = activity;
            wanderTarget = Point.Empty;
            pauseLeft = 0;
            SayActivityLine(activity);
            return true;
        }

        private void SayActivityLine(string name)
        {
            string[] lines;
            if (!activityLines.TryGetValue(name, out lines) || lines.Length == 0) return;
            Say(lines[rng.Next(lines.Length)], 5200);
        }

        private void OnTick()
        {
            phase += 0.09;
            frameClock++;
            if (frameClock >= 4)
            {
                frameClock = 0;
                frameIndex++;
            }
            if (dragging)
            {
                Invalidate();
                return;
            }

            // 引导冲刺：不管距离多远，8 帧（约 0.5 秒）内到位。
            if (gliding)
            {
                glideTicks--;
                if (glideTicks <= 0)
                {
                    Location = glideTarget;
                    gliding = false;
                    state = lockedState.Length > 0 ? lockedState : "idle";
                    Program.Config.x = Left; Program.Config.y = Top; Program.Config.Save();
                }
                else
                {
                    Location = new Point(Left + (int)Math.Round(glideStepX), Top + (int)Math.Round(glideStepY));
                    state = HasFrames("dash") ? "dash" : "swim";
                }
                Invalidate();
                return;
            }

            if (lockedState.Length > 0 && Environment.TickCount >= lockedUntil) lockedState = "";
            if (activityCooldown > 0) activityCooldown--;
            bool panelOpen = Program.Panel != null && !Program.Panel.IsDisposed && Program.Panel.Visible;
            bool free = lockedState.Length == 0;

            if (activity.Length > 0)
            {
                activityLeft--;
                state = activity;
                tilt *= 0.85;
                if (activityLeft <= 0)
                {
                    activity = "";
                    state = "idle";
                    activityCooldown = 420 + rng.Next(600);
                }
            }
            else if (free && Program.Config.wander && !panelOpen)
            {
                if (pauseLeft > 0)
                {
                    pauseLeft--;
                    state = "idle";
                    TryStartActivity();
                }
                else if (wanderTarget.IsEmpty)
                {
                    if (!TryStartActivity())
                    {
                        wanderTarget = PickTarget();
                        state = "swim";
                    }
                }
                else
                {
                    double dx = wanderTarget.X - Left;
                    double dy = wanderTarget.Y - Top;
                    double dist = Math.Sqrt(dx * dx + dy * dy);
                    if (dist < 3)
                    {
                        wanderTarget = Point.Empty;
                        pauseLeft = 50 + rng.Next(90);
                        state = "idle";
                    }
                    else
                    {
                        Location = new Point(
                            Left + (int)Math.Round(dx / dist * 2.0),
                            Top + (int)Math.Round(dy / dist * 2.0));
                        facingLeft = dx < 0;
                        tilt = MultiFrame("swim")
                            ? (dx >= 0 ? 2.0 : -2.0)
                            : (dx >= 0 ? 3.0 : -3.0) + Math.Sin(phase * 2.4) * 1.6;
                        state = "swim";
                    }
                }
            }
            else
            {
                wanderTarget = Point.Empty;
                tilt *= 0.85;
                if (lockedState.Length == 0) state = "idle";
                if (free && !panelOpen) TryStartActivity();
            }

            if (Program.Config.chatter && chatterLeft > 0 && activity.Length == 0)
            {
                chatterLeft--;
                if (chatterLeft == 0)
                {
                    Say(chatterLines[rng.Next(chatterLines.Length)], 6500);
                    chatterLeft = 700 + rng.Next(1600);
                }
            }
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.HighQuality;
            e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            var image = CurrentImage();
            if (image == null) return;
            int size = Program.Config.petSize;
            double bob;
            double breathe = 1.0;
            if (state == "swim" || state == "dash")
            {
                // 有手绘走路帧时不再叠加程序跳动，避免动作打架
                bob = MultiFrame(state) ? 0 : Math.Abs(Math.Sin(phase * 2.6)) * 4.0;
            }
            else if (state == "idle")
            {
                bob = MultiFrame("idle") ? 0 : Math.Sin(phase) * 2.5;
                breathe = MultiFrame("idle") ? 1.0 : 1.0 + Math.Sin(phase * 0.8) * 0.012;
            }
            else
            {
                bob = MultiFrame(state) ? 0 : Math.Sin(phase * 0.9) * 1.5;
            }
            // 等比缩放，避免非正方形素材被拉伸变形
            double fit = Math.Min((double)size / Math.Max(1, image.Width), (double)size / Math.Max(1, image.Height));
            int w = (int)Math.Round(image.Width * fit * breathe);
            int h = (int)Math.Round(image.Height * fit * breathe);
            int x = (Width - w) / 2;
            int y = (int)Math.Round(size - h + bob + 4);
            var saved = e.Graphics.Save();
            if (Math.Abs(tilt) > 0.5)
            {
                e.Graphics.TranslateTransform(Width / 2f, Height / 2f);
                e.Graphics.RotateTransform((float)tilt);
                e.Graphics.TranslateTransform(-Width / 2f, -Height / 2f);
            }
            if (facingLeft)
            {
                e.Graphics.TranslateTransform(Width, 0);
                e.Graphics.ScaleTransform(-1, 1);
            }
            e.Graphics.DrawImage(image, new Rectangle(x, y, w, h));
            e.Graphics.Restore(saved);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x80;              // WS_EX_TOOLWINDOW
                cp.ExStyle |= 0x8000000;         // WS_EX_NOACTIVATE
                return cp;
            }
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            // 右键留给菜单，不参与拖动
            if (e.Button == MouseButtons.Right) return;
            Capture = true;
            dragging = true;
            gliding = false;
            wanderTarget = Point.Empty;
            activity = "";
            dragWatch.Reset(); dragWatch.Start();
            dragStart = new Point(e.X, e.Y);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            if (dragging) Location = new Point(Left + e.X - dragStart.X, Top + e.Y - dragStart.Y);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Right)
            {
                if (menu != null) menu.Show(this, new Point(e.X, e.Y));
                return;
            }
            Capture = false;
            dragging = false;
            dragWatch.Stop();
            Program.Config.x = Left; Program.Config.y = Top; Program.Config.Save();
            if (dragWatch.ElapsedMilliseconds < 400)
            {
                if (Server.TutorialActive) Server.TutorialAdvance();
                else Program.TogglePanel(Left, Top, Program.Config.petSize);
            }
        }

        internal void PositionNear(Rectangle target)
        {
            var area = Screen.FromRectangle(target).WorkingArea;
            int size = Program.Config.petSize;
            int left = target.Left - size - 12;
            if (left < area.Left + 8) left = target.Right + 12;
            left = Math.Max(area.Left + 8, Math.Min(left, area.Right - size - 8));
            int top = target.Top + target.Height / 2 - size / 2;
            top = Math.Max(area.Top + 8, Math.Min(top, area.Bottom - size - 8));
            // 引导必须快：固定 8 帧（约 0.5 秒）冲刺到位，距离再远也不拖沓。
            glideTarget = new Point(left, top);
            facingLeft = left < Left;
            int steps = 8;
            glideStepX = (left - Left) / (double)steps;
            glideStepY = (top - Top) / (double)steps;
            glideTicks = steps;
            gliding = true;
            wanderTarget = Point.Empty;
            activity = "";
            state = "swim";
        }

        internal void SetState(string name, int durationMs)
        {
            if (name != "idle" && name != "swim" && name != "point" && name != "happy" && name != "confused") name = "idle";
            state = name;
            if (name == "happy" || name == "confused" || name == "point")
            {
                lockedState = name;
                lockedUntil = Environment.TickCount + Math.Max(1200, durationMs);
                wanderTarget = Point.Empty;
                activity = "";
            }
            else
            {
                lockedState = "";
            }
            Invalidate();
        }

        internal void ApplyConfig()
        {
            int size = Program.Config.petSize;
            Size = new Size(size + 16, size + 28);
            if (Program.Config.hidden) Hide(); else Show();
            Invalidate();
        }

        protected override void OnLocationChanged(EventArgs e)
        {
            base.OnLocationChanged(e);
            if (Program.Bubble != null && !Program.Bubble.IsDisposed && Program.Bubble.Visible && Program.Config != null)
            {
                Program.Bubble.Follow(new Rectangle(Left, Top, Width, Program.Config.petSize));
            }
        }

        internal void Say(string text, int durationMs)
        {
            if (string.IsNullOrEmpty(text) || !Visible) return;
            // 台词里的“主人”统一替换为面板里设置的称呼
            string who = Program.Config.name;
            if (string.IsNullOrEmpty(who)) who = "主人";
            if (who != "主人") text = text.Replace("主人", who);
            Program.Bubble.ShowText(text, new Rectangle(Left, Top, Width, Program.Config.petSize), durationMs);
        }

        internal void ShowBubble(string text, int durationMs)
        {
            Say(text, durationMs);
        }
    }

    internal class BubbleForm : Form
    {
        private readonly Label label;
        private Timer hideTimer;

        internal BubbleForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            ShowInTaskbar = false;
            BackColor = Ui.BubbleBg;
            DoubleBuffered = true;
            label = new Label
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(16, 11, 16, 11),
                Font = new Font("Microsoft YaHei UI", 10f),
                ForeColor = Ui.BubbleText,
                BackColor = Color.Transparent,
            };
            Controls.Add(label);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = Ui.Rounded(new Rectangle(0, 0, Width - 1, Height - 1), 14))
            {
                using (var pen = new Pen(Ui.BubbleBorder)) e.Graphics.DrawPath(pen, path);
            }
        }

        private void ApplyShape()
        {
            using (var path = Ui.Rounded(new Rectangle(0, 0, Width, Height), 14))
            {
                var old = Region;
                Region = new Region(path);
                if (old != null) old.Dispose();
            }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x8;               // WS_EX_TOPMOST
                cp.ExStyle |= 0x20;              // WS_EX_TRANSPARENT：气泡不挡点击
                cp.ExStyle |= 0x8000000;         // WS_EX_NOACTIVATE
                return cp;
            }
        }

        internal void ShowText(string text, Rectangle petRect, int durationMs)
        {
            label.Text = text ?? "";
            Place(petRect);
            Show();
            if (hideTimer == null)
            {
                hideTimer = new Timer();
                hideTimer.Tick += delegate { Hide(); hideTimer.Stop(); };
            }
            hideTimer.Interval = Math.Max(2000, durationMs <= 0 ? 6000 : durationMs);
            hideTimer.Stop();
            hideTimer.Start();
        }

        // 桌宠移动时实时跟随：只更新位置，不重置自动隐藏计时
        internal void Follow(Rectangle petRect)
        {
            if (IsDisposed || !Visible) return;
            Place(petRect);
        }

        // 按最大宽度换行测量，长文本不再被裁掉；同时把窗口贴到桌宠正上方
        private void Place(Rectangle petRect)
        {
            const int padX = 16, padY = 11;
            const int maxContent = 360, minContent = 120;
            var flags = TextFormatFlags.WordBreak;
            var probe = TextRenderer.MeasureText(label.Text, label.Font, new Size(maxContent, int.MaxValue), flags);
            int contentW = Math.Max(minContent, Math.Min(maxContent, probe.Width));
            var tight = TextRenderer.MeasureText(label.Text, label.Font, new Size(contentW, int.MaxValue), flags);
            // 实测 Label 的 Padding 会让可用文本区略小于测量宽度，这里留足余量，
            // 否则最后一行会被裁掉半个字。
            Width = contentW + padX * 2 + 18;
            Height = Math.Max(44, tight.Height + padY * 2 + 18);
            ApplyShape();
            var area = Screen.FromRectangle(petRect).WorkingArea;
            int left = petRect.Left + petRect.Width / 2 - Width / 2;
            left = Math.Max(area.Left + 8, Math.Min(left, area.Right - Width - 8));
            int top = petRect.Top - Height - 10;
            if (top < area.Top + 8) top = petRect.Bottom + 10;
            Location = new Point(left, top);
        }
    }

    internal class HighlightForm : Form
    {
        private Rectangle target;
        private Timer clearTimer;
        // 教学用黄色，点击预演用红色
        private Color accent = Color.FromArgb(255, 232, 62, 84);

        internal HighlightForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            ShowInTaskbar = false;
            BackColor = Color.Magenta;
            TransparencyKey = BackColor;
            var bounds = SystemInformation.VirtualScreen;
            Bounds = bounds;
            DoubleBuffered = true;
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x20;              // WS_EX_TRANSPARENT：整层点击穿透
                cp.ExStyle |= 0x80000;           // WS_EX_LAYERED
                cp.ExStyle |= 0x8;               // WS_EX_TOPMOST
                cp.ExStyle |= 0x8000000;         // WS_EX_NOACTIVATE
                return cp;
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (target.IsEmpty) return;
            using (var pen = new Pen(accent, 4))
            {
                e.Graphics.DrawRectangle(pen, target);
                // 只用描边：整层是透明键抠像，半透明填充会合成出粉色，反而干扰阅读
            }
        }

        internal void Highlight(Rectangle rect, int durationMs)
        {
            Highlight(rect, durationMs, accent);
        }

        internal void Highlight(Rectangle rect, int durationMs, Color color)
        {
            accent = color;
            target = RectangleToClient(new Rectangle(rect.Left - 4, rect.Top - 4, rect.Width + 8, rect.Height + 8));
            Invalidate();
            if (IsDisposed || !IsHandleCreated) return;
            Show();
            if (clearTimer == null)
            {
                clearTimer = new Timer();
                clearTimer.Tick += delegate { Clear(); clearTimer.Stop(); };
            }
            if (durationMs < 0)
            {
                // 钉住：不自动消失，等 /clear
                clearTimer.Stop();
                return;
            }
            clearTimer.Interval = Math.Max(1500, durationMs <= 0 ? 8000 : durationMs);
            clearTimer.Stop();
            clearTimer.Start();
        }

        internal void Clear()
        {
            target = Rectangle.Empty;
            if (!IsDisposed) { Invalidate(); Hide(); }
        }
    }

    // 蓝色风格的列表：自绘表头与行，替掉系统灰白样式
    internal class SkyListView : ListView
    {
        private static readonly Font HeadFont = new Font("Microsoft YaHei UI", 9f, FontStyle.Bold);

        internal SkyListView()
        {
            OwnerDraw = true;
            View = View.Details;          // 必须是 Details，否则自绘表头根本不会被调用
            BorderStyle = BorderStyle.None;
            BackColor = Color.White;
            Font = new Font("Microsoft YaHei UI", 9f);
            FullRowSelect = true;
            HideSelection = false;
        }

        protected override void OnDrawColumnHeader(DrawListViewColumnHeaderEventArgs e)
        {
            using (var b = new SolidBrush(Ui.Soft)) e.Graphics.FillRectangle(b, e.Bounds);
            using (var p = new Pen(Ui.Border))
            {
                e.Graphics.DrawLine(p, e.Bounds.Left, e.Bounds.Bottom - 1, e.Bounds.Right, e.Bounds.Bottom - 1);
                e.Graphics.DrawLine(p, e.Bounds.Right - 1, e.Bounds.Top, e.Bounds.Right - 1, e.Bounds.Bottom - 1);
            }
            var r = new Rectangle(e.Bounds.Left + 8, e.Bounds.Top, Math.Max(10, e.Bounds.Width - 12), e.Bounds.Height);
            TextRenderer.DrawText(e.Graphics, e.Header.Text, HeadFont, r, Ui.AccentDark,
                TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
            e.DrawDefault = false;
        }

        protected override void OnDrawItem(DrawListViewItemEventArgs e)
        {
            Color bg = e.Item.Selected ? Ui.Soft : (e.ItemIndex % 2 == 0 ? Color.White : Color.FromArgb(250, 253, 255));
            using (var b = new SolidBrush(bg)) e.Graphics.FillRectangle(b, e.Bounds);
            e.DrawDefault = false;
        }

        protected override void OnDrawSubItem(DrawListViewSubItemEventArgs e)
        {
            var r = new Rectangle(e.Bounds.Left + 8, e.Bounds.Top, Math.Max(10, e.Bounds.Width - 12), e.Bounds.Height);
            TextRenderer.DrawText(e.Graphics, e.SubItem.Text, Font, r, Ui.Text,
                TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
            e.DrawDefault = false;
        }
    }

    // 蓝色风格下拉框
    internal class SkyCombo : ComboBox
    {
        internal SkyCombo()
        {
            DrawMode = DrawMode.OwnerDrawFixed;
            DropDownStyle = ComboBoxStyle.DropDownList;
            FlatStyle = FlatStyle.Flat;
            BackColor = Color.White;
            ItemHeight = 22;
            Font = new Font("Microsoft YaHei UI", 9f);
        }

        protected override void OnDrawItem(DrawItemEventArgs e)
        {
            if (e.Index < 0) return;
            bool sel = (e.State & DrawItemState.Selected) != 0;
            using (var b = new SolidBrush(sel ? Ui.Soft : Color.White)) e.Graphics.FillRectangle(b, e.Bounds);
            var r = new Rectangle(e.Bounds.Left + 6, e.Bounds.Top, Math.Max(10, e.Bounds.Width - 10), e.Bounds.Height);
            TextRenderer.DrawText(e.Graphics, Convert.ToString(Items[e.Index]), Font, r, sel ? Ui.AccentDark : Ui.Text,
                TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
        }
    }

    // 蓝色风格勾选框（圆角方块 + 白色对勾）
    internal class PillCheck : Control
    {
        private bool isChecked;

        internal bool Checked
        {
            get { return isChecked; }
            set { if (isChecked == value) return; isChecked = value; Invalidate(); }
        }

        internal PillCheck()
        {
            // 必须从 Control 派生而不是 CheckBox：后者即使设了 UserPaint 仍会把文字再画一遍，
            // 结果文字重叠。Control 没有默认绘制，全部由 OnPaint 负责。
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint
                | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Ui.Card;
            ForeColor = Ui.Text;
            Font = new Font("Microsoft YaHei UI", 9f);
            Height = 24;
            Cursor = Cursors.Hand;
        }

        protected override void OnClick(EventArgs e)
        {
            Checked = !Checked;
            base.OnClick(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            const int box = 16;
            int top = Math.Max(0, (Height - box) / 2);
            var rect = new Rectangle(0, top, box, box);
            using (var path = Ui.Rounded(rect, 5))
            {
                using (var b = new SolidBrush(Checked ? Ui.Accent : Color.White)) e.Graphics.FillPath(b, path);
                using (var p = new Pen(Checked ? Ui.Accent : Ui.Border)) e.Graphics.DrawPath(p, path);
            }
            if (Checked)
            {
                using (var p = new Pen(Color.White, 2.2f))
                {
                    e.Graphics.DrawLines(p, new[]
                    {
                        new Point(4, top + 8), new Point(7, top + 11), new Point(12, top + 4),
                    });
                }
            }
            var tr = new Rectangle(box + 8, 0, Math.Max(10, Width - box - 8), Height);
            TextRenderer.DrawText(e.Graphics, Text, Font, tr, Ui.Text,
                TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
        }
    }

    // 顶部蓝色渐变标题栏（圆角），承载标题/副标题/图标头像
    internal class HeaderPanel : Panel
    {
        internal HeaderPanel()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint
                | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Color.Transparent;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            var rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using (var path = Ui.Rounded(rect, 18))
            {
                using (var brush = new LinearGradientBrush(rect, Ui.HeaderFrom, Ui.HeaderTo, LinearGradientMode.Horizontal))
                {
                    e.Graphics.FillPath(brush, path);
                }
            }
            base.OnPaint(e);
        }
    }

    internal class PanelForm : Form
    {
        private ListView list;
        private TextBox titleBox, courseBox, softwareBox, templateBox, nameBox, studentBox, petNameBox, requirementBox, dataDirBox, datasetBox;
        private SkyCombo templateCombo;
        private ComboBox modeBox;
        private NumericUpDown sizeBox;
        private PillCheck showBox, chatterBox, wanderBox;
        private Label statusLabel;
        private HeaderPanel head;
        private Label headTitle, headSub;
        private PictureBox mascot;
        private CardPanel cardList, cardNew, cardTpl, cardPet;
        private Label tplCountLabel;
        private PillButton btnRefresh, btnOpenDir, btnCreate, btnBrowse, btnBrowseReq, btnGenerate, btnOpenReport, btnPetSave, btnQuitPet, btnBrowseData, btnBrowseDataset;
        private PillButton btnDeleteExp, btnDeleteTpl;
        private List<Dictionary<string, object>> experiments = new List<Dictionary<string, object>>();
        private string lastDocx = "";

        private static Label MakeLabel(string text, int x, int y, int w, int h, Font font, Color color)
        {
            // 注意：不能用 Color.Transparent —— 父级 CardPanel 是自绘控件，
            // 透明子控件的背景合成会失效，导致整块文字看不见。卡片底色是白色，直接用白色。
            return new Label
            {
                Text = text, Left = x, Top = y, Width = w, Height = h,
                Font = font, ForeColor = color, BackColor = Ui.Card,
                UseCompatibleTextRendering = true,
                AutoSize = true,
            };
        }

        private static PillButton MakeButton(string text, int x, int y, int w, bool outline)
        {
            return new PillButton { Text = text, Left = x, Top = y, Width = w, Height = 30, Outline = outline };
        }

        private static TextBox MakeInput(int x, int y, int w)
        {
            return new TextBox
            {
                Left = x, Top = y, Width = w,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Microsoft YaHei UI", 9f),
            };
        }

        internal PanelForm()
        {
            Text = "实验助手";
            TopMost = true;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            // 纯手工绝对布局：关掉字体自动缩放，否则 ClientSize 会按字体比例被缩放（实测被压到 2/3）
            AutoScaleMode = AutoScaleMode.None;
            FormBorderStyle = FormBorderStyle.Sizable;
            MaximizeBox = true;
            MinimizeBox = false;
            MinimumSize = new Size(660, 760);
            ClientSize = new Size(620, 980);
            BackColor = Ui.Bg;
            Font = new Font("Microsoft YaHei UI", 9f);
            AutoScroll = true;
            DoubleBuffered = true;

            head = new HeaderPanel { Left = 20, Top = 16, Width = 580, Height = 92 };
            headTitle = new Label
            {
                Text = "实验助手", Left = 20, Top = 12, Width = 340, Height = 36,
                Font = new Font("Microsoft YaHei UI", 16f, FontStyle.Bold),
                ForeColor = Color.White, BackColor = Color.Transparent,
            };
            headSub = new Label
            {
                Text = "点一下桌宠可以收起面板 · 报告会同时输出 Word 和 Markdown",
                Left = 22, Top = 54, Width = 400, Height = 20,
                Font = new Font("Microsoft YaHei UI", 8.5f),
                ForeColor = Color.FromArgb(236, 246, 255),
                BackColor = Color.Transparent, AutoEllipsis = true,
            };
            mascot = new PictureBox
            {
                Width = 72, Height = 72,
                SizeMode = PictureBoxSizeMode.Zoom,
                BackColor = Color.Transparent,
            };
            try
            {
                string iconPath = "";
                if (!string.IsNullOrEmpty(Program.PetPath))
                {
                    var assetsDir = Path.GetDirectoryName(Path.GetDirectoryName(Program.PetPath));
                    if (!string.IsNullOrEmpty(assetsDir)) iconPath = Path.Combine(assetsDir, "icon.png");
                }
                if (iconPath.Length > 0 && File.Exists(iconPath)) mascot.Image = Image.FromFile(iconPath);
            }
            catch { }
            head.Controls.Add(headTitle);
            head.Controls.Add(headSub);
            head.Controls.Add(mascot);
            Controls.Add(head);

            // ── 实验档案 ──
            cardList = new CardPanel { Left = 24, Top = 72, Width = 468, Height = 192 };
            cardList.Controls.Add(MakeLabel("实验档案", 16, 10, 240, 24, new Font("Microsoft YaHei UI", 10.5f, FontStyle.Bold), Ui.AccentDark));
            list = new SkyListView
            {
                Left = 16, Top = 40, Width = 436, Height = 104,
            };
            list.Columns.Add("实验", 186);
            list.Columns.Add("状态", 64);
            list.Columns.Add("进度", 62);
            list.Columns.Add("更新时间", 118);
            list.SelectedIndexChanged += delegate { LoadSelection(); };
            btnRefresh = MakeButton("刷新", 16, 148, 100, true);
            btnOpenDir = MakeButton("打开实验目录", 124, 148, 140, true);
            btnRefresh.Click += delegate { RefreshList(); };
            btnOpenDir.Click += delegate { OpenDir(false); };
            cardList.Controls.Add(list);
            btnDeleteExp = MakeButton("删除…", 272, 148, 84, true);
            btnDeleteExp.Click += delegate { DeleteSelectedExperiment(); };
            cardList.Controls.Add(btnRefresh);
            cardList.Controls.Add(btnOpenDir);
            cardList.Controls.Add(btnDeleteExp);
            Controls.Add(cardList);

            // ── 新建实验 ──
            cardNew = new CardPanel { Left = 24, Top = 270, Width = 468, Height = 222 };
            cardNew.Controls.Add(MakeLabel("新建实验", 16, 10, 240, 24, new Font("Microsoft YaHei UI", 10.5f, FontStyle.Bold), Ui.AccentDark));
            cardNew.Controls.Add(MakeLabel("名称", 16, 44, 40, 22, Font, Ui.Text));
            titleBox = MakeInput(60, 40, 392);
            cardNew.Controls.Add(titleBox);
            cardNew.Controls.Add(MakeLabel("课程", 16, 76, 40, 22, Font, Ui.Text));
            courseBox = MakeInput(60, 72, 180);
            cardNew.Controls.Add(courseBox);
            cardNew.Controls.Add(MakeLabel("软件", 252, 76, 40, 22, Font, Ui.Text));
            softwareBox = MakeInput(296, 72, 156);
            softwareBox.Text = "eNSP";
            cardNew.Controls.Add(softwareBox);
            cardNew.Controls.Add(MakeLabel("模式", 16, 108, 40, 22, Font, Ui.Text));
            modeBox = new SkyCombo { Left = 60, Top = 102, Width = 180, Height = 26 };
            modeBox.Items.AddRange(new object[] { "混合模式", "详细指导", "自动执行" });
            modeBox.SelectedIndex = 0;
            cardNew.Controls.Add(modeBox);
            // 数据文件：由用户点选（文件对话框自动化不可靠，放这里一次选好）
            cardNew.Controls.Add(MakeLabel("数据", 16, 140, 40, 22, Font, Ui.Text));
            datasetBox = MakeInput(60, 136, 300);
            cardNew.Controls.Add(datasetBox);
            btnBrowseDataset = MakeButton("浏览…", 368, 134, 84, true);
            btnBrowseDataset.Height = 28;
            btnBrowseDataset.Click += delegate { BrowseDataset(); };
            cardNew.Controls.Add(btnBrowseDataset);
            btnCreate = MakeButton("创建实验档案", 252, 102, 200, false);
            btnCreate.Height = 30;
            btnCreate.Click += delegate { CreateExperiment(); };
            cardNew.Controls.Add(btnCreate);
            cardNew.Controls.Add(MakeLabel("模板 = 「模板库」里选中的那个；要求/数据可留空，之后在对话里补", 16, 190, 430, 18, new Font("Microsoft YaHei UI", 8f), Ui.Muted));
            Controls.Add(cardNew);

            // ── 生成报告 ──
            // ── 模板库：只存模板，生成报告在对话里进行 ──
            cardTpl = new CardPanel { Left = 24, Top = 432, Width = 468, Height = 156 };
            cardTpl.Controls.Add(MakeLabel("模板库", 16, 8, 240, 26, new Font("Microsoft YaHei UI", 10.5f, FontStyle.Bold), Ui.AccentDark));
            cardTpl.Controls.Add(MakeLabel("报告在对话里生成；这里只管模板的导入与切换", 16, 36, 420, 18, new Font("Microsoft YaHei UI", 8f), Ui.Muted));
            cardTpl.Controls.Add(MakeLabel("模板", 16, 68, 40, 22, Font, Ui.Text));
            templateBox = MakeInput(60, 64, 300);   // 隐藏：存选中的模板 ID
            templateBox.Visible = false;
            cardTpl.Controls.Add(templateBox);
            templateCombo = new SkyCombo { Left = 60, Top = 64, Width = 196, Height = 26 };
            templateCombo.SelectedIndexChanged += delegate { SyncTemplateSelection(); };
            templateCombo.Items.Add(new TemplateItem { Id = "", Name = "(未导入模板，点右边导入…)" });
            cardTpl.Controls.Add(templateCombo);
            btnBrowse = MakeButton("导入…", 266, 62, 84, true);
            btnBrowse.Height = 28;
            btnBrowse.Click += delegate { ImportTemplate(); };
            cardTpl.Controls.Add(btnBrowse);
            btnDeleteTpl = MakeButton("删除…", 356, 62, 84, true);
            btnDeleteTpl.Height = 28;
            btnDeleteTpl.Click += delegate { DeleteSelectedTemplate(); };
            cardTpl.Controls.Add(btnDeleteTpl);
            tplCountLabel = MakeLabel("模板库为空：点「导入…」选一份老师给的 .docx", 16, 108, 320, 22, new Font("Microsoft YaHei UI", 8.5f), Ui.Muted);
            cardTpl.Controls.Add(tplCountLabel);
            Controls.Add(cardTpl);

            // ── 桌宠设置 ──
            cardPet = new CardPanel { Left = 24, Top = 638, Width = 468, Height = 196 };
            cardPet.Controls.Add(MakeLabel("桌宠设置", 16, 10, 240, 24, new Font("Microsoft YaHei UI", 10.5f, FontStyle.Bold), Ui.AccentDark));
            cardPet.Controls.Add(MakeLabel("称呼", 16, 42, 40, 22, Font, Ui.Text));
            petNameBox = MakeInput(60, 38, 110);
            petNameBox.Text = Program.Config.name;
            cardPet.Controls.Add(petNameBox);
            cardPet.Controls.Add(MakeLabel("大小", 184, 42, 36, 22, Font, Ui.Text));
            sizeBox = new NumericUpDown
            {
                Left = 224, Top = 38, Width = 64, Minimum = 96, Maximum = 320,
                Value = Program.Config.petSize, BorderStyle = BorderStyle.FixedSingle,
            };
            cardPet.Controls.Add(sizeBox);
            showBox = new PillCheck { Left = 300, Top = 40, Width = 76, Text = "显示", Checked = !Program.Config.hidden };
            cardPet.Controls.Add(showBox);
            chatterBox = new PillCheck { Left = 16, Top = 78, Width = 170, Text = "待机动画与说话", Checked = Program.Config.chatter };
            cardPet.Controls.Add(chatterBox);
            wanderBox = new PillCheck { Left = 196, Top = 78, Width = 168, Text = "桌面自由走动", Checked = Program.Config.wander };
            cardPet.Controls.Add(wanderBox);
            btnPetSave = MakeButton("保存设置", 352, 110, 100, false);
            btnPetSave.Height = 28;
            btnPetSave.Click += delegate { SavePet(); };
            cardPet.Controls.Add(btnPetSave);

            // 关闭这一只桌宠（多只并存时只关当前这只）
            btnQuitPet = MakeButton("关闭桌宠", 240, 110, 100, true);
            btnQuitPet.Height = 28;
            btnQuitPet.Click += delegate { Program.QuitThisPet(); };
            cardPet.Controls.Add(btnQuitPet);

            // 数据目录：实验档案、截图、报告都放这里；留空则用默认 <DSH home>/lab-assistant/experiments
            cardPet.Controls.Add(MakeLabel("存储", 16, 152, 40, 22, Font, Ui.Text));
            dataDirBox = MakeInput(60, 148, 300);
            cardPet.Controls.Add(dataDirBox);
            btnBrowseData = MakeButton("浏览…", 368, 146, 84, true);
            btnBrowseData.Height = 28;
            btnBrowseData.Click += delegate { BrowseDataDir(); };
            cardPet.Controls.Add(btnBrowseData);
            Controls.Add(cardPet);

            statusLabel = new Label
            {
                Left = 24, Top = 766, Width = 468, Height = 34,
                ForeColor = Ui.Muted, BackColor = Color.Transparent,
                Font = new Font("Microsoft YaHei UI", 8.5f), AutoEllipsis = true,
            };
            Controls.Add(statusLabel);

            Resize += delegate { LayoutAll(); };
            LayoutAll();
        }

        // WinForms 会在首次显示时按字体/DPI 自动缩放（本机实测被压到 2/3）。
        // 纯手工布局的窗体需要在自动缩放完成之后再按字面赋一次尺寸。
        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            SuspendLayout();
            MinimumSize = new Size(660, 760);
            ClientSize = new Size(620, 980);
            ResumeLayout(true);
            LayoutAll();
        }

        // 窗口尺寸变化时重排：卡片宽度跟随客户区，内部控件按比例拉伸
        private void LayoutAll()
        {
            if (cardList == null) return;
            int m = 24;
            int w = Math.Max(380, ClientSize.Width - m * 2);

            if (head != null)
            {
                head.Left = 20;
                head.Width = Math.Max(300, ClientSize.Width - 40);
                if (mascot != null) mascot.Left = Math.Max(120, head.Width - 92);
                if (headSub != null) headSub.Width = Math.Max(160, head.Width - 130);
            }

            int top = 124;
            cardList.Left = m; cardList.Top = top; cardList.Width = w;
            list.Width = Math.Max(240, w - 32);
            if (list.Columns.Count == 4)
            {
                int lw = Math.Max(200, list.Width - 6);
                int c0 = (int)(lw * 0.40), c1 = (int)(lw * 0.16), c2 = (int)(lw * 0.14);
                list.Columns[0].Width = Math.Max(110, c0);
                list.Columns[1].Width = Math.Max(64, c1);
                list.Columns[2].Width = Math.Max(58, c2);
                list.Columns[3].Width = Math.Max(90, lw - c0 - c1 - c2);
            }
            btnOpenDir.Left = btnRefresh.Left + btnRefresh.Width + 8;
            if (btnDeleteExp != null) btnDeleteExp.Left = btnOpenDir.Left + btnOpenDir.Width + 8;

            top = cardList.Top + cardList.Height + 16;
            cardNew.Left = m; cardNew.Top = top; cardNew.Width = w;
            titleBox.Width = Math.Max(160, w - 60 - 16);
            if (btnCreate != null) btnCreate.Left = Math.Max(180, w - 16 - btnCreate.Width);
            if (btnBrowseDataset != null) btnBrowseDataset.Left = Math.Max(120, w - 16 - btnBrowseDataset.Width);
            if (datasetBox != null) datasetBox.Width = Math.Max(100, btnBrowseDataset.Left - 60 - 8);

            top = cardNew.Top + cardNew.Height + 16;
            cardTpl.Left = m; cardTpl.Top = top; cardTpl.Width = w;
            if (btnDeleteTpl != null) btnDeleteTpl.Left = Math.Max(120, w - 16 - btnDeleteTpl.Width);
            if (btnBrowse != null)
            {
                int rightEdge = btnDeleteTpl != null ? btnDeleteTpl.Left - 8 : w - 16;
                btnBrowse.Left = Math.Max(120, rightEdge - btnBrowse.Width);
            }
            if (templateBox != null && btnBrowse != null) templateBox.Width = Math.Max(100, btnBrowse.Left - 60 - 8);
            if (templateCombo != null && templateBox != null) templateCombo.Width = templateBox.Width;

            top = cardTpl.Top + cardTpl.Height + 16;
            cardPet.Left = m; cardPet.Top = top; cardPet.Width = w;
            btnPetSave.Left = Math.Max(200, w - 16 - btnPetSave.Width);
            if (btnBrowseData != null) btnBrowseData.Left = Math.Max(120, w - 16 - btnBrowseData.Width);
            if (dataDirBox != null) dataDirBox.Width = Math.Max(100, btnBrowseData.Left - 60 - 8);
            if (btnQuitPet != null) btnQuitPet.Left = Math.Max(16, btnPetSave.Left - btnQuitPet.Width - 8);

            if (statusLabel != null)
            {
                statusLabel.Left = m;
                statusLabel.Top = cardPet.Top + cardPet.Height + 10;
                statusLabel.Width = w;
                AutoScrollMinSize = new Size(0, statusLabel.Top + statusLabel.Height + 14);
            }
        }

        internal void ApplyName()
        {
            petNameBox.Text = Program.Config.name;
        }

        internal void RefreshList()
        {
            try
            {
                var st = Obj(Api("GET", "/status", null));
                if (st.ContainsKey("experimentsDir")) dataDirBox.Text = ToStr(st, "experimentsDir");
                RefreshTemplates();
            }
            catch { }
            var data = Obj(Api("GET", "/experiments", null));
            list.BeginUpdate();
            list.Items.Clear();
            experiments.Clear();
            var rows = data.ContainsKey("experiments") ? data["experiments"] as System.Collections.IEnumerable : null;
            if (rows != null)
            {
                foreach (var row in rows)
                {
                    var exp = row as Dictionary<string, object>;
                    if (exp == null) continue;
                    experiments.Add(exp);
                    int total = ToInt(exp, "totalSteps");
                    int current = ToInt(exp, "currentStep");
                    var item = new ListViewItem(new string[]
                    {
                        ToStr(exp, "title"),
                        ToStr(exp, "status") == "active" ? "进行中" : ToStr(exp, "status"),
                        total > 0 ? (current + 1) + "/" + total : "无步骤",
                        ToStr(exp, "updatedAt").Replace("T", " ").Substring(0, Math.Min(16, ToStr(exp, "updatedAt").Length)),
                    });
                    item.Tag = exp;
                    list.Items.Add(item);
                }
            }
            list.EndUpdate();
            SetStatus("实验档案：" + experiments.Count + " 份。选中一条后再生成报告。");
        }

        private void CreateExperiment()
        {
            string title = titleBox.Text.Trim();
            if (title.Length == 0) { SetStatus("请先填写实验名称。"); return; }
            string mode = new[] { "mixed", "guided", "automatic" }[Math.Max(0, modeBox.SelectedIndex)];
            var json = Program.Json.Serialize(new Dictionary<string, object>
            {
                { "title", title }, { "course", courseBox.Text.Trim() },
                { "software", string.IsNullOrEmpty(softwareBox.Text.Trim()) ? "eNSP" : softwareBox.Text.Trim() },
                { "mode", mode },
                { "datasetPath", datasetBox.Text.Trim() },
                { "reportTemplate", templateBox.Text.Trim() },
            });
            var data = Obj(Api("POST", "/experiments", json));
            if (!data.ContainsKey("ok") || !Convert.ToBoolean(data["ok"])) { SetStatus("创建失败：" + ToStr(data, "error")); return; }
            titleBox.Text = "";
            SetStatus("已创建：" + ToStr(data.ContainsKey("experiment") ? ((Dictionary<string, object>)data["experiment"]) : data, "title"));
            RefreshList();
        }

        private void GenerateReport()
        {
            if (list.SelectedItems.Count == 0) { SetStatus("请先在列表里选中一份实验。"); return; }
            var exp = list.SelectedItems[0].Tag as Dictionary<string, object>;
            if (exp == null) { SetStatus("请先在列表里选中一份实验。"); return; }
            var json = Program.Json.Serialize(new Dictionary<string, object>
            {
                { "experimentId", ToStr(exp, "id") },
                { "studentName", nameBox == null ? "" : nameBox.Text.Trim() },
                { "studentId", studentBox == null ? "" : studentBox.Text.Trim() },
                { "templateId", templateBox.Text.Trim() },
                { "templatePath", "" },
                { "requirementPath", requirementBox == null ? "" : requirementBox.Text.Trim() },
            });
            SetStatus("正在生成报告…");
            var data = Obj(Api("POST", "/report/generate", json));
            if (!data.ContainsKey("ok") || !Convert.ToBoolean(data["ok"])) { SetStatus("生成失败：" + ToStr(data, "error")); return; }
            string docx = "";
            // 这里刻意不用 C# 7 的模式匹配：只装了 .NET Framework 的机器上，系统自带 csc 只认 C# 5。
            var files = data.ContainsKey("files") ? data["files"] as Dictionary<string, object> : null;
            if (files != null)
            {
                if (files.ContainsKey("docx")) docx = Convert.ToString(files["docx"]);
            }
            lastDocx = docx;
            int placeholders = 0;
            if (data.ContainsKey("placeholderCount")) placeholders = Convert.ToInt32(data["placeholderCount"]);
            SetStatus("报告已生成：" + docx + "\n还有 " + placeholders + " 处【待补】需要本人填写真实数据。");
        }

        private void SavePet()
        {
            Program.Config.name = string.IsNullOrEmpty(petNameBox.Text.Trim()) ? "主人" : petNameBox.Text.Trim();
            Program.Config.petSize = (int)sizeBox.Value;
            Program.Config.hidden = !showBox.Checked;
            Program.Config.chatter = chatterBox.Checked;
            Program.Config.wander = wanderBox.Checked;
            Program.Config.Save();
            Program.InvokeOnPet(delegate { Program.Pet.ApplyConfig(); });
            try
            {
                var settingsJson = Program.Json.Serialize(new Dictionary<string, object>
                {
                    { "dataDir", dataDirBox.Text.Trim() },
                });
                var saved = Obj(Api("PUT", "/settings", settingsJson));
                if (saved.ContainsKey("ok") && Convert.ToBoolean(saved["ok"]))
                    SetStatus("设置已保存。数据目录：" + ToStr(saved, "experimentsDir"));
                else
                    SetStatus("桌宠设置已保存，但数据目录没写进去：" + ToStr(saved, "error"));
            }
            catch (Exception error)
            {
                SetStatus("桌宠设置已保存；数据目录保存失败：" + error.Message);
            }
        }

        private void BrowseDataset()
        {
            using (var dialog = new OpenFileDialog())
            {
                dialog.Filter = "数据集 (*.arff;*.csv;*.xlsx;*.xls;*.txt)|*.arff;*.csv;*.xlsx;*.xls;*.txt|所有文件 (*.*)|*.*";
                dialog.Title = "选择本次实验使用的数据文件";
                if (dialog.ShowDialog(this) == DialogResult.OK) datasetBox.Text = dialog.FileName;
            }
        }

        private void BrowseDataDir()
        {
            using (var dialog = new FolderBrowserDialog())
            {
                dialog.Description = "选择实验档案/截图/报告的存放目录（留空用默认位置）";
                if (dialog.ShowDialog(this) == DialogResult.OK) dataDirBox.Text = dialog.SelectedPath;
            }
        }

        private void BrowseRequirement()
        {
            using (var dialog = new OpenFileDialog())
            {
                dialog.Filter = "实验要求 (*.pdf;*.docx;*.doc;*.txt;*.md;*.png;*.jpg;*.jpeg)|*.pdf;*.docx;*.doc;*.txt;*.md;*.png;*.jpg;*.jpeg|所有文件 (*.*)|*.*";
                dialog.Title = "选择实验要求文件";
                if (dialog.ShowDialog(this) == DialogResult.OK && requirementBox != null) requirementBox.Text = dialog.FileName;
            }
        }

        internal sealed class TemplateItem
        {
            internal string Id = "";
            internal string Name = "";
            public override string ToString() { return Name; }
        }

        // 下拉选中后把 ID 写进隐藏字段，供生成报告时使用
        private void SyncTemplateSelection()
        {
            var item = templateCombo.SelectedItem as TemplateItem;
            if (item != null) templateBox.Text = item.Id;
        }

        private void RefreshTemplates()
        {
            try
            {
                var data = Obj(Api("GET", "/report/templates", null));
                if (!data.ContainsKey("templates")) return;
                var rows = data["templates"] as System.Collections.IEnumerable;
                if (rows == null) return;
                string keep = templateBox.Text.Trim();
                templateCombo.Items.Clear();
                foreach (var row in rows)
                {
                    var tpl = row as Dictionary<string, object>;
                    if (tpl == null) continue;
                    var item = new TemplateItem { Id = ToStr(tpl, "id"), Name = ToStr(tpl, "name") };
                    if (string.IsNullOrEmpty(item.Name)) item.Name = item.Id;
                    templateCombo.Items.Add(item);
                    if (!string.IsNullOrEmpty(keep) && item.Id == keep) templateCombo.SelectedItem = item;
                }
                if (templateCombo.Items.Count == 0)
                {
                    templateCombo.Items.Add(new TemplateItem { Id = "", Name = "(未导入模板，点导入…)" });
                }
                if (tplCountLabel != null)
                {
                    int real = 0;
                    foreach (var entry in templateCombo.Items)
                    {
                        var item = entry as TemplateItem;
                        if (item != null && !string.IsNullOrEmpty(item.Id)) real++;
                    }
                    tplCountLabel.Text = real == 0
                        ? "模板库为空：点「导入…」选一份老师给的 .docx"
                        : "已存 " + real + " 份模板，切换后新建的实验会绑定它";
                }
            }
            catch { }
        }

        private void ImportTemplate()
        {
            using (var dialog = new OpenFileDialog())
            {
                dialog.Filter = "报告模板 (*.docx;*.md;*.txt)|*.docx;*.md;*.txt";
                dialog.Title = "选择报告模板（会导入到模板库，可随时切换）";
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                try
                {
                    var body = Program.Json.Serialize(new Dictionary<string, object> { { "path", dialog.FileName } });
                    var saved = Obj(Api("POST", "/report/templates", body));
                    if (saved.ContainsKey("ok") && Convert.ToBoolean(saved["ok"]))
                    {
                        RefreshTemplates();
                        var tpl = saved.ContainsKey("template") ? saved["template"] as Dictionary<string, object> : null;
                        if (tpl != null)
                        {
                            string id = ToStr(tpl, "id");
                            foreach (var entry in templateCombo.Items)
                            {
                                var item = entry as TemplateItem;
                                if (item != null && item.Id == id) { templateCombo.SelectedItem = item; break; }
                            }
                            SetStatus("模板已导入并选中：" + ToStr(tpl, "name"));
                        }
                        else SetStatus("模板已导入。");
                    }
                    else SetStatus("模板导入失败：" + ToStr(saved, "error"));
                }
                catch (Exception error) { SetStatus("模板导入失败：" + error.Message); }
            }
        }

        private void BrowseTemplate()
        {
            using (var dialog = new OpenFileDialog())
            {
                dialog.Filter = "报告模板 (*.docx;*.md;*.txt)|*.docx;*.md;*.txt";
                if (dialog.ShowDialog(this) == DialogResult.OK) templateBox.Text = dialog.FileName;
            }
        }

        private void OpenDir(bool reportFolder)
        {
            if (list.SelectedItems.Count == 0) { SetStatus(reportFolder ? "请先选中实验并生成报告。" : "请先选中实验。"); return; }
            var exp = list.SelectedItems[0].Tag as Dictionary<string, object>;
            if (exp == null) return;
            string dir = ToStr(exp, "workDir");
            if (reportFolder) dir = Path.Combine(dir, "reports");
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            Process.Start("explorer.exe", dir);
        }

        // 删除选中的实验档案：二次确认 → 移到 _trash（可恢复）
        private void DeleteSelectedExperiment()
        {
            if (list.SelectedItems.Count == 0)
            {
                SetStatus("先在列表里选中要删除的实验档案"); return;
            }
            var exp = list.SelectedItems[0].Tag as Dictionary<string, object>;
            if (exp == null) return;
            string id = ToStr(exp, "id");
            string title = ToStr(exp, "title");
            var answer = MessageBox.Show(this,
                "删除实验档案「" + title + "」？\n\n整份目录会移到 _trash（可恢复），不会立刻销毁。",
                "确认删除", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning);
            if (answer != DialogResult.OK) return;
            try
            {
                var r = Obj(Api("DELETE", "/experiments/" + Uri.EscapeDataString(id), null));
                SetStatus(r.ContainsKey("ok") && Convert.ToBoolean(r["ok"])
                    ? "已删除：" + title + "（移入 _trash）"
                    : "删除失败：" + ToStr(r, "error"));
                RefreshList();
            }
            catch (Exception ex) { SetStatus("删除失败：" + ex.Message); }
        }

        // 删除当前选中的模板：二次确认 → 移到 _trash
        private void DeleteSelectedTemplate()
        {
            var item = templateCombo.SelectedItem as TemplateItem;
            if (item == null || string.IsNullOrEmpty(item.Id))
            {
                SetStatus("先在下拉里选中要删除的模板"); return;
            }
            var answer = MessageBox.Show(this,
                "删除模板「" + item.Name + "」？\n\n文件会移到 _trash（可恢复）。",
                "确认删除", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning);
            if (answer != DialogResult.OK) return;
            try
            {
                var r = Obj(Api("DELETE", "/report/templates/" + Uri.EscapeDataString(item.Id), null));
                SetStatus(r.ContainsKey("ok") && Convert.ToBoolean(r["ok"])
                    ? "已删除模板：" + item.Name
                    : "删除失败：" + ToStr(r, "error"));
                RefreshTemplates();
            }
            catch (Exception ex) { SetStatus("删除失败：" + ex.Message); }
        }

        private void LoadSelection()
        {
            if (list.SelectedItems.Count == 0) return;
            var exp = list.SelectedItems[0].Tag as Dictionary<string, object>;
            if (exp != null)
            {
                if (requirementBox != null) requirementBox.Text = ToStr(exp, "requirementPath");
                if (datasetBox != null) datasetBox.Text = ToStr(exp, "datasetPath");
                SetStatus("已选中：" + ToStr(exp, "title") + "（" + ToStr(exp, "software") + "）");
            }
        }

        private void SetStatus(string text)
        {
            statusLabel.Text = text;
        }

        private static string ToStr(Dictionary<string, object> data, string key)
        {
            return data.ContainsKey(key) ? Convert.ToString(data[key]) : "";
        }

        private static int ToInt(Dictionary<string, object> data, string key)
        {
            if (!data.ContainsKey(key)) return 0;
            try { return Convert.ToInt32(data[key]); } catch { return 0; }
        }

        private static string Api(string method, string path, string json)
        {
            try
            {
                var url = Program.ApiBase + path + "?token=" + Program.ApiToken;
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = method;
                if (json != null)
                {
                    request.ContentType = "application/json";
                    var bytes = Encoding.UTF8.GetBytes(json);
                    request.ContentLength = bytes.Length;
                    using (var stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
                }
                using (var response = request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    return reader.ReadToEnd();
            }
            catch (Exception error)
            {
                return Program.Json.Serialize(new Dictionary<string, object> { { "ok", false }, { "error", error.Message } });
            }
        }

        private static Dictionary<string, object> Obj(string json)
        {
            try { return Program.Json.Deserialize<Dictionary<string, object>>(json) ?? new Dictionary<string, object>(); }
            catch { return new Dictionary<string, object> { { "ok", false }, { "error", "返回不是 JSON" } }; }
        }
    }

    internal static class Native
    {
        [StructLayout(LayoutKind.Sequential)]
        internal struct RECT { public int Left, Top, Right, Bottom; }

        [DllImport("user32.dll")]
        internal static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

        [DllImport("user32.dll")]
        internal static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);

        [DllImport("user32.dll")]
        internal static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        internal static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        internal static extern bool ShowWindow(IntPtr hWnd, int cmd);

        [DllImport("user32.dll")]
        internal static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        internal static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        internal static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);

        [DllImport("user32.dll")]
        internal static extern bool IsZoomed(IntPtr hWnd);

        [DllImport("user32.dll")]
        internal static extern bool SetCursorPos(int x, int y);

        [DllImport("user32.dll")]
        internal static extern bool GetCursorPos(out POINT point);

        [DllImport("user32.dll")]
        internal static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);

        [StructLayout(LayoutKind.Sequential)]
        internal struct POINT { public int X; public int Y; }

        internal const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        internal const uint MOUSEEVENTF_LEFTUP = 0x0004;

        [DllImport("user32.dll")]
        internal static extern IntPtr WindowFromPoint(POINT point);

        [DllImport("user32.dll")]
        internal static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

        [DllImport("user32.dll")]
        internal static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);

        [DllImport("user32.dll")]
        internal static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

        [DllImport("user32.dll")]
        internal static extern bool GetClientRect(IntPtr hWnd, out RECT rect);

        [DllImport("user32.dll")]
        internal static extern uint GetDpiForWindow(IntPtr hWnd);

        [DllImport("kernel32.dll")]
        internal static extern IntPtr GetCurrentProcess();

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

        [DllImport("advapi32.dll", SetLastError = true)]
        internal static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        internal static extern bool GetTokenInformation(IntPtr tokenHandle, int tokenInformationClass,
            ref TOKEN_ELEVATION tokenInformation, uint tokenInformationLength, out uint returnLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool CloseHandle(IntPtr handle);

        internal struct TOKEN_ELEVATION { public uint TokenIsElevated; }

        // 当前进程（DSH / 伴随进程）是否以管理员身份运行
        internal static bool CurrentProcessElevated()
        {
            return TokenElevated(GetCurrentProcess(), false);
        }

        // 目标进程是否管理员；拿不到句柄时按「与自身同级」处理，避免误报
        internal static bool ProcessElevated(int pid)
        {
            IntPtr proc = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
            if (proc == IntPtr.Zero) return CurrentProcessElevated();
            try { return TokenElevated(proc, true); }
            finally { CloseHandle(proc); }
        }

        private static bool TokenElevated(IntPtr process, bool isTarget)
        {
            IntPtr token = IntPtr.Zero;
            if (process == IntPtr.Zero) return false;
            try
            {
                if (process != GetCurrentProcess() && !isTarget) return false;
                if (!OpenProcessToken(process, 0x0008, out token)) return false; // TOKEN_QUERY
                var elevation = new TOKEN_ELEVATION();
                uint size;
                if (!GetTokenInformation(token, 20, ref elevation,
                        (uint)Marshal.SizeOf(typeof(TOKEN_ELEVATION)), out size)) return false;
                return elevation.TokenIsElevated != 0;
            }
            catch { return false; }
            finally { if (token != IntPtr.Zero) CloseHandle(token); }
        }

        // 统一坐标系：对外只暴露「屏幕物理像素」，同时把 DPI 一起回报，方便换算
        internal static double ScaleOf(IntPtr hWnd)
        {
            try
            {
                uint dpi = GetDpiForWindow(hWnd);
                if (dpi == 0) dpi = 96;
                return dpi / 96.0;
            }
            catch { return 1.0; }
        }

        internal static Dictionary<string, object> CoordInfo(IntPtr hWnd)
        {
            double scale = ScaleOf(hWnd);
            RECT rect;
            int w = 0, h = 0;
            try { if (GetWindowRect(hWnd, out rect)) { w = rect.Right - rect.Left; h = rect.Bottom - rect.Top; } }
            catch { }
            return new Dictionary<string, object>
            {
                { "coordSpace", "physical" },
                { "dpi", (int)Math.Round(scale * 96) },
                { "scale", Math.Round(scale, 2) },
                { "logicalW", (int)Math.Round(w / scale) },
                { "logicalH", (int)Math.Round(h / scale) },
            };
        }

        [DllImport("user32.dll")]
        internal static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);

        // 客户区左上角的屏幕坐标（不含标题栏与边框）
        internal static Point ClientOrigin(IntPtr hWnd)
        {
            var origin = new POINT { X = 0, Y = 0 };
            try { ClientToScreen(hWnd, ref origin); } catch { /* 忽略 */ }
            return new Point(origin.X, origin.Y);
        }

        internal static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        internal static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
        internal const uint SWP_NOSIZE = 0x0001;
        internal const uint SWP_NOMOVE = 0x0002;
        internal const uint SWP_NOACTIVATE = 0x0010;

        // 该屏幕点是否属于指定进程的窗口（含子控件）
        internal static bool PointBelongsTo(IntPtr target, int x, int y)
        {
            var probe = new POINT { X = x, Y = y };
            IntPtr at = WindowFromPoint(probe);
            if (at == IntPtr.Zero) return false;
            IntPtr top = GetAncestor(at, 2);
            uint targetPid;
            GetWindowThreadProcessId(target, out targetPid);
            uint atPid;
            GetWindowThreadProcessId(top == IntPtr.Zero ? at : top, out atPid);
            return atPid == targetPid;
        }

        private const uint WM_SYSCOMMAND = 0x0112;
        private static readonly IntPtr SC_RESTORE = new IntPtr(0xF120);

        // 供外部处理器复用（HandlePlace）
        internal const uint WM_SYSCOMMAND_MSG = 0x0112;
        internal static readonly IntPtr SC_RESTORE_CMD = new IntPtr(0xF120);
        internal static readonly IntPtr SC_MAXIMIZE_CMD = new IntPtr(0xF030);

        // 最小化的窗口坐标是 -48000，直接据此画高亮会跑到屏幕外，
        // 所以引导/截图前先把目标窗口恢复出来并前置。
        internal static void EnsureRestored(IntPtr hWnd)
        {
            if (hWnd == IntPtr.Zero) return;
            if (IsIconic(hWnd))
            {
                // 实测：eNSP 这类 MFC/Qt 程序对 ShowWindow(SW_RESTORE) 不响应
                // （调用后 IsIconic 仍为真、矩形还是 -48000），
                // 必须发 WM_SYSCOMMAND + SC_RESTORE 给它自己的窗口过程处理。
                PostMessage(hWnd, WM_SYSCOMMAND, SC_RESTORE, IntPtr.Zero);
                System.Threading.Thread.Sleep(250);
                if (IsIconic(hWnd))
                {
                    ShowWindow(hWnd, 9); // SW_RESTORE，对普通 Win32 程序有效
                    System.Threading.Thread.Sleep(300);
                }
            }
            try { SetForegroundWindow(hWnd); } catch { }
            System.Threading.Thread.Sleep(150);
        }

        [DllImport("user32.dll")]
        internal static extern int GetWindowTextLength(IntPtr hWnd);

        internal delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        internal static extern bool EnumWindows(EnumProc callback, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        internal static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder text, int count);

        internal const uint PW_RENDERFULLCONTENT = 2;
    }

    internal static class WindowFinder
    {
        // 列出所有候选窗口（可见 + 有面积），按面积从大到小，便于报错时把选项直接给出去
        internal static List<Dictionary<string, object>> ListWindows(string title, string processName, int max = 8)
        {
            var list = new List<Dictionary<string, object>>();
            var rx = BuildPattern(title);
            bool noFilter = string.IsNullOrEmpty(processName) && rx == null && string.IsNullOrEmpty(title);

            // 用 EnumWindows 而不是 Process.MainWindowHandle：
            // 后者对 UWP（Win11 记事本等）和子窗口常返回 0，实测会「明明在屏幕上却找不到」
            Native.EnumWindows(delegate(IntPtr h, IntPtr l)
            {
                try
                {
                    if (!Native.IsWindowVisible(h)) return true;
                    int len = Native.GetWindowTextLength(h);
                    if (len <= 0) return true;
                    var sb = new System.Text.StringBuilder(len + 2);
                    Native.GetWindowTextW(h, sb, sb.Capacity);
                    string winTitle = sb.ToString();
                    Native.RECT rect;
                    if (!Native.GetWindowRect(h, out rect)) return true;
                    int w = rect.Right - rect.Left, hh = rect.Bottom - rect.Top;
                    if (w < 60 || hh < 40) return true;

                    uint pid;
                    Native.GetWindowThreadProcessId(h, out pid);
                    string pname = "";
                    try { pname = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { }

                    bool processMatch = !string.IsNullOrEmpty(processName)
                        && pname.IndexOf(processName, StringComparison.OrdinalIgnoreCase) >= 0;
                    bool titleMatch = rx != null
                        ? rx.IsMatch(winTitle)
                        : (!string.IsNullOrEmpty(title) && winTitle.IndexOf(title, StringComparison.OrdinalIgnoreCase) >= 0);

                    if (!noFilter && !processMatch && !titleMatch) return true;
                    list.Add(new Dictionary<string, object>
                    {
                        { "pid", (int)pid },
                        { "process", pname },
                        { "title", winTitle },
                        { "handle", h.ToString() },
                        { "w", w }, { "h", hh },
                        { "area", w * hh },
                        { "matched", processMatch && titleMatch ? "both" : (processMatch ? "process" : "title") },
                    });
                }
                catch { }
                return true;
            }, IntPtr.Zero);

            list.Sort((a, b) => Convert.ToInt64(b["area"]).CompareTo(Convert.ToInt64(a["area"])));
            if (list.Count > max) list.RemoveRange(max, list.Count - max);
            return list;
        }

        // 标题支持 /正则/ 写法；「进程名 + 标题」都命中且面积最大的那个优先
        private static Regex BuildPattern(string title)
        {
            if (string.IsNullOrEmpty(title) || title.Length < 3) return null;
            if (!(title.StartsWith("/") && title.EndsWith("/"))) return null;
            try { return new Regex(title.Substring(1, title.Length - 2), RegexOptions.IgnoreCase); }
            catch { return null; }
        }

        internal static Dictionary<string, object> FindWindow(string title, string processName)
        {
            int pid = 0;
            string t = title, pn = processName;
            // 支持 "pid:1234" 精确指定
            if (!string.IsNullOrEmpty(title) && title.StartsWith("pid:", StringComparison.OrdinalIgnoreCase))
            {
                int.TryParse(title.Substring(4).Trim(), out pid);
                t = "";
            }
            if (pid > 0)
            {
                var byPid = new List<Dictionary<string, object>>();
                foreach (var p in Process.GetProcesses())
                {
                    try
                    {
                        if (p.Id != pid) continue;
                        IntPtr h = p.MainWindowHandle;
                        if (h == IntPtr.Zero || !Native.IsWindowVisible(h)) continue;
                        byPid.Add(new Dictionary<string, object>
                        {
                            { "pid", p.Id }, { "process", p.ProcessName }, { "title", p.MainWindowTitle ?? "" },
                            { "handle", h.ToString() },
                        });
                    }
                    catch { }
                }
                return byPid.Count > 0 ? byPid[0] : null;
            }
            var candidates = ListWindows(t, pn, 1);
            if (candidates.Count == 0) return null;
            var best = candidates[0];
            return new Dictionary<string, object>
            {
                { "pid", best["pid"] },
                { "process", best["process"] },
                { "title", best["title"] },
                { "handle", best["handle"] },
            };
        }

        // 找不到窗口时统一给「可用窗口列表」，让 agent / 用户自己挑，而不是干巴巴一句"没找到"
        internal static Dictionary<string, object> NoWindowError(string title, string processName)
        {
            var all = new List<Dictionary<string, object>>();
            foreach (var c in ListWindows("", "", 6)) { c.Remove("matched"); all.Add(c); }
            return new Dictionary<string, object>
            {
                { "ok", false },
                { "error", "没有找到匹配的窗口" },
                { "hint", "下面是当前可见的窗口，可改用 process / 精确标题 / pid:<数字> 重试" },
                { "queried", new Dictionary<string, object> { { "title", title }, { "process", processName } } },
                { "candidates", all },
            };
        }

        internal static Dictionary<string, object> WindowRect(IntPtr handle)
        {
            Native.RECT rect;
            if (!Native.GetWindowRect(handle, out rect)) return null;
            return new Dictionary<string, object>
            {
                { "x", rect.Left }, { "y", rect.Top },
                { "w", rect.Right - rect.Left }, { "h", rect.Bottom - rect.Top },
            };
        }

        internal static AutomationElement FindControl(IntPtr handle, string controlName)
        {
            var root = AutomationElement.FromHandle(handle);
            if (root == null || string.IsNullOrEmpty(controlName)) return null;
            return root.FindFirst(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.NameProperty, controlName));
        }

        internal static List<Dictionary<string, object>> InspectControls(IntPtr handle, int max)
        {
            var result = new List<Dictionary<string, object>>();
            var root = AutomationElement.FromHandle(handle);
            if (root == null) return result;
            var windowRect = WindowRect(handle);
            int wx = Convert.ToInt32(windowRect["x"]), wy = Convert.ToInt32(windowRect["y"]);
            var elements = root.FindAll(TreeScope.Descendants, Condition.TrueCondition);
            foreach (AutomationElement element in elements)
            {
                if (result.Count >= max) break;
                try
                {
                    string name = element.Current.Name;
                    if (string.IsNullOrEmpty(name)) continue;
                    var rect = element.Current.BoundingRectangle;
                    if (rect.IsEmpty) continue;
                    result.Add(new Dictionary<string, object>
                    {
                        { "name", name },
                        { "type", element.Current.ControlType.ProgrammaticName.Replace("ControlType.", "") },
                        {
                            "rect", new Dictionary<string, object>
                            {
                                { "x", (int)rect.X }, { "y", (int)rect.Y },
                                { "w", (int)rect.Width }, { "h", (int)rect.Height },
                            }
                        },
                        { "rel", new Dictionary<string, object>
                            {
                                { "x", (int)rect.X - wx }, { "y", (int)rect.Y - wy },
                                { "w", (int)rect.Width }, { "h", (int)rect.Height },
                            }
                        },
                    });
                }
                catch { }
            }
            return result;
        }
    }

    internal static class Server
    {
        private static string token;
        private static TcpListener listener;

        internal static void Start(int port, string tokenValue)
        {
            token = tokenValue;
            listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();
            new Thread(Listen) { IsBackground = true }.Start();
        }

        private static void Listen()
        {
            while (true)
            {
                TcpClient client;
                try { client = listener.AcceptTcpClient(); }
                catch { return; }
                new Thread(() => HandleClient(client)) { IsBackground = true }.Start();
            }
        }

        private class Request
        {
            internal string Path;
            internal string Query;
            internal string Body;
        }

        private static int IndexOf(byte[] haystack, byte[] needle, int start)
        {
            for (int i = start; i <= haystack.Length - needle.Length; i++)
            {
                bool match = true;
                for (int j = 0; j < needle.Length; j++)
                {
                    if (haystack[i + j] != needle[j]) { match = false; break; }
                }
                if (match) return i;
            }
            return -1;
        }

        private static Request ReadRequest(NetworkStream stream)
        {
            using (var ms = new MemoryStream())
            {
                byte[] buf = new byte[4096];
                int headerEnd = -1;
                while (true)
                {
                    int n = stream.Read(buf, 0, buf.Length);
                    if (n <= 0) break;
                    ms.Write(buf, 0, n);
                    byte[] arr = ms.ToArray();
                    headerEnd = IndexOf(arr, new byte[] { 13, 10, 13, 10 }, 0);
                    if (headerEnd >= 0) break;
                    if (ms.Length > 2097152) break;   // 头部+体总上限 2MB，避免被塞爆内存
                }
                byte[] all = ms.ToArray();
                if (headerEnd < 0) headerEnd = all.Length;
                string headerText = Encoding.UTF8.GetString(all, 0, headerEnd);
                string[] headerLines = headerText.Split(new[] { "\r\n" }, StringSplitOptions.None);
                if (headerLines.Length == 0) return null;
                string[] parts = headerLines[0].Split(' ');
                if (parts.Length < 2) return null;
                string url = parts[1];
                int q = url.IndexOf('?');
                string path = q >= 0 ? url.Substring(0, q) : url;
                string query = q >= 0 ? url.Substring(q) : "";
                int contentLength = 0;
                for (int i = 1; i < headerLines.Length; i++)
                {
                    if (headerLines[i].StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                    {
                        int.TryParse(headerLines[i].Substring(15).Trim(), out contentLength);
                    }
                }
                int bodyStart = headerEnd + 4;
                byte[] bodyBytes;
                if (contentLength > 0 && all.Length >= bodyStart + contentLength)
                {
                    bodyBytes = new byte[contentLength];
                    Array.Copy(all, bodyStart, bodyBytes, 0, contentLength);
                }
                else if (contentLength > 0)
                {
                    using (var bodyMs = new MemoryStream())
                    {
                        if (all.Length > bodyStart) bodyMs.Write(all, bodyStart, all.Length - bodyStart);
                        int remain = contentLength - (all.Length - bodyStart);
                        byte[] rbuf = new byte[4096];
                        while (remain > 0)
                        {
                            int rn = stream.Read(rbuf, 0, Math.Min(rbuf.Length, remain));
                            if (rn <= 0) break;
                            bodyMs.Write(rbuf, 0, rn);
                            remain -= rn;
                        }
                        bodyBytes = bodyMs.ToArray();
                    }
                }
                else
                {
                    bodyBytes = new byte[0];
                }
                return new Request { Path = path, Query = query, Body = Encoding.UTF8.GetString(bodyBytes) };
            }
        }

        private static void HandleClient(TcpClient client)
        {
            try
            {
                client.ReceiveTimeout = 10000;
                client.SendTimeout = 10000;
                using (client)
                using (var stream = client.GetStream())
                {
                    Request request = ReadRequest(stream);
                    if (request == null) return;
                    if (!request.Query.Contains("token=" + token))
                    {
                        WriteJson(stream, new Dictionary<string, object> { { "ok", false }, { "error", "token 不匹配" } });
                        return;
                    }
                    WriteJson(stream, Dispatch(request.Path, request.Body));
                }
            }
            catch { }
        }

        private static Dictionary<string, object> Dispatch(string path, string body)
        {
            Dictionary<string, object> payload = string.IsNullOrEmpty(body)
                ? new Dictionary<string, object>()
                : Program.Json.Deserialize<Dictionary<string, object>>(body) ?? new Dictionary<string, object>();
            switch (path)
            {
                case "/status": return Status();
                case "/pet": return HandlePet(payload);
                case "/guide": return HandleGuide(payload);
                case "/place": return HandlePlace(payload);
                case "/click": return HandleClick(payload);
                case "/tutorial": return HandleTutorial(payload);
                case "/tutorial/next": TutorialAdvance(); return new Dictionary<string, object> { { "ok", true }, { "index", tutorialIndex } };
                case "/clear":
                    Program.InvokeOnPet(delegate { Program.Highlight.Clear(); Program.Bubble.Hide(); });
                    return new Dictionary<string, object> { { "ok", true } };
                case "/screenshot": return HandleScreenshot(payload);
                case "/inspect": return HandleInspect(payload);
                case "/quit":
                    Program.Config.Save();
                    new Thread(delegate () { Thread.Sleep(200); Application.Exit(); }).Start();
                    return new Dictionary<string, object> { { "ok", true }, { "bye", true } };
                default:
                    return new Dictionary<string, object> { { "ok", false }, { "error", "unknown path" } };
            }
        }

        private static void WriteJson(NetworkStream stream, Dictionary<string, object> data)
        {
            byte[] body = Encoding.UTF8.GetBytes(Program.Json.Serialize(data));
            string header = "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: " + body.Length + "\r\nConnection: close\r\n\r\n";
            byte[] headerBytes = Encoding.UTF8.GetBytes(header);
            stream.Write(headerBytes, 0, headerBytes.Length);
            stream.Write(body, 0, body.Length);
            stream.Flush();
        }

        private static Dictionary<string, object> Status()
        {
            Dictionary<string, object> pet = null;
            Program.InvokeOnPetSync(delegate
            {
                pet = new Dictionary<string, object>
                {
                    { "x", Program.Pet.Left }, { "y", Program.Pet.Top },
                    { "w", Program.Pet.Width }, { "h", Program.Pet.Height },
                    { "visible", Program.Pet.Visible },
                };
            });
            return new Dictionary<string, object>
            {
                { "ok", true },
                { "name", Program.Config.name },
                { "pet", pet ?? new Dictionary<string, object>() },
                { "state", Program.Pet != null && !Program.Pet.IsDisposed ? Program.Pet.CurrentState : "idle" },
                { "chatter", Program.Config.chatter },
                { "wander", Program.Config.wander },
                { "version", "1.0.0" },
            };
        }

        private static Dictionary<string, object> HandlePet(Dictionary<string, object> payload)
        {
            string action = Convert.ToString(payload.ContainsKey("action") ? payload["action"] : "show");
            Program.InvokeOnPet(delegate
            {
                if (action == "hide") Program.Pet.Hide();
                else if (action == "show") Program.Pet.Show();
                else if (action == "rename" && payload.ContainsKey("name"))
                {
                    Program.Config.name = Convert.ToString(payload["name"]);
                    Program.Config.Save();
                    if (Program.Panel != null && !Program.Panel.IsDisposed) Program.Panel.ApplyName();
                }
                else if (action == "size" && payload.ContainsKey("size"))
                {
                    Program.Config.petSize = Convert.ToInt32(payload["size"]);
                    Program.Config.Save();
                    Program.Pet.ApplyConfig();
                }
                else if (action == "move" && payload.ContainsKey("x") && payload.ContainsKey("y"))
                {
                    Program.Pet.Location = new Point(Convert.ToInt32(payload["x"]), Convert.ToInt32(payload["y"]));
                    Program.Config.x = Program.Pet.Left; Program.Config.y = Program.Pet.Top; Program.Config.Save();
                }
                else if (action == "state" && payload.ContainsKey("state"))
                {
                    Program.Pet.SetState(Convert.ToString(payload["state"]), payload.ContainsKey("durationMs") ? Convert.ToInt32(payload["durationMs"]) : 3500);
                }
                else if (action == "panel")
                {
                    // open/close/toggle：不传 open 时按切换处理
                    bool wantOpen;
                    if (payload.ContainsKey("open")) wantOpen = Convert.ToBoolean(payload["open"]);
                    else wantOpen = Program.Panel == null || Program.Panel.IsDisposed || !Program.Panel.Visible;
                    bool isOpen = Program.Panel != null && !Program.Panel.IsDisposed && Program.Panel.Visible;
                    if (wantOpen != isOpen) Program.TogglePanel(Program.Pet.Left, Program.Pet.Top, Program.Config.petSize);
                    if (wantOpen && Program.Panel != null && !Program.Panel.IsDisposed) Program.Panel.BringToFront();
                }
                else if (action == "say" && payload.ContainsKey("text"))
                {
                    Program.Pet.Say(Convert.ToString(payload["text"]), payload.ContainsKey("durationMs") ? Convert.ToInt32(payload["durationMs"]) : 6000);
                }
            });
            return new Dictionary<string, object> { { "ok", true }, { "action", action } };
        }

        // 可控点击：默认真点；只有显式传 confirm:false 才退化为预演（移动光标 + 高亮，不按键）
        private static Dictionary<string, object> HandleClick(Dictionary<string, object> payload)
        {
            string title = Get(payload, "title");
            string processName = Get(payload, "process");
            int x = Int(payload, "x", 0);
            int y = Int(payload, "y", 0);
            bool relative = !payload.ContainsKey("relative") || Convert.ToBoolean(payload["relative"]);
            // 默认直接点击；只有显式传 confirm:false 才退化为预演
            bool confirm = !payload.ContainsKey("confirm") || Convert.ToBoolean(payload["confirm"]);
            int count = Math.Max(1, Math.Min(3, Int(payload, "count", 1)));

            var found = WindowFinder.FindWindow(title, processName);
            if (found == null)
            {
                return WindowFinder.NoWindowError(title, processName);
            }
            IntPtr handle = new IntPtr(Convert.ToInt64(found["handle"]));
            // UIPI：Windows 不允许低完整性进程向高完整性窗口发消息/模拟输入。
            // eNSP 这类 requireAdministrator 程序，非管理员 DSH 点了等于没点，必须提前拦住。
            bool selfElevated = Native.CurrentProcessElevated();
            bool targetElevated = Native.ProcessElevated(Convert.ToInt32(found["pid"]));
            if (targetElevated && !selfElevated)
            {
                return new Dictionary<string, object>
                {
                    { "ok", false },
                    { "error", "目标程序以管理员身份运行，而 DSH 不是管理员：点击会被系统(UIPI)拦掉。请以管理员身份重启 DSH。" },
                    { "window", Convert.ToString(found["title"]) },
                    { "elevated", false },
                    { "targetElevated", true },
                    { "coordSpace", "physical" },
                };
            }
            Native.EnsureRestored(handle);
            var rect = WindowFinder.WindowRect(handle);
            if (rect == null)
            {
                return new Dictionary<string, object> { { "ok", false }, { "error", "拿不到窗口位置" } };
            }
            int left = Convert.ToInt32(rect["x"]);
            int top = Convert.ToInt32(rect["y"]);
            int width = Convert.ToInt32(rect["w"]);
            int height = Convert.ToInt32(rect["h"]);
            int px = relative ? left + x : x;
            int py = relative ? top + y : y;

            // 越界即拒绝：绝不点窗口外的东西
            if (px <= left + 2 || px >= left + width - 2 || py <= top + 2 || py >= top + height - 2)
            {
                return new Dictionary<string, object>
                {
                    { "ok", false },
                    { "error", "目标点在窗口之外，已拒绝执行" },
                    { "window", Convert.ToString(found["title"]) },
                    { "rect", rect },
                    { "requested", new Dictionary<string, object> { { "x", px }, { "y", py } } },
                };
            }

            // 只靠 SetForegroundWindow 不可靠（实测常被系统拒绝，点击会落到前台窗口上），
            // 用 topmost 切换把目标窗口提到 z 序最前。
            Native.SetWindowPos(handle, Native.HWND_TOPMOST, 0, 0, 0, 0,
                Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
            Native.SetWindowPos(handle, Native.HWND_NOTOPMOST, 0, 0, 0, 0,
                Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
            System.Threading.Thread.Sleep(220);

            // 安全闸：该坐标点必须真属于目标进程，否则一律拒绝（防止点到别的窗口）
            if (!Native.PointBelongsTo(handle, px, py))
            {
                return new Dictionary<string, object>
                {
                    { "ok", false },
                    { "error", "目标位置当前被其它窗口遮挡，已拒绝点击。请先把目标软件切到最前再试。" },
                    { "window", Convert.ToString(found["title"]) },
                    { "point", new Dictionary<string, object> { { "x", px }, { "y", py } } },
                };
            }

            Native.SetCursorPos(px, py);
            Program.InvokeOnPet(delegate
            {
                Program.MovePetAwayFrom(new Rectangle(px - 40, py - 40, 80, 80));
                Program.Highlight.Highlight(new Rectangle(px - 26, py - 26, 52, 52), confirm ? 900 : 1800);
            });

            var point = new Dictionary<string, object> { { "x", px }, { "y", py } };
            if (!confirm)
            {
                var previewResult = new Dictionary<string, object>
                {
                    { "ok", true },
                    { "clicked", false },
                    { "preview", true },
                    { "window", Convert.ToString(found["title"]) },
                    { "rect", rect },
                    { "point", point },
                    { "elevated", selfElevated },
                    { "targetElevated", targetElevated },
                    { "note", "预演：光标已移到目标并高亮，没有点击。确认这个位置安全后，再传 confirm:true 执行。" },
                };
                foreach (var kv in Native.CoordInfo(handle)) previewResult[kv.Key] = kv.Value;
                return previewResult;
            }

            Native.SetForegroundWindow(handle);
            System.Threading.Thread.Sleep(200);
            for (int i = 0; i < count; i++)
            {
                Native.mouse_event(Native.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                System.Threading.Thread.Sleep(45);
                Native.mouse_event(Native.MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                System.Threading.Thread.Sleep(180);
            }
            try
            {
                string logDir = Program.Config != null && !string.IsNullOrEmpty(Program.Config.Dir)
                    ? Program.Config.Dir
                    : AppDomain.CurrentDomain.BaseDirectory;
                System.IO.File.AppendAllText(
                    System.IO.Path.Combine(logDir, "clicks.log"),
                    string.Format("{0}\t({1},{2})\t'{3}'\tx{4}\n", DateTime.Now.ToString("s"), px, py, Convert.ToString(found["title"]), count));
            }
            catch { /* 日志失败不影响点击 */ }

            var clickResult = new Dictionary<string, object>
            {
                { "ok", true },
                { "clicked", true },
                { "count", count },
                { "window", Convert.ToString(found["title"]) },
                { "rect", rect },
                { "point", point },
                { "elevated", selfElevated },
                { "note", "已点击。请用 desktop_screenshot 截图核对结果，再记录实测值。" },
            };
            foreach (var kv in Native.CoordInfo(handle)) clickResult[kv.Key] = kv.Value;
            return clickResult;
        }

        // 把目标窗口摆到固定矩形：截图基准一致、可对比、图片更小（省 token）
        private static Dictionary<string, object> HandlePlace(Dictionary<string, object> payload)
        {
            string title = Get(payload, "title");
            string processName = Get(payload, "process");
            int width = Int(payload, "width", 1280);
            int height = Int(payload, "height", 800);
            var found = WindowFinder.FindWindow(title, processName);
            if (found == null)
            {
                return WindowFinder.NoWindowError(title, processName);
            }
            IntPtr handle = new IntPtr(Convert.ToInt64(found["handle"]));
            // 最小化或被最大化时先还原，否则 MoveWindow 不生效
            if (Native.IsIconic(handle) || Native.IsZoomed(handle))
            {
                Native.PostMessage(handle, Native.WM_SYSCOMMAND_MSG, Native.SC_RESTORE_CMD, IntPtr.Zero);
                System.Threading.Thread.Sleep(300);
                if (Native.IsIconic(handle) || Native.IsZoomed(handle))
                {
                    Native.ShowWindow(handle, 9);
                    System.Threading.Thread.Sleep(300);
                }
            }
            var area = Screen.FromHandle(handle).WorkingArea;
            width = Math.Max(640, Math.Min(width, area.Width - 40));
            height = Math.Max(480, Math.Min(height, area.Height - 40));
            int x = area.Left + 20;
            int y = area.Top + 20;
            Native.MoveWindow(handle, x, y, width, height, true);
            System.Threading.Thread.Sleep(450);
            var rect = WindowFinder.WindowRect(handle);
            // 有些程序（实测 eNSP）拒绝外部改几何：MoveWindow 返回 False 且矩形不变。
            // 这时不要假装成功，要如实回报并给出可操作建议。
            bool applied = rect != null
                && Math.Abs(Convert.ToInt32(rect["w"]) - width) <= 24
                && Math.Abs(Convert.ToInt32(rect["h"]) - height) <= 24;
            var result = new Dictionary<string, object>
            {
                { "ok", true },
                { "window", Convert.ToString(found["title"]) },
                { "rect", rect },
                { "applied", applied },
            };
            if (applied)
            {
                result["note"] = "窗口已归位到固定矩形；后续截图与指引都以此为准";
                result["fallback"] = "";
                return result;
            }
            // 拒绝改尺寸的程序（eNSP 实测）：改为最大化——尺寸稳定，截图基准同样一致
            try
            {
                Native.PostMessage(handle, Native.WM_SYSCOMMAND_MSG, Native.SC_MAXIMIZE_CMD, IntPtr.Zero);
                System.Threading.Thread.Sleep(500);
                var maximized = WindowFinder.WindowRect(handle);
                bool isMax = Native.IsZoomed(handle);
                result["fallback"] = isMax ? "maximize" : "none";
                result["rect"] = maximized ?? rect;
                result["note"] = isMax
                    ? "该软件拒绝外部改动窗口几何，已改用「最大化」：尺寸固定，截图基准一致。"
                    : "该软件既拒绝改尺寸也拒绝最大化。请手动把它拖成固定大小并别再改，之后截图基准仍然一致。";
            }
            catch
            {
                result["fallback"] = "none";
                result["note"] = "该软件拒绝外部调整窗口大小/位置；请手动固定窗口大小后再继续。";
            }
            return result;
        }

        private static Dictionary<string, object> HandleTutorial(Dictionary<string, object> payload)
        {
            LoadTutorial(payload);
            return new Dictionary<string, object>
            {
                { "ok", TutorialActive },
                { "steps", tutorialSteps.Count },
                { "index", tutorialIndex },
            };
        }

        // ───────── 教学循环（桌宠自己驱动，不依赖 DSH 在线）─────────
        internal sealed class TutorialStep
        {
            internal string Id = "";
            internal string Title = "";
            internal string Text = "";
            internal int X = -1, Y = -1, W = 0, H = 0, Pad = 36;
            internal string VerifyCmd = "";
            internal string VerifyExpect = "";
        }

        private static readonly List<TutorialStep> tutorialSteps = new List<TutorialStep>();
        private static int tutorialIndex = -1;
        private static string tutorialWindowTitle = "";
        private static string tutorialProcess = "";
        private static string tutorialClaimFile = "";
        // 由 DSH 通过 /tutorial 的 env 传入（如 MYSQL_PWD）；只在内存里，不写文件、不进命令行
        private static readonly Dictionary<string, string> tutorialEnv = new Dictionary<string, string>();

        internal static bool TutorialActive { get { return tutorialIndex >= 0 && tutorialIndex < tutorialSteps.Count; } }

        internal static void LoadTutorial(Dictionary<string, object> payload)
        {
            tutorialSteps.Clear();
            tutorialIndex = -1;
            tutorialWindowTitle = Get(payload, "windowTitle");
            tutorialProcess = Get(payload, "process");
            tutorialClaimFile = Get(payload, "claimFile");
            tutorialEnv.Clear();
            var envMap = payload.ContainsKey("env") ? payload["env"] as Dictionary<string, object> : null;
            if (envMap != null)
            {
                foreach (var kv in envMap)
                {
                    if (kv.Key == null) continue;
                    tutorialEnv[kv.Key] = kv.Value == null ? "" : Convert.ToString(kv.Value);
                }
            }
            var list = payload.ContainsKey("steps") ? payload["steps"] as System.Collections.IEnumerable : null;
            if (list != null)
            {
                foreach (var row in list)
                {
                    var item = row as Dictionary<string, object>;
                    if (item == null) continue;
                    tutorialSteps.Add(new TutorialStep
                    {
                        Id = Get(item, "id"),
                        Title = Get(item, "title"),
                        Text = Get(item, "text"),
                        X = Int(item, "x", -1),
                        Y = Int(item, "y", -1),
                        W = Int(item, "w", 0),
                        H = Int(item, "h", 0),
                        Pad = Int(item, "pad", 36),
                        VerifyCmd = Get(item, "verifyCmd"),
                        VerifyExpect = Get(item, "verifyExpect"),
                    });
                }
            }
            if (tutorialSteps.Count > 0) tutorialIndex = 0;
            ShowTutorialStep();
        }

        private static void ShowTutorialStep()
        {
            if (!TutorialActive) return;
            var step = tutorialSteps[tutorialIndex];
            var payload = new Dictionary<string, object>
            {
                { "title", tutorialWindowTitle },
                { "process", tutorialProcess },
                { "text", string.Format("[{0}/{1}] {2}\n{3}\n\n做好后点我一下～", tutorialIndex + 1, tutorialSteps.Count, step.Title, step.Text) },
                { "durationMs", 0 },
                { "sticky", true },
                { "pad", step.Pad },
                { "color", "yellow" },
            };
            if (step.X >= 0 && step.Y >= 0)
            {
                payload["x"] = step.X;
                payload["y"] = step.Y;
                if (step.W > 0) payload["w"] = step.W;
                if (step.H > 0) payload["h"] = step.H;
            }
            try { HandleGuide(payload); } catch { /* 指不到就算了，气泡仍然重要 */ }
        }

        // 本机 HTTP 不能被当成任意命令执行口：只放行常见实验/开发命令
        private static readonly string[] VerifyAllowed = new string[]
        {
            "mysql", "mysqladmin", "mysqldump", "python", "py", "pip", "git", "dotnet",
            "java", "javaw", "node", "npm", "dir", "type", "findstr", "echo", "ver", "whoami", "ping",
        };

        private static bool VerifyCommandAllowed(string command)
        {
            string text = (command ?? "").Trim();
            if (text.Length == 0) return false;
            // 白名单只认第一个 token，所以先把串联/重定向堵掉：
            // 否则 "echo hi & del /q ..." 的第一个 token 是 echo，照样能执行后面的任意命令。
            // 引号里的内容先剔掉，避免误杀 mysql -e "select 'a&b'" 这类正常参数。
            string scan = System.Text.RegularExpressions.Regex.Replace(text, "\"[^\"]*\"", "\"\"");
            for (int i = 0; i < scan.Length; i += 1)
            {
                char c = scan[i];
                if (c == '&' || c == '|' || c == '<' || c == '>' || c == '^' || c < (char)32) return false;
            }
            // 允许 "C:\Program Files\Python\python.exe" 这种带引号的完整路径
            string exe;
            if (text[0] == '"')
            {
                int close = text.IndexOf('"', 1);
                exe = close > 1 ? text.Substring(1, close - 1) : text.Trim('"');
            }
            else
            {
                int space = text.IndexOf(' ');
                exe = space > 0 ? text.Substring(0, space) : text;
            }
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

                // chcp 65001：把子进程的代码页切到 UTF-8，否则 cmd.exe 在中文系统上按 GBK 输出，
                // 与下面的 StandardOutputEncoding 对不上，verifyExpect 里的中文永远匹配不到。
                var info = new System.Diagnostics.ProcessStartInfo("cmd.exe", "/c chcp 65001 >nul & " + command)
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    StandardOutputEncoding = System.Text.Encoding.UTF8,
                    StandardErrorEncoding = System.Text.Encoding.UTF8,
                };
                // 只把 DSH 显式传入的变量写给子进程（口令走内存，不进命令行）
                foreach (var envItem in tutorialEnv)
                {
                    try { info.EnvironmentVariables[envItem.Key] = envItem.Value; } catch { }
                }
                // 不内置任何数据库口令：子进程默认继承父进程环境变量，
                // 需要密码时由使用者自己在环境里设置（例如 MYSQL_PWD=... 再启动 DSH）。
                using (var process = System.Diagnostics.Process.Start(info))
                {
                    // 两个管道都要异步读：先 ReadToEnd(stdout) 再读 stderr，输出 >4KB 会互相等死
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
                        // cmd.exe 被杀不代表孙进程（mysql 等）会退出，先连进程树一起结束
                        try
                        {
                            var killer = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(
                                "taskkill", "/PID " + process.Id + " /T /F")
                            { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true });
                            if (killer != null) { killer.WaitForExit(3000); killer.Dispose(); }
                        }
                        catch { }
                        try { process.Kill(); } catch { }
                        return "ERR 校验命令超时（15 秒），已终止：" + command;
                    }
                    process.WaitForExit();   // 异步读要等流读完，否则最后几行输出会丢
                    string outputText;
                    lock (output) lock (errorText) outputText = output.ToString() + errorText.ToString();
                    return outputText;
                }
            }
            catch (Exception error) { return "ERR " + error.Message; }
        }

        private static void AppendClaim(Dictionary<string, object> claim)
        {
            if (string.IsNullOrEmpty(tutorialClaimFile)) return;
            try
            {
                System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(tutorialClaimFile));
                string line = Program.Json.Serialize(claim);
                System.IO.File.AppendAllText(tutorialClaimFile, line + "\n", new System.Text.UTF8Encoding(false));
            }
            catch { /* 写不进去不影响流程 */ }
        }

        // 点一下桌宠：校验当前步骤，通过就自动进下一步
        internal static void TutorialAdvance()
        {
            if (!TutorialActive) return;
            var step = tutorialSteps[tutorialIndex];
            string output = string.IsNullOrEmpty(step.VerifyCmd) ? "" : RunVerify(step.VerifyCmd);
            bool expectOk = string.IsNullOrEmpty(step.VerifyExpect)
                || (output ?? "").IndexOf(step.VerifyExpect, StringComparison.OrdinalIgnoreCase) >= 0;
            // 校验命令自身出错（不在白名单 / 超时 / 启动失败）一律不算通过，
            // 否则错误文字里恰好含有 expect 子串时会把「被拒绝」判成「做对了」。
            bool verifyFailed = (output ?? "").StartsWith("ERR", StringComparison.OrdinalIgnoreCase);
            bool pass = string.IsNullOrEmpty(step.VerifyCmd) ? true : (expectOk && !verifyFailed);
            if (string.IsNullOrEmpty(step.VerifyCmd) && verifyFailed) pass = false;

            AppendClaim(new Dictionary<string, object>
            {
                { "stepId", step.Id },
                { "index", tutorialIndex + 1 },
                { "passed", pass },
                { "cmd", step.VerifyCmd },
                { "expect", step.VerifyExpect },
                { "output", (output ?? "").Length > 1200 ? output.Substring(0, 1200) : output },
                { "at", DateTime.Now.ToString("s") },
            });

            if (pass)
            {
                tutorialIndex += 1;
                if (TutorialActive)
                {
                    Program.InvokeOnPet(delegate
                    {
                        Program.Pet.ShowBubble("✓ 这一步对啦！" + (tutorialSteps.Count > tutorialIndex ? "继续下一步～" : ""), 2600);
                    });
                    ShowTutorialStep();
                }
                else
                {
                    Program.InvokeOnPet(delegate { Program.Pet.ShowBubble("全部完成啦～主人真棒！", 4000); });
                    try { Program.Highlight.Clear(); } catch { }
                }
            }
            else
            {
                Program.InvokeOnPet(delegate
                {
                    Program.Pet.ShowBubble("✗ 还没看到「" + step.VerifyExpect + "」，再弄一下再点我～", 4000);
                });
            }
        }

        private static Dictionary<string, object> HandleGuide(Dictionary<string, object> payload)
        {
            string title = Get(payload, "title");
            string processName = Get(payload, "process");
            string controlName = Get(payload, "control");
            string text = Get(payload, "text");
            int duration = Int(payload, "durationMs", 8000);

            var found = WindowFinder.FindWindow(title, processName);
            if (found == null)
            {
                return new Dictionary<string, object>
                {
                    { "ok", false },
                    { "error", string.IsNullOrEmpty(title) && string.IsNullOrEmpty(processName)
                        ? "需要 title 或 process 来定位窗口"
                        : "没有找到匹配的窗口，请确认软件已打开" },
                };
            }
            IntPtr handle = new IntPtr(Convert.ToInt64(found["handle"]));
            // 最小化的窗口先恢复，否则高亮框会画到屏幕外
            Native.EnsureRestored(handle);
            // 提到最前：不然学生看到的框会落在别的窗口上
            Native.SetWindowPos(handle, Native.HWND_TOPMOST, 0, 0, 0, 0,
                Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
            Native.SetWindowPos(handle, Native.HWND_NOTOPMOST, 0, 0, 0, 0,
                Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
            System.Threading.Thread.Sleep(180);
            var rect = WindowFinder.WindowRect(handle);
            string located = "window";
            if (!string.IsNullOrEmpty(controlName))
            {
                var element = WindowFinder.FindControl(handle, controlName);
                if (element != null)
                {
                    var controlRect = element.Current.BoundingRectangle;
                    if (!controlRect.IsEmpty)
                    {
                        rect = new Dictionary<string, object>
                        {
                            { "x", (int)controlRect.X }, { "y", (int)controlRect.Y },
                            { "w", (int)controlRect.Width }, { "h", (int)controlRect.Height },
                        };
                        located = "control";
                    }
                }
            }
            if (rect == null)
            {
                return new Dictionary<string, object> { { "ok", false }, { "error", "拿不到窗口位置" } };
            }
            var screenRect = new Rectangle(
                Convert.ToInt32(rect["x"]), Convert.ToInt32(rect["y"]),
                Convert.ToInt32(rect["w"]), Convert.ToInt32(rect["h"]));

            // 相对坐标：直接指向截图里看到的位置（不依赖控件名）
            // 默认以「客户区」为基准，避免把标题栏高度算进去造成偏移
            int rx = Int(payload, "x", -1);
            int ry = Int(payload, "y", -1);
            // 与 screenshot / click 保持一致：默认按整窗算，截图量出来的坐标可直接用
            bool useClient = payload.ContainsKey("client") && Convert.ToBoolean(payload["client"]);
            var windowRect = screenRect;
            if (rx >= 0 && ry >= 0)
            {
                int rw = Int(payload, "w", 0);
                int rh = Int(payload, "h", 0);
                if (rw <= 0) rw = 200;   // 宁大勿小：稍偏也能被看到
                if (rh <= 0) rh = 56;
                int ox = Int(payload, "offsetX", 0);
                int oy = Int(payload, "offsetY", 0);
                Point origin = useClient ? Native.ClientOrigin(handle) : new Point(windowRect.Left, windowRect.Top);
                screenRect = new Rectangle(origin.X + rx + ox, origin.Y + ry + oy, rw, rh);
                located = useClient ? "client" : "relative";
            }

            // 放大：宁可框偏大，也别让使用者找不到
            int pad = Int(payload, "pad", 36);
            if (pad > 0) screenRect = Rectangle.Inflate(screenRect, pad, pad);

            // 夹紧到窗口内，避免画到标题栏或窗口外面
            var clamp = windowRect;
            screenRect = Rectangle.Intersect(screenRect, clamp);
            if (screenRect.Width < 24 || screenRect.Height < 16) screenRect = clamp;

            // 钉住：学生做完这步之前一直留着
            bool sticky = payload.ContainsKey("sticky") && Convert.ToBoolean(payload["sticky"]);
            if (sticky) duration = -1;

            Color accentColor = Color.FromArgb(255, 214, 0);
            string colorName = Get(payload, "color");
            if (string.Equals(colorName, "red", StringComparison.OrdinalIgnoreCase))
                accentColor = Color.FromArgb(255, 232, 62, 84);
            Program.InvokeOnPet(delegate
            {
                // 桌宠别挡住要讲解的地方
                Program.MovePetAwayFrom(screenRect);
                Program.Pet.SetState("point", duration);
                Program.Highlight.Highlight(screenRect, duration, accentColor);
                Program.Pet.PositionNear(screenRect);
                if (!string.IsNullOrEmpty(text)) Program.Pet.ShowBubble(text, duration);
                else Program.Pet.ShowBubble("主人，看这里～", duration);
            });
            return new Dictionary<string, object>
            {
                { "ok", true },
                { "window", found["title"] },
                { "located", located },
                { "rect", rect },
                { "text", text },
            };
        }

        private static Dictionary<string, object> HandleScreenshot(Dictionary<string, object> payload)
        {
            string title = Get(payload, "title");
            string processName = Get(payload, "process");
            string output = Get(payload, "out");
            if (string.IsNullOrEmpty(output))
            {
                return new Dictionary<string, object> { { "ok", false }, { "error", "缺少 out 保存路径" } };
            }
            // 只允许写到实验的 screenshots 目录、临时目录或配置目录，避免任意可写文件被覆盖成 PNG
            string fullOut = null;
            try { fullOut = Path.GetFullPath(output); } catch { fullOut = null; }
            if (fullOut == null) return new Dictionary<string, object> { { "ok", false }, { "error", "out 路径非法" } };
            string outParent = Path.GetFileName(Path.GetDirectoryName(fullOut) ?? "");
            bool outAllowed = string.Equals(outParent, "screenshots", StringComparison.OrdinalIgnoreCase)
                || fullOut.StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase)
                || fullOut.StartsWith(Path.GetFullPath(Program.Config.Dir), StringComparison.OrdinalIgnoreCase);
            if (!outAllowed) return new Dictionary<string, object> { { "ok", false }, { "error", "out 必须位于实验 screenshots 目录、临时目录或配置目录内" } };
            output = fullOut;
            var found = WindowFinder.FindWindow(title, processName);
            if (found == null)
            {
                return WindowFinder.NoWindowError(title, processName);
            }
            IntPtr handle = new IntPtr(Convert.ToInt64(found["handle"]));
            // 最小化的窗口量出来的 rect / 截出来的图都不对：先恢复再取尺寸
            Native.EnsureRestored(handle);
            System.Threading.Thread.Sleep(120);
            Native.RECT rect;
            if (!Native.GetWindowRect(handle, out rect) || rect.Right <= rect.Left)
            {
                return new Dictionary<string, object> { { "ok", false }, { "error", "拿不到窗口大小" } };
            }
            int width = rect.Right - rect.Left;
            int height = rect.Bottom - rect.Top;
            // 桌宠是常驻置顶窗口：PrintWindow 拿不到它，但失败时的屏幕拷贝会把它拍进去（实测）。
            // 截图前先收起桌宠，截完立刻恢复。
            // 可能同时存在多个桌宠实例（SpawnAnotherPet），逐个按窗口隐藏，截完统一恢复
            var petWindows = new List<KeyValuePair<IntPtr, bool>>();
            try
            {
                // 桌宠窗口标题是 "lab-pet"，而且 MainWindowHandle 常为 0，只能靠 EnumWindows + 进程名判断
                Native.EnumWindows(delegate(IntPtr wh, IntPtr lp)
                {
                    try
                    {
                        if (!Native.IsWindowVisible(wh)) return true;
                        uint pid;
                        Native.GetWindowThreadProcessId(wh, out pid);
                        string pname = "";
                        try { pname = Process.GetProcessById((int)pid).ProcessName; } catch { }
                        if (!pname.StartsWith("LabPet", StringComparison.OrdinalIgnoreCase)) return true;
                        if (Native.ShowWindow(wh, 0)) petWindows.Add(new KeyValuePair<IntPtr, bool>(wh, true));
                    }
                    catch { }
                    return true;
                }, IntPtr.Zero);
                if (petWindows.Count > 0) System.Threading.Thread.Sleep(180);
            }
            catch { }
            bool petHidden = petWindows.Count > 0;
            bool petRestored = false;
            try
            {
            using (var bitmap = new Bitmap(width, height))
            using (var graphics = Graphics.FromImage(bitmap))
            {
                IntPtr hdc = graphics.GetHdc();
                bool rendered = Native.PrintWindow(handle, hdc, Native.PW_RENDERFULLCONTENT);
                graphics.ReleaseHdc(hdc);
                if (!rendered)
                {
                    // PrintWindow 对部分 DWM 合成窗口会失败并留下白图：退回屏幕拷贝，别把白图当证据存进报告
                    try { graphics.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height)); }
                    catch { }
                }
                Directory.CreateDirectory(Path.GetDirectoryName(output));
                bitmap.Save(output, ImageFormat.Png);
            }
            }
            finally
            {
                // 截完立刻把桌宠放回来（用户明确要求：只藏一瞬，不是常驻隐藏）
                foreach (var kv in petWindows)
                {
                    try
                    {
                        Native.ShowWindow(kv.Key, 5); // SW_SHOW
                        if (Native.IsWindowVisible(kv.Key)) petRestored = true;
                    }
                    catch { }
                }
            }
            var shotResult = new Dictionary<string, object>
            {
                { "ok", true },
                { "out", output },
                { "title", found["title"] },
                { "w", width }, { "h", height },
                { "petHidden", petHidden },
                { "petRestored", petRestored },
            };
            foreach (var kv in Native.CoordInfo(handle)) shotResult[kv.Key] = kv.Value;
            return shotResult;
        }

        private static Dictionary<string, object> HandleInspect(Dictionary<string, object> payload)
        {
            string title = Get(payload, "title");
            string processName = Get(payload, "process");
            int max = Int(payload, "max", 200);
            var found = WindowFinder.FindWindow(title, processName);
            if (found == null)
            {
                return WindowFinder.NoWindowError(title, processName);
            }
            IntPtr handle = new IntPtr(Convert.ToInt64(found["handle"]));
            var controls = WindowFinder.InspectControls(handle, max);
            return new Dictionary<string, object>
            {
                { "ok", true },
                { "title", found["title"] },
                { "process", found["process"] },
                { "rect", WindowFinder.WindowRect(handle) },
                { "controls", controls },
            };
        }

        private static string Get(Dictionary<string, object> payload, string key)
        {
            return payload.ContainsKey(key) ? Convert.ToString(payload[key]) : "";
        }

        private static int Int(Dictionary<string, object> payload, string key, int fallback)
        {
            if (!payload.ContainsKey(key)) return fallback;
            try { return Convert.ToInt32(payload[key]); }
            catch { return fallback; }
        }
    }
}
