/**
 * Wording check for user facing copy (architecture contract, section 1, rule 4).
 *
 * A piece of copy fails when it contains
 *   (a) a dash character: U+2010 to U+2015 (hyphen, non breaking hyphen, figure dash, en dash,
 *       em dash, horizontal bar) or U+2212 (minus sign);
 *   (b) a hyphen-minus directly between two letters (Latin or Arabic, Arabic diacritics count as
 *       part of the letter), or a hyphen-minus with whitespace on both sides;
 *   (c) the phrase "حالتك الصحية" (the product always says "حالتك الطبية"). Arabic diacritics and
 *       tatweel are removed before matching, so a vocalized TTS line cannot slip through.
 *
 * Where copy is read from
 *   1. Every JSON file under src/i18n (the folder may not exist yet), all string leaves.
 *   2. src/app/voice-script.json: the ar, en and arTts text of every cue.
 *   3. src/exercises/library.json: name, description and steps of every exercise.
 *   4. Exported copy of src/app/platform-copy.ts, src/app/camera-copy.ts, src/app/i18n.ts (T),
 *      src/app/experience.ts and src/app/product.ts: exported objects are walked recursively and
 *      the exported copy functions (labels, camCopy, ui, copy) are called with "ar" and "en".
 *      src/exercises/defs.ts contributes name, description and camera of every exercise.
 *   5. Source text of src/app/*.tsx and of the copy modules in 4 (this reaches tables that live
 *      inside functions, such as errorText): JSX text, and string or template literal pieces that
 *      contain whitespace and at least one letter.
 *
 * Heuristics that keep false positives near zero
 *   - Values from the data sources (1 to 4) are copy by construction. Only values that are clearly
 *     not copy are skipped: URLs, emails, paths, locale tags, and lowercase ids or keys without
 *     spaces (for example "full", "azm.coach", "sit_to_stand").
 *   - In source text (5), literals are skipped when they sit inside an attribute that never holds
 *     copy (className, style, d, href, key, ...) or an SVG presentation attribute (fontFamily,
 *     stroke..., textAnchor, ...), inside a style object property whose value can hold hyphenated
 *     CSS words (fontFamily, transition, animation, background, grid, ...), inside a call whose
 *     arguments are not copy (querySelector, matchMedia, classList, fetch, api, storage, Intl,
 *     RegExp, console), inside a variable or property that holds class names (cls, className,
 *     cardClass, ...), or inside an import or export.
 *   - Only the files listed above are read. The sanitiser code in src/medical/weekly.ts and
 *     server/weekly-ai.ts, which mentions "حالتك الصحية" in order to replace or forbid it, is
 *     never part of the scan.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import * as tsModule from "typescript";
import voiceScript from "../src/app/voice-script.json";
import library from "../src/exercises/library.json";
import * as platformCopy from "../src/app/platform-copy";
import * as cameraCopy from "../src/app/camera-copy";
import * as i18n from "../src/app/i18n";
import * as experience from "../src/app/experience";
import * as product from "../src/app/product";
import { EXERCISES } from "../src/exercises/defs";

const ts: typeof tsModule = (tsModule as unknown as { default?: typeof tsModule }).default ?? tsModule;

const ROOT = join(__dirname, "..");
type Copy = { where: string; text: string };

/* ------------------------------------------------------------------ detector */

const LETTER =
  "A-Za-z\\u00C0-\\u024F\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
const DASH_CHARS = /[\u2010-\u2015\u2212]/;
const HYPHEN_BETWEEN_LETTERS = new RegExp(`[${LETTER}]-[${LETTER}]`);
const SPACED_HYPHEN = /(^|\s)-(\s|$)/;
const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const FORBIDDEN_PHRASE = "حالتك الصحية";

function wordingProblems(text: string): string[] {
  const problems: string[] = [];
  if (DASH_CHARS.test(text)) problems.push("dash character");
  if (HYPHEN_BETWEEN_LETTERS.test(text)) problems.push("hyphen between letters");
  if (SPACED_HYPHEN.test(text)) problems.push("spaced hyphen");
  if (text.replace(ARABIC_MARKS, "").includes(FORBIDDEN_PHRASE)) problems.push("حالتك الصحية");
  return problems;
}

/* ------------------------------------------------------- value level filters */

const HAS_LETTER = new RegExp(`[${LETTER}]`);
const URL_LIKE = /^(https?:|mailto:|data:|blob:)/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PATH = /^\.{0,2}\/[^\s]*$/;
const LOCALE = /^[a-z]{2,3}(-[A-Z][A-Za-z]{1,3})?$/;
const LOWER_ID = /^[a-z0-9_.:#/]+(?:[-_.][a-z0-9_.:#/]+)*$/;

/** True when a value taken from a copy data source could be read by a person. */
function isCopyValue(s: string): boolean {
  const t = s.trim();
  if (!HAS_LETTER.test(t)) return false;
  if (URL_LIKE.test(t) || EMAIL.test(t) || PATH.test(t) || LOCALE.test(t)) return false;
  if (!/\s/.test(t) && LOWER_ID.test(t)) return false;
  return true;
}

function walk(value: unknown, where: string, out: Copy[]) {
  if (typeof value === "string") {
    if (isCopyValue(value)) out.push({ where, text: value });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${where}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walk(v, `${where}.${k}`, out);
  }
}

/* ------------------------------------------------------------- data sources */

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return jsonFiles(p);
    return name.endsWith(".json") ? [p] : [];
  });
}

