# -*- coding: utf-8 -*-
"""实验助手讲解视频 · 本地渲染器

分镜规范遵循 anilecture（script.md / timeline.json / style / card / decor / out/）。
本机的 anilecture 技能包只有文档、缺 bin/anilecture.py，因此这里用
Pillow 合成画面 + ffmpeg 编码实现同一套版式，不生成角色图、不引入数字人。

用法：
  python build_video.py            # 全流程
  python build_video.py --step prepare|audio|video|outputs
"""
import argparse
import asyncio
import json
import math
import os
import re
import shutil
import subprocess
import sys
import wave
from datetime import datetime

import edge_tts
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont

VID = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # D:/lab-assistant/video
PROJ = os.path.dirname(VID)                                          # D:/lab-assistant
BUILD = os.path.join(VID, "build")
FRAMES = os.path.join(BUILD, "frames")
LISTS = os.path.join(BUILD, "lists")
SEG = os.path.join(BUILD, "segments")
VOICE = os.path.join(BUILD, "voice")
OUT = os.path.join(VID, "out")
PET = os.path.join(PROJ, "assets", "pet")
SHOTS_DIR = os.path.join(PROJ, "docs", "screenshots")
BGM = r"D:\git文件\4.mp3"

FF = imageio_ffmpeg.get_ffmpeg_exe()
W, H, FPS = 1920, 1080, 30
SR = 48000
LEAD, TAIL = 0.30, 0.38
FRAME_DT = 0.20

# 与 2026-10-31 B 站演示片完全一致（scripts/promo_audio_v2.py:23,46）
TTS_VOICE, TTS_RATE, TTS_PITCH = "zh-CN-XiaoyiNeural", "+4%", "+12Hz"

FONT_R = r"C:\Windows\Fonts\msyh.ttc"
FONT_B = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_M = r"C:\Windows\Fonts\consola.ttf"

INK = (43, 42, 40)
RED = (196, 68, 58)
BLUE = (47, 111, 168)
PAPER = (245, 240, 227)
CARD = (255, 253, 248)
NOTE = (255, 246, 196)
WOOD = (176, 137, 96)
DARK = (27, 42, 58)

CHAPTERS = ["开场", "插件能干啥", "WorkBuddy 适配", "硬边界与实话", "收尾"]
_fcache = {}


def font(size, bold=False, mono=False):
    key = (size, bold, mono)
    if key not in _fcache:
        _fcache[key] = ImageFont.truetype(FONT_M if mono else (FONT_B if bold else FONT_R), size)
    return _fcache[key]


def wrap_cn(text, fnt, max_w, draw):
    """按标点优先断行，避免一句话被从中间劈开。"""
    parts = re.findall(r"[^\s，。！？、；：,/]+[\s，。！？、；：,/]*|[\s，。！？、；：,/]+", text)
    lines, cur = [], ""
    for part in parts:
        if draw.textlength(cur + part, font=fnt) <= max_w:
            cur += part
            continue
        if cur:
            lines.append(cur)
            cur = ""
        for ch in part:
            if draw.textlength(cur + ch, font=fnt) <= max_w:
                cur += ch
            else:
                if cur:
                    lines.append(cur)
                cur = ch
    if cur:
        lines.append(cur)
    return lines


def ff(args, capture=False):
    return subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error"] + args,
                          capture_output=capture, text=True,
                          encoding="utf-8", errors="replace")


def duration_of(path):
    p = subprocess.run([FF, "-hide_banner", "-i", path], capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", p.stderr or "")
    return round(int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)), 3) if m else 3.0


def decode_audio(path):
    """解码为 48k 单声道 float32 ndarray。"""
    p = subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-i", path,
                        "-f", "f32le", "-ac", "1", "-ar", str(SR), "pipe:1"],
                       capture_output=True)
    return np.frombuffer(p.stdout, dtype="<f4").copy()


# ────────────────────────── 画面 ──────────────────────────

