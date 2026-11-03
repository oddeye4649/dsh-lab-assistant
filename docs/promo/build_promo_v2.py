"""
实验助手 0.14.3 宣传片 v2 —— 生成脚本
结构：旁白（edge-tts 少女音）驱动时间轴 → PIL 逐帧合成 → ffmpeg 编码。
"""
import os, sys, json, asyncio, subprocess, math, io
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg
import edge_tts

ROOT = r"D:\lab-assistant"
PET = os.path.join(ROOT, "assets", "pet")
OUT = os.path.join(ROOT, "docs", "promo")
WORK = os.path.join(OUT, "_build")
os.makedirs(WORK, exist_ok=True)

W, H, FPS = 1920, 1080, 30
VOICE = "zh-CN-XiaoyiNeural"     # 少女音，最贴可爱风
RATE, PITCH = "+8%", "+22Hz"

FF = imageio_ffmpeg.get_ffmpeg_exe()
FONT_B = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_R = r"C:\Windows\Fonts\msyh.ttc"

# ────────────────────────── 文案 + 场景 ──────────────────────────
# 每幕：pet=桌宠动作前缀, title/sub=大标题, bullets=卡片, vo=旁白
SCENES = [
    dict(key="intro", pet="wave", title="实验助手", sub="一只住在 DSH 里的实验桌宠 · 已上架插件市场", bullets=[],
         vo="嗨，我是你的实验桌宠。今天想跟你聊聊，做实验这件事，其实可以不用那么累。"),
    dict(key="pain", pet="confused",
         title="做实验最烦的，\n从来不是实验本身",
         sub=None,
         bullets=[("步骤记不住", "老师发的流程十几页，做着做着就乱了"),
                  ("报告写不完", "软件里一步步截图，写完还得排版")],
         vo="实验步骤十几页，做着做着就乱了。报告又要在软件里一步步截图取证，写完还得排版，一份作业耗掉一整个晚上。"),
    dict(key="dsh", pet="idle",
         title="它不是独立软件，\n是 DSH 里的一只桌宠",
         sub="DeepSeek Harness 插件 · 上架即装",
         bullets=[("说话就能用", "在对话里说「帮我做实验三」"),
                  ("记得你的实验", "档案、截图、经验都留在本地"),
                  ("看得见你的屏幕", "指引框直接画在软件窗口上")],
         vo="它是 DeepSeek Harness 的插件。你在对话里说一句，它就动起来了，因为它记得你的每一次实验。"),
    dict(key="guided", pet="point",
         title="指导模式\n给需要一步步学的人",
         sub="它不替你点，它教你怎么点",
         bullets=[("黄色高框标出这一步", "该点哪里、为什么点，讲清楚"),
                  ("做完点一下它", "它自己跑校验命令判断对错"),
                  ("错了当场指出", "不会让你带着错误往下走")],
         vo="如果你正在学，用指导模式。它不替你点，而是在屏幕上用黄色高框标出这一步该点哪里，讲清为什么。你做完点一下它，它自己跑校验命令，对了就带你去下一步。"),
    dict(key="auto", pet="typing",
         title="自动执行模式\n给要交报告的人",
         sub="它替你把软件操作走完",
         bullets=[("一步一步替你点", "照着文档粒度执行，不跳步"),
                  ("每步自动截图取证", "截图里必须有回显内容才算数"),
                  ("按老师模板出报告", "Word 直接生成，没实测的地方留空")],
         vo="如果你只是要交作业，用自动执行模式。它在软件里替你一步步操作，每一步自动截图取证，最后按老师的模板生成 Word 报告，没有实测的地方留空，绝不瞎填。"),
    dict(key="install", pet="happy",
         title="已经上架\nDSH 插件市场",
         sub="搜「实验助手」即可安装",
         bullets=None,   # 用代码框
         vo="现在它已经上架 DSH 插件市场，搜索实验助手就能装。也可以在 GitHub 上找到它。"),
    dict(key="outro", pet="wave",
         title="实验是你做的，\n麻烦交给我",
         sub="github.com/oddeye4649/dsh-lab-assistant",
         bullets=[],
         vo="实验是你做的，麻烦交给我。我们实验课上见。"),
]
INSTALL_LINES = [
    ("在 DSH 里装（推荐）", ["dsh plugin --profile desktop add dsh-lab-assistant"]),
    ("或者从 GitHub 装", ["dsh plugin --profile desktop add \\",
                          "    github:oddeye4649/dsh-lab-assistant"]),
]

# ────────────────────────── 1. 配音 ──────────────────────────
async def synth(text, path):
    c = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH)
    await c.save(path)