function i18nJsonCopy(): Copy[] {
  const out: Copy[] = [];
  for (const file of jsonFiles(join(ROOT, "src/i18n"))) {
    walk(JSON.parse(readFileSync(file, "utf8")), relative(ROOT, file), out);
  }
  return out;
}

function voiceCopy(): Copy[] {
  const out: Copy[] = [];
  for (const [id, cue] of Object.entries(voiceScript as Record<string, Record<string, string>>)) {
    for (const field of ["ar", "en", "arTts"]) {
      if (typeof cue[field] === "string") walk(cue[field], `voice-script.json ${id}.${field}`, out);
    }
  }
  return out;
}

function libraryCopy(): Copy[] {
  const out: Copy[] = [];
  for (const e of library as Array<Record<string, unknown>>) {
    for (const field of ["name", "description", "steps"]) {
      walk(e[field], `library.json ${e.id}.${field}`, out);
    }
  }
  return out;
}

const COPY_FUNCTIONS = new Set(["labels", "camCopy", "ui", "copy"]);
const COPY_MODULES: Array<[string, Record<string, unknown>, string[]?]> = [
  ["platform-copy.ts", platformCopy],
  ["camera-copy.ts", cameraCopy],
  ["i18n.ts", i18n, ["T"]],
  ["experience.ts", experience],
  ["product.ts", product],
];

function moduleCopy(): Copy[] {
  const out: Copy[] = [];
  for (const [file, mod, only] of COPY_MODULES) {
    for (const [name, value] of Object.entries(mod)) {
      if (only && !only.includes(name)) continue;
      if (typeof value === "function") {
        if (!COPY_FUNCTIONS.has(name)) continue;
        for (const lang of ["ar", "en"] as const) walk(value(lang), `${file} ${name}("${lang}")`, out);
      } else {
        walk(value, `${file} ${name}`, out);
      }
    }
  }
  for (const e of EXERCISES) {
    walk({ name: e.name, description: e.description, camera: e.camera }, `defs.ts ${e.id}`, out);
  }
  return out;
}

/* ------------------------------------------------------------ source scan */

/** JSX attributes whose value is never read as copy. */
const NON_COPY_ATTRIBUTES = new Set([
  "className",
  "class",
  "style",
  "id",
  "key",
  "href",
  "src",
  "srcSet",
  "sizes",
  "type",
  "rel",
  "role",
  "htmlFor",
  "name",
  "value",
  "inputMode",
  "autoComplete",
  "pattern",
  "accept",
  "capture",
  "lang",
  "dir",
  "d",
  "points",
  "transform",
  "viewBox",
  "fill",
  "stroke",
  "xmlns",
  "preserveAspectRatio",
  "gradientTransform",
  "clipPath",
  "mask",
  "filter",
]);

/**
 * Style values: object keys (style objects built outside JSX) and SVG or CSS presentation attributes
 * whose values can hold several words with hyphens, such as "Cairo, sans-serif" or "opacity 0.2s
 * ease-in-out". Short keys such as left, right, top or color are deliberately absent: copy objects
 * use them as keys (for example copy.left = "Left side weakness").
 */
const STYLE_KEY =
  /^(font|fontFamily|transition\w*|animation\w*|background\w*|grid\w*|boxShadow|textShadow|mask\w*|clipPath|backdropFilter|transform\w*|border\w*|outline\w*|willChange)$/;
const PRESENTATION_ATTRIBUTE =
  /^(font\w*|stroke\w*|text[A-Z]\w*|dominant\w*|marker\w*|stop\w*|letterSpacing|wordSpacing)$/;

/** Variables and properties that hold CSS class lists, such as cls, className or cardClass. */
const CLASS_NAME = /^(cls|classes|className)$|Class(es|Name)?$/;

/** Calls whose string arguments are selectors, queries, keys or developer text. */
const NON_COPY_CALL =
  /^(querySelector|querySelectorAll|closest|matches|matchMedia|setProperty|getPropertyValue|removeProperty|add|remove|toggle|contains|replace|addEventListener|removeEventListener|fetch|api|getItem|setItem|removeItem|DateTimeFormat|NumberFormat|RegExp|log|warn|error|info|debug|createElement|setAttribute|getAttribute|postMessage)$/;

function propertyName(name: tsModule.PropertyName): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name) ? name.text : "";
}

function calleeName(expr: tsModule.Expression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return "";
}

