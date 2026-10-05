/**
 * The stroke survivors' rule hits for the clinical review (product v7 contract 8.3, step C2): the 10
 * Van Criekinge stroke walkers through the engine and the rules as a person with a stroke on the
 * dataset's paretic side, with no pass bar. With AZM_GAIT_REPORT set to a file path the run writes
 * the report there (C2 writes /Users/nasser/Development/Azm6.0/local-docs/qa/v7/gait-stroke-hits.md),
 * with the able bodied walkers' hits and the front views' contact timing beside it:
 *
 *   AZM_GAIT_REPORT=/Users/nasser/Development/Azm6.0/local-docs/qa/v7/gait-stroke-hits.md \
 *     npx vitest run tests/v7/c-mocap-report.test.ts
 */
import { writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { autoFillRegions } from "../../src/medical/body-map";
import { gaitPatternShown } from "../../src/medical/gait-rules";
import type { GaitPatternResult, GaitSupportFinding } from "../../src/medical/gait-types";
import { eventErrors, median } from "./c-acceptance-helpers";
import { HEALTHY_HITS, mocapAge, runAll, rulesForWalker, type MocapRun } from "./c-mocap-run";

/** The c3d files carry no age or sex for the stroke walkers: the norm lookups read a 60 year old man. */
const STROKE_NORM_PERSON = { age: 60, sex: "male" as const };

interface StrokeRow {
  id: string;
  /** The leg whose knee bends less in swing in the dataset's angles: the stroke side the person is given. */
  weaker: "left" | "right";
  workbookP: "left" | "right";
  knees: Record<"left" | "right", number>;
  speed: number;
  cadence: number | null;
  gates: string;
  fired: GaitPatternResult[];
  notAssessed: GaitPatternResult[];
  findings: GaitSupportFinding[];
}

let runs: Map<string, MocapRun>;
let rows: StrokeRow[];
beforeAll(() => {
  runs = runAll();
  rows = [...runs.values()]
    .filter((r) => r.fx.subject.group === "stroke")
    .map((run) => {
      const s = run.fx.subject;
      const weaker = s.stifferKneeSide!;
      const out = rulesForWalker(run, {
        ...STROKE_NORM_PERSON,
        conditions: ["stroke"],
        regions: autoFillRegions([{ condition: "stroke", weakerSide: weaker }]),
        walking: { status: "without_aid" },
      });
      const speeds = run.fx.passes.map((p) => p.speedMps);
      return {
        id: run.fx.id,
        weaker,
        workbookP: s.workbookPside!,
        knees: s.kneeSwingPeakDeg!,
        speed: speeds.reduce((a, b) => a + b, 0) / speeds.length,
        cadence: run.views.find((v) => v.view === "side")?.result.metrics.cadence?.value ?? null,
        gates: run.views
          .map((v) => {
            const q = v.result.quality;
            return `${v.view} ${q.cleanCycles.left}/${q.cleanCycles.right}${q.gatePassed ? " passed" : ""}`;
          })
          .join(", "),
        fired: out.patterns.filter((p) => p.status === "possible" || p.status === "likely"),
        notAssessed: out.patterns.filter((p) => p.status === "not_assessed"),
        findings: out.findings,
      };
    });
});

describe("the stroke survivors through the gait rules", () => {
  it("reads every stroke walker into the 11 patterns, with no pass bar", () => {
    expect(rows).toHaveLength(10);
    for (const r of rows) {
      const ids = new Set([...r.fired, ...r.notAssessed].map((p) => p.pattern));
      expect(ids.size, r.id).toBeLessThanOrEqual(11);
      expect(r.cadence, r.id).not.toBeNull();
    }
    const report = process.env.AZM_GAIT_REPORT;
    if (report) writeFileSync(report, reportOf(rows, runs));
  });
});

const fmtResult = (p: GaitPatternResult, weaker: "left" | "right") =>
  `${p.pattern}${p.label !== p.pattern ? ` (${p.label})` : ""}, ${p.side}${
    p.side === weaker ? " (stiffer knee)" : p.side === "both" ? "" : " (other leg)"
  }, ${p.status}, confidence ${p.confidence ?? "none"}${gaitPatternShown(p) ? "" : " (not shown)"}`;

function reportOf(rows: StrokeRow[], runs: Map<string, MocapRun>): string {
  const lines: string[] = [];
  lines.push("# Gait rules on stroke survivors' walks (projected motion capture)");
  lines.push("");
  lines.push(
    `Written by \`tests/v7/c-mocap-report.test.ts\` (v7 step C2, contract 8.3), ${new Date().toISOString().slice(0, 10)}. No pass threshold: for the clinical review of gait-rules 5 (GAIT-Q3, Q9, Q12).`,
  );
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push(
    "- Walkers: the 10 stroke survivors of `tests/fixtures/gait/mocap` (Van Criekinge et al. 2023, figshare CC0), 3 overground passes each, both walking directions, the dataset's own events.",
  );
  lines.push(
    '- Which leg is paretic: the dataset\'s stroke workbook labels a "P" (paretic) side, found here by matching its curves to each walker\'s knees. In 40 of its 50 walkers the "P" leg is the one whose knee bends more in swing and whose hip extends further, the opposite of the usual picture after a stroke (its "P" may name the lesion\'s side; the article gives lesion location L/R 17/33). This report gives both: the workbook\'s "P" side and the leg whose knee bends less in the dataset\'s own Plug-in Gait angles (the stiffer knee), and runs the rules for a stroke on the stiffer knee\'s side.',
  );
  lines.push(
    "- Views: overground front, back and side (`mocapWalk`, seed 7, landmark noise 0.002), each through `analyseGaitView`, then `combineViews` and `evaluateGait` as A's gait route runs them.",
  );
  lines.push(
    `- Person: a stroke on the stiffer knee's side (conditions stroke, the body map the stroke questions fill for that side), walking without an aid, the dataset's height. The c3d files hold no age or sex for these walkers: the norm lookups (short steps, slow speed) read a ${STROKE_NORM_PERSON.age} year old man.`,
  );
  lines.push(
    "- A pattern needs its view group's gate (6 clean cycles a side): three passes of 4 to 5 m give the side view 3 to 9 a side and the front and back views 1 to 4, so the frontal patterns are mostly not assessed here.",
  );
  lines.push("");
  lines.push("## Results per walker");
  lines.push("");
  lines.push(
    "| Walker | Workbook P | Knee swing peak L/R (stiffer) | Speed (m/s) | Cadence | Gates (clean cycles left/right) | Fired | Not assessed | Findings |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    const fired = r.fired.map((p) => fmtResult(p, r.weaker)).join("; ") || "none";
    const na =
      [...new Set(r.notAssessed.map((p) => `${p.pattern} (${p.notAssessed ?? ""})`))].join("; ") || "none";
    const findings =
      r.findings.map((f) => `${f.id}${f.side && f.side !== "none" ? ` ${f.side}` : ""}`).join("; ") || "none";
    lines.push(
      `| \`${r.id}\` | ${r.workbookP} | ${r.knees.left}/${r.knees.right} (${r.weaker}) | ${r.speed.toFixed(2)} | ${r.cadence?.toFixed(0) ?? ""} | ${r.gates} | ${fired} | ${na} | ${findings} |`,
    );
  }
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  const count = new Map<string, { weaker: number; workbookP: number; both: number; n: number }>();
  for (const r of rows)
    for (const p of r.fired) {
      const c = count.get(p.pattern) ?? { weaker: 0, workbookP: 0, both: 0, n: 0 };
      c.n++;
      if (p.side === "both") c.both++;
      else {
        if (p.side === r.weaker) c.weaker++;
        if (p.side === r.workbookP) c.workbookP++;
      }
      count.set(p.pattern, c);
    }
  if (!count.size) lines.push("No rule fired.");
  for (const [id, c] of [...count.entries()].sort())
    lines.push(
      `- ${id}: ${c.n} result${c.n === 1 ? "" : "s"}; ${c.weaker} on the stiffer knee's leg, ${c.workbookP} on the workbook's "P" leg, ${c.both} on both.`,
    );
  const assessed = rows.filter((r) => r.fired.length + r.notAssessed.length < 11 || r.fired.length).length;
  lines.push(
    `- Walkers with at least one pattern read (not all not assessed): ${assessed} of ${rows.length}.`,
  );
  lines.push("");
  lines.push("## For comparison: the able bodied walkers");
  lines.push("");
  lines.push(
    "The same run on the 20 able bodied Van Criekinge walkers and the 30 Fukuchi treadmill walks (a person with no condition and no body map entry) fires on five, each confirmed by the dataset's own joint angles (`HEALTHY_HITS` in `tests/v7/c-mocap-run.ts`):",
  );
  lines.push("");
  for (const [id, hits] of Object.entries(HEALTHY_HITS)) {
    const run = runs.get(id)!;
    lines.push(
      `- \`${id}\` (${run.fx.subject.sex ?? ""}, ${run.fx.subject.heightCm} cm, age ${mocapAge(run.fx)}${run.fx.subject.ageYears ? "" : " from the decade of birth"}, ${run.fx.passes[0].speedMps} m/s): ${hits.join(", ")}.`,
    );
  }
  lines.push("");
  lines.push("## Front view contact timing (CG-2)");
  lines.push("");
  lines.push(
    "The front views' initial contacts (the Stenum 2024 vertical ankle distance) against the datasets' events, as a share of the stride (median over every contact found):",
  );
  lines.push("");
  const lag: Record<string, number[]> = { front: [], back: [], pad_front: [] };
  const lagMs: Record<string, number[]> = { front: [], back: [], pad_front: [] };
  for (const run of runs.values())
    for (const v of run.views) {
      if (!(v.view in lag)) continue;
      const stride = (120 / v.walk.truth.cadence) * 1000;
      const ics = v.result.events.filter((e) => e.type === "ic");
      for (const e of eventErrors(v.walk.truth, ics).filter(Number.isFinite)) {
        lag[v.view].push(e / stride);
        lagMs[v.view].push(e);
      }
    }
  for (const [k, xs] of Object.entries(lag))
    lines.push(
      `- ${k === "front" ? "Walking toward the phone" : k === "back" ? "Walking away" : "The pad from the front"}: ${((median(xs) ?? 0) * 100).toFixed(1)}% of the stride (${(median(lagMs[k]) ?? 0).toFixed(0)} ms), ${xs.length} contacts.`,
    );
  lines.push("");
  return lines.join("\n");
}
