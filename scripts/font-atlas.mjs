// The built-in fonts ship as a lossless WebP atlas plus a JSON description (assets/fonts/<key>.atlas.*), made from
// the font zip by scripts/pack-atlas.py (Python with Pillow). The atlas records the zip's SHA-256 and is rebuilt when
// the zip changes; encoding at full effort takes a few minutes, so the result is kept in the repository.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function atlasPaths(key) {
  const base = path.join(root, 'assets/fonts', key);
  return { zip: base + '.zip', webp: base + '.atlas.webp', json: base + '.atlas.json' };
}

/** Make sure the atlas for `key` matches its font zip; rebuilds it when it doesn't. Returns the paths. */
export function ensureAtlas(key, { method = 6 } = {}) {
  const p = atlasPaths(key);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(p.zip)).digest('hex');
  let fresh = false;
  try { fresh = JSON.parse(fs.readFileSync(p.json, 'utf8')).source === hash && fs.existsSync(p.webp); } catch { /* missing */ }
  if (!fresh) {
    console.log(`packing ${key} into a WebP atlas (a few minutes)…`);
    try {
      execFileSync('python3', [path.join(root, 'scripts/pack-atlas.py'), p.zip, p.webp, p.json, String(method)], { stdio: 'inherit' });
    } catch {
      throw new Error(`Could not pack ${key}: scripts/pack-atlas.py needs python3 with Pillow (pip install pillow)`);
    }
  }
  return p;
}

if (import.meta.url === `file://${process.argv[1]}`) for (const k of process.argv.slice(2)) ensureAtlas(k);