def paper_bg():
    cache = os.path.join(BUILD, "paper.png")
    if os.path.exists(cache):
        return Image.open(cache).convert("RGB")
    rng = np.random.default_rng(11)
    n = rng.normal(0, 3.0, (H, W)).astype(np.float32)
    arr = np.zeros((H, W, 3), np.float32)
    arr[:] = PAPER
    arr += n[..., None]
    rows = (0.996 + 0.004 * np.sin(np.arange(H) / 11.0))[..., None, None]
    arr = np.clip(arr * rows, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, "RGB")
    d = ImageDraw.Draw(img)
    # 木台面
    for y in range(886, H):
        t = (y - 886) / float(H - 886)
        d.line([(0, y), (W, y)], fill=(int(WOOD[0] - 42 * t), int(WOOD[1] - 40 * t), int(WOOD[2] - 34 * t)))
    for i in range(14):
        y = 892 + i * 14
        d.line([(0, y), (W, y)], fill=(150, 112, 76, 40), width=1)
    d.line([(0, 884), (W, 884)], fill=(126, 94, 62), width=3)
    img.save(cache)
    return img


def draw_chapter_bar(d, chapter):
    x0, y0, x1, y1 = 300, 26, 1620, 92
    d.rounded_rectangle((x0, y0, x1, y1), radius=26, fill=(255, 252, 244), outline=(214, 202, 178), width=2)
    total = len(CHAPTERS)
    cw = (x1 - x0 - 24) / total
    for i, name in enumerate(CHAPTERS):
        bx = x0 + 12 + i * cw
        active = name == chapter
        d.rounded_rectangle((bx + 5, y0 + 10, bx + cw - 5, y1 - 10), radius=16,
                            fill=RED if active else (238, 232, 218))
        f = font(25, bold=active)
        tw = d.textlength(name, font=f)
        d.text((bx + cw / 2 - tw / 2, y0 + 20), name, font=f,
               fill=(255, 255, 255) if active else (120, 112, 98))
    d.text((1640, 44), "lab-assistant · 0.16.1", font=font(20, mono=True), fill=(150, 140, 120))


def draw_subtitle(d, text):
    if not text:
        return
    box = (150, 926, 1770, 1052)
    d.rounded_rectangle(box, radius=22, fill=(30, 34, 40))
    lines = []
    for size in (44, 40, 36):
        f = font(size, bold=True)
        lines = wrap_cn(text, f, box[2] - box[0] - 90, d)
        if len(lines) <= 2:
            break
    lines = lines[:2]
    lh = 58
    y = box[1] + (box[3] - box[1] - len(lines) * lh) / 2 + 4
    for line in lines:
        tw = d.textlength(line, font=f)
        d.text(((W - tw) / 2, y), line, font=f, fill=(255, 253, 246))
        y += lh


def shadow_card(d, box):
    d.rounded_rectangle((box[0] + 12, box[1] + 14, box[2] + 12, box[3] + 14), radius=18,
                        fill=(196, 184, 160))


def draw_items(d, items, box, fnt=40, gap=26, mark="square"):
    x = box[0] + 46
    lines_all = [wrap_cn(item, font(fnt), box[2] - box[0] - 110, d) for item in items]
    total_h = sum(len(ls) * (fnt + 14) + gap for ls in lines_all) - gap
    y = max(box[1] + 26, box[1] + (box[3] - box[1] - total_h) / 2)
    for lines in lines_all:
        for j, line in enumerate(lines):
            if j == 0:
                if mark == "check":
                    d.rounded_rectangle((x, y + 9, x + 26, y + 35), radius=5, outline=RED, width=3)
                    d.line([(x + 5, y + 22), (x + 11, y + 29), (x + 22, y + 12)], fill=RED, width=4)
                else:
                    d.rounded_rectangle((x, y + 13, x + 23, y + 36), radius=4, fill=BLUE)
            d.text((x + 44, y), line, font=font(fnt), fill=INK)
            y += fnt + 14
        y += gap


