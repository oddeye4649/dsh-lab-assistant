#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""实验助手宣传片渲染器。

用法：
  python promo_video.py preview 3.2 12.5    # 导出指定秒数的静帧
  python promo_video.py render              # 渲染完整视频并混音
"""
import json
import math
import os
import random
import subprocess
import sys
import wave

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets", "pet")
VIDEO_DIR = os.path.join(ROOT, "temp", "video")
OUT_DIR = os.path.join(ROOT, "docs", "promo")
W, H = 1920, 1080
FPS = 30
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

FONT_REG = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"

BG_TOP = (232, 243, 255)
BG_BOTTOM = (250, 253, 255)
ACCENT = (86, 141, 208)
ACCENT_DARK = (44, 82, 138)
TEXT = (39, 55, 82)
MUTED = (120, 139, 165)
CREAM = (255, 250, 238)

_font_cache = {}


def font(size, bold=False):
    key = (size, bold)
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)
    return _font_cache[key]


def text(canvas, xy, s, size, color=TEXT, bold=False, anchor="la"):
    ImageDraw.Draw(canvas).text(xy, s, font=font(size, bold), fill=color, anchor=anchor)


def load_frames():
    groups = {}
    for name in sorted(os.listdir(ASSETS)):
        if not name.lower().endswith(".png"):
            continue
        base = name[:-4]
        key = base
        idx = None
        if "_" in base:
            head, tail = base.rsplit("_", 1)
            if tail.isdigit():
                key, idx = head, int(tail)
        entry = groups.setdefault(key, [])
        entry.append((idx if idx is not None else 0, os.path.join(ASSETS, name)))
    frames = {}
    for key, items in groups.items():
        items.sort(key=lambda x: x[0])
        frames[key] = [Image.open(p).convert("RGBA") for _, p in items]
    return frames


FRAMES = load_frames()
_pet_scaled = {}


def pet_image(key, index, char_h, flip=False):
    cache_key = (key, index % len(FRAMES[key]), char_h, flip)
    if cache_key in _pet_scaled:
        return _pet_scaled[cache_key]
    img = FRAMES[key][index % len(FRAMES[key])]
    scale = char_h / 460.0
    size = max(8, int(round(512 * scale)))
    im = img.resize((size, size), Image.LANCZOS)
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    _pet_scaled[cache_key] = im
    return im


def alpha_paste(dst, src, x, y):
    sx0, sy0 = max(0, -x), max(0, -y)
    dx0, dy0 = max(0, x), max(0, y)
    w = min(src.width - sx0, dst.width - dx0)
    h = min(src.height - sy0, dst.height - dy0)
    if w <= 0 or h <= 0:
        return
    dst.alpha_composite(src.crop((sx0, sy0, sx0 + w, sy0 + h)), (dx0, dy0))


def draw_pet(base, key, t, cx, feet_y, char_h=360, flip=False, fps=7.0, bob=0.0, alpha=1.0):
    if key not in FRAMES:
        return
    im = pet_image(key, int(t * fps), char_h, flip)
    scale = char_h / 460.0
    top = int(round(feet_y - 486 * scale + bob))
    left = int(round(cx - im.width / 2))
    if alpha < 1:
        im = im.copy()
        a = im.getchannel("A").point(lambda v: int(v * alpha))
        im.putalpha(a)
    alpha_paste(base, im, left, top)


def round_rect(layer, box, radius, fill=None, outline=None, width=1):
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def card(base, box, radius=26, fill=(255, 255, 255, 255), shadow=26, border=None):
    x0, y0, x1, y1 = box
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(sh)
    d.rounded_rectangle((x0, y0 + 8, x1, y1 + 10), radius=radius, fill=(40, 80, 130, shadow))
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    base.alpha_composite(sh)
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=border, width=1 if border else 0)
    base.alpha_composite(layer)


def bubble(base, x, y, text_str, size=30, tail="down", max_width=520):
    """气泡：x,y 是尾巴尖端坐标。"""
    tmp = Image.new("RGBA", (10, 10))
    dt = ImageDraw.Draw(tmp)
    bbox = dt.multiline_textbbox((0, 0), text_str, font=font(size), spacing=8)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    bw, bh = min(max_width, tw + 52), th + 40
    left = max(16, min(W - bw - 16, x - bw // 2))
    top = y - bh - 26 if tail == "down" else y + 26
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((left, top, left + bw, top + bh), radius=20, fill=CREAM, outline=(240, 222, 190), width=2)
    if tail == "down":
        d.polygon([(x - 14, top + bh - 2), (x + 14, top + bh - 2), (x, top + bh + 16)], fill=CREAM)
    else:
        d.polygon([(x - 14, top + 2), (x + 14, top + 2), (x, top - 16)], fill=CREAM)
    base.alpha_composite(layer)
    d2 = ImageDraw.Draw(base)
    d2.multiline_text((left + 26, top + 20), text_str, font=font(size), fill=TEXT, spacing=8)


def gradient_bg(accent=False):
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    if accent:
        top, bottom = (58, 103, 163), (30, 58, 102)
    else:
        top, bottom = BG_TOP, BG_BOTTOM
    for y in range(H):
        t = y / (H - 1)
        d.line([(0, y), (W, y)], fill=(
            int(top[0] + (bottom[0] - top[0]) * t),
            int(top[1] + (bottom[1] - top[1]) * t),
            int(top[2] + (bottom[2] - top[2]) * t),
        ))
    base = img.convert("RGBA")
    # 柔和光斑
    blobs = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    db = ImageDraw.Draw(blobs)
    random.seed(7)
    for _ in range(9):
        cx, cy = random.randint(0, W), random.randint(0, H)
        r = random.randint(120, 340)
        color = (140, 190, 245, 26) if not accent else (120, 170, 230, 30)
        db.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color)
    blobs = blobs.filter(ImageFilter.GaussianBlur(60))
    base.alpha_composite(blobs)
    return base


def bubbles_overlay(base, t, accent=False):
    random.seed(11)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(16):
        x = random.randint(0, W)
        speed = random.uniform(6, 18)
        y = (random.randint(0, H) - t * speed) % H
        r = random.randint(4, 16)
        color = (255, 255, 255, 60) if not accent else (180, 210, 245, 60)
        d.ellipse((x - r, y - r, x + r, y + r), fill=color)
    base.alpha_composite(layer)


def _pen(target):
    if isinstance(target, ImageDraw.ImageDraw):
        return target
    return ImageDraw.Draw(target)


def icon_warning(target, x, y, size=54, color=(238, 152, 96)):
    d = _pen(target)
    d.rounded_rectangle((x, y + size * 0.18, x + size, y + size * 0.18 + size * 0.8), radius=12, fill=(255, 245, 235))
    d.polygon([(x + size / 2, y + 6), (x + size - 6, y + size - 8), (x + 6, y + size - 8)], fill=color)
    d.rectangle((x + size / 2 - 3, y + size * 0.32, x + size / 2 + 3, y + size * 0.62), fill=(255, 255, 255))
    d.ellipse((x + size / 2 - 4, y + size * 0.68, x + size / 2 + 4, y + size * 0.76), fill=(255, 255, 255))


def icon_lines(target, x, y, size=54, color=(120, 170, 225)):
    d = _pen(target)
    d.rounded_rectangle((x, y, x + size, y + size), radius=12, fill=(238, 246, 255))
    for i in range(3):
        d.rounded_rectangle((x + 12, y + 16 + i * 14, x + size - 12 - (i % 2) * 10, y + 22 + i * 14), radius=3, fill=color)


def icon_moon(target, x, y, size=54, color=(130, 140, 200)):
    d = _pen(target)
    d.rounded_rectangle((x, y, x + size, y + size), radius=12, fill=(242, 243, 252))
    d.ellipse((x + 12, y + 10, x + 42, y + 40), fill=color)
    d.ellipse((x + 6, y + 2, x + 36, y + 32), fill=(242, 243, 252))


def check_badge(target, x, y, r=16, color=(110, 180, 145)):
    d = _pen(target)
    d.ellipse((x - r, y - r, x + r, y + r), fill=color)
    d.line([(x - 7, y), (x - 2, y + 6), (x + 8, y - 7)], fill=(255, 255, 255), width=4)


# ---------------------------------------------------------------- scenes

class Scene:
    key = ""

    def __init__(self, duration):
        self.duration = duration
        self.bg = None

    def build(self, accent=False):
        return gradient_bg(accent)

    def render(self, t):
        raise NotImplementedError


class HookScene(Scene):
    key = "hook"

    def build(self):
        base = gradient_bg()
        bubbles_overlay(base, 0)
        return base

    def render(self, t):
        if self.bg is None:
            self.bg = self.build()
        base = self.bg.copy()
        bubbles_overlay(base, t)
        text(base, (140, 110), "做实验最烦的，", 58, TEXT, bold=True)
        text(base, (140, 186), "从来不是实验本身。", 58, ACCENT_DARK, bold=True)

        items = [
            ("环境报错查半天", "装好了却跑不起来，报错看不懂", icon_warning),
            ("步骤记不住", "老师发的流程十几页，做着做着就乱", icon_lines),
            ("报告排版到深夜", "截图、数据、格式，全得手动搬", icon_moon),
        ]
        for i, (title, sub, icon) in enumerate(items):
            appear = 0.35 + i * 0.55
            if t < appear:
                continue
            k = min(1.0, (t - appear) / 0.35)
            x = 140 + (1 - k) * -40
            y = 300 + i * 190
            card(base, (x, y, x + 820, y + 150), 24)
            layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
            icon(layer, x + 34, y + 46, 56)
            base.alpha_composite(layer)
            text(base, (x + 120, y + 34), title, 36, TEXT, bold=True)
            text(base, (x + 120, y + 88), sub, 24, MUTED)

        draw_pet(base, "confused", t, 1540, 940, 560)
        if t > 1.2:
            bubble(base, 1450, 460, "又报错了？", 30)
        return base


class MeetScene(Scene):
    key = "meet"

    def build(self):
        return gradient_bg()

    def render(self, t):
        if self.bg is None:
            self.bg = self.build()
        base = self.bg.copy()
        bubbles_overlay(base, t)

        k = min(1.0, t / 0.6)
        text(base, (W / 2, 250), "实验助手", 96, ACCENT_DARK, bold=True, anchor="mm")
        text(base, (W / 2, 340), "住在 DSH 桌面上的实验搭子", 38, MUTED, anchor="mm")

        draw_pet(base, "wave", t, W / 2, 900, 520, bob=math.sin(t * 3.4) * 6)

        chip_y = 960
        label = "大肥鱼"
        tw = ImageDraw.Draw(Image.new("RGBA", (10, 10))).textbbox((0, 0), label, font=font(28, True))[2]
        card(base, (W / 2 - tw / 2 - 40, chip_y, W / 2 + tw / 2 + 40, chip_y + 58), 29)
        text(base, (W / 2, chip_y + 29), label, 28, ACCENT_DARK, bold=True, anchor="mm")

        if t > 1.1:
            bubble(base, W / 2 + 300, 640, "今天做哪个实验呀？", 30)
        return base


class ActionsScene(Scene):
    key = "actions"

    def build(self):
        return gradient_bg()

    ACTIONS = [
        ("drink", "喝咖啡"), ("typing", "敲键盘"), ("read", "看书"), ("stretch", "伸懒腰"), ("wave", "挥手"),
        ("sleep", "打瞌睡"), ("snack", "吃饼干"), ("music", "听歌"), ("wipe", "擦汗"), ("spin", "转圈"),
    ]

    def render(self, t):
        if self.bg is None:
            self.bg = self.build()
        base = self.bg.copy()
        bubbles_overlay(base, t)
        text(base, (120, 78), "她平时都在忙什么？", 46, TEXT, bold=True)
        text(base, (120, 142), "十种待机小动作，全是本地播放，不花一个 token", 26, MUTED)

        cols, rows = 5, 2
        cw, chh = 328, 372
        gx, gy = 118, 206
        for i, (key, label) in enumerate(self.ACTIONS):
            appear = 0.2 + i * 0.12
            if t < appear:
                continue
            k = min(1.0, (t - appear) / 0.3)
            col, row = i % cols, i // cols
            x = gx + col * (cw + 16)
            y = gy + row * (chh + 18) + (1 - k) * 24
            card(base, (x, y, x + cw, y + chh), 22)
            draw_pet(base, key, t + i * 0.37, x + cw / 2, y + chh - 84, 230)
            text(base, (x + cw / 2, y + chh - 46), label, 27, TEXT, bold=True, anchor="mm")
        return base


class DshScene(Scene):
    key = "dsh"

    def build(self):
        return gradient_bg()

    def render(self, t):
        if self.bg is None:
            self.bg = self.build()
        base = self.bg.copy()
        bubbles_overlay(base, t)
        text(base, (110, 76), "在 DSH 里说一句话", 46, TEXT, bold=True)
        text(base, (110, 140), "实验档案、环境检查、实测记录，她都能接住", 26, MUTED)

        win = (110, 200, 1120, 960)
        card(base, win, 26)
        # 窗口标题栏
        d = ImageDraw.Draw(base)
        d.rounded_rectangle((110, 200, 1120, 268), radius=26, fill=(238, 245, 255))
        d.rectangle((110, 244, 1120, 268), fill=(238, 245, 255))
        for i, color in enumerate([(255, 122, 116), (255, 197, 96), (116, 205, 130)]):
            d.ellipse((138 + i * 26, 224, 154 + i * 26, 240), fill=color)
        text(base, (230, 224), "DSH · 实验助手", 24, MUTED, bold=True)

        # 用户消息
        if t > 0.2:
            card(base, (600, 300, 1080, 390), 20, fill=(226, 240, 255, 255), shadow=0)
            text(base, (620, 320), "帮我准备计算机网络实验三，", 24, TEXT)
            text(base, (620, 352), "报告用老师发的模板。", 24, TEXT)

        tools = [
            ("lab_experiment_create", "新建实验档案"),
            ("lab_environment_probe", "只读检查 eNSP / VirtualBox"),
            ("lab_experiment_record_result", "记录每一步实测值"),
        ]
        for i, (code, label) in enumerate(tools):
            appear = 1.1 + i * 0.75
            if t < appear:
                continue
            y = 440 + i * 150
            card(base, (150, y, 1080, y + 122), 20, fill=(250, 253, 255, 255), shadow=14)
            check_badge(ImageDraw.Draw(base), 186, y + 60)
            text(base, (218, y + 22), code, 22, ACCENT, bold=True)
            text(base, (218, y + 62), label, 28, TEXT)

        draw_pet(base, "point", t, 1530, 900, 470, flip=True)
        if t > 1.6:
            bubble(base, 1470, 560, "在这里，点一下就好", 28)
        return base


class GuideScene(Scene):
    key = "guide"

    def build(self):
        return gradient_bg()

    def render(self, t):
        if self.bg is None:
            self.bg = self.build()
        base = self.bg.copy()
        bubbles_overlay(base, t)
        text(base, (110, 76), "点一下桌宠，她来判对错", 46, TEXT, bold=True)
        text(base, (110, 140), "guided 模式：给一条命令 → 你执行 → 点她校验 → 自动指下一步", 25, MUTED)

        shot = Image.open(os.path.join(ROOT, "docs", "screenshots", "guide.png")).convert("RGBA")
        shot = shot.crop((0, 0, 460, 370))
        target_w = 980
        shot = shot.resize((target_w, int(shot.height * target_w / shot.width)), Image.LANCZOS)
        mask = Image.new("L", shot.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width, shot.height), radius=16, fill=255)
        shot.putalpha(mask)
        card(base, (96, 208, 96 + shot.width + 8, 208 + shot.height + 8), 18, fill=(20, 26, 36, 255), shadow=30)
        base.alpha_composite(shot, (100, 212))

        # 点击波纹（落在高亮的命令框里）
        phase = (t * 1.5) % 1.0
        cx, cy = 400, 592
        ring = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dr = ImageDraw.Draw(ring)
        for k in range(2):
            r = 16 + (phase + k * 0.5) % 1.0 * 46
            dr.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(255, 214, 120, int(170 * (1 - ((phase + k * 0.5) % 1.0)))), width=4)
        dr.ellipse((cx - 6, cy - 6, cx + 6, cy + 6), fill=(255, 214, 120, 235))
        base.alpha_composite(ring)

        if t > 1.2:
            card(base, (1200, 268, 1800, 358), 20, fill=(235, 248, 241, 255), shadow=12)
            check_badge(base, 1246, 313, 20)
            text(base, (1286, 292), "通过，进入下一步", 30, (52, 122, 92), bold=True)
            text(base, (1210, 382), "连续通过会自动指到下一步", 22, MUTED)

        draw_pet(base, "point", t, 1480, 1010, 420, flip=True)
        return base


class ReportScene(Scene):
    key = "report"

    def build(self):
        return gradient_bg()

    def render(self, t):
        if self.bg is None:
            self.bg = self.build()
        base = self.bg.copy()
        bubbles_overlay(base, t)
        text(base, (110, 76), "老师发的模板，她能直接读", 46, TEXT, bold=True)
        text(base, (110, 140), "章节、表格、封面字段都照着模板来", 26, MUTED)

        # 面板截图
        panel = Image.open(os.path.join(ROOT, "docs", "screenshots", "panel.png")).convert("RGBA")
        scale = 660 / panel.height
        panel = panel.resize((int(panel.width * scale), 660), Image.LANCZOS)
        mask = Image.new("L", panel.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, panel.width, panel.height), radius=18, fill=255)
        panel.putalpha(mask)
        base.alpha_composite(panel, (120, 250))

        # 报告卡片
        card(base, (1080, 230, 1700, 900), 28)
        d = ImageDraw.Draw(base)
        d.rounded_rectangle((1120, 280, 1220, 380), radius=14, fill=(226, 238, 252))
        text(base, (1140, 300), "DOCX", 20, ACCENT_DARK, bold=True)
        text(base, (1240, 288), "实验报告.docx", 34, TEXT, bold=True)
        text(base, (1240, 338), "已按模板生成 · 可直接提交前核对", 22, MUTED)
        for i, wdt in enumerate([420, 380, 440, 300, 400]):
            d.rounded_rectangle((1120, 430 + i * 54, 1120 + wdt, 450 + i * 54), radius=8, fill=(235, 242, 250))
        chips = ["【待补】实测值", "【待补】班级", "【待补】教师"]
        for i, chip in enumerate(chips):
            x = 1120 + (i % 2) * 260
            y = 720 + (i // 2) * 62
            d.rounded_rectangle((x, y, x + 238, y + 46), radius=12, fill=(255, 244, 226))
            text(base, (x + 18, y + 10), chip, 22, (176, 126, 60), bold=True)

        draw_pet(base, "happy", t, 1760, 980, 380)
        return base


class SafetyScene(Scene):
    key = "safety"

    def build(self):
        return gradient_bg()

    def render(self, t):
        if self.bg is None:
            self.bg = self.build()
        base = self.bg.copy()
        bubbles_overlay(base, t)
        text(base, (W / 2, 150), "有一件事，她绝不做", 52, TEXT, bold=True, anchor="mm")

        items = ["不替你编实验数据", "不偷偷安装或卸载软件", "所有资料只留在本机"]
        for i, item in enumerate(items):
            appear = 0.35 + i * 0.6
            if t < appear:
                continue
            k = min(1.0, (t - appear) / 0.35)
            y = 330 + i * 170
            card(base, (330, y, 1250, y + 120), 24)
            check_badge(ImageDraw.Draw(base), 386, y + 60, 22)
            text(base, (438, y + 32), item, 38, TEXT, bold=True)
            text(base, (1510 - 380, y + 34), "", 20, MUTED)

        draw_pet(base, "idle", t, 1560, 900, 420, bob=math.sin(t * 2.8) * 4)
        if t > 2.2:
            bubble(base, 1480, 590, "我只写你真正做过的～", 28)
        return base


class MultiScene(Scene):
    key = "multi"

    def build(self):
        return gradient_bg()

    def render(self, t):
        if self.bg is None:
            self.bg = self.build()
        base = self.bg.copy()
        bubbles_overlay(base, t)
        text(base, (W / 2, 120), "一个人做实验太安静？", 44, TEXT, bold=True, anchor="mm")
        text(base, (W / 2, 190), "右键桌宠 →「再来一只桌宠」，想要几只都可以", 30, ACCENT_DARK, anchor="mm")

        pets = [
            (420, "wave", 1.0, "我也来啦！"),
            (960, "drink", 1.1, "喝杯咖啡？"),
            (1500, "spin", 1.2, "转圈圈～"),
        ]
        for i, (x, key, appear, line) in enumerate(pets):
            if t < appear:
                continue
            k = min(1.0, (t - appear) / 0.45)
            slide = (1 - k) * 80
            draw_pet(base, key, t + i * 0.5, x + slide, 900, 400)
            if t > appear + 0.7:
                bubble(base, x, 500, line, 26)

        # 小跟班
        if t > 1.8:
            draw_pet(base, "wave", t + 0.8, 1778, 1010, 230)
        return base


class ClosingScene(Scene):
    key = "closing"

    def build(self):
        base = gradient_bg(accent=True)
        return base

    def render(self, t):
        if self.bg is None:
            self.bg = self.build()
        base = self.bg.copy()
        bubbles_overlay(base, t, accent=True)

        icon = Image.open(os.path.join(ROOT, "assets", "icon.png")).convert("RGBA").resize((150, 150), Image.LANCZOS)
        base.alpha_composite(icon, (W // 2 - 75, 110))

        text(base, (W / 2, 330), "实验助手", 82, (255, 255, 255), bold=True, anchor="mm")
        text(base, (W / 2, 410), "让 DSH 替你把实验流程跑顺", 34, (214, 230, 250), anchor="mm")

        card(base, (W / 2 - 480, 500, W / 2 + 480, 620), 22)
        text(base, (W / 2, 560), "github.com/oddeye4649/dsh-lab-assistant", 38, ACCENT_DARK, bold=True, anchor="mm")

        text(base, (W / 2, 648), "GitHub Releases 下载 · DSH 桌面端 plugin_manager 安装", 26, (214, 230, 250), anchor="mm")

        draw_pet(base, "wave", t, W / 2 - 260, 1040, 320)
        draw_pet(base, "happy", t + 0.4, W / 2 + 40, 1040, 320)
        draw_pet(base, "spin", t + 0.8, W / 2 + 340, 1040, 320)

        fade = min(1.0, max(0.0, (t - (self.duration - 0.9)) / 0.9))
        if fade > 0:
            black = Image.new("RGBA", (W, H), (0, 0, 0, int(255 * fade)))
            base.alpha_composite(black)
        return base


SCENE_CLASSES = {
    "hook": HookScene, "meet": MeetScene, "actions": ActionsScene, "dsh": DshScene,
    "guide": GuideScene,
    "report": ReportScene, "safety": SafetyScene, "multi": MultiScene, "closing": ClosingScene,
}
GAP = 1.0


def build_timeline():
    with open(os.path.join(VIDEO_DIR, "timeline.json"), encoding="utf-8") as f:
        rows = json.load(f)
    scenes = []
    cursor = 0.6
    entries = []
    for row in rows:
        cls = SCENE_CLASSES[row["key"]]
        duration = row["duration"] + GAP
        scenes.append(cls(duration))
        entries.append({"key": row["key"], "start": cursor, "duration": duration, "voice": row["duration"]})
        cursor += duration
    return scenes, entries, cursor + 1.4


def render_frames(scenes, entries, total):
    cmd = [FFMPEG, "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "pipe:0",
           "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
           os.path.join(VIDEO_DIR, "video_silent.mp4")]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    frames = int(total * FPS)
    for i in range(frames):
        t = i / float(FPS)
        idx = 0
        for j, e in enumerate(entries):
            if t >= e["start"]:
                idx = j
        entry = entries[idx]
        scene = scenes[idx]
        local = t - entry["start"]
        frame = scene.render(local)
        # 转场：先淡到背景色，再淡入下一幕，避免两套版式叠在一起
        transition = 0.42
        if idx > 0 and local < transition:
            prev = scenes[idx - 1]
            prev_frame = prev.render(prev.duration - 0.001)
            phase = local / transition
            dark = entry["key"] == "closing"
            plain = Image.new("RGB", (W, H), (32, 60, 104) if dark else BG_TOP)
            if phase < 0.5:
                frame = Image.blend(prev_frame.convert("RGB"), plain, phase * 2).convert("RGBA")
            else:
                frame = Image.blend(plain, frame.convert("RGB"), (phase - 0.5) * 2).convert("RGBA")
        proc.stdin.write(frame.convert("RGB").tobytes())
        if i % 150 == 0:
            print(f"  frame {i}/{frames}", flush=True)
    proc.stdin.close()
    proc.wait()


def build_audio(entries, total):
    sr = 48000
    voice = np.zeros(int(total * sr) + sr, dtype=np.float32)
    for e in entries:
        path = os.path.join(VIDEO_DIR, f"voice_{e['key']}.wav")
        with wave.open(path, "rb") as f:
            data = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
            if f.getnchannels() > 1:
                data = data.reshape(-1, f.getnchannels()).mean(axis=1)
        start = int((e["start"] + 0.28) * sr)
        voice[start:start + len(data)] += data
    voice = np.tanh(voice * 1.05) * 0.92

    # 轻快的尤克里里/电子音 BGM
    bpm = 104
    beat = 60.0 / bpm
    music = np.zeros(int(total * sr) + sr, dtype=np.float32)
    chords = [(261.63, 329.63, 392.00), (196.00, 246.94, 293.66),
              (220.00, 261.63, 329.63), (174.61, 220.00, 261.63)]
    t_all = np.arange(len(music)) / sr
    for bar in range(int(total / (beat * 4)) + 1):
        start = bar * beat * 4
        chord = chords[bar % 4]
        for n, freq in enumerate(chord):
            env = np.exp(-np.maximum(0, t_all - start - n * 0.02) * 2.4)
            tone = 0.05 * np.sin(2 * np.pi * freq * t_all) * env
            tone += 0.018 * np.sin(2 * np.pi * freq * 2 * t_all) * env
            music += tone
        # 旋律
        for k in range(4):
            note = chord[k % 3] * (2 if k % 2 else 1)
            st = start + k * beat
            env = np.exp(-np.maximum(0, t_all - st) * 6.0)
            music += 0.035 * np.sin(2 * np.pi * note * t_all) * env
        # 轻打击
        for k in range(4):
            st = start + k * beat
            env = np.exp(-np.maximum(0, t_all - st) * 28.0)
            music += 0.03 * np.sin(2 * np.pi * 90 * t_all) * env
    music *= 0.55
    music = np.tanh(music * 1.2) * 0.35

    end_fade = np.ones_like(music)
    fade_len = int(2.0 * sr)
    end_fade[-fade_len:] = np.linspace(1, 0, fade_len)
    music *= end_fade

    mix = voice + music
    mix = np.clip(mix, -1, 1)
    pcm = (mix * 32767).astype(np.int16)
    with wave.open(os.path.join(VIDEO_DIR, "mix.wav"), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sr)
        f.writeframes(pcm.tobytes())


def mux(total):
    out = os.path.join(OUT_DIR, "lab-assistant-promo.mp4")
    os.makedirs(OUT_DIR, exist_ok=True)
    subprocess.run([FFMPEG, "-y", "-loglevel", "error",
                    "-i", os.path.join(VIDEO_DIR, "video_silent.mp4"),
                    "-i", os.path.join(VIDEO_DIR, "mix.wav"),
                    "-shortest", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", out], check=True)
    print("saved", out, os.path.getsize(out))


def preview(times):
    scenes, entries, total = build_timeline()
    for ts in times:
        idx = 0
        for j, e in enumerate(entries):
            if ts >= e["start"]:
                idx = j
        frame = scenes[idx].render(ts - entries[idx]["start"])
        path = os.path.join(VIDEO_DIR, f"preview_{ts:.1f}.png")
        frame.convert("RGB").save(path)
        print("saved", path)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "render"
    if mode == "preview":
        preview([float(x) for x in sys.argv[2:]])
    else:
        scenes, entries, total = build_timeline()
        print("total", round(total, 2), "s")
        render_frames(scenes, entries, total)
        build_audio(entries, total)
        mux(total)
