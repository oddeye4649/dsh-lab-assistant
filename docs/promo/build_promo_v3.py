"""
实验助手宣传片 v3
- 真实界面截图（面板 / 指引 / 报告成品）
- 背景音乐（用户提供的 3.mp3）自动闪避旁白
- 支持横屏 1920x1080 与竖屏 1080x1920
用法: python build_promo_v3.py landscape|portrait
"""
import os, sys, json, asyncio, subprocess, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg
import edge_tts

ROOT = r"D:\lab-assistant"
PET = os.path.join(ROOT, "assets", "pet")
SHOTS = os.path.join(ROOT, "docs", "screenshots")
OUT = os.path.join(ROOT, "docs", "promo")
WORK = os.path.join(OUT, "_build")
os.makedirs(WORK, exist_ok=True)

ORIENT = (sys.argv[1] if len(sys.argv) > 1 else "landscape").lower()
if ORIENT == "portrait":
    W, H = 1080, 1920
else:
    W, H = 1920, 1080
FPS = 30

VOICE = "zh-CN-XiaoyiNeural"
RATE, PITCH = "+8%", "+22Hz"
FF = imageio_ffmpeg.get_ffmpeg_exe()
FONT_B = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_R = r"C:\Windows\Fonts\msyh.ttc"
FONT_M = r"C:\Windows\Fonts\consola.ttf"
BGM_SRC = r"D:\git文件\3.mp3"

REPORT_SHOT = os.path.join(WORK, "report_shot.png")   # 预合成：报告正文 + 截图取证

# ────────────────────────── 场景 ──────────────────────────
SCENES = [
    dict(key="intro", pet="wave", title="实验助手",
         sub="一只住在 DSH 里的实验桌宠 · 已上架插件市场", bullets=[],
         vo="嗨，我是你的实验桌宠。今天想跟你聊聊，做实验这件事，其实可以不用那么累。"),
    dict(key="pain", pet="confused", title="做实验最烦的，\n从来不是实验本身", sub=None,
         bullets=[("步骤记不住", "老师发的流程十几页，做着做着就乱了"),
                  ("报告写不完", "软件里一步步截图，写完还得排版")],
         vo="实验步骤十几页，做着做着就乱了。报告又要在软件里一步步截图取证，写完还得排版，一份作业耗掉一整个晚上。"),
    dict(key="dsh", pet="idle", title="它不是独立软件，\n是 DSH 里的一只桌宠",
         sub="DeepSeek Harness 插件 · 对话里就能指挥它",
         bullets=[("说话就能用", "在对话里说「帮我做实验三」"),
                  ("档案都在本地", "实验、截图、经验不出这台电脑")],
         shot=os.path.join(SHOTS, "panel.png"), shot_h=680,
         vo="它是 DeepSeek Harness 的插件。你在对话里说一句，它就动起来了，因为它记得你的每一次实验。"),
    dict(key="guided", pet="point", title="指导模式\n给需要一步步学的人",
         sub="它不替你点，它教你怎么点",
         bullets=[("黄色高框标出这一步", "该点哪里、为什么点，讲清楚"),
                  ("做完点一下它", "它自己跑校验命令，对了才走下一步")],
         shot=os.path.join(WORK, "guide_crop.png"), shot_h=560,
         vo="如果你正在学，用指导模式。它不替你点，而是在屏幕上用黄色高框标出这一步该点哪里，讲清为什么。你做完点一下它，它自己跑校验命令，对了就带你去下一步。"),
    dict(key="auto", pet="typing", title="自动执行模式\n给要交报告的人",
         sub="它替你把软件操作走完",
         bullets=[("每一步自动截图取证", "截图里必须有回显内容才算数"),
                  ("按老师模板出报告", "Word 直接生成，没实测的地方留空")],
         shot=REPORT_SHOT, shot_h=680,
         vo="如果你只是要交作业，用自动执行模式。它在软件里替你一步步操作，每一步自动截图取证，最后按老师的模板生成 Word 报告，没有实测的地方留空，绝不瞎填。"),
    dict(key="install", pet="happy", title="已经上架\nDSH 插件市场",
         sub="搜「实验助手」即可安装", bullets=None,
         vo="现在它已经上架 DSH 插件市场，搜索实验助手就能装。也可以在 GitHub 上找到它。"),
    dict(key="outro", pet="wave", title="实验是你做的，\n麻烦交给我",
         sub="github.com/oddeye4649/dsh-lab-assistant", bullets=[],
         vo="实验是你做的，麻烦交给我。我们实验课上见。"),
]
INSTALL_LINES = [
    ("在 DSH 里装（推荐）", ["dsh plugin --profile desktop add dsh-lab-assistant"]),
    ("或者从 GitHub 装", ["dsh plugin --profile desktop add \\",
                          "    github:oddeye4649/dsh-lab-assistant"]),
]

