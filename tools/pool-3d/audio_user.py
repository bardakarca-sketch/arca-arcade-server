"""Senaryoyu seslendirir (kelime zamanlarıyla), timeline.json ve mix.wav üretir."""
import asyncio, json, os, re, subprocess, sys, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); WORK = os.path.join(HERE, "work3"); os.makedirs(WORK, exist_ok=True)
FF = sys.argv[1]; SR = 44100; VOICE = "tr-TR-AhmetNeural"

# id, metin (*vurgu*), sesten sonra bekleme, çözüm anını başlatan kelime
SEGS = [
    ("hook",   "Bahçene havuz yapmak istiyorsun. En basit hâliyle başlayalım, sonra her *sorunu* tek tek çözelim.", .3, None),
    ("dig",    "Önce bir çukur kazıyorsun. Altı metre, üç metre, iki metre *derinlik*.", .5, None),
    ("fill1",  "Hortumu açıp suyu dolduruyorsun. Bitti mi? Ne yazık ki *hayır*.", .6, None),
    ("leak",   "Su toprağa *sızıyor*, kenarlar çöküyor. Ertesi sabah elinde kocaman bir çamur çukuru var.", .6, None),
    ("conc",   "Çözüm: sıkıştırılmış çakıl, *çelik hasır* ve tek parça beton. Artık su hiçbir yere kaçamaz.", .5, None),
    ("tile",   "Üstüne seramik döşeyip suyu yeniden dolduruyorsun. Tertemiz, *değil mi?*", .7, None),
    ("dirty",  "Bir hafta sonra yapraklar, toz ve böcekler. Su *yeşile* dönüyor.", .8, None),
    ("filter", "Bu yüzden dip süzgeci, yüzey skimmeri, bir *pompa* ve kum filtresi ekliyoruz. Su sürekli filtreden geçip havuza geri dönüyor.", .6, None),
    ("chlor",  "Ama filtre kiri tutar, *mikropları* öldüremez. Bunun için otomatik bir *klor ünitesi* ekliyoruz.", .9, "Bunun"),
    ("night",  "Akşam olunca su soğuyor ve havuz *zifiri karanlık*. Isı pompası suyu ısıtıyor, ışıklar yanıyor, merdiven ve kenar taşları ekleniyor.", .8, "Isı"),
    ("reveal", "İşte gerçek bir havuz *böyle çalışır*. Sırada ne inşa edelim? Yorumlara yaz.", 2.4, None),
]
plain = lambda t: t.replace("*", "")
norm = lambda w: re.sub(r"[^a-zçğıöşüâîû]", "", w.lower().replace("İ", "i").replace("I", "ı"))

VOICE_FILE = sys.argv[2]; WORDS = json.load(open(sys.argv[3]))
clean = os.path.join(WORK, "user_clean.wav")
subprocess.run([FF, "-loglevel", "error", "-y", "-i", VOICE_FILE, "-af",
  "highpass=f=80,lowpass=f=12000,afftdn=nf=-25,acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=4dB,loudnorm=I=-15:TP=-1.5:LRA=9",
  "-ac", "1", "-ar", str(SR), clean], check=True)
with wave.open(clean) as w: UA = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
import difflib
sw_words = []
for si, (sid, txt, _, _) in enumerate(SEGS):
    for w in txt.split(): sw_words.append((si, w))
A = [norm(w) for _, w in sw_words]; B = [norm(w[2]) for w in WORDS]
st = [None] * len(A); en = [None] * len(A)
for blk in difflib.SequenceMatcher(None, A, B, autojunk=False).get_matching_blocks():
    for k in range(blk.size): st[blk.a + k] = WORDS[blk.b + k][0]; en[blk.a + k] = WORDS[blk.b + k][1]
