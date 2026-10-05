// The v7 library data (product v7 contract 1.2 and 2.10, stream E, step E1). Reads the runtime
// targets data, src/movements/targets/targets-v7.json (exported from the clinical source, C-1), and
// writes into src/exercises/library.json:
//   - every existing entry: the positions, targets and pain friendly tag of its libraryTags row, and
//     the contraindication ids the row adds (proposed.addContraindications, approved with the sign
//     off, D-025) in their own field, v7Contraindications, which libraryPool reads only for an intake
//     with the v7 fields, so v1 pools stay unchanged (2.10 rule 2, D-026 item 9); the rows' other
//     proposals (muscles, osteoporosis cautions) stay proposals;
//   - every new exercise (newExercises), after the existing entries, with its status (draft until
//     the sign off and the Arabic review, D-025): the library fields and the v7 fields of
//     LibraryExercise, with its cautions and the NIA credit line of an adapted text (textSource.credit),
//     which the guided card shows with the exercise in both languages (E1-8, D-026 item 9). Its other
//     fields (props, textSource, painVariant, raisedSeatVariant, requiresMobility) stay in the targets
//     data under the same id.
// Idempotent. tests/v7/e-library.test.ts checks the library against the targets data both ways.
//   node scripts/library-v7.mjs            write the library
//   node scripts/library-v7.mjs --check    exit 1 when the library is not what the data gives
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const at = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const LIBRARY = at("src/exercises/library.json");
const TARGETS = at("src/movements/targets/targets-v7.json");

const text = readFileSync(LIBRARY, "utf8");
const library = JSON.parse(text);
const data = JSON.parse(readFileSync(TARGETS, "utf8"));

const ids = new Set(library.map((e) => e.id));
for (const t of data.libraryTags)
  if (!ids.has(t.id)) throw new Error(`libraryTags names no library entry: ${t.id}`);
const tags = new Map(data.libraryTags.map((t) => [t.id, t]));
// The vocabulary's ids (a region template stands for its ids, never named by a row).
const vocabulary = new Set(data.contraindicationVocabulary.map((v) => v.id));

/** The ids a row adds: addContraindications and addContraindication, a note in brackets dropped. */
function addedIds(t) {
  const p = t.proposed ?? {};
  const ids = [...(p.addContraindications ?? []), ...(p.addContraindication ? [p.addContraindication] : [])];
  const out = [...new Set(ids.map((id) => id.replace(/\s*\(.*\)$/, "")))];
  for (const id of out) if (!vocabulary.has(id)) throw new Error(`libraryTags ${t.id} adds an unknown id: ${id}`);
  return out;
}

const tagged = library.map((e) => {
  const t = tags.get(e.id);
  if (!t) return e;
  const { positions: _p, targets: _t, painFriendly: _f, v7Contraindications: _c, ...rest } = e;
  const added = addedIds(t);
  return {
    ...rest,
    positions: t.positions,
    targets: t.targets,
    painFriendly: t.painFriendly,
    ...(added.length ? { v7Contraindications: added } : {}),
  };
});

// The fields of LibraryExercise (src/medical/pool.ts) and LibraryExerciseV7Fields, in this order.
const FIELDS = [
  "id",
  "name",
  "description",
  "category",
  "muscles",
  "equipment",
  "difficulty",
  "minutes",
  "steps",
  "tags",
  "demands",
  "contraindications",
  "status",
  "positions",
  "targets",
  "painFriendly",
  "dose",
  "hipEndRange",
];
const entryOf = (n) => ({
  ...Object.fromEntries(FIELDS.filter((k) => n[k] !== undefined).map((k) => [k, n[k]])),
  ...(n.cautions ? { cautions: n.cautions } : {}),
  ...(n.textSource?.credit ? { credit: n.textSource.credit } : {}),
});
const fresh = new Map(data.newExercises.map((n) => [n.id, entryOf(n)]));
for (const id of fresh.keys()) if (tags.has(id)) throw new Error(`a new exercise is already tagged: ${id}`);
const out = [...tagged.filter((e) => !fresh.has(e.id)), ...fresh.values()];

const next = JSON.stringify(out, null, 1) + "\n";
if (process.argv.includes("--check")) {
  if (next !== text) {
    console.error("src/exercises/library.json is not what the targets data gives: run node scripts/library-v7.mjs");
    process.exit(1);
  }
} else if (next !== text) {
  writeFileSync(LIBRARY, next);
  console.log(`library.json: ${out.length} entries, ${tags.size} tagged, ${fresh.size} new`);
} else console.log("library.json is up to date");