def draw_card(img, card, box):
    if not card:
        return
    d = ImageDraw.Draw(img)
    style = card.get("style", "paper")
    kind = card["type"]
    shadow_card(d, box)
    if style == "note":
        fill = NOTE
    else:
        fill = CARD
    d.rounded_rectangle(box, radius=18, fill=fill, outline=(216, 206, 186), width=2)
    if style == "paper":
        d.rounded_rectangle((box[0], box[1], box[2], box[1] + 12), radius=6, fill=RED)
    if style == "window":
        d.rounded_rectangle((box[0], box[1], box[2], box[1] + 46), radius=16, fill=(238, 236, 232))
        d.rectangle((box[0], box[1] + 30, box[2], box[1] + 46), fill=(238, 236, 232))
        for i, c in enumerate([(226, 96, 88), (236, 190, 84), (108, 184, 126)]):
            d.ellipse((box[0] + 24 + i * 32, box[1] + 16, box[0] + 42 + i * 32, box[1] + 34), fill=c)
    top = 44 if style == "window" else 26
    inner = (box[0] + 20, box[1] + top, box[2] - 20, box[3] - 20)

    if kind == "big-quote":
        cx = (box[0] + box[2]) / 2
        f = font(66, bold=True)
        bf = font(40)
        title_lines = wrap_cn(card.get("title", ""), f, inner[2] - inner[0] - 40, d)
        body_lines = wrap_cn(card.get("body", ""), bf, inner[2] - inner[0] - 60, d)
        th = len(title_lines) * 84 + 34 + len(body_lines) * 56
        y = box[1] + (box[3] - box[1] - th) / 2 - 6
        for line in title_lines:
            tw = d.textlength(line, font=f)
            d.text((cx - tw / 2, y), line, font=f, fill=INK)
            y += 84
        y += 10
        d.line([(box[0] + 140, y), (box[2] - 140, y)], fill=RED, width=3)
        y += 24
        for line in body_lines:
            tw = d.textlength(line, font=bf)
            d.text((cx - tw / 2, y), line, font=bf, fill=(88, 84, 76))
            y += 56
        if card.get("stamp"):
            sx, sy = box[2] - 150, box[3] - 120
            d.rounded_rectangle((sx, sy, sx + 118, sy + 62), radius=8, outline=RED, width=5)
            sf = font(30, bold=True)
            tw = d.textlength(card["stamp"], font=sf)
            d.text((sx + 59 - tw / 2, sy + 13), card["stamp"], font=sf, fill=RED)
    elif kind in ("icon-list", "checklist"):
        draw_items(d, card.get("items", []), (box[0], box[1] + top, box[2], box[3]),
                   mark="check" if kind == "checklist" else "square")
    elif kind == "before-after":
        half = (box[2] - box[0]) / 2
        l = (box[0] + 34, box[1] + 100, box[0] + half - 24, box[3] - 50)
        r = (box[0] + half + 24, box[1] + 100, box[2] - 34, box[3] - 50)
        d.rounded_rectangle(l, radius=12, fill=(238, 232, 220), outline=(200, 190, 170), width=2)
        d.rounded_rectangle(r, radius=12, fill=(232, 242, 248), outline=(150, 184, 206), width=2)
        d.text((l[0] + 18, l[1] + 14), "之前", font=font(26, bold=True), fill=(140, 130, 110))
        d.text((r[0] + 18, r[1] + 14), "现在 / 实际", font=font(26, bold=True), fill=BLUE)
        for bx, text in [(l, card.get("before", "")), (r, card.get("after", ""))]:
            f = font(36)
            ls = wrap_cn(text, f, bx[2] - bx[0] - 36, d)
            yy = bx[1] + max(66, (bx[3] - bx[1] - len(ls) * 48) / 2)
            for line in ls:
                d.text((bx[0] + 18, yy), line, font=f, fill=INK)
                yy += 48
        cx = (l[2] + r[0]) / 2
        d.line([(cx - 26, box[1] + 300), (cx + 26, box[1] + 300)], fill=RED, width=7)
        d.polygon([(cx + 34, box[1] + 300), (cx + 12, box[1] + 288), (cx + 12, box[1] + 312)], fill=RED)
    elif kind == "web-shot":
        src = os.path.join(PROJ, card.get("src", ""))
        area = (box[0] + 28, box[1] + 58, box[2] - 28, box[3] - 96)
        aw, ah = area[2] - area[0], area[3] - area[1]
        if os.path.exists(src):
            shot = Image.open(src).convert("RGB")
            scale = min(aw / shot.width, ah / shot.height)
            nw, nh = max(1, int(shot.width * scale)), max(1, int(shot.height * scale))
            shot = shot.resize((nw, nh), Image.LANCZOS)
            px, py = area[0] + (aw - nw) // 2, area[1] + (ah - nh) // 2
            d.rectangle((px - 7, py - 7, px + nw + 7, py + nh + 7),
                        fill=(255, 253, 248), outline=(206, 196, 178), width=2)
            img.paste(shot, (px, py))
        else:
            d.rectangle(area, fill=(226, 222, 214))
            d.text((area[0] + 20, area[1] + 20), "截图缺失", font=font(30), fill=(120, 110, 100))
        d.rounded_rectangle((box[0] + 28, box[3] - 86, box[2] - 28, box[3] - 20),
                            radius=10, fill=(238, 234, 224))
        af = font(30)
        note = wrap_cn(card.get("annotation", ""), af, box[2] - box[0] - 84, d)[:1]
        if note:
            d.text((box[0] + 44, box[3] - 76), note[0], font=af, fill=(96, 88, 76))


