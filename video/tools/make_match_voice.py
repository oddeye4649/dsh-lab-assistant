# -*- coding: utf-8 -*-
"""按 10-31 B 站演示片（v2）的配音参数精确复现，并做交叉验证。"""
import asyncio
import os
import re
import subprocess

import edge_tts
import imageio_ffmpeg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUD = os.path.join(ROOT, "audition")
REF = r"D:\lab-assistant\temp\video"
BGM = r"D:\git文件\4.mp3"
os.makedirs(AUD, exist_ok=True)

# 原视频 v2 参数（scripts/promo_audio_v2.py:23,46）
VOICE = "zh-CN-XiaoyiNeural"
RATE = "+4%"
PITCH = "+12Hz"

NEW_TEXT = ("主人好呀，我是大肥鱼～今天讲讲实验助手插件。"
            "你不是常说 WorkBuddy 能免费薅、所以也经常用嘛？"
            "这回，咱们把它也适配上啦！走，看看它到底能干啥。")
REF_TEXT = "做实验的时候，你是不是也这样：环境报错查半天，步骤记不住，报告排版到深夜。"

FF = imageio_ffmpeg.get_ffmpeg_exe()


def duration(path):
    p = subprocess.run([FF, "-hide_banner", "-i", path], capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", p.stderr or "")
    return round(int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)), 3) if m else None


async def tts(text, out):
    await edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH).save(out)


async def main():
    # 交叉验证：用同一句原台词 + 同一参数重合成，与视频留下的原始 TTS 比时长
    check = os.path.join(AUD, "_verify_original_tts.mp3")
    await tts(REF_TEXT, check)
    orig = os.path.join(REF, "v2_hook.mp3")
    print("VERIFY  原视频 v2_hook.mp3 :", duration(orig), "s", flush=True)
    print("VERIFY  同参数重合成        :", duration(check), "s", flush=True)

    # 原视频纯人声参照（未混 BGM）
    ref_out = os.path.join(AUD, "ref_original_voice.mp3")
    subprocess.run([FF, "-y", "-loglevel", "error", "-i",
                    os.path.join(REF, "v2_hook.wav"),
                    "-c:a", "libmp3lame", "-q:a", "3", ref_out], check=True)

    # 新台词，原音色原语速
    new_out = os.path.join(AUD, "match_voice.mp3")
    await tts(NEW_TEXT, new_out)

    # 新台词 + 指定 BGM（成片氛围）
    mix_out = os.path.join(AUD, "match_voice_with_bgm.mp3")
    subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error",
                    "-i", new_out, "-i", BGM, "-filter_complex",
                    "[1:a]volume=0.10,afade=t=in:st=0:d=1.5[a1];"
                    "[0:a]volume=1.0[a0];"
                    "[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[a]",
                    "-map", "[a]", "-c:a", "libmp3lame", "-q:a", "3", mix_out], check=True)

    print("\n=== 产物 ===", flush=True)
    for f in ["ref_original_voice.mp3", "match_voice.mp3", "match_voice_with_bgm.mp3"]:
        p = os.path.join(AUD, f)
        print(f, duration(p), "s", os.path.getsize(p), "bytes", flush=True)
    os.remove(check)


if __name__ == "__main__":
    asyncio.run(main())
