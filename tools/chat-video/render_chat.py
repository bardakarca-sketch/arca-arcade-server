"""Telefon sohbeti tarzında hareketli kısa video üretir (1080x1920, 30fps)."""
import asyncio, math, os, re, subprocess, sys, wave, random, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work"); os.makedirs(WORK, exist_ok=True)
EMO = os.path.join(HERE, "emoji"); os.makedirs(EMO, exist_ok=True)
FF = sys.argv[1]; OUT = sys.argv[2]
W, H, FPS, SR = 1080, 1920, 30, 44100
random.seed(7)

# ---------------- içerik ----------------
CONTACT = "Ece"
V_L, V_R = "tr-TR-EmelNeural", "tr-TR-AhmetNeural"
HOOK = ("Bankaya yatırdığın para", "şu an NEREDE?", "1f914")
MSGS = [
    ("L", "Bir şey soracağım ama sakın gülme", "1f605"),
    ("R", "Söyle bakalım", None),
    ("L", "Bankaya 10 bin lira yatırdım. Şu an kasada duruyor, değil mi?", None),
    ("R", "Büyük ihtimalle şu an başkasının cebinde", "1f604"),
    ("L", "NE?!", "1f633", "big"),
    ("R", "Sakin ol. Banka o parayı kredi olarak veriyor", None),
    ("R", "Ev, araba ya da dükkân almak isteyenlere", None),
    ("R", "", None, "icons"),
    ("L", "Benim paramı mı? Bana sormadan?", "1f928"),
    ("R", "Hesap açarken imzaladığın sözleşmede yazıyor", "1f605"),
    ("L", "Peki banka bundan ne kazanıyor?", None),
    ("R", "Kredi verdiği kişiden yüksek faiz alıyor", None),
    ("R", "Sana ise daha düşük faiz veriyor", None),
    ("R", "", None, "rates"),
    ("R", "İşte aradaki fark, bankanın kârı", "1f4b0"),
    ("L", "Yani benim paramla para kazanıyor", "1f612"),
    ("R", "Aynen. Ama sen de faiz alıyorsun, herkes kazanıyor", None),
    ("L", "Ya herkes aynı gün parasını çekmek isterse?", "1f62c"),
    ("R", "Buna banka hücumu deniyor. En korkulan şey bu", None),
    ("R", "O yüzden bankalar paranın bir kısmını hep hazırda tutuyor", None),
    ("L", "Ya banka batarsa?", "1f630"),
    ("R", "Mevduat sigortası var. Belli bir tutara kadar paran güvencede", "1f6e1"),
    ("L", "Tamam, biraz rahatladım", "1f62e-200d-1f4a8"),
    ("R", "Kısacası banka, parası olanla paraya ihtiyacı olanı buluşturan bir köprü", None),
    ("L", "Bunu neden okulda öğretmiyorlar ya", None),
    ("R", "İşte onu ben de bilmiyorum", "1f602"),
]
OUTRO = ("Bölüm 2 geliyor", "Kredi kartı borcu nasıl bu kadar hızlı büyür?", "1f440")
EXTRA_EMO = ["1f3e0", "1f697", "1f3ea", "1f4de", "1f4f9", "1f440", "1f914"]

# ---------------- renkler & fontlar ----------------
BG = (13, 16, 22); HEAD = (22, 26, 34); IN_B = (38, 43, 54); TXT = (240, 242, 247); MUTE = (140, 148, 165)
O1, O2 = (79, 107, 255), (140, 77, 255); GOLD = (255, 196, 61); GREEN = (61, 220, 132)
FD = "/usr/share/fonts/opentype/inter/"
f = lambda n, s: ImageFont.truetype(FD + n, s)
F_MSG = f("Inter-SemiBold.otf", 50); F_BIG = f("Inter-ExtraBold.otf", 96)
F_NAME = f("Inter-Bold.otf", 46); F_STAT = f("Inter-Medium.otf", 30); F_TIME = f("Inter-Medium.otf", 24)
F_KEY = f("Inter-Medium.otf", 40); F_HOOK = f("InterDisplay-Bold.otf", 92); F_HOOK2 = f("Inter-SemiBold.otf", 52)
F_DJ = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 26)
F_DJB = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 52)

