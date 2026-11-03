#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成宣传片配音与时间轴。用法：python promo_tts.py"""
import asyncio
import json
import os
import subprocess
import wave

import edge_tts
import imageio_ffmpeg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "temp", "video")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
VOICE = "zh-CN-XiaoyiNeural"

SEGMENTS = [
    ("hook", "做实验的时候，你是不是也这样：环境报错查半天，步骤记不住，报告排版到深夜。"),
    ("meet", "现在，把实验交给这条大肥鱼吧。她是 DSH 的实验助手。"),
    ("actions", "平时她就住在桌面上，喝咖啡、敲键盘、翻书、伸懒腰，偶尔还会打个瞌睡。"),
    ("dsh", "在 DSH 里说一句话，她就能建实验档案、只读检查软件环境、记录每一步的真实结果。"),
    ("guide", "做实验的时候，每完成一步，就点一下她，对错她当场告诉你。"),
    ("report", "还能读老师发的 Word 模板，直接生成排版好的报告。实测值，只来自你真正做过的记录。"),
    ("safety", "她不会替你编数据，也不会偷偷装软件，所有资料都留在你的电脑上。"),
    ("multi", "无聊的时候，右键还能再来一只，好几只大肥鱼一起陪你做实验。"),
    ("closing", "DSH 实验助手，GitHub 搜索 dsh-lab-assistant，就能把她带回家。"),
]


def wav_duration(path):
    with wave.open(path, "rb") as f:
        return f.getnframes() / float(f.getframerate())


async def synth(key, text):
    mp3 = os.path.join(OUT, f"voice_{key}.mp3")
    wav = os.path.join(OUT, f"voice_{key}.wav")
    communicate = edge_tts.Communicate(text, VOICE, rate="+4%", pitch="+12Hz")
    await communicate.save(mp3)
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", mp3,
                    "-ar", "48000", "-ac", "1", wav], check=True)
    return wav_duration(wav)


def main():
    os.makedirs(OUT, exist_ok=True)
    timeline = []
    for key, text in SEGMENTS:
        duration = asyncio.run(synth(key, text))
        timeline.append({"key": key, "text": text, "duration": round(duration, 3)})
        print(f"{key}: {duration:.2f}s")
    with open(os.path.join(OUT, "timeline.json"), "w", encoding="utf-8") as f:
        json.dump(timeline, f, ensure_ascii=False, indent=2)
    total = sum(item["duration"] for item in timeline)
    print("total narration: %.2fs" % total)


if __name__ == "__main__":
    main()