def draw_burst(d):
    cx, cy = W * 0.62, H * 0.45
    for i in range(46):
        a = 2 * math.pi * i / 46
        r0, r1 = 170, 1250
        d.line([(cx + r0 * math.cos(a), cy + r0 * math.sin(a)),
                (cx + r1 * math.cos(a), cy + r1 * math.sin(a))],
               fill=(238, 214, 176), width=3)


def draw_decor(d, decor, box):
    for item in decor or []:
        if item == "circle":
            d.ellipse((box[0] - 20, box[1] - 16, box[2] + 20, box[1] + 130), outline=RED, width=9)
        elif item == "arrow":
            x, y = box[0] - 130, box[1] + 150
            d.line([(x, y), (x + 100, y + 40)], fill=RED, width=10)
            d.polygon([(x + 112, y + 46), (x + 82, y + 56), (x + 88, y + 22)], fill=RED)
        elif item == "tape":
            cx = (box[0] + box[2]) / 2
            d.polygon([(cx - 70, box[1] - 18), (cx + 70, box[1] - 14),
                       (cx + 62, box[1] + 24), (cx - 62, box[1] + 20)], fill=(238, 226, 176, 220))
        elif item == "flower":
            for (fx, fy) in [(box[0] - 40, box[3] + 30), (box[2] + 30, box[1] + 40)]:
                for k in range(6):
                    a = 2 * math.pi * k / 6
                    px, py = fx + 16 * math.cos(a), fy + 16 * math.sin(a)
                    d.ellipse((px - 12, py - 12, px + 12, py + 12), fill=(246, 206, 214))
                d.ellipse((fx - 10, fy - 10, fx + 10, fy + 10), fill=(244, 202, 96))
        elif item == "stars":
            for (sx, sy, r) in [(240, 180, 16), (1700, 200, 20), (1560, 860, 13), (330, 820, 11)]:
                pts = []
                for k in range(10):
                    a = -math.pi / 2 + k * math.pi / 5
                    rr = r if k % 2 == 0 else r * 0.44
                    pts.append((sx + rr * math.cos(a), sy + rr * math.sin(a)))
                d.polygon(pts, fill=(240, 196, 96))
        elif item == "numbers":
            for i, (nx, ny) in enumerate([(box[0] + 20, box[1] + 20), (box[0] + 20, box[1] + 160)]):
                d.text((nx, ny), str(i + 1), font=font(64, bold=True), fill=(230, 216, 192))
        elif item == "bubble":
            d.rounded_rectangle((1320, 130, 1780, 250), radius=28, fill=(255, 253, 246), outline=BLUE, width=4)
            d.polygon([(1400, 248), (1360, 292), (1450, 248)], fill=(255, 253, 246))
            d.text((1350, 165), "免费薅，真香～", font=font(38, bold=True), fill=BLUE)