def emo(cp, size):
    p = os.path.join(EMO, cp + ".png")
    if not os.path.exists(p):
        urllib.request.urlretrieve(f"https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/{cp}.png", p)
    return Image.open(p).convert("RGBA").resize((size, size), Image.LANCZOS)

def ease_back(t):
    t = min(1, max(0, t)); c = 1.9
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2
def ease_out(t):
    t = min(1, max(0, t)); return 1 - (1 - t) ** 3

def grad(w, h, c1, c2, horiz=True):
    a = np.linspace(0, 1, w if horiz else h)
    cols = np.array([[c1[i] + (c2[i] - c1[i]) * x for i in range(3)] for x in a], dtype=np.uint8)
    arr = np.tile(cols[None, :, :], (h, 1, 1)) if horiz else np.tile(cols[:, None, :], (1, w, 1))
    return Image.fromarray(arr, "RGB")

def round_mask(w, h, r, corners=None):
    m = Image.new("L", (w, h), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], r, fill=255, corners=corners)
    return m

# ---------------- baloncuklar ----------------
CLOCK = 4.0
MAXW = 700; PADX, PADY = 36, 26; ESZ = 58
def wrap(text, extra_last):
    words = text.split(); lines = []; cur = ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if F_MSG.getlength(t) <= MAXW - 2 * PADX: cur = t
        else: lines.append(cur); cur = w_
    if cur or not lines: lines.append(cur)
    if extra_last and F_MSG.getlength(lines[-1]) + extra_last > MAXW - 2 * PADX: lines.append("")
    return lines

def text_bubble(side, text, e):
    lines = wrap(text, ESZ + 14 if e else 0); lh = 64
    tw = max(F_MSG.getlength(l) + ((ESZ + 14) if (e and i == len(lines) - 1) else 0) for i, l in enumerate(lines))
    tw = max(tw, 150)
    bw = int(tw + 2 * PADX); bh = int(len(lines) * lh + 2 * PADY + 26)
    corners = (True, True, True, False) if side == "L" else (True, True, False, True)
    if side == "R": base = grad(bw, bh, O1, O2).convert("RGBA")
    else: base = Image.new("RGBA", (bw, bh), IN_B + (255,))
    base.putalpha(round_mask(bw, bh, 40, None)); # yumuşak köşe
    sq = Image.new("L", (bw, bh), 0); ImageDraw.Draw(sq).rectangle([0 if side == "L" else bw - 40, bh - 40, 40 if side == "L" else bw, bh], fill=255)
    a = base.getchannel("A"); a.paste(255, mask=sq); base.putalpha(a)
    d = ImageDraw.Draw(base)
    for i, l in enumerate(lines):
        d.text((PADX, PADY + i * lh), l, font=F_MSG, fill=TXT)
    if e:
        x = PADX + F_MSG.getlength(lines[-1]) + (12 if lines[-1] else 0); y = PADY + (len(lines) - 1) * lh - 2
        base.alpha_composite(emo(e, ESZ), (int(x), int(y)))
    global CLOCK
    CLOCK += 0.34; tm = f"21:{int(CLOCK):02d}"
    tcol = (220, 225, 255) if side == "R" else MUTE
    tx = bw - PADX - F_TIME.getlength(tm) - (40 if side == "R" else 0)
    d.text((tx, bh - 42), tm, font=F_TIME, fill=tcol)
    if side == "R": d.text((bw - PADX - 34, bh - 44), "✓✓", font=F_DJ, fill=(150, 230, 255))
    return base

