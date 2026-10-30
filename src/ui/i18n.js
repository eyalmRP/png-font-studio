// UI strings are written in English inline: t('Add layer'). Hebrew lives in he.js keyed by the English text.
import { HE } from './he.js';
import { storeGet, storeSet } from './dom.js';

let lang = storeGet('lang', 'en');

export function getLang() { return lang; }
export const isRTL = () => lang === 'he';

export function setLang(l) {
  lang = l === 'he' ? 'he' : 'en';
  storeSet('lang', lang);
  applyLang();
}

export function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
}

/** Translate; {name} placeholders are filled from vars. */
export function t(s, vars) {
  let out = lang === 'he' && HE[s] ? HE[s] : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return out;
}
