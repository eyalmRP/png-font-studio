"""Narration for the guide videos, spoken locally by Kokoro (Apache-2.0 model, no account or credits).

Reads one JSON request per line on stdin: {"text": ..., "out": "path.wav"}; writes the WAV (24 kHz mono) unless it
already exists, and answers one JSON line: {"out": ..., "dur": seconds}.

Needs: pip install kokoro-onnx soundfile; the model files from
https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0 (kokoro-v1.0.int8.onnx, voices-v1.0.bin),
given by KOKORO_MODEL and KOKORO_VOICES. KOKORO_VOICE picks the voice (default af_heart).
"""
import json
import os
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

kokoro = Kokoro(os.environ['KOKORO_MODEL'], os.environ['KOKORO_VOICES'])
voice = os.environ.get('KOKORO_VOICE', 'af_heart')
speed = float(os.environ.get('KOKORO_SPEED', '1.0'))

for line in sys.stdin:
    req = json.loads(line)
    out = req['out']
    if not os.path.exists(out):
        samples, rate = kokoro.create(req['text'], voice=voice, speed=speed, lang='en-us')
        sf.write(out, samples, rate)
    info = sf.info(out)
    print(json.dumps({'out': out, 'dur': info.frames / info.samplerate}), flush=True)