def big_bubble(text, e):
    bw = int(F_BIG.getlength(text) + 150 + 2 * PADX + 10); bh = 200
    base = Image.new("RGBA", (bw, bh), IN_B + (255,)); base.putalpha(round_mask(bw, bh, 48))
    d = ImageDraw.Draw(base); d.text((PADX, 44), text, font=F_BIG, fill=TXT)
    base.alpha_composite(emo(e, 130), (int(PADX + F_BIG.getlength(text) + 14), 34))
    return base

class Item:
    def __init__(s, side, kind, img=None, w=0, h=0):
        s.side, s.kind, s.img = side, kind, img
        s.w, s.h = (img.size if img is not None else (w, h)); s.t0 = None

def card_base(w, h):
    b = Image.new("RGBA", (w, h), (29, 35, 64, 255)); b.putalpha(round_mask(w, h, 40)); return b

def draw_icons(frame, x, y, lt, it):
    frame.alpha_composite(it.bg, (x, y))
    for i, cp in enumerate(["1f3e0", "1f697", "1f3ea"]):
        s = ease_back((lt - 0.15 - i * 0.28) / 0.35)
        if s <= 0.02: continue
        sz = max(4, int(150 * s)); im = emo_cache[cp].resize((sz, sz), Image.LANCZOS)
        cx = x + 50 + i * 190 + 75; cy = y + 40 + 75
        frame.alpha_composite(im, (cx - sz // 2, cy - sz // 2))
    d = ImageDraw.Draw(frame)
    lab = ["Ev", "Araba", "Dükkân"]
    for i in range(3):
        if lt > 0.3 + i * 0.28:
            tw = F_STAT.getlength(lab[i]); d.text((x + 50 + i * 190 + 75 - tw / 2, y + 205), lab[i], font=F_STAT, fill=TXT)

def draw_rates(frame, x, y, lt, it):
    frame.alpha_composite(it.bg, (x, y)); d = ImageDraw.Draw(frame)
    base = y + 380; p = ease_out((lt - 0.1) / 0.9)
    bars = [(x + 110, 300, "Kredi faizi", GOLD), (x + 380, 150, "Mevduat faizi", (120, 200, 255))]
    for bx, hmax, lab, c in bars:
        hh = int(hmax * p)
        if hh > 4: d.rounded_rectangle([bx, base - hh, bx + 170, base], 18, fill=c)
        tw = F_STAT.getlength(lab); d.text((bx + 85 - tw / 2, base + 14), lab, font=F_STAT, fill=TXT)
    a = ease_out((lt - 1.0) / 0.4)
    if a > 0:
        top, bot = base - 300, base - 150; xx = x + 600
        col = tuple(int(v * a + 29 * (1 - a)) for v in GREEN)
        d.line([(x + 290, top), (xx, top)], fill=col, width=5); d.line([(x + 560, bot), (xx, bot)], fill=col, width=5)
        d.line([(xx, top), (xx, bot)], fill=col, width=7)
        d.text((xx - 150, (top + bot) / 2 - 24), "KÂR", font=F_NAME, fill=col)

def typing_img(lt):
    w, h = 190, 110; b = Image.new("RGBA", (w, h), IN_B + (255,)); b.putalpha(round_mask(w, h, 40))
    d = ImageDraw.Draw(b)
    for i in range(3):
        oy = math.sin(lt * 9 - i * 0.9) * 9; c = 150 + int(60 * (0.5 + 0.5 * math.sin(lt * 9 - i * 0.9)))
        d.ellipse([45 + i * 40 - 12, 55 + oy - 12, 45 + i * 40 + 12, 55 + oy + 12], fill=(c, c, c + 10))
    return b

# ---------------- TTS ----------------
def strip(s): return re.sub(r"[^\w\s.,!?'’\-:;âîûçğıöşüÂÎÛÇĞİÖŞÜ]", "", s)
async def tts_all(jobs):
    import edge_tts
    for text, voice, path in jobs:
        if not os.path.exists(path):
            await edge_tts.Communicate(text, voice, rate="+18%").save(path)
def load_wav(mp3):
    wv = mp3[:-4] + ".wav"
    if not os.path.exists(wv):
        subprocess.run([FF, "-loglevel", "error", "-y", "-i", mp3, "-ac", "1", "-ar", str(SR), wv], check=True)
    with wave.open(wv) as w_: a = np.frombuffer(w_.readframes(w_.getnframes()), np.int16).astype(np.float32) / 32768
    idx = np.where(np.abs(a) > 0.02)[0]
    if len(idx): a = a[max(0, idx[0] - int(.03 * SR)): idx[-1] + int(.06 * SR)]
    return a

jobs = [(" ".join(HOOK[:2]).replace("NEREDE", "nerede"), V_R, os.path.join(WORK, "hook.mp3"))]
for i, m in enumerate(MSGS):
    if m[1]: jobs.append((strip(m[1]), V_L if m[0] == "L" else V_R, os.path.join(WORK, f"m{i}.mp3")))
asyncio.run(tts_all(jobs))
voices = {os.path.basename(p)[:-4]: load_wav(p) for _, _, p in jobs}

# ---------------- zaman çizelgesi ----------------
emo_cache = {cp: emo(cp, 150) for cp in ["1f3e0", "1f697", "1f3ea"]}
items, events, sfx = [], [], []  # events: (t_start, item, kind)
t = 0.0
hook_dur = len(voices["hook"]) / SR
sfx.append((0.05, "pop")); voice_at = [(0.1, "hook")]
t = 0.1 + hook_dur + 0.45; HOOK_END = t
typing_spans, keyboard_spans = [], []
for i, m in enumerate(MSGS):
    side, text, e = m[0], m[1], m[2]; kind = m[3] if len(m) > 3 else "text"
    if kind == "text": it = Item(side, kind, text_bubble(side, text, e))
    elif kind == "big": it = Item(side, kind, big_bubble(text, e))
    elif kind == "icons": it = Item(side, kind, w=670, h=260); it.bg = card_base(670, 260)
    else: it = Item(side, kind, w=700, h=440); it.bg = card_base(700, 440)
    if side == "L":
        tt = 0.75 if kind != "big" else 0.5; typing_spans.append((t, t + tt)); t += tt
    else:
        tt = 0.0 if kind in ("icons", "rates") else min(1.1, 0.25 + len(text) * 0.018)
        if tt: keyboard_spans.append((t, t + tt, text))
        for k in range(int(tt / 0.07)): sfx.append((t + k * 0.07, "key"))
        t += tt
    it.t0 = t; items.append(it)
    sfx.append((t, "pop" if side == "L" else "send"))
    if kind == "big": sfx.append((t, "boom"))
    key = f"m{i}"
    if key in voices:
        voice_at.append((t + 0.05, key)); t += 0.05 + len(voices[key]) / SR + 0.32
    else:
        t += 2.1 if kind == "rates" else 1.4
OUTRO_T = t + 0.2; sfx.append((OUTRO_T, "pop"))
TOTAL = max(OUTRO_T + 3.2, 62.0)
print(f"süre: {TOTAL:.1f} sn, mesaj: {len(MSGS)}")

# ---------------- ses miksajı ----------------
N = int(TOTAL * SR) + SR; mix = np.zeros(N, np.float32)
def add(at, sig, vol=1.0):
    s = int(at * SR); e_ = min(N, s + len(sig)); mix[s:e_] += sig[: e_ - s] * vol
for at, k in voice_at: add(at, voices[k], 0.95)
tt_ = lambda d: np.arange(int(d * SR)) / SR
def s_pop():
    x = tt_(0.12); fr = 700 + 900 * (x / 0.12); return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-x * 35) * 0.5
def s_send():
    x = tt_(0.22); n = np.random.randn(len(x)); n = np.convolve(n, np.ones(30) / 30, "same")
    return (n * np.exp(-((x - 0.07) ** 2) / 0.002) * 1.4 + np.sin(2 * np.pi * (500 + 1500 * x / 0.22) * x) * np.exp(-x * 18) * 0.25)
def s_key():
    x = tt_(0.03); return np.random.randn(len(x)) * np.exp(-x * 220) * 0.18
def s_boom():
    x = tt_(0.6); return np.sin(2 * np.pi * (90 - 50 * x) * x) * np.exp(-x * 6) * 0.7
S = {"pop": s_pop, "send": s_send, "key": s_key, "boom": s_boom}
for at, k in sfx: add(at, S[k](), 0.6 if k != "key" else 1.0)
# özgün, alçak sesli ambient pad (hazır müzik yok)
x = np.arange(N) / SR; pad = np.zeros(N, np.float32)
chords = [(220, 277.2, 329.6), (196, 246.9, 293.7), (174.6, 220, 261.6), (196, 246.9, 311.1)]
for ci in range(int(TOTAL / 4) + 2):
    s0 = ci * 4 * SR; seg = slice(s0, min(N, s0 + 4 * SR + SR // 2)); xs = x[seg] - ci * 4
    env = np.minimum(1, xs / 0.8) * np.minimum(1, np.maximum(0, (4.5 - xs) / 0.8))
    for fq in chords[ci % 4]: pad[seg] += (np.sin(2 * np.pi * fq * xs) + 0.3 * np.sin(2 * np.pi * fq * 2 * xs)) * env
pad *= 0.018 * (1 + 0.3 * np.sin(2 * np.pi * 0.1 * x)); mix += pad
mix = np.clip(mix / max(1.0, np.abs(mix).max() / 0.95), -1, 1)
wav = os.path.join(WORK, "mix.wav")
with wave.open(wav, "wb") as w_:
    w_.setnchannels(1); w_.setsampwidth(2); w_.setframerate(SR); w_.writeframes((mix * 32767).astype(np.int16).tobytes())

# ---------------- statik katmanlar ----------------
bg = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(bg)
for i in range(70):
    cx, cy, r = random.randint(0, W), random.randint(180, 1500), random.randint(6, 26)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(24, 29, 39), width=3)
bg = bg.convert("RGBA")
HEAD_H, CHAT_BOT, INPUT_Y, KB_Y = 190, 1490, 1515, 1645
def header(status, col):
    h = Image.new("RGBA", (W, HEAD_H), HEAD + (255,)); d = ImageDraw.Draw(h)
    d.text((34, 52), "‹", font=F_BIG, fill=(120, 160, 255))
    av = grad(110, 110, (255, 140, 90), (255, 70, 140)).convert("RGBA"); av.putalpha(round_mask(110, 110, 55)); h.alpha_composite(av, (110, 42))
    d.text((165 - F_NAME.getlength("E") / 2, 68), "E", font=F_NAME, fill=(255, 255, 255))
    d.text((250, 52), CONTACT, font=F_NAME, fill=TXT); d.text((250, 112), status, font=F_STAT, fill=col)
    h.alpha_composite(emo("1f4f9", 56), (W - 230, 66)); h.alpha_composite(emo("1f4de", 56), (W - 130, 66))
    d.line([(0, HEAD_H - 1), (W, HEAD_H - 1)], fill=(40, 46, 58), width=2); return h
HEAD_ON, HEAD_TYPE = header("çevrimiçi", MUTE), header("yazıyor...", GREEN)
ROWS = ["qwertyuıopğü", "asdfghjklşi", "zxcvbnmöç"]
def keyboard(hl=None):
    k = Image.new("RGBA", (W, H - KB_Y), (20, 23, 30, 255)); d = ImageDraw.Draw(k); kw = 84
    for r, row in enumerate(ROWS):
        ox = (W - len(row) * (kw + 4)) / 2
        for i, ch in enumerate(row):
            x0 = ox + i * (kw + 4); y0 = 18 + r * 88
            on = hl == ch; d.rounded_rectangle([x0, y0, x0 + kw, y0 + 76], 14, fill=(95, 110, 255) if on else (52, 57, 70))
            d.text((x0 + kw / 2 - F_KEY.getlength(ch) / 2, y0 + 14), ch, font=F_KEY, fill=TXT)
    return k
KB = {None: keyboard()}
def input_bar(txt):
    b = Image.new("RGBA", (W, 115), BG + (0,)); d = ImageDraw.Draw(b)
    d.rounded_rectangle([30, 8, 900, 108], 50, fill=(30, 34, 44))
    if txt:
        shown = txt
        while F_STAT.getlength(shown) > 800: shown = shown[1:]
        d.text((70, 38), shown + "|", font=f("Inter-Medium.otf", 36), fill=TXT)
    else: d.text((70, 38), "Mesaj yaz...", font=f("Inter-Medium.otf", 36), fill=MUTE)
    s = grad(100, 100, O1, O2).convert("RGBA"); s.putalpha(round_mask(100, 100, 50)); b.alpha_composite(s, (940, 8))
    ImageDraw.Draw(b).text((968, 30), "➤", font=F_DJB, fill=(255, 255, 255)); return b

# yerleşim (içerik y'si)
GAP, SIDE_M, RIGHT_M = 22, 40, 110
y = HEAD_H + 30
for it in items: it.y = y; y += it.h + GAP

# ---------------- render ----------------
cmd = [FF, "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
       "-i", wav, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
       "-movflags", "+faststart", "-shortest", OUT]
proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
scroll = 0.0; nfr = int(TOTAL * FPS); dt = 1 / FPS
for fi in range(nfr):
    T = fi / FPS; fr = bg.copy()
    vis = [it for it in items if it.t0 <= T]
    typing = next((s for s in typing_spans if s[0] <= T < s[1]), None)
    bottom = (vis[-1].y + vis[-1].h) if vis else HEAD_H
    if typing: bottom = (vis[-1].y + vis[-1].h + GAP if vis else HEAD_H + 30) + 110
    target = max(0, bottom - CHAT_BOT); scroll += (target - scroll) * (1 - math.exp(-dt * 11))
    shake = 0
    for it in vis:
        if it.kind == "big" and T - it.t0 < 0.45: shake = int(math.sin((T - it.t0) * 70) * 18 * (1 - (T - it.t0) / 0.45))
    for it in vis:
        yy = int(it.y - scroll) + shake
        if yy + it.h < HEAD_H or yy > CHAT_BOT + 20: continue
        x = SIDE_M if it.side == "L" else W - RIGHT_M - it.w
        lt = T - it.t0
        if it.kind in ("icons", "rates"):
            (draw_icons if it.kind == "icons" else draw_rates)(fr, x, yy, lt, it); continue
        im = it.img
        if lt < 0.35:
            if it.side == "L":
                s = max(0.05, ease_back(lt / 0.32)); nw, nh = max(1, int(it.w * s)), max(1, int(it.h * s))
                im = im.resize((nw, nh), Image.BILINEAR); fr.alpha_composite(im, (x, yy + it.h - nh)); continue
            else:
                p = ease_out(lt / 0.3); oy = int((1 - p) * 140); im = im.copy(); a = im.getchannel("A").point(lambda v: int(v * p)); im.putalpha(a)
                fr.alpha_composite(im, (x, yy + oy)); continue
        fr.alpha_composite(im, (x, yy))
    if typing:
        ty = int((vis[-1].y + vis[-1].h + GAP if vis else HEAD_H + 30) - scroll)
        s = ease_back((T - typing[0]) / 0.25); ti = typing_img(T)
        if s < 0.99: ti = ti.resize((max(1, int(190 * s)), max(1, int(110 * s))))
        fr.alpha_composite(ti, (SIDE_M, ty + 110 - ti.size[1]))
    fr.alpha_composite(HEAD_TYPE if typing else HEAD_ON, (0, 0))
    kb = next((k for k in keyboard_spans if k[0] <= T < k[1]), None)
    txt = ""; hl = None
    if kb:
        n = int(len(kb[2]) * (T - kb[0]) / (kb[1] - kb[0])) + 1; txt = kb[2][:n]
        ch = txt[-1].lower() if txt else None; hl = ch if ch and any(ch in r for r in ROWS) else None
        if hl not in KB: KB[hl] = keyboard(hl)
    fr.alpha_composite(Image.new("RGBA", (W, KB_Y - CHAT_BOT), BG + (255,)), (0, CHAT_BOT))
    fr.alpha_composite(input_bar(txt), (0, INPUT_Y)); fr.alpha_composite(KB[hl], (0, KB_Y))
    # kanca ekranı
    if T < HOOK_END + 0.35:
        a = 1.0 if T < HOOK_END else 1 - (T - HOOK_END) / 0.35
        ov = Image.new("RGBA", (W, H), (8, 10, 16, int(225 * a))); d = ImageDraw.Draw(ov)
        for li, line in enumerate(HOOK[:2]):
            s = ease_back((T - 0.1 - li * 0.45) / 0.35)
            if s <= 0.02: continue
            fnt = F_HOOK; tw = fnt.getlength(line)
            ti = Image.new("RGBA", (int(tw) + 20, 120), (0, 0, 0, 0)); ImageDraw.Draw(ti).text((10, 0), line, font=fnt, fill=(255, 255, 255, int(255 * a)) if li == 0 else GOLD + (int(255 * a),))
            ti = ti.resize((max(1, int(ti.size[0] * s)), max(1, int(120 * s))))
            ov.alpha_composite(ti, (W // 2 - ti.size[0] // 2, 700 + li * 130))
        es = ease_back((T - 1.1) / 0.4)
        if es > 0.02:
            e_ = emo(HOOK[2], max(4, int(200 * es))); e_.putalpha(e_.getchannel("A").point(lambda v: int(v * a)))
            ov.alpha_composite(e_, (W // 2 - e_.size[0] // 2, 1000 + int(math.sin(T * 4) * 12)))
        fr.alpha_composite(ov)
    # kapanış
    if T >= OUTRO_T:
        p = ease_out((T - OUTRO_T) / 0.4)
        ov = Image.new("RGBA", (W, H), (8, 10, 16, int(215 * p))); fr.alpha_composite(ov)
        s = ease_back((T - OUTRO_T) / 0.45)
        cw, ch_ = 900, 520; card = grad(cw, ch_, (40, 46, 90), (80, 40, 120)).convert("RGBA"); card.putalpha(round_mask(cw, ch_, 50))
        cd = ImageDraw.Draw(card); cd.text((cw / 2 - F_HOOK.getlength(OUTRO[0]) / 2, 70), OUTRO[0], font=F_HOOK, fill=GOLD)
        words = OUTRO[1].split(); ln = []; cur = ""
        for w_ in words:
            tst = (cur + " " + w_).strip()
            if F_HOOK2.getlength(tst) < cw - 120: cur = tst
            else: ln.append(cur); cur = w_
        ln.append(cur)
        for i, l in enumerate(ln): cd.text((cw / 2 - F_HOOK2.getlength(l) / 2, 210 + i * 66), l, font=F_HOOK2, fill=TXT)
        card.alpha_composite(emo(OUTRO[2], 90), (cw // 2 - 45, 400))
        if s > 0.02:
            card = card.resize((max(1, int(cw * s)), max(1, int(ch_ * s))))
            fr.alpha_composite(card, (W // 2 - card.size[0] // 2, 680 - (card.size[1] - ch_) // 2))
    proc.stdin.write(fr.convert("RGB").tobytes())
    if fi % 300 == 0: print(f"kare {fi}/{nfr}", flush=True)
proc.stdin.close(); proc.wait(); print("bitti:", OUT, proc.returncode)