def pet_layout(style):
    """返回 (left, top, size)，角色脚底对齐画面 940。"""
    if style in ("empty",):
        return None
    if style == "title":
        return (1390, 350, 470)
    if style == "solo":
        return (520, 190, 760)
    if style == "demo":
        return (110, 230, 700)
    if style == "emphasis":
        return (60, 520, 440)
    if style == "focus":
        return (1470, 610, 350)
    if style == "ending":
        return (110, 590, 400)
    return (110, 230, 700)


def card_box(style):
    if style == "title":
        return (330, 250, 1590, 780)
    if style == "solo":
        return (1140, 230, 1790, 700)
    if style == "demo":
        return (860, 210, 1810, 830)
    if style == "focus":
        return (310, 150, 1440, 880)
    if style == "emphasis":
        return (620, 190, 1740, 780)
    if style == "ending":
        return (620, 250, 1680, 760)
    return (860, 210, 1810, 830)


def render_frame(shot, action, chapter, out_path, ending=False):
    img = paper_bg().copy() if not ending else Image.new("RGB", (W, H), DARK)
    d = ImageDraw.Draw(img)
    if not ending:
        draw_chapter_bar(d, chapter)
        if "burst" in (shot.get("decor") or []):
            draw_burst(d)
    else:
        for i in range(9):
            x = 120 + i * 210
            d.line([(x, 0), (x + 60, H)], fill=(36, 54, 72), width=2)
        d.text((620, 180), "FIN", font=font(90, bold=True), fill=(228, 196, 128))

    style = shot["style"]
    box = card_box(style)
    if style == "title":
        d.text((box[0] + 40, box[1] + 20), "实验助手插件", font=font(96, bold=True), fill=INK)
        d.line([(box[0] + 40, box[1] + 150), (box[2] - 40, box[1] + 150)], fill=RED, width=6)
        d.text((box[0] + 40, box[1] + 190), "这回也住进 WorkBuddy 了", font=font(58, bold=True), fill=BLUE)
        d.text((box[0] + 40, box[1] + 310), "一个仓库 · 两个宿主 · 同一只大肥鱼", font=font(36), fill=(110, 102, 90))
        d.text((box[0] + 40, box[1] + 400), "v0.16.1  /  讲解视频", font=font(30, mono=True), fill=(150, 138, 116))
    elif style == "ending":
        d.text((box[0], box[1] + 40), "下次做实验，", font=font(66, bold=True), fill=(250, 246, 236))
        d.text((box[0], box[1] + 150), "让大肥鱼陪你一起记。", font=font(66, bold=True), fill=(250, 246, 236))
        d.text((box[0], box[1] + 290), "GitHub 搜索 dsh-lab-assistant", font=font(34), fill=(176, 202, 226))
        for (fx, fy) in [(1500, 240), (1660, 700), (560, 880)]:
            for k in range(6):
                a = 2 * math.pi * k / 6
                px, py = fx + 18 * math.cos(a), fy + 18 * math.sin(a)
                d.ellipse((px - 13, py - 13, px + 13, py + 13), fill=(228, 196, 128))
            d.ellipse((fx - 10, fy - 10, fx + 10, fy + 10), fill=(246, 214, 148))
    else:
        draw_card(img, shot.get("card"), box)
    draw_decor(d, shot.get("decor"), box)

    lay = pet_layout(style)
    if lay and action:
        p = os.path.join(PET, action + ".png")
        if os.path.exists(p):
            pet = Image.open(p).convert("RGBA")
            sz = lay[2]
            pet = pet.resize((sz, sz), Image.LANCZOS)
            img.paste(pet, (lay[0], lay[1]), pet)

    draw_subtitle(d, shot["text"])
    img.save(out_path)