# ────────────────────────── 版式常量 ──────────────────────────
L = dict(
    title_xy=(130, 110), title_px=76, sub_px=38,
    card_x=130, card_w=640 if ORIENT == "landscape" else 920, card_h=104, card_gap=44,
    shot_x=860 if ORIENT == "landscape" else None,
    shot_top=140 if ORIENT == "landscape" else 0,
    pet_px=310 if ORIENT == "landscape" else 330,
    sub_px2=36 if ORIENT == "landscape" else 40,
)
if ORIENT == "portrait":
    L.update(title_xy=(80, 160), title_px=68, sub_px=36,
             card_x=80, card_w=920, card_h=116, card_gap=30,
             shot_x=0, shot_top=500, pet_px=340, sub_px2=40)

# ────────────────────────── 工具 ──────────────────────────
def gradient(w, h, c1, c2):
    img = Image.new("RGB", (1, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        k = y / (h - 1)
        d.point((0, y), tuple(int(c1[i] + (c2[i] - c1[i]) * k) for i in range(3)))
    return img.resize((w, h), Image.BILINEAR)

BASE = None
def base_bg():
    global BASE
    if BASE is None:
        bg = gradient(W, H, (238, 246, 255), (212, 231, 255)).convert("RGBA")
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        for (x, y, r, a) in [(int(W * 0.79), int(H * 0.13), int(W * 0.16), 150),
                             (int(W * 0.14), int(H * 0.84), int(W * 0.18), 130),
                             (int(W * 0.5), int(H * 0.5), int(W * 0.24), 70)]:
            gd.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, a))
        bg.alpha_composite(glow.filter(ImageFilter.GaussianBlur(int(W * 0.08))))
        BASE = bg
    return BASE.copy()

def rounded(size, radius, fill, shadow=True):
    w, h = size
    pad = 26
    im = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([pad, pad, pad + w, pad + h], radius, fill=fill)
    if shadow:
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle([pad, pad + 10, pad + w, pad + h + 10],
                                            radius, fill=(96, 130, 190, 70))
        sh = sh.filter(ImageFilter.GaussianBlur(12))
        out = Image.new("RGBA", im.size, (0, 0, 0, 0))
        out.alpha_composite(sh)
        out.alpha_composite(im)
        return out
    return im

def text_block(lines, font, fill, spacing=12, align="left"):
    tmp = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    boxes = [tmp.textbbox((0, 0), ln, font=font) for ln in lines]
    w = max(b[2] for b in boxes)
    h = sum(b[3] - b[1] for b in boxes) + spacing * (len(lines) - 1)
    im = Image.new("RGBA", (w + 8, h + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    y = 0
    for ln, b in zip(lines, boxes):
        x = 0 if align == "left" else (w - b[2]) // 2
        d.text((x - b[0], y - b[1]), ln, font=font, fill=fill)
        y += b[3] - b[1] + spacing
    return im

def wrap_all(text, limit):
    parts, cur = [], ""
    for ch in text:
        cur += ch
        if ch in "，。；！？":
            parts.append(cur); cur = ""
    if cur: parts.append(cur)
    lines, line = [], ""
    for p in parts:
        if not line: line = p
        elif len(line) + len(p) <= limit: line += p
        else: lines.append(line); line = p
        while len(line) > limit:
            lines.append(line[:limit]); line = line[limit:]
    if line: lines.append(line)
    return lines

def vo_chunks(vo, limit, per_chunk=2):
    lines = wrap_all(vo, limit)
    return [lines[i:i + per_chunk] for i in range(0, len(lines), per_chunk)]

def pick_chunk(chunks, frac):
    total = sum(len("".join(c)) for c in chunks)
    acc = 0.0
    for c in chunks:
        acc += len("".join(c)) / total
        if frac <= acc + 1e-9: return c
    return chunks[-1]

def pet_frame(prefix, t):
    files = sorted(f for f in os.listdir(PET) if f.startswith(prefix + "_") and f.endswith(".png"))
    if not files:
        p = os.path.join(PET, prefix + ".png")
        files = [prefix + ".png"] if os.path.exists(p) else ["idle.png"]
    return Image.open(os.path.join(PET, files[int(t * 6) % len(files)])).convert("RGBA")

def shot_image(sc):
    """截图卡片：等比缩放 + 圆角 + 阴影"""
    p = sc.get("shot")
    if not p or not os.path.exists(p):
        return None, 0, 0
    im = Image.open(p).convert("RGBA")
    fw = W - L["shot_x"] - 120 if ORIENT == "landscape" else W - 160
    h = sc.get("shot_h", 640)
    if ORIENT == "portrait":
        h = min(h, 720)
    r = im.width / im.height
    w = int(h * r)
    if w > fw:
        w = fw; h = int(w / r)
    im = im.resize((w, h), Image.LANCZOS)

    pad = 26
    mw, mh = w + pad * 2, h + pad * 2
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], 18, fill=255)
    clipped = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    clipped.paste(im, (0, 0), mask)

    canvas = Image.new("RGBA", (mw, mh), (0, 0, 0, 0))
    sh = Image.new("RGBA", (mw, mh), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([pad, pad + 10, pad + w, pad + h + 10], 18,
                                         fill=(90, 125, 185, 80))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(12)))
    ImageDraw.Draw(canvas).rounded_rectangle([pad, pad, pad + w, pad + h], 18,
                                             fill=(255, 255, 255, 255))
    canvas.alpha_composite(clipped, (pad, pad))
    return canvas, mw, mh

