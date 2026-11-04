"""ElevenLabs ile seslendirme + kelime zamanları.

Kullanım:
  python elevenlabs_tts.py <segments.json> <çıktı_klasörü> [ses_adı]

segments.json: [{"id": "hook", "text": "..."}, ...]   (*vurgu* işaretleri otomatik temizlenir)
Her segment için <id>.mp3 ve <id>.json üretir. JSON biçimi tools/pool-3d/audio.py ile aynıdır:
  [[başlangıç_sn, süre_sn, "kelime"], ...]
Böylece audio.py TTS adımını atlar ve bu dosyaları kullanır.

Anahtar, ELEVENLABS_API_KEY ortam değişkeninden okunur. Asla koda veya sohbete yazmayın.
"""
import base64, json, os, sys, urllib.request, urllib.error

VOICES = {  # ElevenLabs hazır İngiliz sesleri
    "george": "JBFqnCBsd6RMkjVDRZzb",  # sıcak, sürükleyici hikâye anlatıcısı (erkek)
    "daniel": "onwK4e9ZLuTAKqWW03F9",  # ciddi haber spikeri (erkek)
    "alice": "Xb7hH8MSUJpSbSDYk0k2",   # net, eğitici (kadın)
    "lily": "pFZP5JQG7iQjIQuC4Bku",    # kadife ses, oyuncu (kadın)
}
MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2")


def tts_with_timestamps(text, voice_id, key):
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128",
        data=json.dumps({
            "text": text, "model_id": MODEL,
            "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.25, "use_speaker_boost": True},
        }).encode(),
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        sys.exit(f"ElevenLabs hata {e.code}: {body}")


def words_from_alignment(al):
    chars, st, en = al["characters"], al["character_start_times_seconds"], al["character_end_times_seconds"]
    words, cur, s0, e0 = [], "", None, None
    for c, a, b in zip(chars, st, en):
        if c.isspace():
            if cur: words.append([round(s0, 3), round(e0 - s0, 3), cur])
            cur, s0 = "", None
        else:
            if s0 is None: s0 = a
            cur += c; e0 = b
    if cur: words.append([round(s0, 3), round(e0 - s0, 3), cur])
    return words


def main():
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        sys.exit("ELEVENLABS_API_KEY ortam değişkeni yok. Ortam ayarlarına secret olarak ekleyin.")
    segs = json.load(open(sys.argv[1])); out = sys.argv[2]; os.makedirs(out, exist_ok=True)
    voice = sys.argv[3] if len(sys.argv) > 3 else "george"
    vid = VOICES.get(voice.lower(), voice)
    for s in segs:
        mp3, js = os.path.join(out, s["id"] + ".mp3"), os.path.join(out, s["id"] + ".json")
        if os.path.exists(mp3) and os.path.exists(js):
            continue
        r = tts_with_timestamps(s["text"].replace("*", ""), vid, key)
        open(mp3, "wb").write(base64.b64decode(r["audio_base64"]))
        json.dump(words_from_alignment(r.get("normalized_alignment") or r["alignment"]), open(js, "w"), ensure_ascii=False)
        print("hazır:", s["id"])


if __name__ == "__main__":
    main()
