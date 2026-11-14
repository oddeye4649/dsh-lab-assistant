# -*- coding: utf-8 -*-
"""生成几个角色配音试听，供用户挑选音色。"""
import asyncio
import os
import re
import subprocess
import sys

import edge_tts
import imageio_ffmpeg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUD = os.path.join(ROOT, "audition")
BGM = r"D:\git文件\4.mp3"
os.makedirs(AUD, exist_ok=True)

TEXT = ("主人好呀，我是大肥鱼～今天讲讲实验助手插件。"
        "你不是常说 WorkBuddy 能免费薅、所以也经常用嘛？"
        "这回，咱们把它也适配上啦！走，看看它到底能干啥。")

VOICES = [
    ("01_xiaoyi", "zh-CN-XiaoyiNeural", "晓伊 · 活泼卡通少女"),
    ("02_yunxia", "zh-CN-YunxiaNeural", "云夏 · 可爱卡通少年"),
    ("03_xiaoxiao", "zh-CN-XiaoxiaoNeural", "晓晓 · 温柔稳重姐姐"),
    ("04_yunxi", "zh-CN-YunxiNeural", "云希 · 阳光清爽少年"),
    ("05_xiaobei", "zh-CN-liaoning-XiaobeiNeural", "晓北 · 东北幽默彩蛋"),
]


def ffprobe_duration(ffmpeg, path):
    p = subprocess.run([ffmpeg, "-hide_banner", "-i", path],
                       capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", p.stderr or "")
    if not m:
        return "?"
    h, mi, s = m.groups()
    return f"{int(h)*60+int(mi):02d}:{float(s):04.1f}"


async def main():
    for fid, voice, label in VOICES:
        out = os.path.join(AUD, fid + ".mp3")
        print("TTS", label, "->", out, flush=True)
        c = edge_tts.Communicate(TEXT, voice, rate="+8%", volume="+0%")
        await c.save(out)
        print("   ok", os.path.getsize(out), "bytes", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    print("\nffmpeg:", ffmpeg, flush=True)
    # 主推音色 + BGM 的成片氛围样例
    voice = os.path.join(AUD, "01_xiaoyi.mp3")
    mix = os.path.join(AUD, "00_sample_with_bgm.mp3")
    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
           "-i", voice, "-i", BGM,
           "-filter_complex",
           "[1:a]volume=0.10,afade=t=in:st=0:d=1.5[a1];"
           "[0:a]volume=1.0[a0];"
           "[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[a]",
           "-map", "[a]", "-c:a", "libmp3lame", "-q:a", "3", mix]
    r = subprocess.run(cmd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    print("mix return:", r.returncode, (r.stderr or "").strip()[:300], flush=True)

    print("\n=== 试听清单 ===", flush=True)
    for f in sorted(os.listdir(AUD)):
        if f.endswith(".mp3"):
            print(f, ffprobe_duration(ffmpeg, os.path.join(AUD, f)),
                  os.path.getsize(os.path.join(AUD, f)), "bytes", flush=True)
