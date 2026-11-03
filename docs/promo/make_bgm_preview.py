"""生成 3 段背景音乐试听（原创旋律，非版权歌曲），三种音色。"""
import numpy as np, subprocess, os, imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
OUT = r"D:\lab-assistant\docs\promo\_bgm_preview"
os.makedirs(OUT, exist_ok=True)
SR = 48000

# A 小调五声音阶的温柔循环（原创，别拿去和《雨爱》比对）
NOTE = {"A3":220.00,"C4":261.63,"D4":293.66,"E4":329.63,"G4":392.00,
        "A4":440.00,"C5":523.25,"D5":587.33,"E5":659.25,"G5":783.99,
        "A5":880.00,"F4":349.23,"G3":196.00,"E3":164.81,"D3":146.83,"C3":130.81}
MELODY = [("E5",1),("D5",1),("C5",2),("A4",1),("C5",1),("D5",2),
          ("E5",1),("G5",1),("E5",2),("D5",1),("C5",1),("A4",2),
          ("G4",1),("A4",1),("C5",2),("D5",1),("E5",1),("D5",2),
          ("C5",1),("A4",1),("G4",2),("A4",4)]
BASS = ["A3","F4","C4","G3"]

def env(n, a=0.01, d=0.2, s=0.6, r=0.3):
    t = np.arange(n) / SR
    sus = max(1, n - int((a + d + r) * SR))
    e = np.ones(n) * s
    e[:int(a*SR)] = np.linspace(0, 1, int(a*SR))
    e[int(a*SR):int((a+d)*SR)] = np.linspace(1, s, max(1, int(d*SR)))
    e[-int(r*SR):] = np.linspace(s, 0, int(r*SR))
    return e

def tone(freq, dur, kind="music_box"):
    n = int(dur * SR)
    t = np.arange(n) / SR
    if kind == "music_box":          # 八音盒：正弦 + 快速衰减 + 高次泛音
        w = (np.sin(2*np.pi*freq*t) * 0.7
             + np.sin(2*np.pi*freq*2*t) * 0.22
             + np.sin(2*np.pi*freq*3.01*t) * 0.08)
        e = np.exp(-3.2 * t)
    elif kind == "piano":            # 钢琴：加法合成，锤击包络
        w = sum(a * np.sin(2*np.pi*freq*k*t + k) for k, a in
                ((1,0.55),(2,0.22),(3,0.12),(4,0.07),(5,0.04)))
        e = np.exp(-1.6 * t) * (1 - np.exp(-t * 300))
    else:                            # 电子：锯齿 + 低通感
        w = 2 * ((freq * t) % 1) - 1
        w = np.convolve(w, np.ones(12) / 12, mode="same")
        e = np.exp(-1.1 * t)
    return w * e * 0.5

def build(kind, path, bpm=76):
    beat = 60.0 / bpm
    sig = np.zeros(int(SR * 3), dtype=np.float32)   # 尾巴
    pos = 0
    for i, (note, beats) in enumerate(MELODY):
        dur = beats * beat
        seg = tone(NOTE[note], dur * 1.6, kind)
        if kind == "music_box":
            seg = seg * 0.6
        end = pos + len(seg)
        if end > len(sig):
            sig = np.pad(sig, (0, end - len(sig)))
        sig[pos:end] += seg
        pos += int(dur * SR)
    # 低音铺底（每轮四个根音）
    total = len(sig)
    bar = int(4 * beat * SR)
    for i in range(0, total, bar):
        root = BASS[(i // bar) % len(BASS)]
        seg = tone(NOTE[root], beat * 4, "piano") * 0.35
        end = min(total, i + len(seg))
        sig[i:end] += seg[:end - i]
    # 简单混响（衰减回声）
    d = int(0.22 * SR)
    tail = np.zeros_like(sig)
    tail[d:] = sig[:-d] * 0.28
    sig = sig + tail
    sig = sig / (np.max(np.abs(sig)) or 1) * 0.8
    stereo = np.stack([sig, sig], axis=1)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run([FF, "-y", "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "-",
                    "-t", "14", "-c:a", "mp3", "-b:a", "192k", path],
                   input=pcm, capture_output=True)
    return path

for kind, label in (("music_box", "A 八音盒"), ("piano", "B 钢琴"), ("synth", "C 电子")):
    p = os.path.join(OUT, f"{kind}.mp3")
    build(kind, p)
    print(f"  {label}: {p}  {os.path.getsize(p)//1024} KB")
