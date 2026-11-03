"""Senaryoyu seslendirir, zaman çizelgesini (timeline.json) ve ses miksini (mix.wav) üretir."""
import asyncio, json, os, re, subprocess, sys, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); WORK = os.path.join(HERE, "work"); os.makedirs(WORK, exist_ok=True)
FF = sys.argv[1]; SR = 44100; VOICE = "tr-TR-AhmetNeural"

# id, metin (*vurgu*), sesten sonra ekstra bekleme
SEGS = [
    ("hook",  "Bahçene kendi *havuzunu* yapsan, kaç gün sürerdi? Hadi kesitten izleyelim.", 0.4),
    ("mark",  "Önce zemini ölçüp ipleri geriyoruz. Altı metreye üç metre, klasik bir *aile havuzu*.", 0.3),
    ("dig",   "Sonra ekskavatör devreye giriyor. İki günde yaklaşık *otuz yedi metreküp* toprak çıkıyor.", 0.6),
    ("base",  "Tabana sıkıştırılmış çakıl seriliyor, üstüne *çelik hasır* örülüyor. Havuzun iskeleti bu.", 0.4),
    ("pipe",  "Şimdi gizli kısım: dip süzgeci ve *filtre boruları*. Bitince bunları kimse görmeyecek.", 0.3),
    ("pour",  "Ardından beton dökülüyor. Taban ve duvarlar *tek parça* olmalı, yoksa su sızdırır.", 0.5),
    ("cure",  "Ve en sıkıcı kısım: betonun kuruması için tam *bir hafta* beklemek.", 1.6),
    ("tile",  "Sonra seramikler döşeniyor, köşeye *merdiven* ekleniyor, kenarlar taşla kaplanıyor.", 0.6),
    ("fill",  "Ve büyük an. Yaklaşık *otuz ton* su, tek günde doluyor.", 1.4),
    ("reveal","Işıklar yanıyor. *Yirmi bir günde*, bahçende kendi havuzun. Sırada ne inşa edelim? Yorumlara yaz.", 2.4),
]

def plain(t): return t.replace("*", "")
async def tts():
    import edge_tts
    for sid, txt, _ in SEGS:
        p = os.path.join(WORK, sid + ".mp3")
        if not os.path.exists(p): await edge_tts.Communicate(plain(txt), VOICE, rate="+12%").save(p)
asyncio.run(tts())

def load(sid):
    mp3 = os.path.join(WORK, sid + ".mp3"); wv = mp3[:-4] + ".wav"
    subprocess.run([FF, "-loglevel", "error", "-y", "-i", mp3, "-ac", "1", "-ar", str(SR), wv], check=True)
    with wave.open(wv) as w: a = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    i = np.where(np.abs(a) > 0.02)[0]; return a[max(0, i[0] - 1300): i[-1] + 2600]

segs, t, voices = [], 0.0, {}
for sid, txt, hold in SEGS:
    v = load(sid); voices[sid] = v; d = len(v) / SR
    # altyazı parçaları: en fazla 3 kelime, süre harf sayısına oranlı
    words = txt.split(); chunks = []; cur = []
    for w in words:
        cur.append(w)
        if len(cur) == 3 or re.search(r"[.,?!:]$", w.replace("*", "")): chunks.append(" ".join(cur)); cur = []
    if cur: chunks.append(" ".join(cur))
    tot = sum(len(plain(c)) for c in chunks); ct = t + 0.15; out = []
    for c in chunks:
        cd = d * len(plain(c)) / tot; out.append({"t": round(ct, 3), "d": round(cd, 3), "text": c}); ct += cd
    segs.append({"id": sid, "s": round(t, 3), "v": round(t + 0.15, 3), "vd": round(d, 3), "e": round(t + 0.15 + d + hold, 3), "chunks": out})
    t = t + 0.15 + d + hold
TOTAL = round(t, 3)
json.dump({"total": TOTAL, "segs": segs}, open(os.path.join(HERE, "web", "timeline.json"), "w"), ensure_ascii=False, indent=1)
print("toplam süre:", TOTAL)
S = {s["id"]: s for s in segs}

