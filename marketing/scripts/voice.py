"""The Short's voiceover: Kokoro (an open text-to-speech model, Apache 2.0, runs on this machine, no
account) reads each line, and PocketSphinx lines every word up with the sound, so the captions can pop in
on the word. scripts/short.ts runs this; by hand:

    python scripts/voice.py lines.json out/        # lines.json: {"voice", "speed", "lines": [{"id", "say"}]}

Writes out/<id>.wav (24 kHz mono) and prints {"lines": [{"id", "file", "seconds", "words": [{"w", "t0", "t1"}],
"heard"}]}: `heard` is what a speech recogniser makes of the line, a check that the voice said the words.

Needs `pip install kokoro-onnx soundfile pocketsphinx` and the two model files from
https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0 (kokoro-v1.0.onnx, voices-v1.0.bin)
in $KOKORO_DIR (default: this folder's ../.voice).
"""
import json, os, re, sys
import numpy as np
import soundfile as sf

def resample(x, sr, to):
    n = int(round(len(x) * to / sr))
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)

# Words the recogniser's dictionary lacks, in its phones.
EXTRA = {"wobbles": "W AA B AH L Z", "wobbly": "W AA B L IY", "blocklings": "B L AA K L IH NG Z"}

def words_of(text):
    return re.sub(r"[^a-z' ]+", " ", text.lower().replace("-", " ")).split()

def align(samples, sr, text):
    """Word times by forced alignment; None when a word is not in the recogniser's dictionary."""
    from pocketsphinx import Decoder
    pcm = (np.clip(resample(samples, sr, 16000), -1, 1) * 32767).astype(np.int16).tobytes()
    words = words_of(text)
    d = Decoder(samprate=16000, loglevel="FATAL")
    for w, phones in EXTRA.items():
        if d.lookup_word(w) is None:
            d.add_word(w, phones, True)
    missing = [w for w in words if d.lookup_word(w) is None]
    out = None
    if not missing:
        d.set_align_text(" ".join(words))
        d.start_utt(); d.process_raw(pcm, full_utt=True); d.end_utt()
        segs = [s for s in d.seg() if not s.word.startswith("<") and s.word != "(NULL)"]
        if len(segs) == len(words):
            out = [{"w": w, "t0": round(s.start_frame / 100, 3), "t1": round((s.end_frame + 1) / 100, 3)} for w, s in zip(words, segs)]
    h = Decoder(samprate=16000, loglevel="FATAL")
    h.start_utt(); h.process_raw(pcm, full_utt=True); h.end_utt()
    heard = h.hyp().hypstr if h.hyp() else ""
    return out, heard, missing

def spread(samples, sr, text):
    """The fallback: words spread over the line by their length."""
    words = words_of(text)
    total = sum(len(w) + 1 for w in words)
    t, out, dur = 0.0, [], len(samples) / sr
    for w in words:
        d = dur * (len(w) + 1) / total
        out.append({"w": w, "t0": round(t, 3), "t1": round(t + d, 3)})
        t += d
    return out

def main():
    spec = json.load(open(sys.argv[1]))
    out_dir = sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    home = os.environ.get("KOKORO_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".voice")
    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(home, "kokoro-v1.0.onnx"), os.path.join(home, "voices-v1.0.bin"))
    lines = []
    for line in spec["lines"]:
        samples, sr = k.create(line["say"], voice=spec.get("voice", "af_heart"), speed=float(line.get("speed", spec.get("speed", 1.0))), lang=spec.get("lang", "en-us"))
        samples = np.asarray(samples, dtype=np.float32)
        # Trim to the speech (20 ms of air each side).
        loud = np.flatnonzero(np.abs(samples) > 0.01)
        a, b = max(0, loud[0] - int(0.02 * sr)), min(len(samples), loud[-1] + int(0.06 * sr))
        samples = samples[a:b]
        path = os.path.join(out_dir, f"{line['id']}.wav")
        sf.write(path, samples, sr, subtype="PCM_16")
        words, heard, missing = align(samples, sr, line.get("align", line["say"]))
        lines.append({"id": line["id"], "file": path, "seconds": round(len(samples) / sr, 3), "words": words or spread(samples, sr, line.get("align", line["say"])),
                      "aligned": bool(words), "missing": missing, "heard": heard, "phonemes": k.tokenizer.phonemize(line["say"], "en-us")})
    json.dump({"lines": lines}, sys.stdout)

main()
