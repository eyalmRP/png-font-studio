"""Lay the narration clips on one track at their start times: mix.py plan.json out.wav
plan.json: {"duration": seconds, "clips": [{"t": seconds, "wav": path}]}"""
import json
import sys

import numpy as np
import soundfile as sf

plan = json.load(open(sys.argv[1]))
rate = 24000
track = np.zeros(int(plan['duration'] * rate) + rate, dtype=np.float32)
for c in plan['clips']:
    audio, r = sf.read(c['wav'], dtype='float32')
    assert r == rate, f"{c['wav']}: {r} Hz"
    at = int(c['t'] * rate)
    end = min(len(track), at + len(audio))
    track[at:end] += audio[:end - at]
sf.write(sys.argv[2], np.clip(track, -1, 1), rate)
