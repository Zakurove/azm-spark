/**
 * Copy for new features (architecture contract, section 11): src/i18n/ar/<namespace>.json and
 * src/i18n/en/<namespace>.json, read with t(lang, "<namespace>.<key>", vars).
 *
 *   t("ar", "assessment.intro.title")            nested objects or flat keys inside a namespace
 *   t("en", "progress.nextDue", { date: "..." }) {name} interpolation
 *
 * Numbers passed in vars are written with fmtNum (Arabic Indic digits in Arabic). ASCII digits in
 * Arabic text are shown in Arabic Indic digits too, so a sentence never mixes the two systems
 * (localizeDigits). A number followed by {unit}, where unit is a unit form id of the check data
 * (deg, bends, stands, sec), is written with the right Arabic plural form (countPhrase).
 *
 * To add a namespace: create the JSON file in both folders and add it to DICTS below. The key sets
 * of Arabic and English must be identical; tests/i18n.test.ts and the compile time check below
 * enforce it.
 */
import { fmtNum, type Lang } from "../app/i18n";
import { progress } from "../movements/check-v1.json";
import { UNIT_FORM_IDS, type UnitFormId, type UnitForms } from "../movements/types";
import arAssessment from "./ar/assessment.json";
import arLanding from "./ar/landing.json";
import arProgress from "./ar/progress.json";
import enAssessment from "./en/assessment.json";
import enLanding from "./en/landing.json";
import enProgress from "./en/progress.json";

export type { Lang };

const DICTS = {
  ar: { assessment: arAssessment, progress: arProgress, landing: arLanding },
  en: { assessment: enAssessment, progress: enProgress, landing: enLanding },
};

// Compile time key parity: each language must have every key of the other.
const arHasEveryEnglishKey: typeof DICTS.en = DICTS.ar;
const enHasEveryArabicKey: typeof DICTS.ar = DICTS.en;
void arHasEveryEnglishKey;
void enHasEveryArabicKey;

export type Namespace = keyof typeof DICTS.en;
export const NAMESPACES = Object.keys(DICTS.en) as Namespace[];

/** Dotted paths to the string leaves of a dictionary. */
export type KeyPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : T[K] extends object ? `${K}.${KeyPaths<T[K]>}` : never;
}[keyof T & string];

/** Every key t() accepts, for example "assessment.intro.title". */
export type I18nKey = { [N in Namespace]: `${N}.${KeyPaths<(typeof DICTS)["en"][N]>}` }[Namespace];

export type Vars = Record<string, string | number>;

/* ---------------------------------------------------------------- numbers */

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
// SPEC-GAP: digits-tel. The spec (progress.digits) says "tel: links stay 997, 937" while every other
// ASCII digit in Arabic becomes Arabic Indic. The safest reading keeps the emergency (997) and
// Ministry of Health (937) numbers in ASCII wherever they are shown, so the number on screen always
// matches the dialled tel: link and the phone keypad.
const ASCII_NUMBERS = new Set(["997", "937"]);

/**
 * Shows the ASCII digits of Arabic text in Arabic Indic digits (progress.digits in the check data).
 * Digits attached to a Latin letter stay as they are (codes such as T6), and so do 997 and 937.
 * Digits are mapped one by one (with ٫ as the decimal mark), so a year or a code is never grouped.
 * English text is returned unchanged.
 */
export function localizeDigits(lang: Lang, text: string): string {
  if (lang !== "ar") return text;
  return text.replace(/\d+(?:\.\d+)?/g, (run, offset: number) => {
    const before = text[offset - 1] ?? "";
    const after = text[offset + run.length] ?? "";
    if (/[A-Za-z]/.test(before) || /[A-Za-z]/.test(after) || ASCII_NUMBERS.has(run)) return run;
    return run.replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]).replace(".", "٫");
  });
}

// SPEC-GAP: negative-numbers. Copy may not hold a minus sign (rule 4) and the spec does not say how a
// negative change is written, so a negative number is refused rather than shown with a sign.
/** A number for copy: fmtNum, never negative (a minus sign is a dash; say the direction in words). */
export function formatNumber(lang: Lang, n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`Cannot show ${n} in copy`);
  if (n < 0) throw new RangeError("Negative numbers cannot be shown in copy: say the direction in words");
  return fmtNum(n, lang);
}

/* ---------------------------------------------------------------- plurals */