function skippedByContext(node: tsModule.Node): boolean {
  for (let n: tsModule.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return true;
    if (ts.isJsxAttribute(n)) {
      const name = n.name.getText();
      return NON_COPY_ATTRIBUTES.has(name) || PRESENTATION_ATTRIBUTE.test(name) || STYLE_KEY.test(name);
    }
    if (ts.isPropertyAssignment(n)) {
      const name = propertyName(n.name);
      if (STYLE_KEY.test(name) || CLASS_NAME.test(name)) return true;
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && CLASS_NAME.test(n.name.text)) return true;
    if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && NON_COPY_CALL.test(calleeName(n.expression))) {
      return true;
    }
    if (ts.isSourceFile(n)) return false;
  }
  return false;
}

function sourceCopy(file: string): Copy[] {
  const text = readFileSync(join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Copy[] = [];
  const add = (node: tsModule.Node, value: string, needsSpace: boolean) => {
    const v = value.replace(/\s+/g, " ").trim();
    if (!HAS_LETTER.test(v)) return;
    if (needsSpace && !/\s/.test(value)) return;
    if (skippedByContext(node)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    out.push({ where: `${file}:${line}`, text: v });
  };
  const visit = (node: tsModule.Node) => {
    if (ts.isJsxText(node)) add(node, node.text, false);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text, true);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      add(node, node.text, true);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const SOURCE_FILES = [
  ...readdirSync(join(ROOT, "src/app"))
    .filter((f) => f.endsWith(".tsx"))
    .sort()
    .map((f) => `src/app/${f}`),
  ...COPY_MODULES.map(([file]) => `src/app/${file}`),
];

/* ------------------------------------------------------------------- tests */

function violations(copy: Copy[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of copy) {
    const problems = wordingProblems(c.text);
    const line = `${c.where} [${problems.join(", ")}] ${JSON.stringify(c.text)}`;
    if (problems.length && !seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

describe("wording detector", () => {
  it("flags dash characters, hyphens inside words, spaced hyphens and the forbidden phrase", () => {
    expect(wordingProblems("Face the camera, 1\u20132 m away")).toContain("dash character");
    expect(wordingProblems("Calm \u2014 steady")).toContain("dash character");
    expect(wordingProblems("\u22125")).toContain("dash character");
    expect(wordingProblems("Left-side weakness")).toContain("hyphen between letters");
    expect(wordingProblems("قبل-بعد")).toContain("hyphen between letters");
    expect(wordingProblems("Before - after")).toContain("spaced hyphen");
    expect(wordingProblems("خطة تناسب حالتك الصحية")).toContain("حالتك الصحية");
    expect(wordingProblems("خطة تناسب حَالَتَكَ الصِّحِّيَّة")).toContain("حالتك الصحية");
  });
  it("accepts plain wording", () => {
    expect(wordingProblems("Face the camera, 1 to 2 m away")).toEqual([]);
    expect(wordingProblems("خطة تناسب حالتك الطبية")).toEqual([]);
    expect(wordingProblems("Left side weakness, 10 reps")).toEqual([]);
  });
  it("skips values that are not copy", () => {
    for (const s of [
      "sit_to_stand",
      "azm.coach",
      "ar-SA",
      "/illustrations/chair-press.png",
      "https://a.b/c-d",
    ]) {
      expect(isCopyValue(s)).toBe(false);
    }
    expect(isCopyValue("Arabic first")).toBe(true);
    expect(isCopyValue("حركة")).toBe(true);
  });
});

describe("user facing copy", () => {
  it("reads every copy source", () => {
    expect(voiceCopy().length).toBeGreaterThan(50);
    expect(libraryCopy().length).toBeGreaterThan(200);
    expect(moduleCopy().length).toBeGreaterThan(300);
    for (const file of SOURCE_FILES) expect(existsSync(join(ROOT, file)), file).toBe(true);
    expect(SOURCE_FILES.map((f) => basename(f))).toContain("Landing.tsx");
    expect(sourceCopy("src/app/Landing.tsx").length).toBeGreaterThan(20);
    expect(SOURCE_FILES.some((f) => f.includes("weekly"))).toBe(false);
  });
  it("has no dashes and never says حالتك الصحية (src/i18n JSON)", () => {
    expect(violations(i18nJsonCopy())).toEqual([]);
  });
  it("has no dashes and never says حالتك الصحية (voice script)", () => {
    expect(violations(voiceCopy())).toEqual([]);
  });
  it("has no dashes and never says حالتك الصحية (exercise library)", () => {
    expect(violations(libraryCopy())).toEqual([]);
  });
  it("has no dashes and never says حالتك الصحية (exported copy modules)", () => {
    expect(violations(moduleCopy())).toEqual([]);
  });
  it("has no dashes and never says حالتك الصحية (screens and copy module source)", () => {
    expect(violations(SOURCE_FILES.flatMap(sourceCopy))).toEqual([]);
  });
});
