#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""重制宣传片音轨：可爱配音 + P5 雨天风爵士 BGM，并与现有画面合成。

用法：python promo_audio_v2.py
"""
import asyncio
import json
import math
import os
import subprocess
import wave

import edge_tts
import imageio_ffmpeg
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIDEO_DIR = os.path.join(ROOT, "temp", "video")
OUT = os.path.join(ROOT, "docs", "promo", "lab-assistant-promo.mp4")
SILENT = os.path.join(VIDEO_DIR, "video_silent.mp4")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
VOICE = "zh-CN-XiaoyiNeural"
GAP = 1.0
LEAD = 0.6
TAIL = 1.4
SR = 48000


def wav_info(path):
    with wave.open(path, "rb") as f:
        return f.getnframes() / float(f.getframerate()), f.getnchannels(), f.getsampwidth()


def read_wav(path):
    with wave.open(path, "rb") as f:
        data = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        if f.getnchannels() > 1:
            data = data.reshape(-1, f.getnchannels()).mean(axis=1)
    return data


def synth_voice(text, key):
    mp3 = os.path.join(VIDEO_DIR, f"v2_{key}.mp3")
    raw = os.path.join(VIDEO_DIR, f"v2_{key}_raw.wav")
    tts = edge_tts.Communicate(text, VOICE, rate="+4%", pitch="+12Hz")
    asyncio.run(tts.save(mp3))
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", mp3, "-ar", str(SR), "-ac", "1", raw], check=True)
    return raw


def stretch_to(raw, key, target):
    cur, _, _ = wav_info(raw)
    ratio = cur / target
    out = os.path.join(VIDEO_DIR, f"v2_{key}.wav")
    if abs(ratio - 1.0) < 0.02:
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", raw, "-ar", str(SR), "-ac", "1", out], check=True)
    else:
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", raw,
                        "-filter:a", f"atempo={ratio:.5f}", "-ar", str(SR), "-ac", "1", out], check=True)
    return out


def fft_noise(n, low, high, seed):
    rng = np.random.default_rng(seed)
    spec = np.fft.rfft(rng.standard_normal(n))
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    mask = np.zeros_like(freqs)
    mask[(freqs >= low) & (freqs <= high)] = 1.0
    # 平滑边缘
    band = (freqs >= low * 0.8) & (freqs <= high * 1.2)
    mask = np.convolve(mask, np.hanning(31) / np.hanning(31).sum(), mode="same")
    out = np.fft.irfft(spec * mask, n=n)
    return out / (np.abs(out).max() + 1e-9)


def add(buf, start, sig, gain=1.0):
    s = int(start * SR)
    if s >= len(buf):
        return
    e = min(len(buf), s + len(sig))
    buf[s:e] += sig[: e - s] * gain


def rhodes(freq, dur, amp=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.exp(-t * 2.2) * (1 - np.exp(-t * 90))
    mod = 0.55 * np.sin(2 * np.pi * freq * 2.0 * t) * np.exp(-t * 3.0)
    tone = np.sin(2 * np.pi * freq * t + mod)
    tone += 0.22 * np.sin(2 * np.pi * freq * 3.0 * t) * np.exp(-t * 4.0)
    return tone * env * amp


def bass_note(freq, dur, amp=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.exp(-t * 3.4) * (1 - np.exp(-t * 120))
    return (np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * freq * 2 * t)) * env * amp


def brush(dur=0.22, amp=1.0):
    n = int(dur * SR)
    noise = fft_noise(n, 1200, 7000, seed=hash(dur) % 9999)
    t = np.arange(n) / SR
    env = np.exp(-t * 16.0) * (1 - np.exp(-t * 300))
    return noise * env * amp


def kick(dur=0.28, amp=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    freq = 58 * np.exp(-t * 18) + 36
    phase = 2 * np.pi * np.cumsum(freq) / SR
    env = np.exp(-t * 9.0) * (1 - np.exp(-t * 200))
    return np.sin(phase) * env * amp


def hat(dur=0.05, amp=1.0):
    n = int(dur * SR)
    noise = fft_noise(n, 7000, 16000, seed=hash(dur) % 777)
    t = np.arange(n) / SR
    return noise * np.exp(-t * 90.0) * amp


def vibes(freq, dur, amp=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.exp(-t * 1.6) * (1 - np.exp(-t * 120))
    return (np.sin(2 * np.pi * freq * t) + 0.18 * np.sin(2 * np.pi * freq * 4 * t)) * env * amp


def make_music(total):
    n = int(total * SR)
    music = np.zeros(n, dtype=np.float32)

    bpm = 76.0
    beat = 60.0 / bpm
    bar = beat * 4
    swing = 0.64

    # Dm9 - G13 - Cmaj9 - A7(b9)，按爵士标准排列（根音交给贝斯）
    chords = [
        (146.83, [174.61, 220.00, 261.63, 329.63]),   # Dm9  F3 A3 C4 E4
        (98.00, [174.61, 246.94, 293.66, 329.63]),    # G13  F3 B3 D4 E4
        (130.81, [164.81, 246.94, 293.66, 392.00]),   # Cmaj9 E3 B3 D4 G4
        (110.00, [196.00, 277.18, 329.63, 466.16]),   # A7b9 G3 C#4 E4 Bb4
    ]

    bars = int(math.ceil(total / bar)) + 1
    for b in range(bars):
        t0 = b * bar
        root, notes = chords[b % 4]
        # 电钢和弦：一小节一次，轻微琶音
        for i, f in enumerate(notes):
            add(music, t0 + 0.02 + i * 0.018, rhodes(f, bar * 1.05, 0.075))
        # 第 3 拍后半拍补一个轻和弦（切分感）
        if b % 2 == 1:
            for f in notes[1:3]:
                add(music, t0 + beat * 2.5, rhodes(f, beat * 0.8, 0.045))
        # 贝斯：1、3 拍
        add(music, t0, bass_note(root, beat * 1.4, 0.16))
        add(music, t0 + beat * 2, bass_note(root * 1.5 if b % 2 else root, beat * 1.2, 0.13))
        # 刷鼓 2、4 拍
        add(music, t0 + beat, brush(0.26, 0.055))
        add(music, t0 + beat * 3, brush(0.26, 0.05))
        # 底鼓 1、3
        add(music, t0, kick(0.3, 0.10))
        add(music, t0 + beat * 2, kick(0.3, 0.075))
        # 摇摆八分音符 hi-hat
        for k in range(8):
            off = k * beat / 2 + (0.0 if k % 2 == 0 else (swing - 0.5) * beat)
            add(music, t0 + off, hat(0.05, 0.020 if k % 2 else 0.012))
        # 稀疏颤音琴旋律
        if b % 2 == 0:
            melody = notes[(b // 2) % len(notes)] * 2
            add(music, t0 + beat * 2.5, vibes(melody, beat * 1.6, 0.05))

    # 雨声：带通噪声 + 慢速起伏
    rain = fft_noise(n, 500, 6500, seed=42)
    t = np.arange(n) / SR
    mod = 0.75 + 0.25 * np.sin(2 * np.pi * 0.07 * t + 1.2) + 0.12 * np.sin(2 * np.pi * 0.19 * t)
    music += (rain * mod * 0.022).astype(np.float32)

    # 雨滴：随机短促高频点
    rng = np.random.default_rng(7)
    drops = rng.integers(0, n, size=int(total * 3))
    for idx in drops:
        f = rng.uniform(1200, 3200)
        dur = 0.05
        m = int(dur * SR)
        tt = np.arange(m) / SR
        sig = np.sin(2 * np.pi * f * tt) * np.exp(-tt * 60) * 0.02
        add(music, idx / SR, sig)

    # 黑胶底噪
    vinyl = fft_noise(n, 200, 9000, seed=9) * 0.006
    music += vinyl.astype(np.float32)

    # 低频温暖 + 淡入淡出
    music = np.tanh(music * 1.1)
    fade_in = int(0.8 * SR)
    music[:fade_in] *= np.linspace(0, 1, fade_in)
    fade_out = int(3.0 * SR)
    music[-fade_out:] *= np.linspace(1, 0, fade_out)
    peak = np.abs(music).max() + 1e-9
    music = music / peak * 0.55
    return music.astype(np.float32)


def main():
    with open(os.path.join(VIDEO_DIR, "timeline.json"), encoding="utf-8") as f:
        rows = json.load(f)
    # 旧的场景时长：与已渲染画面严格对应
    entries = []
    cursor = LEAD
    for row in rows:
        entries.append({"key": row["key"], "text": row["text"], "start": cursor, "duration": row["duration"]})
        cursor += row["duration"] + GAP
    total = cursor + TAIL

    voice = np.zeros(int(total * SR) + SR, dtype=np.float32)
    for e in entries:
        raw = synth_voice(e["text"], e["key"])
        wav = stretch_to(raw, e["key"], e["duration"])
        data = read_wav(wav)
        add(voice, e["start"] + 0.26, data.astype(np.float32), 1.0)
        print(f"{e['key']}: target {e['duration']:.2f}s actual {len(data)/SR:.2f}s")

    voice = np.tanh(voice * 1.02) * 0.95
    music = make_music(total)
    # 侧链：说话时把音乐压下去，句间再抬起来
    env = np.abs(voice).astype(np.float32)
    win = max(3, int(0.18 * SR))
    kernel = np.hanning(win).astype(np.float32)
    kernel /= kernel.sum()
    env = np.convolve(env, kernel, mode="same")
    env /= (env.max() + 1e-9)
    duck = 1.0 - 0.42 * np.clip(env * 3.2, 0, 1)
    m = min(len(voice), len(music))
    mix = voice[:m] + music[:m] * duck[:m] * 0.62
    mix = np.clip(mix, -1, 1)
    pcm = (mix * 32767).astype(np.int16)
    mix_path = os.path.join(VIDEO_DIR, "mix_v2.wav")
    with wave.open(mix_path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())

    subprocess.run([FFMPEG, "-y", "-loglevel", "error",
                    "-i", SILENT, "-i", mix_path, "-shortest",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", OUT], check=True)
    print("saved", OUT, os.path.getsize(OUT))


if __name__ == "__main__":
    main()