# ────────────────────────── 静态层 ──────────────────────────
def scene_static(i, sc, shot_size=None):
    img = base_bg()
    tpx = L["title_px"] - (16 if sc.get("shot") and ORIENT == "landscape" else 0)
    f_t = ImageFont.truetype(FONT_B, tpx)
    f_s = ImageFont.truetype(FONT_R, L["sub_px"] - (4 if sc.get("shot") and ORIENT == "landscape" else 0))
    f_ct = ImageFont.truetype(FONT_B, 40 if ORIENT == "landscape" else 44)
    f_cs = ImageFont.truetype(FONT_R, 29 if ORIENT == "landscape" else 32)
    f_code = ImageFont.truetype(FONT_M, 30 if ORIENT == "landscape" else 26)

    x, y = L["title_xy"]
    if sc["title"]:
        tb = text_block(sc["title"].split("\n"), f_t, (22, 44, 82, 255), spacing=14)
        img.alpha_composite(tb, (x, y)); y += tb.height + 14
    if sc["sub"]:
        sb = text_block([sc["sub"]], f_s, (78, 112, 160, 255))
        img.alpha_composite(sb, (x + 4, y)); y += sb.height + 22

    if sc["bullets"]:
        cy = y + 24
        if sc.get("shot") and ORIENT == "landscape":
            cy = max(cy, 400)
        if sc.get("shot") and ORIENT == "portrait" and shot_size:
            cy = L["shot_top"] + shot_size[1] + 40
        for k, (t1, t2) in enumerate(sc["bullets"]):
            cw = L["card_w"]
            card = rounded((cw, L["card_h"]), 20, (255, 255, 255, 240))
            cx = L["card_x"]
            img.alpha_composite(card, (cx, cy))
            cd = ImageDraw.Draw(img)
            r0 = 20
            cd.ellipse([cx + 46, cy + 42 + r0, cx + 46 + 40, cy + 42 + r0 + 40], fill=(96, 150, 235, 255))
            nb = cd.textbbox((0, 0), str(k + 1), font=f_cs)
            cd.text((cx + 46 + 20 - (nb[2] - nb[0]) / 2, cy + 42 + r0 + 20 - (nb[3] - nb[1]) / 2 - 3),
                    str(k + 1), font=f_cs, fill="white")
            img.alpha_composite(text_block([t1], f_ct, (28, 50, 88, 255)), (cx + 132, cy + 20))
            img.alpha_composite(text_block([t2], f_cs, (108, 132, 170, 255)), (cx + 132, cy + 74))
            cy += L["card_h"] + L["card_gap"]

    if sc.get("key") == "install":
        cy = y + 30
        for label, cmds in INSTALL_LINES:
            img.alpha_composite(text_block([label], f_cs, (78, 112, 160, 255)), (x + 4, cy))
            cy += 48
            bw = 1180 if ORIENT == "landscape" else W - 200
            bh = 62 * len(cmds) + 30
            box = rounded((bw, bh), 16, (30, 42, 66, 255))
            img.alpha_composite(box, (x - 8, cy))
            dd = ImageDraw.Draw(img)
            for j, cmd in enumerate(cmds):
                dd.text((x + 62, cy + 26 + j * 56), cmd, font=f_code, fill=(196, 228, 255, 255))
            cy += bh + 46
    return img

