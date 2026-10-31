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

/** Keep a left-to-right fragment such as 1920×1080 in order inside right-to-left text (Unicode isolate). */
export const ltr = (s) => `\u2066${s}\u2069`;
/** Text the user typed (a title, a character) set inside a message: kept apart from the text around it, so its own
 * direction holds and its punctuation stays put (“Hello!” in a Hebrew sentence). */
export const iso = (s) => `\u2068${s}\u2069`;
