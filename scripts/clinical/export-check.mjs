/**
 * Writes the runtime movement check data (architecture contract v2, section A).
 *
 *   node scripts/clinical/export-check.mjs [path to the clinical JSON]
 *
 * The input is the clinical source of truth, local-docs/clinical/movement-check-v1.json by default
 * (git ignored). The output, src/movements/check-v1.json, is committed and is the app's source of
 * truth. It keeps exactly the runtime sections of the contract and drops the review material:
 * references, reviewLog, laterBattery and dataMap, plus every sources, noiseBandBasis and note field
 * at any depth. Prose rule fields stay, they document the item.
 *
 * Exits with 1, and writes nothing, when a kept section is missing, when the input has a top level
 * section this script does not know (so a new section is never dropped silently), or when any
 * string breaks the wording rules (scripts/wording-rules.mjs, the same rules as the wording test).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dataViolations } from "../wording-rules.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_INPUT = join(ROOT, "local-docs/clinical/movement-check-v1.json");
const OUTPUT = join(ROOT, "src/movements/check-v1.json");

/** Top level sections kept, in this order (contract v2, section A). */
export const KEEP = [
  "id",
  "version",
  "status",
  "signoff",
  "boundary",
  "areas",
  "surgeryAreas",
  "engine",
  "precheck",
  "betweenTests",
  "afterCheck",
  "stopRouting",
  "locks",
  "screens",
  "pausedWhenTokens",
  "reasons",
  "postponeReasons",
  "tests",
  "progress",
  "cues",
  "selection",
];

/**
 * Top level sections that are known and not kept. The contract names references, reviewLog,
 * laterBattery and dataMap; note is dropped at every depth. The document date is not in the keep
 * list either (the sign off date lives in signoff.date).
 */
// SPEC-GAP: export-date. The top level date is in neither list of the contract; it is dropped because
// only the kept sections are written.
export const DROP_TOP = ["references", "reviewLog", "laterBattery", "dataMap", "note", "date"];

/** Fields dropped at any depth. */
// SPEC-GAP: dropped-notes. Some note fields state rules (for example pc_sci_level: warn_sci_t6 before
// every test; pc_sci_ad_since: yes_cleared stores changeCleared). They are dropped as the contract
// says; the code that implements them must follow the clinical spec, not this runtime subset.
export const DROP_ANYWHERE = ["sources", "noiseBandBasis", "note"];

function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!DROP_ANYWHERE.includes(k)) out[k] = strip(v);
    return out;
  }
  return value;
}

/** Builds the runtime subset. Returns { data } or { errors }. */
export function exportCheck(source) {
  const errors = [];
  if (!source || typeof source !== "object" || Array.isArray(source))
    return { errors: ["input is not an object"] };
  for (const key of KEEP) if (!(key in source)) errors.push(`missing section ${key}`);
  for (const key of Object.keys(source))
    if (!KEEP.includes(key) && !DROP_TOP.includes(key))
      errors.push(`unknown top level section ${key}: add it to KEEP or DROP_TOP in export-check.mjs`);
  if (errors.length) return { errors };
  const data = {};
  for (const key of KEEP) data[key] = strip(source[key]);
  const wording = dataViolations(data, "check-v1.json");
  if (wording.length) return { errors: wording.map((w) => `wording: ${w}`) };
  return { data };
}

function main() {
  const input = resolve(process.argv[2] ?? DEFAULT_INPUT);
  let source;
  try {
    source = JSON.parse(readFileSync(input, "utf8"));
  } catch (e) {
    console.error(`Cannot read ${input}: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  const { data, errors } = exportCheck(source);
  if (errors) {
    console.error(`Not exported (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  const text = JSON.stringify(data, null, 2) + "\n";
  writeFileSync(OUTPUT, text);
  console.log(
    `Wrote ${relative(ROOT, OUTPUT)}: ${Buffer.byteLength(text)} bytes, ${data.tests.length} tests, ` +
      `${data.precheck.length} pre-check items, ${data.cues.length} cues, ` +
      `${Object.keys(data.screens).length} screens, ${Object.keys(data.reasons).length} reasons`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