# ────────────────────────── 渲染 ──────────────────────────
def fade_frame(img, t, total, tin=0.7, tout=1.0):
    if t < tin:
        return Image.blend(Image.new("RGBA", img.size, (238, 246, 255, 255)), img, max(0.0, t / tin))
    if t > total - tout:
        return Image.blend(Image.new("RGBA", img.size, (238, 246, 255, 255)), img, max(0.0, (total - t) / tout))
    return img

def render(meta, total, out_name):
    statics, shots = {}, {}
    for i, sc in enumerate(SCENES):
        s, sw, sh = shot_image(sc)
        if s: shots[i] = (s, sw, sh)
        statics[i] = scene_static(i, sc, (sw, sh) if s else None)
    f_sub = ImageFont.truetype(FONT_B, L["sub_px2"])
    limit = 30 if ORIENT == "landscape" else 18

    path = os.path.join(WORK, f"video_{ORIENT}.mp4")
    proc = subprocess.Popen(
        [FF, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
         "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
         "-pix_fmt", "yuv420p", path],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    n = int(total * FPS)
    for fi in range(n):
        t = fi / FPS
        idx = len(SCENES) - 1
        for i, m in enumerate(meta):
            if m["start"] <= t < m["end"] + (GAP if i < len(meta) - 1 else 1e9):
                idx = i; break
        sc = SCENES[idx]
        img = statics[idx].copy()

        # 截图
        if idx in shots:
            s, sw, sh = shots[idx]
            if ORIENT == "landscape":
                sx = L["shot_x"]; sy = max(120, (H - sh) // 2 - 50)
            else:
                sx = (W - sw) // 2; sy = L["shot_top"]
            img.alpha_composite(s, (sx, sy))

        # 桌宠
        pf = pet_frame(sc["pet"], t - meta[idx]["start"]).resize((L["pet_px"], L["pet_px"]), Image.LANCZOS)
        bob = int(7 * math.sin(t * 2.0))
        if ORIENT == "landscape":
            px, py = W - L["pet_px"] - 40, H - L["pet_px"] - 150 + bob
            if idx in shots:
                px, py = 150 if not sc["bullets"] else 60, H - L["pet_px"] - 120 + bob
        else:
            px, py = W - L["pet_px"] - 30, H - L["pet_px"] - 330 + bob
        img.alpha_composite(pf, (px, py))

        # 字幕
        if meta[idx]["start"] <= t <= meta[idx]["end"] + 0.25:
            span = max(0.3, meta[idx]["end"] - meta[idx]["start"])
            frac = min(1.0, max(0.0, (t - meta[idx]["start"]) / span))
            cur = pick_chunk(vo_chunks(sc["vo"], limit, 2), frac)
            sb = text_block(cur, f_sub, (30, 48, 80, 255), spacing=10, align="center")
            bar = rounded((sb.width + 64, sb.height + 34), 18, (255, 255, 255, 220))
            bx = (W - bar.width) // 2
            by = H - bar.height - 8
            img.alpha_composite(bar, (bx, by))
            img.alpha_composite(sb, (bx + (bar.width - sb.width) // 2, by + 30))

        proc.stdin.write(fade_frame(img, t, total).convert("RGB").tobytes())
        if fi % 400 == 0: print(f"    帧 {fi}/{n}", flush=True)
    proc.stdin.close(); proc.wait()
    return path

# ────────────────────────── 音频 ──────────────────────────
GAP = 0.55

async def synth(text, path):
    await edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH).save(path)

def audio_dur(p):
    q = subprocess.run([FF, "-i", p], capture_output=True, text=True, errors="replace")
    for line in q.stderr.splitlines():
        if "Duration:" in line:
            h, m, s = line.split("Duration:")[1].split(",")[0].strip().split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    return 0.0

def build_vo():
    meta = []
    for i, sc in enumerate(SCENES):
        mp3, wav = os.path.join(WORK, f"vo3_{i}.mp3"), os.path.join(WORK, f"vo3_{i}.wav")
        if not os.path.exists(wav):
            asyncio.run(synth(sc["vo"], mp3))
            subprocess.run([FF, "-y", "-i", mp3, "-ar", "48000", "-ac", "2", wav], capture_output=True)
        d = audio_dur(wav)
        meta.append(dict(idx=i, wav=wav, dur=d))
        print(f"  VO {i} {sc['key']:8s} {d:5.2f}s")
    return meta

def build_audio(meta, total, path):
    sr = 48000
    n = int(total * sr) + sr
    voice = np.zeros(n, dtype=np.float32)
    for m in meta:
        raw = subprocess.run([FF, "-v", "error", "-i", m["wav"], "-f", "f32le", "-ac", "1",
                              "-ar", str(sr), "-"], capture_output=True).stdout
        a = np.frombuffer(raw, dtype=np.float32)
        s = int(m["start"] * sr); e = min(n, s + len(a))
        voice[s:e] += a[:e - s]

    # 背景音乐：循环 + 低音量 + 旁白时闪避
    raw = subprocess.run([FF, "-v", "error", "-i", BGM_SRC, "-f", "f32le", "-ac", "2",
                          "-ar", str(sr), "-"], capture_output=True).stdout
    bgm_all = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
    reps = int(np.ceil(n / len(bgm_all))) + 1
    bgm = np.tile(bgm_all, (reps, 1))[:n]
    bgm = bgm / (np.max(np.abs(bgm)) or 1)

    # 目标电平（相对满刻度）：幕间 -26 dB，旁白期间再降 8 dB
    rms_bgm = float(np.sqrt(np.mean(bgm ** 2))) or 1e-6
    target_quiet = 10 ** (-26 / 20.0)
    base_gain = target_quiet / rms_bgm
    duck_factor = 10 ** (-8 / 20.0)

    duck = np.zeros(n, dtype=np.float32)
    for m in meta:
        s = max(0, int((m["start"] - 0.25) * sr)); e = min(n, int((m["end"] + 0.35) * sr))
        duck[s:e] = 1.0
    k = int(0.15 * sr)
    ker = np.ones(k, dtype=np.float32) / k
    duck = np.convolve(duck, ker, mode="same")
    gain = base_gain * (1.0 - (1.0 - duck_factor) * duck)
    # 开头结尾淡入淡出
    fade = np.ones(n, dtype=np.float32)
    f_in, f_out = int(1.2 * sr), int(2.0 * sr)
    fade[:f_in] = np.linspace(0, 1, f_in)
    fade[-f_out:] = np.linspace(1, 0, f_out)
    gain = gain * fade

    bgm = bgm * gain[:, None]
    mix = voice[:, None] * 0.95 + bgm
    peak = float(np.max(np.abs(mix))) or 1.0
    if peak > 0.98:
        mix = mix / peak * 0.98
    pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run([FF, "-y", "-f", "s16le", "-ar", str(sr), "-ac", "2", "-i", "-",
                    "-c:a", "pcm_s16le", path], input=pcm, capture_output=True)
    return path, float(np.mean(gain[duck > 0.5]) if np.any(duck > 0.5) else 0)

def main():
    print(f"=== {ORIENT} {W}x{H} ===")
    print("① 旁白…"); meta = build_vo()
    t = 0.8
    for m in meta:
        m["start"] = t; m["end"] = t + m["dur"]; t = m["end"] + GAP
    total = t
    print(f"② 总时长 {total:.1f}s")
    print("③ 渲染…"); v = os.path.join(WORK, f"video_{ORIENT}.mp4")
    if os.environ.get("AUDIO_ONLY") != "1":
        v = render(meta, total, ORIENT)
    print("④ 混音…"); a, g = build_audio(meta, total, os.path.join(WORK, f"audio_{ORIENT}.wav"))
    print(f"   幕间 BGM ≈ -26 dB（实测 {20*math.log10(max(g,1e-9)):.1f} dB）")
    final = os.path.join(OUT, f"lab-assistant-promo-{ORIENT}.mp4")
    subprocess.run([FF, "-y", "-i", v, "-i", a, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                    "-shortest", final], capture_output=True)
    print("完成:", final, round(os.path.getsize(final) / 1e6, 2), "MB")
    json.dump(dict(orient=ORIENT, total=total, scenes=meta),
              open(os.path.join(WORK, f"timeline_{ORIENT}.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