# fuzzy eşleştirme: eşleşmeyen kelimeyi komşu boşluktaki en benzer whisper kelimesine bağla
for i in range(len(A)):
    if st[i] is None:
        lo = max([en[k] for k in range(i) if en[k] is not None] or [0]); hi = min([st[k] for k in range(i + 1, len(A)) if st[k] is not None] or [1e9])
        cands = [w for w in WORDS if w[0] >= lo - .01 and w[0] <= hi]
        if cands:
            best = max(cands, key=lambda w: difflib.SequenceMatcher(None, A[i], norm(w[2])).ratio())
            if difflib.SequenceMatcher(None, A[i], norm(best[2])).ratio() > .4: st[i], en[i] = best[0], best[1]
for i in range(len(A)):
    if st[i] is None:
        p = next((en[k] for k in range(i - 1, -1, -1) if en[k] is not None), 0); st[i] = p + .05; en[i] = p + .35
seg_words = {}
for (si, w), a, b in zip(sw_words, st, en): seg_words.setdefault(si, []).append((w, a, b))
segs, t, voices = [], 0.0, {}
for si, (sid, txt, hold, swword) in enumerate(SEGS):
    ws = seg_words[si]; a0 = ws[0][1] - .12; a1 = ws[-1][2] + .18
    if si + 1 < len(SEGS): a1 = min(a1, seg_words[si + 1][0][1] - .08)
    v = UA[int(a0 * SR): int(a1 * SR)].copy(); fade = int(.03 * SR); v[:fade] *= np.linspace(0, 1, fade); v[-fade:] *= np.linspace(1, 0, fade)
    voices[sid] = v; d = len(v) / SR; v0 = t + .15
    words = txt.split(); times = [v0 + (w[1] - a0) for w in ws]
    chunks, cur = [], []
    for i, w in enumerate(words):
        cur.append(i)
        if len(cur) == 3 or re.search(r"[.,?!:]\**$", w): chunks.append(cur); cur = []
    if cur: chunks.append(cur)
    out = [{"t": round(max(v0, times[c[0]]), 3), "text": " ".join(words[k] for k in c)} for c in chunks]
    sw = None
    if swword:
        for i, w in enumerate(words):
            if norm(w) == norm(swword): sw = round(times[i], 3); break
    segs.append({"id": sid, "s": round(t, 3), "v": round(v0, 3), "vd": round(d, 3), "e": round(v0 + d + hold, 3), "sw": sw, "chunks": out})
    t = v0 + d + hold
TOTAL = round(t, 3)
json.dump({"total": TOTAL, "segs": segs}, open(os.path.join(HERE, "web", "timeline.json"), "w"), ensure_ascii=False, indent=1)
print("toplam süre:", TOTAL); S = {s["id"]: s for s in segs}
for s in segs: print(s["id"], s["s"], s["e"], "sw", s["sw"])

# ---------- ses ----------
N = int((TOTAL + 1) * SR); mix = np.zeros(N, np.float32); rng = np.random.default_rng(3)
def add(at, sig, vol=1.0):
    a = int(at * SR); b = min(N, a + len(sig))
    if b > a: mix[a:b] += sig[: b - a] * vol