const UNIT_FORMS: Record<UnitFormId, UnitForms> = progress.unitForms;
const PLURAL_RULES: Record<Lang, Intl.PluralRules> = {
  ar: new Intl.PluralRules("ar"),
  en: new Intl.PluralRules("en"),
};

export function isUnitFormId(x: unknown): x is UnitFormId {
  return typeof x === "string" && (UNIT_FORM_IDS as readonly string[]).includes(x);
}

/** The plural category of n: Arabic zero, one, two, few (3 to 10), many (11 to 99), other (100 and up). */
export function pluralForm(lang: Lang, n: number): Intl.LDMLPluralRule {
  return PLURAL_RULES[lang].select(n);
}

/** The unit word that goes with n, for example درجات for 5 and degree for 1. */
export function unitWord(lang: Lang, unit: UnitFormId, n: number): string {
  const forms = UNIT_FORMS[unit];
  const form = pluralForm(lang, n);
  return lang === "ar" ? forms.ar[form] : forms.en[form === "one" ? "one" : "other"];
}

/**
 * A number with its unit word. In Arabic the one and two forms stand for the number and the word
 * together (درجة واحدة, درجتين); every other form follows the number (٥ درجات, ١١ درجة).
 * English: 1 degree, 16 degrees.
 */
export function countPhrase(lang: Lang, unit: UnitFormId, n: number): string {
  const number = formatNumber(lang, n);
  const word = unitWord(lang, unit, n);
  if (lang === "ar") {
    const form = pluralForm(lang, n);
    if (form === "one" || form === "two") return word;
  }
  return `${number} ${word}`;
}

/* ---------------------------------------------------------- interpolation */

/**
 * Fills {name} tokens. Numbers go through formatNumber. "{x} {unit}" with a number x and a unit form
 * id as unit becomes countPhrase(unit, x); a {unit} on its own with a unit form id gets the generic
 * word (Arabic zero form, English other form). Unknown tokens are left in place. Arabic text first
 * has its own ASCII digits localized (localizeDigits); string vars are inserted as given.
 */
export function interpolate(lang: Lang, template: string, vars: Vars = {}): string {
  const unit = vars.unit;
  const text = localizeDigits(lang, template);
  const paired = isUnitFormId(unit)
    ? text.replace(/\{(\w+)\} \{unit\}/g, (whole, name: string) => {
        const n = vars[name];
        return typeof n === "number" ? countPhrase(lang, unit, n) : whole;
      })
    : text;
  return paired.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name];
    if (v === undefined) return whole;
    if (typeof v === "number") return formatNumber(lang, v);
    // SPEC-GAP: lone-unit. Every {unit} in the check data follows a number; a {unit} on its own gets
    // the generic word (Arabic zero form, English other form).
    if (name === "unit" && isUnitFormId(v)) return unitWord(lang, v, 0);
    return v;
  });
}

/* ------------------------------------------------------------------- t() */

type Dict = { [key: string]: string | Dict };

function lookup(dict: Dict | string | undefined, path: string): string | undefined {
  if (dict === undefined || typeof dict === "string") return undefined;
  const direct = dict[path];
  if (typeof direct === "string") return direct;
  const dot = path.indexOf(".");
  return dot < 0 ? undefined : lookup(dict[path.slice(0, dot)], path.slice(dot + 1));
}

/**
 * A t() over any pair of dictionaries keyed by namespace. A missing key returns the key itself,
 * which the key parity test and the typed keys make impossible for the real dictionaries.
 */
export function createTranslator(dicts: Record<Lang, Record<string, unknown>>) {
  return (lang: Lang, key: string, vars?: Vars): string => {
    const dot = key.indexOf(".");
    const namespace = dot < 0 ? key : key.slice(0, dot);
    const text = dot < 0 ? undefined : lookup(dicts[lang][namespace] as Dict | undefined, key.slice(dot + 1));
    return text === undefined ? key : interpolate(lang, text, vars);
  };
}

const translate = createTranslator(DICTS);

/** New feature copy in the chosen language, for example t(lang, "assessment.intro.title"). */
export function t(lang: Lang, key: I18nKey, vars?: Vars): string {
  return translate(lang, key, vars);
}

/** The dictionaries, for tests and tooling. */
export const DICTIONARIES: Record<Lang, Record<Namespace, unknown>> = DICTS;
