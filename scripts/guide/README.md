# Guide videos

`guide/index.html` is the help guide; it is published with the app at `guide/` (see `scripts/build.mjs`).
Its videos in `guide/media/` are recorded from the real app by these scripts, so re-record them when the
interface changes.

## Re-record

```sh
npm run build                      # the recorder serves dist/site
PFS_GUIDE_PYTHON=/path/to/python \
KOKORO_MODEL=/path/to/kokoro-v1.0.int8.onnx KOKORO_VOICES=/path/to/voices-v1.0.bin \
node scripts/guide/record.mjs              # all videos, or name some: ui fonts still animated export
```

Needs Playwright with Chromium, ffmpeg (with libass), and the narration voice: a Python with
`pip install kokoro-onnx soundfile`, plus the two model files from
https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0. The voice is Kokoro's `af_heart`
(change with `KOKORO_VOICE`). Kokoro is Apache-2.0 and runs offline; no account or credits.

## How it works

- `record.mjs` serves the built site, opens a fresh browser for each scene, pauses the page clock and runs the scene.
- `recorder.mjs` steps the clock one frame (1/30 s) at a time and captures each frame, so the video is smooth
  however long a capture takes. The camera zooms by capturing a smaller part of the page at a higher scale.
  Narration is spoken by `tts.py`, laid on one track by `mix.py`, and burned in as captions with ffmpeg.
- `director.js` is the overlay drawn only while recording: cursor, click ripples, spotlight, callouts, key caps,
  title card.
- `scenes/*.mjs` are the scripts: what is said, highlighted, clicked and typed. Each writes
  `guide/media/<name>.mp4`, a poster `<name>.jpg`, and `<name>.json` (chapters and transcript, read by the guide page).