def audio_dur(path):
    p = subprocess.run([FF, "-i", path], capture_output=True, text=True, errors="replace")
    for line in p.stderr.splitlines():
        if "Duration:" in line:
            t = line.split("Duration:")[1].split(",")[0].strip()
            h, m, s = t.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    return 0.0

def build_vo():
    meta = []
    for i, sc in enumerate(SCENES):
        mp3 = os.path.join(WORK, f"vo_{i}.mp3")
        wav = os.path.join(WORK, f"vo_{i}.wav")
        if not os.path.exists(wav):
            asyncio.run(synth(sc["vo"], mp3))
            subprocess.run([FF, "-y", "-i", mp3, "-ar", "48000", "-ac", "2", wav],
                           capture_output=True)
        d = audio_dur(wav)
        meta.append(dict(idx=i, wav=wav, dur=d))
        print(f"  VO {i} {sc['key']:8s} {d:5.2f}s  {sc['vo'][:24]}…")
    return meta

# ────────────────────────── 2. 时间轴 ──────────────────────────
GAP = 0.55          # 幕间停顿
LEAD = 0.8          # 开场留白

def timeline(meta):
    t = LEAD
    for m in meta:
        m["start"] = t
        m["end"] = t + m["dur"]
        t = m["end"] + GAP
    return t   # 总时长

