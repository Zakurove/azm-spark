/**
 * Wording rules for user facing copy (architecture contract, section 1, rule 4), shared by
 * tests/wording.test.ts and the scripts that write copy into src (scripts/clinical/export-check.mjs),
 * so a script can never write a file that the wording test would reject.
 *
 * A piece of copy fails when it contains
 *   (a) a dash character: U+2010 to U+2015 (hyphen, non breaking hyphen, figure dash, en dash,
 *       em dash, horizontal bar) or U+2212 (minus sign);
 *   (b) a hyphen-minus directly between two letters (Latin or Arabic, Arabic diacritics count as
 *       part of the letter), or a hyphen-minus with whitespace on both sides;
 *   (c) the phrase "حالتك الصحية" (the product always says "حالتك الطبية"). Arabic diacritics and
 *       tatweel are removed before matching, so a vocalized TTS line cannot slip through.
 */

export const LETTER =
  "A-Za-z\\u00C0-\\u024F\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
export const DASH_CHARS = /[\u2010-\u2015\u2212]/;
export const HYPHEN_BETWEEN_LETTERS = new RegExp(`[${LETTER}]-[${LETTER}]`);
export const SPACED_HYPHEN = /(^|\s)-(\s|$)/;
export const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
export const FORBIDDEN_PHRASE = "حالتك الصحية";

export const DASH_PROBLEM = "dash character";
export const PHRASE_PROBLEM = FORBIDDEN_PHRASE;

/** Every wording rule a piece of copy breaks, as short labels. */
export function wordingProblems(text) {
  const problems = [];
  if (DASH_CHARS.test(text)) problems.push(DASH_PROBLEM);
  if (HYPHEN_BETWEEN_LETTERS.test(text)) problems.push("hyphen between letters");
  if (SPACED_HYPHEN.test(text)) problems.push("spaced hyphen");
  if (text.replace(ARABIC_MARKS, "").includes(FORBIDDEN_PHRASE)) problems.push(PHRASE_PROBLEM);
  return problems;
}

export const HAS_LETTER = new RegExp(`[${LETTER}]`);
export const URL_LIKE = /^(https?:|mailto:|data:|blob:)/i;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PATH = /^\.{0,2}\/[^\s]*$/;
export const LOCALE = /^[a-z]{2,3}(-[A-Z][A-Za-z]{1,3})?$/;
export const LOWER_ID = /^[a-z0-9_.:#/]+(?:[-_.][a-z0-9_.:#/]+)*$/;

/** True when a value taken from a copy data source could be read by a person. */
export function isCopyValue(s) {
  const t = s.trim();
  if (!HAS_LETTER.test(t)) return false;
  if (URL_LIKE.test(t) || EMAIL.test(t) || PATH.test(t) || LOCALE.test(t)) return false;
  if (!/\s/.test(t) && LOWER_ID.test(t)) return false;
  return true;
}

/**
 * Keys that hold user facing copy in the clinical data (src/movements/*.json). Every person facing
 * string there is Arabic first with complete English, so it always sits under one of these keys:
 * { ar, en } pairs, { ar: [...], en: [...] } lists, plural form maps and the cue lines (ar, arTts, en).
 */
export const USER_FACING_KEYS = new Set(["ar", "en", "arTts"]);

/**
 * Every string value of a clinical data file with its path and whether it is user facing.
 * A string is user facing when any key on its path is ar, en or arTts. The other strings are
 * English only engineering prose (rule, definition, when, ...) that is never shown to a person.
 */
export function dataStrings(value, where = "") {
  const out = [];
  const visit = (v, path, userFacing) => {
    if (typeof v === "string") out.push({ where: path, text: v, userFacing });
    else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${i}]`, userFacing));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) visit(x, `${path}.${k}`, userFacing || USER_FACING_KEYS.has(k));
  };
  visit(value, where, false);
  return out;
}

/**
 * Wording problems of one string from a clinical data file.
 * User facing strings get every rule (and are read when they look like copy, or hold a dash).
 * Engineering prose gets the rules that hold for every string anywhere: no dash characters and never
 * the forbidden phrase. A hyphen in prose such as "pre-check" or "ar-SA" is not copy and passes.
 */
export function dataStringProblems({ text, userFacing }) {
  if (userFacing) return isCopyValue(text) || DASH_CHARS.test(text) ? wordingProblems(text) : [];
  return wordingProblems(text).filter((p) => p === DASH_PROBLEM || p === PHRASE_PROBLEM);
}

/** Readable violation lines for a clinical data file (empty when it is clean). */
export function dataViolations(value, where = "") {
  return dataStrings(value, where).flatMap((s) => {
    const problems = dataStringProblems(s);
    return problems.length ? [`${s.where} [${problems.join(", ")}] ${JSON.stringify(s.text)}`] : [];
  });
}
