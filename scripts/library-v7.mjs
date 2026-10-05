// The v7 library data (product v7 contract 1.2 and 2.10, stream E, step E1). Reads the runtime
// targets data, src/movements/targets/targets-v7.json (exported from the clinical source, C-1), and
// writes into src/exercises/library.json:
//   - every existing entry: the positions, targets and pain friendly tag of its libraryTags row, and
//     nothing else (the rows' proposed changes stay proposals, 2.10 rule 2);
//   - every new exercise (newExercises), after the existing entries, with its status (draft until
//     the sign off and the Arabic review, D-025): the library fields and the v7 fields of
//     LibraryExercise. Its other fields (props, cautions, textSource with the NIA credit, painVariant,
//     raisedSeatVariant, requiresMobility) stay in the targets data under the same id.
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

const tagged = library.map((e) => {
  const t = tags.get(e.id);
  if (!t) return e;
  const { positions: _p, targets: _t, painFriendly: _f, ...rest } = e;
  return { ...rest, positions: t.positions, targets: t.targets, painFriendly: t.painFriendly };
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
const entryOf = (n) => Object.fromEntries(FIELDS.filter((k) => n[k] !== undefined).map((k) => [k, n[k]]));
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
