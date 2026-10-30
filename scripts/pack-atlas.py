"""Pack a font zip's glyph PNGs into one lossless WebP atlas for shipping.

    python3 scripts/pack-atlas.py <font.zip> <out.webp> <out.json> [method]

The JSON holds the font description (font.json from the zip), the atlas size and each glyph file's rect, and the
SHA-256 of the zip it came from, so the build can tell when the atlas is stale. Lossless WebP keeps every pixel;
the script decodes the atlas again and checks each glyph against its PNG before writing anything.
"""
import hashlib
import io
import json
import sys
import zipfile

from PIL import Image

src, out_webp, out_json = sys.argv[1:4]
method = int(sys.argv[4]) if len(sys.argv) > 4 else 6
raw = open(src, 'rb').read()
z = zipfile.ZipFile(io.BytesIO(raw))
font = json.loads(z.read('font.json').decode('utf-8'))
files = [g['file'] for g in font['glyphs'] if g.get('file')]
images = {f: Image.open(io.BytesIO(z.read(f))).convert('RGBA') for f in files}

# shelf packing, tallest first; a 1 px gap keeps glyphs apart
WIDTH = 4096
order = sorted(files, key=lambda f: (-images[f].height, f))
rects, x, y, row = {}, 0, 0, 0
for f in order:
    im = images[f]
    if x + im.width > WIDTH:
        x, y, row = 0, y + row + 1, 0
    rects[f] = [x, y, im.width, im.height]
    x += im.width + 1
    row = max(row, im.height)
height = y + row
atlas = Image.new('RGBA', (WIDTH, height), (0, 0, 0, 0))
for f in order:
    atlas.paste(images[f], tuple(rects[f][:2]))

buf = io.BytesIO()
atlas.save(buf, 'WEBP', lossless=True, quality=100, method=method, exact=True)
back = Image.open(io.BytesIO(buf.getvalue())).convert('RGBA')
for f, (gx, gy, w, h) in rects.items():
    if back.crop((gx, gy, gx + w, gy + h)).tobytes() != images[f].tobytes():
        sys.exit(f'atlas does not reproduce {f} exactly')

open(out_webp, 'wb').write(buf.getvalue())
with open(out_json, 'w', encoding='utf-8') as fh:
    json.dump({'source': hashlib.sha256(raw).hexdigest(), 'font': font, 'atlas': {'width': WIDTH, 'height': height, 'rects': rects}}, fh, ensure_ascii=False, separators=(',', ':'))
print(f'{out_webp}: {len(files)} glyphs, {WIDTH}x{height}, {len(buf.getvalue()) / 1e6:.2f} MB (PNGs {sum(len(z.read(f)) for f in files) / 1e6:.2f} MB)')
