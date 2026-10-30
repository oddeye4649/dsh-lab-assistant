#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 AI 生成的动作拼图切成分帧 PNG（512x512，透明底，底部对齐）。

用法：
  python scripts/slice-pet-sheets.py <源目录> <输出目录> [--sheet drink=drink.png:2x2 ...]

约定：
  - 每张拼图 = 一个动作的所有帧，按行优先顺序排列；
  - 自动找空隙下刀；没有空隙时在理想分割线附近找内容最少的列/行；
  - 抠掉纯白/浅灰棋盘格背景（仅对不透明图片），保留人物内部白色；
  - 所有帧按“脚底基线”对齐，跳跃帧的相对高度会保留。
"""
import os
import sys
import json
import argparse
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

TARGET = 512
MARGIN_BOTTOM = 26
MAX_DRAW_H = 460
MAX_DRAW_W = 480
MIN_BLOB = 400


def remove_background(im):
    """返回 RGBA 图；对不透明图片用泛洪去掉浅色中性背景。"""
    rgba = im.convert("RGBA")
    arr = np.array(rgba)
    if (arr[:, :, 3] < 250).any():
        # 已有透明通道，只清理极小的浮尘
        return rgba
    rgb = arr[:, :, :3].astype(np.int16)
    neutral = (rgb.max(2) - rgb.min(2) <= 4) & (rgb.min(2) >= 228)
    mask = Image.fromarray((neutral * 255).astype(np.uint8), "L").copy()
    w, h = mask.size
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
             (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
    for s in seeds:
        if mask.getpixel(s) == 255:
            ImageDraw.floodfill(mask, s, 128, thresh=0)
    bg = np.array(mask) == 128
    arr[bg, 3] = 0
    return Image.fromarray(arr, "RGBA")


def clean_alpha(im):
    """按 alpha 去掉孤立小噪点。"""
    arr = np.array(im)
    alpha = arr[:, :, 3]
    mask = alpha > 24
    lab, n = ndimage.label(mask)
    if n == 0:
        return im
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= MIN_BLOB
    arr[:, :, 3] = np.where(keep[lab], alpha, 0).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def find_cuts(mask, count, axis):
    """返回 count+1 个边界（含两端）。axis=1 列，axis=0 行。"""
    proj = mask.any(axis=0 if axis == 1 else 1)
    length = len(proj)
    ideal = [round(length * i / count) for i in range(count + 1)]
    edges = [0]
    for i in range(1, count):
        lo = max(1, ideal[i] - 70)
        hi = min(length - 2, ideal[i] + 70)
        seg = ~proj[lo:hi + 1]
        # 优先取连续空白段的中线
        best = None
        start = None
        for j, v in enumerate(seg):
            if v and start is None:
                start = j
            if not v and start is not None:
                if best is None or (j - start) > best[1]:
                    best = (start + lo, j - 1 + lo, j - start)
                start = None
        if start is not None and (best is None or (len(seg) - start) > best[1]):
            best = (start + lo, len(seg) - 1 + lo, len(seg) - start)
        if best is not None and best[2] >= 3:
            edges.append((best[0] + best[1]) // 2)
        else:
            # 没有空隙：取窗口内内容最少的列（并列取最靠近理想位）
            density = mask.sum(axis=0)[lo:hi + 1] if axis == 1 else mask.sum(axis=1)[lo:hi + 1]
            order = sorted(range(len(density)), key=lambda k: (density[k], abs((k + lo) - ideal[i])))
            edges.append(order[0] + lo)
    edges.append(length)
    return edges


def slice_sheet(path, cols, rows):
    im = Image.open(path)
    im = remove_background(im)
    im = clean_alpha(im)
    rgba = np.array(im)
    mask = rgba[:, :, 3] > 24
    xs = find_cuts(mask, cols, 1)
    ys = find_cuts(mask, rows, 0)
    frames = []
    for r in range(rows):
        for c in range(cols):
            x0, x1 = xs[c], xs[c + 1]
            y0, y1 = ys[r], ys[r + 1]
            sub = im.crop((x0, y0, x1, y1))
            arr = np.array(sub)
            sub_mask = arr[:, :, 3] > 24
            if not sub_mask.any():
                continue
            # 去掉贴着左右裁切边的小碎块（多为相邻帧的手指尖/发丝）
            lab, n = ndimage.label(sub_mask)
            if n > 1:
                sizes = ndimage.sum(sub_mask, lab, range(1, n + 1))
                largest = float(sizes.max())
                for idx in range(1, n + 1):
                    area = float(sizes[idx - 1])
                    if area >= largest * 0.05:
                        continue
                    ys_, xs_ = np.where(lab == idx)
                    if xs_.min() <= 1 or xs_.max() >= sub.width - 2:
                        arr[lab == idx, 3] = 0
                sub = Image.fromarray(arr, "RGBA")
                arr = np.array(sub)
                sub_mask = arr[:, :, 3] > 24
                if not sub_mask.any():
                    continue
            yy, xx = np.where(sub_mask)
            bbox = (int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1)
            # 主体 = 面积最大的连通域；速度线、星星等装饰不参与缩放定标
            lab2, n2 = ndimage.label(sub_mask)
            if n2 > 0:
                sizes2 = ndimage.sum(sub_mask, lab2, range(1, n2 + 1))
                main = int(np.argmax(sizes2)) + 1
                by, bx = np.where(lab2 == main)
                body = (int(bx.min()), int(by.min()), int(bx.max()) + 1, int(by.max()) + 1)
            else:
                body = bbox
            frames.append({"image": sub, "bbox": bbox, "body": body,
                           "edge_touch": bool(bbox[0] <= 1 or bbox[1] <= 1 or
                                              bbox[2] >= sub.width - 1 or bbox[3] >= sub.height - 1)})
    return frames


def compose(frames, action, out_dir, start=1):
    if not frames:
        return []
    heights = [f["body"][3] - f["body"][1] for f in frames]
    widths = [f["body"][2] - f["body"][0] for f in frames]
    baselines = [f["body"][3] for f in frames]
    base = max(baselines)
    lifts = [base - b for b in baselines]
    # 用“典型帧高度”统一定标，保证不同动作之间大小一致；
    # 特别高的跳跃帧单独缩一点，避免顶部超出画布。
    typical = float(np.median(heights))
    scale = min(MAX_DRAW_H / typical, MAX_DRAW_W / max(widths), 1.6)
    usable = TARGET - MARGIN_BOTTOM - 8
    outputs = []
    for i, f in enumerate(frames, start):
        x0, y0, x1, y1 = f["bbox"]
        crop = f["image"].crop((x0, y0, x1, y1))
        bx0, by0, bx1, by1 = f["body"]
        lift_px = base - by1
        if lift_px < 12:
            lift_px = 0
        body_h = max(1, by1 - by0)
        s = scale
        if (body_h + lift_px) * s > usable:
            s = usable / float(body_h + lift_px)
        w = max(1, int(round(crop.width * s)))
        h = max(1, int(round(crop.height * s)))
        crop = crop.resize((w, h), Image.LANCZOS)
        canvas = Image.new("RGBA", (TARGET, TARGET), (0, 0, 0, 0))
        # 以“主体”底部中心对齐，装饰元素可超出画布被自然裁掉
        lift = int(round(lift_px * s))
        body_center_x = (bx0 + bx1) / 2.0 - x0
        body_bottom_y = by1 - y0
        left = int(round(TARGET / 2 - body_center_x * s))
        top = int(round(TARGET - MARGIN_BOTTOM - lift - body_bottom_y * s))
        canvas.alpha_composite(crop, (left, top))
        name = f"{action}_{i}.png"
        canvas.save(os.path.join(out_dir, name))
        outputs.append({"name": name, "edge_touch": f["edge_touch"]})
    return outputs


def contact_sheet(action, files, out_dir):
    ims = [Image.open(os.path.join(out_dir, f["name"])) for f in files]
    sheet = Image.new("RGBA", (TARGET * len(ims), TARGET), (232, 241, 251, 255))
    for i, im in enumerate(ims):
        sheet.alpha_composite(im, (i * TARGET, 0))
    sheet.convert("RGB").save(os.path.join(out_dir, f"_preview_{action}.png"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--sheet", action="append", required=True,
                    help="动作=文件名:列x行，例如 drink=drink.png:2x2")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    groups = {}
    order = []
    for spec in args.sheet:
        action, rest = spec.split("=", 1)
        parts = rest.split(":")
        filename, grid = parts[0], parts[1]
        start = int(parts[2]) if len(parts) > 2 else None
        cols, rows = [int(v) for v in grid.lower().split("x")]
        if action not in groups:
            groups[action] = []
            order.append(action)
        groups[action].append({"file": filename, "cols": cols, "rows": rows, "start": start})

    report = {}
    for action in order:
        all_frames = []
        for item in groups[action]:
            all_frames.extend(slice_sheet(os.path.join(args.src, item["file"]), item["cols"], item["rows"]))
        start = groups[action][0]["start"] or 1
        files = compose(all_frames, action, args.out, start)
        contact_sheet(action, files, args.out)
        report[action] = {"count": len(files), "edge_touch": [f["name"] for f in files if f["edge_touch"]]}
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
