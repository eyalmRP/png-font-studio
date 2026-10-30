// List every interface string that goes through t(), including the label tables translated at run time,
// and report which ones have no Hebrew yet. Usage: node scripts/i18n-strings.mjs [--missing] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { HE } from '../src/ui/he.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
walk(path.join(root, 'src'));
const unq = (s) => s.replace(/\\(u\{?[0-9a-fA-F]+\}?|.)/g, (m, c) => (c[0] === 'u' ? String.fromCodePoint(parseInt(c.replace(/[u{}]/g, ''), 16)) : c === 'n' ? '\n' : c));
const found = new Map();
const add = (s, where) => { if (s && /[A-Za-z]/.test(s) && !found.has(s)) found.set(s, where); };
const block = (src, start) => { const i = src.indexOf(start); if (i < 0) return ''; let depth = 0; for (let j = src.indexOf('{', i); j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1); } return ''; };
const values = (txt) => [...txt.matchAll(/(?:^|[,{\s])(?:[\w$]+|'[^']*'):\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => unq(m[1]));
for (const file of files) {
  if (file.endsWith('he.js')) continue;
  const src = fs.readFileSync(file, 'utf8'), rel = path.relative(root, file);
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) add(unq(m[1]), rel);
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) add(unq(m[1]), rel);
  for (const m of src.matchAll(/\bt\(\s*`([^`$]*)`/g)) add(m[1], rel);
  // undo/redo labels are shown through t()
  for (const m of src.matchAll(/checkpoint\([^,()]+,\s*'((?:[^'\\]|\\.)*)'/g)) add(unq(m[1]), rel + ' (undo)');
  // tables whose entries are translated where they are shown
  for (const name of ['const LABELS = {', 'const ANIM_NAMES = {', 'export function blendName', 'const GROUP_LABEL = {']) for (const v of values(block(src, name))) add(v, rel + ' (table)');
  for (const m of src.matchAll(/\b(?:label|desc|name):\s*'((?:[^'\\]|\\.)*)'/g)) if (/charsets|export\.js|recolor|titles\.js/.test(rel)) add(unq(m[1]), rel + ' (table)');
  for (const m of src.matchAll(/\['\w+', '((?:[^'\\]|\\.)*)', '--[\w-]+'\]/g)) add(unq(m[1]), rel + ' (guides)');
  for (const m of src.matchAll(/\bt\(\{([^}]*)\}/g)) for (const v of values('{' + m[1] + '}')) add(v, rel + ' (table)');
  for (const m of src.matchAll(/const detected = \{([^}]*)\}/g)) { for (const v of values('{' + m[1] + '}')) add(v, rel); add('flat', rel); }
}
const list = [...found.keys()].sort((a, b) => a.localeCompare(b));
const missing = list.filter((s) => !HE[s]);
const stale = Object.keys(HE).filter((k) => !found.has(k));
if (process.argv.includes('--json')) console.log(JSON.stringify(process.argv.includes('--missing') ? missing : list, null, 1));
else {
  console.log(`${list.length} strings, ${missing.length} without Hebrew, ${stale.length} Hebrew entries no longer used`);
  if (process.argv.includes('--missing')) for (const s of missing) console.log(`${found.get(s)}\t${s}`);
  if (process.argv.includes('--stale')) for (const s of stale) console.log('stale\t' + s);
}
