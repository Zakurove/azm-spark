/**
 * The live spike suite (product v7 contract 8.6; DG-2, D-026 item 1, D-027 item 7):
 *
 *   npm run spike:live                          every probe: lock, answers, context, dose, press
 *   npm run spike:live -- --probes lock,dose    some probes
 *   npm run spike:live -- --budget 0.5          stop starting probes past this many dollars (default 1)
 *   npm run spike:live -- --plan                list the probes and exit (no key, no network)
 *   npm run spike:live -- --check               build the suite on the production modules and exit (no network)
 *
 * It needs GEMINI_API_KEY (the npm script reads .env.local; the key is never printed), spends real
 * credits and never runs in CI. It bundles scripts/spike-live/suite.ts with esbuild, so every probe runs
 * the production token body, instruction, history, tools and D3's transport. Results, the spend ledger
 * and the synthetic voices go to local-docs/research/v7/live-spike-data/runs (git ignored). The exit
 * code is the number of probes that did not pass.
 */
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
export const PROBES = ["lock", "answers", "context", "dose", "press"];
export const PLAN = {
  lock: "a client setup cannot replace the locked instruction or add a tool (S0 02b-lock A and B)",
  answers: "the Arabic and English yes, not yet, hurts and pain answers spoken: tool calls, setupComplete, event to first audio",
  context: "silent P3 lines start no reply and reach the next turn; a P0 interrupts; usage grows (S0 06-context)",
  dose: "spoken dose change prompts in a workout: the coach declines and calls no tool (5.3 rule 3, S0 10-dose)",
  press: "D-036 item 2: spoken ready, let's go, next and again call next_step with their intent, after their transcription; own calls counted",
};

/** The command line: --probes a,b, --budget n, --plan, --check. Unknown probes or numbers exit 2. */
export function parseArgs(argv) {
  const value = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const probes = (value("--probes") ?? PROBES.join(",")).split(",").filter(Boolean);
  const unknown = probes.filter((p) => !PROBES.includes(p));
  const budget = Number(value("--budget") ?? 1);
  return {
    probes,
    budgetUsd: budget,
    plan: argv.includes("--plan"),
    check: argv.includes("--check"),
    error: unknown.length
      ? `unknown probe: ${unknown.join(", ")}`
      : !Number.isFinite(budget) || budget <= 0
        ? "--budget needs a positive number of dollars"
        : null,
  };
}

/** Builds the suite into node_modules/.cache (so it resolves the repository's packages) and imports it. */
async function loadSuite() {
  const outfile = join(ROOT, "node_modules", ".cache", "azm-spike-live", "suite.mjs");
  await build({
    entryPoints: [join(HERE, "suite.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    outfile,
    logLevel: "silent",
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    process.exit(2);
  }
  if (args.plan) {
    for (const p of args.probes) console.log(`${p}: ${PLAN[p]}`);
    return;
  }
  const key = (process.env.GEMINI_API_KEY ?? "").trim();
  if (!key && !args.check) {
    console.error("GEMINI_API_KEY is not set: the live spike needs it, and it never runs in CI.");
    process.exit(2);
  }
  const suite = await loadSuite();
  if (args.check) {
    console.log(`suite built: ${suite.PROBES.join(", ")}`);
    return;
  }
  const out = join(ROOT, "local-docs", "research", "v7", "live-spike-data", "runs");
  mkdirSync(out, { recursive: true });
  const failed = await suite.runSuite({ key, probes: args.probes, out, budgetUsd: args.budgetUsd });
  process.exit(failed);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