# ────────────────────────── 3. 背景/静态层 ──────────────────────────
def gradient(w, h, c1, c2):
    img = Image.new("RGB", (1, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        k = y / (h - 1)
        d.point((0, y), tuple(int(c1[i] + (c2[i] - c1[i]) * k) for i in range(3)))
    return img.resize((w, h), Image.BILINEAR)

def blob(size, color, alpha):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([0, 0, size - 1, size - 1], fill=color + (alpha,))
    return im.filter(ImageFilter.GaussianBlur(size // 6))

BASE = None
def base_bg():
    """浅蓝渐变 + 柔光斑（整体模糊一次，避免出现方块边）"""
    global BASE
    if BASE is None:
        bg = gradient(W, H, (238, 246, 255), (214, 232, 255)).convert("RGBA")
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        for (x, y, r, a) in [(1520, 140, 300, 150), (260, 900, 340, 130),
                             (980, 520, 460, 70), (1750, 820, 240, 90)]:
            gd.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, a))
        glow = glow.filter(ImageFilter.GaussianBlur(160))
        bg.alpha_composite(glow)
        BASE = bg
    return BASE.copy()

def rounded(size, radius, fill, shadow=False):
    w, h = size
    pad = 24
    im = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if shadow:
        d.rounded_rectangle([pad, pad + 8, pad + w, pad + h + 8], radius,
                            fill=(120, 150, 200, 60))
        im = im.filter(ImageFilter.GaussianBlur(10))
        im2 = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(im2).rounded_rectangle([pad, pad, pad + w, pad + h], radius, fill=fill)
        im2.alpha_composite(im)
        return im2
    d.rounded_rectangle([pad, pad, pad + w, pad + h], radius, fill=fill)
    return im

def text_block(lines, font, fill, spacing=12, align="left"):
    tmp = Image.new("RGBA", (10, 10))
    d = ImageDraw.Draw(tmp)
    sizes = [d.textbbox((0, 0), ln, font=font) for ln in lines]
    w = max(b[2] for b in sizes)
    h = sum(b[3] - b[1] for b in sizes) + spacing * (len(lines) - 1)
    im = Image.new("RGBA", (w + 8, h + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    y = 0
    for ln in lines:
        b = d.textbbox((0, 0), ln, font=font)
        x = 0 if align == "left" else (w - b[2]) // 2
        d.text((x - b[0], y - b[1]), ln, font=font, fill=fill)
        y += b[3] - b[1] + spacing
    return im

def pet_frame(prefix, t):
    """按动作前缀取帧（循环播放）"""
    files = sorted([f for f in os.listdir(PET) if f.startswith(prefix + "_") and f.endswith(".png")])
    if not files:
        p = os.path.join(PET, prefix + ".png")
        files = [prefix + ".png"] if os.path.exists(p) else ["idle.png"]
    f = files[int(t * 6) % len(files)]
    return Image.open(os.path.join(PET, f)).convert("RGBA")

def scene_static(sc):
    """预渲染一幕的静态层（背景+标题+卡片）"""
    img = base_bg()
    d = ImageDraw.Draw(img)
    f_title = ImageFont.truetype(FONT_B, 82)
    f_sub = ImageFont.truetype(FONT_R, 40)
    f_card_t = ImageFont.truetype(FONT_B, 42)
    f_card_s = ImageFont.truetype(FONT_R, 30)
    f_code = ImageFont.truetype(r"C:\Windows\Fonts\consola.ttf", 32)

    y = 150
    if sc["title"]:
        tb = text_block(sc["title"].split("\n"), f_title, (22, 44, 82, 255), spacing=16)
        img.alpha_composite(tb, (140, y))
        y += tb.height + 16
    if sc["sub"]:
        sb = text_block([sc["sub"]], f_sub, (78, 112, 160, 255))
        img.alpha_composite(sb, (144, y))
        y += sb.height + 24

    # 卡片 / 代码框
    if sc["bullets"]:
        cy = y + 24
        for i, (t1, t2) in enumerate(sc["bullets"]):
            card = rounded((760, 116), 22, (255, 255, 255, 235), shadow=True)
            img.alpha_composite(card, (140, cy))
            cd = ImageDraw.Draw(img)
            cd.ellipse([140 + 24 + 12, cy + 24 + 30, 140 + 24 + 12 + 40, cy + 24 + 30 + 40],
                       fill=(96, 150, 235, 255))
            num = str(i + 1)
            nb = cd.textbbox((0, 0), num, font=f_card_s)
            cd.text((140 + 24 + 12 + 20 - (nb[2] - nb[0]) / 2,
                     cy + 24 + 30 + 20 - (nb[3] - nb[1]) / 2 - 3), num, font=f_card_s, fill="white")
            img.alpha_composite(text_block([t1], f_card_t, (28, 50, 88, 255)), (140 + 100, cy + 26))
            img.alpha_composite(text_block([t2], f_card_s, (108, 132, 170, 255)), (140 + 100, cy + 82))
            cy += 148

    if sc["key"] == "install":
        cy = y + 34
        for label, cmds in INSTALL_LINES:
            img.alpha_composite(text_block([label], f_card_s, (78, 112, 160, 255)), (144, cy))
            cy += 50
            box_h = 62 * len(cmds) + 30
            box = rounded((1180, box_h), 16, (30, 42, 66, 255), shadow=True)
            img.alpha_composite(box, (132, cy))
            dd = ImageDraw.Draw(img)
            for j, cmd in enumerate(cmds):
                dd.text((176, cy + 22 + j * 58), cmd, font=f_code, fill=(196, 228, 255, 255))
            cy += box_h + 52
    return img

# ────────────────────────── 4. 逐帧合成 ──────────────────────────
def wrap_cn(text, limit=26, max_lines=2):
    """按标点断句，贪心装行；每行不超过 limit 字"""
    parts, cur = [], ""
    for ch in text:
        cur += ch
        if ch in "，。；！？":
            parts.append(cur)
            cur = ""
    if cur:
        parts.append(cur)
    lines, line = [], ""
    for p in parts:
        if len(line) + len(p) <= limit:
            line += p
        else:
            if line:
                lines.append(line)
            line = p
            while len(line) > limit:
                lines.append(line[:limit])
                line = line[limit:]
    if line:
        lines.append(line)
    if len(lines) > max_lines:
        keep = lines[:max_lines]
        rest = "".join(lines[max_lines:])
        keep[-1] = keep[-1][:limit]
        lines = keep
    return lines


def wrap_all(text, limit=30):
    """按标点装行，返回完整行列表（不截断）"""
    parts, cur = [], ""
    for ch in text:
        cur += ch
        if ch in "，。；！？":
            parts.append(cur)
            cur = ""
    if cur:
        parts.append(cur)
    lines, line = [], ""
    for p in parts:
        if not line:
            line = p
        elif len(line) + len(p) <= limit:
            line += p
        else:
            lines.append(line)
            line = p
        while len(line) > limit:
            lines.append(line[:limit])
            line = line[limit:]
    if line:
        lines.append(line)
    return lines


def vo_chunks(vo, limit=30, per_chunk=2):
    """把旁白切成若干「字幕块」，每块 per_chunk 行，覆盖全文不丢字"""
    lines = wrap_all(vo, limit)
    return [lines[i:i + per_chunk] for i in range(0, len(lines), per_chunk)]


def pick_chunk(chunks, frac):
    """按字数比例决定当前显示第几块"""
    total = sum(len("".join(c)) for c in chunks)
    acc = 0.0
    for c in chunks:
        acc += len("".join(c)) / total
        if frac <= acc + 1e-9:
            return c
    return chunks[-1]


def fade_frame(img, t, total, tin=0.7, tout=1.0):
    """开头淡入、结尾淡出（与背景同色，不出现黑场）"""
    if t < tin:
        k = max(0.0, t / tin)
        return Image.blend(Image.new("RGBA", img.size, (238, 246, 255, 255)), img, k)
    if t > total - tout:
        k = max(0.0, (total - t) / tout)
        return Image.blend(Image.new("RGBA", img.size, (238, 246, 255, 255)), img, k)
    return img


def render(meta, total, out_mp4):
    statics = {i: scene_static(SCENES[i]) for i in range(len(SCENES))}
    f_sub = ImageFont.truetype(FONT_B, 36)
    pet_px = 440

    proc = subprocess.Popen(
        [FF, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
         "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium",
         "-crf", "20", "-pix_fmt", "yuv420p", os.path.join(WORK, "video_only.mp4")],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    n = int(total * FPS)
    for fi in range(n):
        t = fi / FPS
        idx = len(SCENES) - 1
        for i, m in enumerate(meta):
            if m["start"] <= t < m["end"] + (GAP if i < len(meta) - 1 else 1e9):
                idx = i
                break
        sc = SCENES[idx]
        img = statics[idx].copy()

        # 桌宠（上下浮动 + 轻微呼吸缩放）
        pf = pet_frame(sc["pet"], t - meta[idx]["start"]).resize((pet_px, pet_px), Image.LANCZOS)
        bob = int(7 * math.sin(t * 2.0))
        px = W - pet_px - 110
        py = H - pet_px - 215 + bob
        img.alpha_composite(pf, (px, py))

        # 字幕条（按旁白进度切块）
        if meta[idx]["start"] <= t <= meta[idx]["end"] + 0.25:
            span = max(0.3, meta[idx]["end"] - meta[idx]["start"])
            frac = min(1.0, max(0.0, (t - meta[idx]["start"]) / span))
            chunks = vo_chunks(sc["vo"], limit=30, per_chunk=2)
            cur = pick_chunk(chunks, frac)
            sb = text_block(cur, f_sub, (30, 48, 80, 255), spacing=10, align="center")
            bar = rounded((sb.width + 64, sb.height + 34), 18, (255, 255, 255, 215), shadow=True)
            bx = (W - bar.width) // 2
            by = H - bar.height - 10
            img.alpha_composite(bar, (bx, by))
            img.alpha_composite(sb, (bx + (bar.width - sb.width) // 2, by + 30))

        proc.stdin.write(fade_frame(img, t, total).convert("RGB").tobytes())
        if fi % 300 == 0:
            print(f"    帧 {fi}/{n}", flush=True)
    proc.stdin.close()
    proc.wait()
    return os.path.join(WORK, "video_only.mp4")

# ────────────────────────── 5. 音轨 ──────────────────────────
def build_audio(meta, total, path):
    sr = 48000
    buf = np.zeros(int(total * sr) + sr, dtype=np.float32)
    for m in meta:
        raw = subprocess.run([FF, "-v", "error", "-i", m["wav"], "-f", "f32le",
                              "-ac", "1", "-ar", str(sr), "-"],
                             capture_output=True).stdout
        a = np.frombuffer(raw, dtype=np.float32)
        s = int(m["start"] * sr)
        e = min(len(buf), s + len(a))
        buf[s:e] += a[:e - s]
    peak = float(np.max(np.abs(buf))) or 1.0
    buf = buf / peak * 0.92
    stereo = np.stack([buf, buf], axis=1)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run([FF, "-y", "-f", "s16le", "-ar", str(sr), "-ac", "2", "-i", "-",
                    "-c:a", "pcm_s16le", path],
                   input=pcm, capture_output=True)
    return path

def main():
    print("① 合成旁白…")
    meta = build_vo()
    total = timeline(meta)
    print(f"② 时间轴：总时长 {total:.1f}s，{len(SCENES)} 幕")
    for i, m in enumerate(meta):
        print(f"   {SCENES[i]['key']:8s} {m['start']:6.2f} → {m['end']:6.2f}")
    print("③ 渲染帧…")
    v = render(meta, total, None)
    print("④ 混音…")
    a = build_audio(meta, total, os.path.join(WORK, "audio.wav"))
    print("⑤ 合成成片…")
    final = os.path.join(OUT, "lab-assistant-promo-v2.mp4")
    subprocess.run([FF, "-y", "-i", v, "-i", a, "-c:v", "copy", "-c:a", "aac",
                    "-b:a", "192k", "-shortest", final], capture_output=True)
    print("完成:", final, round(os.path.getsize(final) / 1e6, 2), "MB")
    json.dump(dict(total=total, scenes=[{k: v for k, v in m.items()} for m in meta]),
              open(os.path.join(WORK, "timeline.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