tt = lambda d: np.arange(int(d * SR)) / SR
lp = lambda x, k: np.convolve(x, np.ones(k) / k, "same")
dur = lambda i: S[i]["e"] - S[i]["s"]
def thud(): x = tt(.35); return np.sin(2 * np.pi * (70 - 30 * x) * x) * np.exp(-x * 11) + lp(rng.standard_normal(len(x)), 40) * np.exp(-x * 18) * 2
def whoosh(): x = tt(.5); return lp(rng.standard_normal(len(x)), 25) * np.sin(np.pi * x / .5) ** 2 * 1.6
def clank(): x = tt(.25); return (np.sin(2 * np.pi * 620 * x) + .6 * np.sin(2 * np.pi * 1490 * x)) * np.exp(-x * 22) * .5
def rumble(d): x = tt(d); return lp(rng.standard_normal(len(x)), 200) * 6 * np.minimum(1, x / .4) * np.minimum(1, (d - x) / .4)
def water(d): x = tt(d); return lp(rng.standard_normal(len(x)), 12) * (.6 + .4 * np.sin(2 * np.pi * 3 * x)) * np.minimum(1, x / .6) * np.minimum(1, (d - x) / .8) * .9
def buzz(): x = tt(.45); return (np.sign(np.sin(2 * np.pi * 110 * x)) + np.sign(np.sin(2 * np.pi * 116 * x))) * np.exp(-x * 5) * .18
def ding(): x = tt(.9); return (np.sin(2 * np.pi * 880 * x) * np.exp(-x * 6) + np.sin(2 * np.pi * 1320 * np.maximum(0, x - .12)) * np.exp(-np.maximum(0, x - .12) * 6) * (x > .12)) * .35
def chime(): x = tt(2.5); return sum(np.sin(2 * np.pi * f * x) * np.exp(-x * (2 + i)) for i, f in enumerate([784, 988, 1175, 1568])) * .25
def hum(d): x = tt(d); return (np.sin(2 * np.pi * 98 * x) + .5 * np.sin(2 * np.pi * 196 * x) + .2 * np.sin(2 * np.pi * 294 * x)) * np.minimum(1, x / .5) * np.minimum(1, (d - x) / .5) * .12
def bubble(): x = tt(.12); return np.sin(2 * np.pi * (400 + 2000 * x) * x) * np.exp(-x * 40) * .4
def crickets(d):
    x = tt(d); env = (np.sin(2 * np.pi * 2.2 * x) > .6) * (np.sin(2 * np.pi * 30 * x) > 0)
    return np.sin(2 * np.pi * 4300 * x) * env * .05 * np.minimum(1, x / .5) * np.minimum(1, (d - x) / .5)

for s in segs: add(max(0, s["s"] - .1), whoosh(), .3)
k = S["dig"]["s"] + .9
while k < S["dig"]["e"] - .4: add(k, thud(), .55); k += 1.6
add(S["fill1"]["s"] + .2, water(dur("fill1") - .2), .4)
add(S["leak"]["s"] + .2, rumble(1.6), .5)
for i in range(5): add(S["leak"]["s"] + (.45 + i * .08) * dur("leak"), thud(), .45)
c0 = S["conc"]["s"]
for i in range(8): add(c0 + (.25 + i * .045) * dur("conc"), clank(), .3)
add(c0 + .55 * dur("conc"), rumble(.42 * dur("conc")), .45)
add(S["tile"]["s"] + .45 * dur("tile"), water(.5 * dur("tile")), .4)
for p in ("leak", "dirty", "chlor", "night"): add(S[p]["s"] + .05, buzz(), .8)
for p, at in (("conc", S["conc"]["s"]), ("filter", S["filter"]["s"]), ("chlor", S["chlor"]["sw"]), ("night", S["night"]["sw"])): add(at, ding(), .6)
f0 = S["filter"]["s"] + .45 * dur("filter"); add(f0, hum(S["night"]["e"] - f0), .8)
sw = S["chlor"]["sw"]
for i in range(9): add(sw + .8 + i * .13, bubble(), .5)
add(S["night"]["s"] + .2, crickets(S["night"]["sw"] - S["night"]["s"] + .3), 1)
add(S["night"]["sw"] + 1.2, chime(), .45); add(S["reveal"]["s"] + .2, chime(), .55)
for s in segs: add(s["v"], voices[s["id"]], 1.0)
x = np.arange(N) / SR; pad = np.zeros(N, np.float32)
ch = [(196, 246.9, 293.7), (220, 261.6, 329.6), (174.6, 220, 261.6), (196, 246.9, 329.6)]
for ci in range(int(TOTAL / 4) + 2):
    a = ci * 4 * SR; sl = slice(a, min(N, a + 4 * SR + SR // 2)); xs = x[sl] - ci * 4
    env = np.minimum(1, xs / .8) * np.minimum(1, np.maximum(0, (4.5 - xs) / .8))
    for f_ in ch[ci % 4]: pad[sl] += (np.sin(2 * np.pi * f_ * xs) + .25 * np.sin(4 * np.pi * f_ * xs)) * env
mix += pad * .018
mix = np.clip(mix / max(1, np.abs(mix).max() / .95), -1, 1)
with wave.open(os.path.join(WORK, "mix.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
print("mix.wav hazır")