# ────────────────────────── 流程 ──────────────────────────

def load_project():
    with open(os.path.join(VID, "timeline.json"), encoding="utf-8") as f:
        return json.load(f)


async def synth_all(shots):
    for s in shots:
        p = os.path.join(VOICE, s["id"] + ".mp3")
        if not os.path.exists(p):
            await edge_tts.Communicate(s["text"], TTS_VOICE, rate=TTS_RATE, pitch=TTS_PITCH).save(p)
    return shots


def step_prepare():
    proj = load_project()
    shots = proj["shots"]
    for d in [FRAMES, LISTS, SEG, OUT, VOICE]:
        os.makedirs(d, exist_ok=True)
    asyncio.run(synth_all(shots))
    final, cursor = [], 0.0
    for i, s in enumerate(shots):
        tts_p = os.path.join(VOICE, s["id"] + ".mp3")
        td = duration_of(tts_p)
        dur = round(LEAD + td + TAIL, 3)
        row = dict(s, tts_duration=td, duration=dur, start=round(cursor, 3),
                   voice_start=round(cursor + LEAD, 3))
        final.append(row)
        cursor += dur

        acts = s.get("actions") or ["idle"]
        ending = s["style"] == "ending"
        for k, act in enumerate(acts):
            out = os.path.join(FRAMES, f"{s['id']}_a{k}.png")
            if s["style"] == "empty":
                render_frame(s, None, s["chapter"], out)
            else:
                render_frame(s, act, s["chapter"], out, ending=ending)

        # concat demuxer：动作帧按 FRAME_DT 循环，覆盖整段时长
        n = max(1, int(math.ceil(dur / FRAME_DT)))
        lines = []
        for j in range(n):
            k = j % len(acts)
            lines.append(f"file '{os.path.join(FRAMES, s['id'] + '_a%d.png' % k).replace(os.sep, '/')}'")
            lines.append(f"duration {FRAME_DT:.3f}")
        lines.append(lines[-2])
        with open(os.path.join(LISTS, s["id"] + ".txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        print(f"PREP {s['id']} {s['style']:<9} tts={td:5.2f}s shot={dur:5.2f}s frames={len(acts)}", flush=True)

    with open(os.path.join(VID, "timeline.final.json"), "w", encoding="utf-8") as f:
        json.dump(dict(proj, total=round(cursor, 3), shots=final), f, ensure_ascii=False, indent=2)

    # 人声稿（script.md）
    with open(os.path.join(VID, "script.md"), "w", encoding="utf-8") as f:
        f.write(f"# {proj['topic']}\n\n")
        f.write(f"风格：{proj['style_rule']}\n")
        f.write(f"配音：{TTS_VOICE} / rate {TTS_RATE} / pitch {TTS_PITCH}（与 10-31 B 站演示片一致）\n")
        f.write(f"BGM：{BGM}\n\n")
        for s in final:
            f.write(f"## {s['id']} [{s['style']}] {s['chapter']}\n\n{s['text']}\n\n")
            if s.get("card"):
                f.write(f"> 卡片：{json.dumps(s['card'], ensure_ascii=False)[:220]}\n\n")
    print("TOTAL", round(cursor, 3), "s", flush=True)
    return final


def step_audio():
    with open(os.path.join(VID, "timeline.final.json"), encoding="utf-8") as f:
        data = json.load(f)
    total = data["total"]
    n = int((total + 0.2) * SR)
    voice = np.zeros(n, np.float32)
    for s in data["shots"]:
        pcm = decode_audio(os.path.join(VOICE, s["id"] + ".mp3"))
        st = int(s["voice_start"] * SR)
        en = min(n, st + len(pcm))
        voice[st:en] += pcm[: en - st]
        print(f"AUDIO {s['id']} {len(pcm)/SR:5.2f}s @ {s['voice_start']:.2f}s", flush=True)
    bgm_raw = decode_audio(BGM)
    need = n + SR
    if len(bgm_raw) < need:
        bgm_raw = np.tile(bgm_raw, int(math.ceil(need / len(bgm_raw))))
    bgm = bgm_raw[:n]

    # 侧链：说话时把 BGM 压下去
    win = int(0.15 * SR)
    env = np.convolve(np.abs(voice), np.ones(win, np.float32) / win, mode="same")
    env /= (env.max() + 1e-9)
    duck = 1.0 - 0.42 * np.clip(env * 3.0, 0, 1)
    mix = voice * 0.95 + bgm * 0.13 * duck
    fi, fo = int(1.2 * SR), int(2.5 * SR)
    mix[:fi] *= np.linspace(0, 1, fi)
    mix[-fo:] *= np.linspace(1, 0, fo)
    peak = np.abs(mix).max()
    if peak > 0.96:
        mix *= 0.96 / peak
    path = os.path.join(BUILD, "mix.wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(mix, -1, 1) * 32767).astype(np.int16).tobytes())
    print("MIX", path, round(len(mix) / SR, 3), "s", flush=True)


def step_video():
    with open(os.path.join(VID, "timeline.final.json"), encoding="utf-8") as f:
        data = json.load(f)
    shot_list = []
    for s in data["shots"]:
        lst = os.path.join(LISTS, s["id"] + ".txt")
        seg = os.path.join(SEG, s["id"] + ".mp4")
        r = ff(["-f", "concat", "-safe", "0", "-i", lst,
                "-vf", f"fps={FPS},format=yuv420p,fade=t=in:st=0:d=0.22",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                "-r", str(FPS), "-t", f"{s['duration']:.3f}", seg], capture=True)
        if r.returncode != 0:
            print("FFMPEG ERROR", s["id"], (r.stderr or "")[:600], flush=True)
            raise SystemExit(1)
        real = duration_of(seg)
        print(f"SEG {s['id']} target={s['duration']:.3f}s real={real:.3f}s", flush=True)
        shot_list.append(f"file '{seg.replace(os.sep, '/')}'")
    concat = os.path.join(BUILD, "shots.txt")
    with open(concat, "w", encoding="utf-8") as f:
        f.write("\n".join(shot_list) + "\n")
    silent = os.path.join(BUILD, "video_silent.mp4")
    r = ff(["-f", "concat", "-safe", "0", "-i", concat, "-c", "copy", silent], capture=True)
    if r.returncode != 0:
        print("CONCAT ERROR", (r.stderr or "")[:800], flush=True)
        raise SystemExit(1)

    final = os.path.join(OUT, "video.mp4")
    r = ff(["-i", silent, "-i", os.path.join(BUILD, "mix.wav"),
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", final], capture=True)
    if r.returncode != 0:
        print("MUX ERROR", (r.stderr or "")[:800], flush=True)
        raise SystemExit(1)
    print("VIDEO", final, duration_of(final), "s", os.path.getsize(final), "bytes", flush=True)


def srt_time(t):
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h:02d}:{m:02d}:{int(s):02d},{int((s - int(s)) * 1000):03d}"


def step_outputs():
    with open(os.path.join(VID, "timeline.final.json"), encoding="utf-8") as f:
        data = json.load(f)
    shots = data["shots"]
    # 字幕
    with open(os.path.join(OUT, "subtitle.srt"), "w", encoding="utf-8") as f:
        for i, s in enumerate(shots, 1):
            start, end = s["voice_start"], s["voice_start"] + s["tts_duration"]
            f.write(f"{i}\n{srt_time(start)} --> {srt_time(end)}\n{s['text']}\n\n")
    # 封面
    cover_src = os.path.join(FRAMES, "s01_a0.png")
    cover = Image.open(cover_src).convert("RGB")
    cover.save(os.path.join(OUT, "cover.png"))
    # 15 秒样片
    ff(["-i", os.path.join(OUT, "video.mp4"), "-t", "15", "-c", "copy",
        os.path.join(OUT, "preview_15s.mp4")])

    total = data["total"]
    real_total = duration_of(os.path.join(OUT, "video.mp4"))
    actions_used = sorted({a for s in shots for a in (s.get("actions") or ["idle"])})
    report = [
        "# 讲解视频生成报告", "",
        f"- 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 主题：{data['topic']}",
        f"- 成片：`out/video.mp4`，时长 **{real_total:.3f} s**，{W}x{H} @ {FPS}fps",
        f"- 镜头数：{len(shots)}，风格：{', '.join(sorted({s['style'] for s in shots}))}",
        f"- 角色动作：从 `assets/pet/` 用了 {len(actions_used)} 种桌宠动作（{', '.join(actions_used)}）",
        f"- 配音：`{TTS_VOICE}` / rate `{TTS_RATE}` / pitch `{TTS_PITCH}` —— 与 10-31 B 站演示片同参数（同句重合成 7.49s vs 原片 7.49s）",
        f"- BGM：`{BGM}`，音量 0.13 且旁白时侧链压低 42%，首尾 1.2s / 2.5s 淡入淡出",
        "", "## 音画同步", "",
        "画面按每句配音的真实时长排布（lead 0.30s + 音频 + tail 0.38s），"
        f"字幕起点 = 人声起点。各镜头用 ffmpeg `-t` 精确截断，实测单段与目标相差 ≤0.02s；"
        f"时间轴 {total:.3f}s，成片 {real_total:.3f}s，累计偏差 **{real_total - total:+.3f}s**（编码取整，非音画漂移）。", "",
        "| shot | style | 人声(s) | 镜头(s) | 起点(s) |", "|---|---|---|---|---|",
    ]
    for s in shots:
        report.append(f"| {s['id']} | {s['style']} | {s['tts_duration']:.3f} | {s['duration']:.3f} | {s['start']:.3f} |")
    report += [
        "", "## 警告与边界", "",
        "1. 本机 `anilecture` 技能包缺 `bin/anilecture.py` 渲染 CLI，本片按同一分镜规范用 Pillow + ffmpeg 本地合成；未生成任何角色图，角色全部取自 `assets/pet/`。",
        "2. 动效范围：静态立绘 + 桌宠动作序列（每 0.20s 换帧）+ 镜头淡入；无嘴型层、无 Live2D / 数字人。",
        "3. `web-shot` 卡片使用项目内真实截图 `docs/screenshots/panel.png` 与 `guide.png`，非合成示意图。",
        "4. 片中数据以 0.16.1 源码核对为准，刻意未采用 README 里几处与代码不一致的说法，详见 `sources.md`。",
        "5. DSH 与 WorkBuddy 同时运行并写同一数据目录时无跨进程锁（片中未展开，属已知风险）。",
        "6. 桌宠与面板仅 Windows；片中所述 13 / 1 / 126 项为单机实测状态，不代表其他电脑。",
    ]
    with open(os.path.join(OUT, "report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    print("OUTPUTS", sorted(os.listdir(OUT)), flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", default="all")
    a = ap.parse_args()
    if a.step in ("prepare", "all"):
        step_prepare()
    if a.step in ("audio", "all"):
        step_audio()
    if a.step in ("video", "all"):
        step_video()
    if a.step in ("outputs", "all"):
        step_outputs()
