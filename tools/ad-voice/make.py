# Open-source ad voiceover: Chatterbox (MIT, Resemble AI) with emotion control.
# Speaker references are made with Kokoro (Apache-2.0) voices.
import json, os, sys, numpy as np, soundfile as sf, torch, torchaudio as ta
from kokoro_onnx import Kokoro
from chatterbox.tts import ChatterboxTTS

LINES = json.load(open("tools/ad-voice/lines.json"))
OUT = "tools/ad-voice/out"; os.makedirs(OUT, exist_ok=True)
REF_TEXT = ("Running an agency is a lot of work. Every week there are hours to check, "
            "people to pay and clients to update, and I want it to feel simple and calm.")
k = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
VOICES = {"sarah": None, "chris": "am_michael", "brian": "am_onyx", "emma": "af_heart"}
refs = {}
for name, kv in VOICES.items():
    if kv:
        a, sr = k.create(REF_TEXT, voice=kv, speed=1.0, lang="en-us")
        p = f"{OUT}/ref-{name}.wav"; sf.write(p, a, sr); refs[name] = p
torch.set_num_threads(os.cpu_count())
model = ChatterboxTTS.from_pretrained(device="cpu")
for name in VOICES:
    for L in LINES:
        torch.manual_seed(7)
        wav = model.generate(L["text"], audio_prompt_path=refs.get(name),
                             exaggeration=L["ex"], cfg_weight=L.get("cfg", 0.4), temperature=0.8)
        ta.save(f"{OUT}/{name}-{L['id']}.wav", wav, model.sr)
        print("ok", name, L["id"], flush=True)