# ---------- ses miksi ----------
N = int((TOTAL + 1) * SR); mix = np.zeros(N, np.float32); rng = np.random.default_rng(3)
def add(at, sig, vol=1.0):
    a = int(at * SR); b = min(N, a + len(sig));
    if b > a: mix[a:b] += sig[: b - a] * vol
def tt(d): return np.arange(int(d * SR)) / SR
def lp(x, k): return np.convolve(x, np.ones(k) / k, "same")
def thud(): x = tt(.35); return np.sin(2 * np.pi * (70 - 30 * x) * x) * np.exp(-x * 11) + lp(rng.standard_normal(len(x)), 40) * np.exp(-x * 18) * 2
def whoosh(): x = tt(.5); n = lp(rng.standard_normal(len(x)), 25); return n * np.sin(np.pi * x / .5) ** 2 * 1.6
def tick(): x = tt(.06); return np.sin(2 * np.pi * 1800 * x) * np.exp(-x * 90) * .5
def chime():
    x = tt(2.5); return sum(np.sin(2 * np.pi * f * x) * np.exp(-x * (2 + i)) for i, f in enumerate([784, 988, 1175, 1568])) * .25
def clank(): x = tt(.25); return (np.sin(2 * np.pi * 620 * x) + .6 * np.sin(2 * np.pi * 1490 * x)) * np.exp(-x * 22) * .5
def rumble(d): x = tt(d); n = lp(rng.standard_normal(len(x)), 200) * 6; env = np.minimum(1, x / .4) * np.minimum(1, (d - x) / .4); return n * env
def water(d): x = tt(d); n = lp(rng.standard_normal(len(x)), 12) * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * x)); env = np.minimum(1, x / .6) * np.minimum(1, (d - x) / .8); return n * env * .9

for s in segs: add(max(0, s["s"] - .1), whoosh(), .35)
# kazı: kepçe her 1.6 sn'de bir toprağa vurur (index.html ile aynı ritim)
d0, d1 = S["dig"]["s"], S["dig"]["e"]; k = d0 + .9
while k < d1 - .4: add(k, thud(), .55); k += 1.6
b0, b1 = S["base"]["s"], S["base"]["e"]
for i in range(10): add(b0 + 1.5 + i * (b1 - b0 - 2) / 10, clank(), .35)
add(S["pour"]["s"] + .3, rumble(S["pour"]["e"] - S["pour"]["s"] - .3), .5)
c0, c1 = S["cure"]["s"], S["cure"]["e"]
for i in range(7): add(c0 + .4 + (i + 1) * (c1 - c0 - .8) / 7, tick(), .6)
t0, t1 = S["tile"]["s"], S["tile"]["e"]
for i in range(14): add(t0 + .5 + i * (t1 - t0 - 1) / 14, tick(), .25)
add(S["fill"]["s"] + .3, water(S["fill"]["e"] - S["fill"]["s"]), .45)
add(S["reveal"]["s"] + .2, chime(), .6)
for s in segs: add(s["v"], voices[s["id"]], 1.0)
# özgün ambient pad
x = np.arange(N) / SR; pad = np.zeros(N, np.float32)
ch = [(196, 246.9, 293.7), (220, 261.6, 329.6), (174.6, 220, 261.6), (196, 246.9, 329.6)]
for ci in range(int(TOTAL / 4) + 2):
    a = ci * 4 * SR; sl = slice(a, min(N, a + 4 * SR + SR // 2)); xs = x[sl] - ci * 4
    env = np.minimum(1, xs / .8) * np.minimum(1, np.maximum(0, (4.5 - xs) / .8))
    for f_ in ch[ci % 4]: pad[sl] += (np.sin(2 * np.pi * f_ * xs) + .25 * np.sin(4 * np.pi * f_ * xs)) * env
mix += pad * .02
mix = np.clip(mix / max(1, np.abs(mix).max() / .95), -1, 1)
with wave.open(os.path.join(WORK, "mix.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
print("mix.wav hazır")
