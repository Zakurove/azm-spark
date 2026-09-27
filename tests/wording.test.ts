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
 *   5. Data modules: every .ts file under src/movements is imported and its exported values are
 *      walked the same way (test names, purpose, steps and safety, even when computed). An export
 *      that is the whole content of a JSON file under src/movements (CHECK_DATA) is read by 7.
 *   6. Source text of EVERY .ts and .tsx file under src, found by walking the folder (so
 *      src/features/**, src/i18n/index.ts and any new screen are read the moment they exist),
 *      minus EXCLUDED_SOURCES, where each exclusion carries its reason and no screen (.tsx) may be
 *      listed. Read are JSX text, and string or template literal pieces that contain whitespace,
 *      or a capital or Arabic letter, or that are rendered as a JSX child ({ok ? "a" : "b"}).
 *   7. Clinical data: every JSON file under src/movements (check-v1.json), every string value at
 *      any depth. Strings under an ar, en or arTts key are user facing and get every rule. The
 *      other strings are English engineering prose (rule, definition, when, ...) that is never
 *      shown, and get the rules that hold for any string: no dash character and never the phrase
 *      (a hyphen in prose such as "pre-check" or "ar-SA" passes). scripts/clinical/export-check.mjs
 *      applies the same rules (scripts/wording-rules.mjs) before it writes the file.
 *
 * Every string, with or without letters, is checked for dash characters (a): they are never
 * legitimate in copy, so "\u22125" or "1\u20132" fail wherever they appear. The hyphen-minus
 * rules (b) and the phrase (c) only apply to strings with letters.
 *
 * Heuristics that keep false positives near zero
 *   - Values from the data sources (1 to 5, and the user facing strings of 7) are copy by
 *     construction. Only values that are clearly not copy are skipped: URLs, emails, paths, locale
 *     tags, and lowercase ids or keys without spaces (for example "full", "azm.coach",
 *     "sit_to_stand").
 *   - In source text (6), single words that are URLs, emails, paths or locale tags are skipped, and
 *     so are object keys, member names, element access keys and string literal types. Literals
 *     are skipped when they sit inside an attribute that never holds copy (className, style, d,
 *     href, key, ...) or an SVG presentation attribute (fontFamily, stroke..., textAnchor, ...),
 *     inside a style object property whose value can hold hyphenated CSS words (fontFamily,
 *     transition, animation, background, grid, ...), inside a variable or property that holds
 *     class names (cls, className, cardClass, ...), or inside an import or export. A literal
 *     passed DIRECTLY as an argument to a call that never takes copy (querySelector, matchMedia,
 *     fetch, api, storage, Intl, RegExp, console, and add, remove, toggle, contains or replace on
 *     a classList) is skipped; the receiver of a call ("Rep {n}".replace(...)) and anything
 *     deeper, such as a callback body, is still read.
 *   - The sanitisers in src/medical/weekly.ts and server/weekly-ai.ts, which mention
 *     "حالتك الصحية" in order to replace or forbid it, do so with regex literals (weekly.ts) or
 *     live outside src (weekly-ai.ts), so they are never part of the scan.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import * as tsModule from "typescript";
import voiceScript from "../src/app/voice-script.json";
import library from "../src/exercises/library.json";
import * as platformCopy from "../src/app/platform-copy";
import * as cameraCopy from "../src/app/camera-copy";
import * as i18n from "../src/app/i18n";
import * as experience from "../src/app/experience";
import * as product from "../src/app/product";
import { EXERCISES } from "../src/exercises/defs";
import {
  DASH_CHARS,
  EMAIL,
  HAS_LETTER,
  LOCALE,
  PATH,
  URL_LIKE,
  dataStringProblems,
  dataStrings,
  isCopyValue,
  wordingProblems,
} from "../scripts/wording-rules.mjs";

const ts: typeof tsModule = (tsModule as unknown as { default?: typeof tsModule }).default ?? tsModule;

const ROOT = join(__dirname, "..");
/** A piece of copy. prose: engineering prose from clinical data, checked only for dashes and the phrase. */
type Copy = { where: string; text: string; prose?: boolean };

/* ------------------------------------------- detector and value level filters */

// The detector (rules a to c above) and the value filters live in scripts/wording-rules.mjs, so the
// scripts that write copy into src (scripts/clinical/export-check.mjs) apply exactly these rules.

function walk(value: unknown, where: string, out: Copy[]) {
  if (typeof value === "string") {
    // Dash characters are never legitimate in copy, so any string holding one is checked.
    if (isCopyValue(value) || DASH_CHARS.test(value)) out.push({ where, text: value });
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

function i18nJsonCopy(root = ROOT): Copy[] {
  const out: Copy[] = [];
  for (const file of jsonFiles(join(root, "src/i18n"))) {
    walk(JSON.parse(readFileSync(file, "utf8")), relative(root, file), out);
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

/**
 * Calls whose direct string arguments are selectors, queries, storage keys, locales, patterns or
 * developer text. Only a literal passed straight to the call is skipped (through parentheses, +,
 * templates and ?: branches). A string that is the receiver of a call, as in
 * "Rep {n}".replace("{n}", n), or that sits deeper, such as inside a callback, is still read.
 */
const NON_COPY_CALL =
  /^(querySelector|querySelectorAll|closest|matches|matchMedia|setProperty|getPropertyValue|removeProperty|addEventListener|removeEventListener|fetch|api|getItem|setItem|removeItem|DateTimeFormat|NumberFormat|RegExp|log|warn|error|info|debug|createElement|setAttribute|getAttribute|postMessage)$/;
/** Methods whose arguments are class names, but only when they are called on a classList. */
const CLASS_LIST_CALL = /^(add|remove|toggle|contains|replace)$/;

/** A Latin capital or an Arabic letter: a single word holding one is read as copy. */
const WORD_COPY = /[A-Z\u00C0-\u00DE\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

function propertyName(name: tsModule.PropertyName): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name) ? name.text : "";
}

function calleeName(expr: tsModule.Expression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return "";
}

const PASS_THROUGH_OPERATORS = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

/** The outermost expression a literal's text flows into unchanged: through (), +, templates, ?: and && || ??. */
function valueRoot(node: tsModule.Node): tsModule.Node {
  let n = node;
  for (let p = n.parent; p; n = p, p = n.parent) {
    if (
      ts.isParenthesizedExpression(p) ||
      ts.isTemplateSpan(p) ||
      ts.isTemplateExpression(p) ||
      ts.isAsExpression(p) ||
      ts.isSatisfiesExpression(p)
    )
      continue;
    if (ts.isBinaryExpression(p) && PASS_THROUGH_OPERATORS.has(p.operatorToken.kind)) continue;
    if (ts.isConditionalExpression(p) && p.condition !== n) continue;
    break;
  }
  return n;
}

function isNonCopyArgument(node: tsModule.Node): boolean {
  const root = valueRoot(node);
  const call = root.parent;
  if (!call || !(ts.isCallExpression(call) || ts.isNewExpression(call))) return false;
  if (!call.arguments?.some((a) => a === root)) return false;
  const name = calleeName(call.expression);
  if (NON_COPY_CALL.test(name)) return true;
  return (
    CLASS_LIST_CALL.test(name) &&
    ts.isPropertyAccessExpression(call.expression) &&
    calleeName(call.expression.expression) === "classList"
  );
}

/** True for a literal shown as a JSX child, directly or as a branch: {ok ? "done" : "re-test"}. */
function rendersAsJsxChild(node: tsModule.Node): boolean {
  const holder = valueRoot(node).parent;
  return (
    !!holder &&
    ts.isJsxExpression(holder) &&
    !!holder.parent &&
    (ts.isJsxElement(holder.parent) || ts.isJsxFragment(holder.parent))
  );
}

/** Object keys, member names, element access keys and string literal types are never copy. */
function isNameOrType(node: tsModule.Node): boolean {
  const p = node.parent;
  if (!p) return false;
  if (ts.isLiteralTypeNode(p)) return true;
  if (ts.isElementAccessExpression(p)) return p.argumentExpression === node;
  return (
    (ts.isPropertyAssignment(p) ||
      ts.isPropertySignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isEnumMember(p)) &&
    p.name === node
  );
}

function skippedByContext(node: tsModule.Node): boolean {
  if (isNameOrType(node) || isNonCopyArgument(node)) return true;
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
    if (ts.isSourceFile(n)) return false;
  }
  return false;
}

function sourceCopy(file: string, root = ROOT): Copy[] {
  const text = readFileSync(join(root, file), "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Copy[] = [];
  const add = (node: tsModule.Node, value: string, jsxText: boolean) => {
    const v = value.replace(/\s+/g, " ").trim();
    if (!HAS_LETTER.test(v)) {
      // Letterless pieces such as "\u22125" or "1\u20132" still carry banned dash characters.
      if (!DASH_CHARS.test(v)) return;
    } else if (!jsxText && !/\s/.test(value)) {
      // A single word: copy when it has a capital or Arabic, or when it is rendered as a JSX child.
      if (URL_LIKE.test(v) || EMAIL.test(v) || PATH.test(v) || LOCALE.test(v)) return;
      if (!WORD_COPY.test(v) && !rendersAsJsxChild(node)) return;
    }
    if (skippedByContext(node)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    out.push({ where: `${file}:${line}`, text: v });
  };
  const visit = (node: tsModule.Node) => {
    if (ts.isJsxText(node)) add(node, node.text, true);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      add(node, node.text, false);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      add(node, node.text, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * Source files under src that are never scanned, each with its reason. Every other .ts and .tsx
 * file under src is read, so a new screen, feature folder or copy module is covered the moment it
 * exists. A screen (.tsx) can never be excluded.
 */
const EXCLUDED_SOURCES: Record<string, string> = {
  "src/medical/legacy-config.ts":
    "English clinical reference notes; weekly.ts reads only categories and flags from it, no text reaches a screen",
};

function filesUnder(root: string, dir: string, test: (name: string) => boolean): string[] {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir))
    .sort()
    .flatMap((name) => {
      const rel = `${dir}/${name}`;
      if (statSync(join(root, rel)).isDirectory()) return filesUnder(root, rel, test);
      return test(name) ? [rel] : [];
    });
}
const isSource = (name: string) => /\.tsx?$/.test(name) && !name.endsWith(".d.ts");

function sourceFiles(root = ROOT): string[] {
  return filesUnder(root, "src", isSource).filter((f) => !(f in EXCLUDED_SOURCES));
}
const SOURCE_FILES = sourceFiles();

/**
 * Data modules: every .ts file under these folders is imported and its exported values are walked
 * like the copy modules above, so copy that is computed rather than written as a literal is read
 * too (for example the name, purpose, steps and safety of each movement check test).
 */
const DATA_MODULE_DIRS = ["src/movements"];

/** Parsed content of every clinical data JSON file (source 7). */
function dataJson(root = ROOT): { file: string; data: unknown }[] {
  return DATA_MODULE_DIRS.flatMap((d) => filesUnder(root, d, (name) => name.endsWith(".json"))).map(
    (file) => ({
      file,
      data: JSON.parse(readFileSync(join(root, file), "utf8")),
    }),
  );
}

async function dataModuleCopy(root = ROOT): Promise<Copy[]> {
  const out: Copy[] = [];
  const json = dataJson(root);
  for (const file of DATA_MODULE_DIRS.flatMap((d) => filesUnder(root, d, isSource))) {
    const mod = (await import(pathToFileURL(join(root, file)).href)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === "function") continue;
      // A whole JSON file re-exported as is (CHECK_DATA) is read by source 7, which knows which of
      // its strings are user facing. Anything derived from it is still walked here.
      if (json.some((j) => isDeepStrictEqual(j.data, value))) continue;
      walk(value, `${file} ${name}`, out);
    }
  }
  return out;
}

/**
 * Clinical data (source 7): every string value of every JSON file under src/movements. User facing
 * strings (under ar, en or arTts) are read like any copy value; engineering prose is always read and
 * checked only for dash characters and the phrase.
 */
function dataJsonCopy(root = ROOT): Copy[] {
  return dataJson(root).flatMap(({ file, data }) =>
    dataStrings(data, relative("src/movements", file)).flatMap((s): Copy[] => {
      if (!s.userFacing) return [{ where: s.where, text: s.text, prose: true }];
      return isCopyValue(s.text) || DASH_CHARS.test(s.text) ? [{ where: s.where, text: s.text }] : [];
    }),
  );
}

/* ------------------------------------------------------------------- tests */

function violations(copy: Copy[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of copy) {
    const problems = c.prose
      ? dataStringProblems({ text: c.text, userFacing: false })
      : wordingProblems(c.text);
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
    expect(dataJsonCopy().length).toBeGreaterThan(1000);
    expect(dataJsonCopy().filter((c) => !c.prose).length).toBeGreaterThan(500);
    expect(SOURCE_FILES.map((f) => basename(f))).toContain("Landing.tsx");
    expect(sourceCopy("src/app/Landing.tsx").length).toBeGreaterThan(20);
    // The weekly plan copy is read; its sanitiser matches the forbidden phrase with a regex literal,
    // which is never a string literal and so never part of the scan.
    expect(SOURCE_FILES).toContain("src/medical/weekly.ts");
  });
  it("reads every source file under src except the listed exclusions, and never skips a screen", () => {
    const all = filesUnder(ROOT, "src", isSource);
    for (const file of COPY_MODULES.map(([f]) => `src/app/${f}`)) expect(SOURCE_FILES).toContain(file);
    for (const [file, reason] of Object.entries(EXCLUDED_SOURCES)) {
      expect(all, `${file} is excluded but does not exist`).toContain(file);
      expect(file.endsWith(".tsx"), `${file} is a screen`).toBe(false);
      expect(reason.length).toBeGreaterThan(20);
    }
    expect(all.filter((f) => !SOURCE_FILES.includes(f))).toEqual(Object.keys(EXCLUDED_SOURCES).sort());
    expect(all.filter((f) => f.endsWith(".tsx")).every((f) => SOURCE_FILES.includes(f))).toBe(true);
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
  it("has no dashes and never says حالتك الصحية (clinical data, src/movements JSON)", () => {
    expect(violations(dataJsonCopy())).toEqual([]);
  });
  it("has no dashes and never says حالتك الصحية (data modules such as src/movements)", async () => {
    expect(violations(await dataModuleCopy())).toEqual([]);
  });
  it("has no dashes and never says حالتك الصحية (source of every screen and module under src)", () => {
    expect(violations(SOURCE_FILES.flatMap((f) => sourceCopy(f)))).toEqual([]);
  });
});

describe("collection pipeline (scratch project)", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "azm-wording-"));
    const put = (file: string, text: string) => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    };
    put("src/app/Landing.tsx", "export const Landing = () => <p>Plain words</p>;\n");
    for (const [file] of COPY_MODULES) put(`src/app/${file}`, "export {};\n");
    put(
      "src/features/assessment/CheckFlow.tsx",
      "export const CheckFlow = () => <p>Then \u2014 now, your medical condition: حالتك الصحية</p>;\n",
    );
    put(
      "src/features/progress/ProgressView.tsx",
      [
        "export function ProgressView({ lang, ok }: { lang: string; ok: boolean }) {",
        "  return (",
        '    <div className="is-open">',
        '      <button>{lang === "ar" ? "إعادة الفحص" : "Re-test"}</button>',
        '      <p>{"Rep {n} \u2014 nice".replace("{n}", "1")}</p>',
        '      <span>{"\u22125\u00b0"}</span>',
        '      <em>{ok ? "re-test" : "start"}</em>',
        "    </div>",
        "  );",
        "}",
        'export const headers = { "Content-Type": "application/json" };',
        'export const when = (d: Date) => d.toLocaleDateString("ar-SA");',
        'export const debug = () => console.log("probe \u2014 ignored");',
        'export const cls = (el: Element) => el.classList.add("is-active");',
        "",
      ].join("\n"),
    );
    put(
      "src/movements/check-v9.json",
      JSON.stringify({
        screens: { scr_retry: { ar: "أعد الفحص لاحقًا", en: "Re-check later" } },
        tests: [
          {
            id: "arm_raise",
            rule: "Ask the pre-check first, then use ar-SA digits",
            definition: "Angle – in degrees",
            when: "never says حالتك الصحية",
            name: { ar: "رفع الذراع حسب حالتك الصحية", en: "Arm raise" },
            steps: { ar: ["اجلس"], en: ["Sit — tall", "full"] },
          },
        ],
        cues: [{ id: "check_go", ar: "ابدأ", arTts: "اِبْدَأْ", en: "Go-go" }],
      }),
    );
    put(
      "src/movements/assessments.ts",
      [
        'import data from "./check-v9.json";',
        "export const CHECK_DATA = data;",
        'const words = ["Arm", "curl"];',
        "export const ASSESSMENT_TESTS = [",
        '  { id: "arm_curl_30s", unit: "count", illustration: "/illustrations/arm-curl.png",',
        '    name: { ar: "ثني الذراع", en: words.join("-") }, metric: () => "elbow_left" },',
        "];",
        "",
      ].join("\n"),
    );
    put(
      "src/i18n/en/progress.json",
      JSON.stringify({ delta: "\u22125", title: "Then \u2013 now", unit: "deg" }),
    );
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const flagged = (copy: Copy[]) => violations(copy).map((v) => v.replace(/^.*? \[/, "["));

  it("scans screens anywhere under src, not only src/app", () => {
    const files = sourceFiles(root);
    expect(files).toContain("src/features/assessment/CheckFlow.tsx");
    expect(flagged(sourceCopy("src/features/assessment/CheckFlow.tsx", root))).toEqual([
      '[dash character, حالتك الصحية] "Then \u2014 now, your medical condition: حالتك الصحية"',
    ]);
  });

  it("checks single words, post processed templates and letterless values in source", () => {
    expect(flagged(sourceCopy("src/features/progress/ProgressView.tsx", root))).toEqual([
      '[hyphen between letters] "Re-test"',
      '[dash character] "Rep {n} \u2014 nice"',
      '[dash character] "\u22125\u00b0"',
      '[hyphen between letters] "re-test"',
    ]);
  });

  it("reads computed copy exported by data modules", async () => {
    expect(await dataModuleCopy(root)).toEqual([
      { where: "src/movements/assessments.ts ASSESSMENT_TESTS[0].name.ar", text: "ثني الذراع" },
      { where: "src/movements/assessments.ts ASSESSMENT_TESTS[0].name.en", text: "Arm-curl" },
    ]);
    expect(flagged(await dataModuleCopy(root))).toEqual(['[hyphen between letters] "Arm-curl"']);
  });

  it("reads every string of clinical data JSON, with every rule for user facing strings", () => {
    const copy = dataJsonCopy(root);
    // Prose is always read; user facing lowercase ids such as "full" are not copy.
    expect(copy.map((c) => c.where)).toContain("check-v9.json.tests[0].rule");
    expect(copy.map((c) => c.where)).not.toContain("check-v9.json.tests[0].steps.en[1]");
    expect(flagged(copy)).toEqual([
      '[hyphen between letters] "Re-check later"',
      '[dash character] "Angle – in degrees"',
      '[حالتك الصحية] "never says حالتك الصحية"',
      '[حالتك الصحية] "رفع الذراع حسب حالتك الصحية"',
      '[dash character] "Sit — tall"',
      '[hyphen between letters] "Go-go"',
    ]);
  });

  it("leaves a re-exported clinical data file to the JSON scan", async () => {
    const modules = await dataModuleCopy(root);
    expect(modules.some((c) => c.where.includes("CHECK_DATA"))).toBe(false);
  });

  it("checks letterless values in i18n JSON", () => {
    expect(flagged(i18nJsonCopy(root))).toEqual([
      '[dash character] "\u22125"',
      '[dash character] "Then \u2013 now"',
    ]);
  });
});
