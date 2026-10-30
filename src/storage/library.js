// Browser library (IndexedDB): fonts and the current title, kept in this browser only.
import { fontToJSON, fontFromJSON } from '../core/font.js';
import { imageToPNG, decodeImage } from './files.js';

const DB = 'png-font-studio';
let dbp = null;

function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}

function tx(store, mode, fn) {
  return openDB().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const r = fn(s);
        t.oncomplete = () => resolve(r && 'result' in r ? r.result : true);
        t.onerror = () => resolve(null);
        t.onabort = () => resolve(null);
      } catch { resolve(null); }
    });
  });
}

export async function storageAvailable() { return !!(await openDB()); }

export async function saveFontRecord(font) {
  const json = fontToJSON(font);
  const files = {};
  for (const gj of json.glyphs) if (gj.file) files[gj.file] = await imageToPNG(font.glyphs.get(gj.char).image);
  return tx('fonts', 'readwrite', (s) => s.put({ id: font.id, json, files, order: font.order ?? 0, builtin: !!font.builtin, updated: Date.now() }));
}

export function deleteFontRecord(id) { return tx('fonts', 'readwrite', (s) => s.delete(id)); }

export async function loadFontRecords() {
  const recs = await tx('fonts', 'readonly', (s) => s.getAll());
  if (!recs) return [];
  const out = [];
  for (const r of recs) {
    try {
      const images = new Map();
      await Promise.all(Object.entries(r.files || {}).map(async ([n, b]) => images.set(n, await decodeImage(b))));
      const f = fontFromJSON(r.json, images);
      f.order = r.order; f.builtin = r.builtin;
      out.push(f);
    } catch (e) { console.warn('Skipping unreadable font', r.id, e); }
  }
  return out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function saveProjectRecord(json) { return tx('projects', 'readwrite', (s) => s.put({ id: 'current', json, updated: Date.now() })); }
export function loadProjectRecord() { return tx('projects', 'readonly', (s) => s.get('current')); }
export function kvSet(key, value) { return tx('kv', 'readwrite', (s) => s.put(value, key)); }
export function kvGet(key) { return tx('kv', 'readonly', (s) => s.get(key)); }
