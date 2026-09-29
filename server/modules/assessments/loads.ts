/**
 * The arm curl load across checks (Q5, Q26), from the person's own stored results only:
 *
 *   lastLoads       the load of the current home arm curl series of each arm (S30 re-test form, "Do
 *                   you have the same one as last time?"), or the heavier load the person chose
 *   loadStepOf      the Q26 offer of one load step heavier for a current home series (GET /progress),
 *                   from loadStepOffer with the pain answers after the test (bt_pain_after, kept on the
 *                   result as painAfter) and the grip answer of S29 (gripYes)
 *   nextLoad        the choice of the offer (POST /api/progress/load-step), kept on the latest result
 *                   of that arm as a short text: "same", or the heavier load ("dumbbell:1.5",
 *                   "cuff:1", "bottle:1")
 *
 * Nothing is stored beyond the person's own result rows.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  loadStepOffer,
  type LoadStep,
  type SeriesContext,
  type StoredResult,
} from "../../../src/medical/progress-rules";
import type { CheckContext } from "../../../src/medical/assessment";

export type ArmSide = "left" | "right";

/** A load as S30 and the flow keep it (the flow's CurlLoad). */
export interface CurlLoadView {
  kind: "dumbbell" | "bottle" | "cuff" | "none";
  kg?: number;
  liters?: number;
}

const isArm = (s: string): s is ArmSide => s === "left" || s === "right";

function measured(r: StoredResult): boolean {
  return typeof r.value === "number" && Number.isFinite(r.value);
}

/** The load of a stored arm curl result (its detail), or null when it names none. */
export function loadOfDetail(detail: StoredResult["detail"]): CurlLoadView | null {
  const o = detail.loadObject;
  if (o === "none") return { kind: "none" };
  if ((o === "dumbbell" || o === "cuff") && typeof detail.loadKg === "number")
    return { kind: o, kg: detail.loadKg };
  if (o === "bottle" && typeof detail.loadL === "number") return { kind: "bottle", liters: detail.loadL };
  return null;
}

/** The text form of a load step kept as nextLoad ("dumbbell:1.5", "bottle:1"). */
export function nextLoadText(step: LoadStep): string {
  return step.kind === "bottle" ? `bottle:${step.liters}` : `${step.kind}:${step.kg}`;
}

/** A nextLoad text back as a load, or null ("same" or anything else). */
export function nextLoadOf(text: unknown): CurlLoadView | null {
  if (typeof text !== "string") return null;
  const [kind, amount] = text.split(":");
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  if (kind === "dumbbell" || kind === "cuff") return { kind, kg: n };
  if (kind === "bottle") return { kind, liters: n };
  return null;
}

/** The newest measured home arm curl result of each arm. */
function latestPerArm(results: readonly StoredResult[]): Partial<Record<ArmSide, StoredResult>> {
  const out: Partial<Record<ArmSide, StoredResult>> = {};
  for (const r of results) {
    if (r.testId !== "arm_curl_30s" || r.setting !== "home" || !isArm(r.side) || !measured(r)) continue;
    const had = out[r.side];
    if (!had || r.created >= had.created) out[r.side] = r;
  }
  return out;
}

/**
 * The load each arm used at its last home arm curl (Q5 locked load), or the heavier one the person
 * chose after it (Q26). Null when no home arm curl was measured yet.
 */
export function lastLoads(results: readonly StoredResult[]): Partial<Record<ArmSide, CurlLoadView>> | null {
  const latest = latestPerArm(results);
  const out: Partial<Record<ArmSide, CurlLoadView>> = {};
  for (const side of ["left", "right"] as const) {
    const r = latest[side];
    if (!r) continue;
    const load = nextLoadOf(r.detail.nextLoad) ?? loadOfDetail(r.detail);
    if (load) out[side] = load;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Q26: the heavier load offer of one current home arm curl series, or null. Not offered again once
 * the person answered it (nextLoad on the latest result).
 */
export function loadStepOf(
  series: readonly StoredResult[],
  o: { ctx: SeriesContext; context: CheckContext; lastCheckLasting: boolean },
): { from: LoadStep; to: LoadStep } | null {
  const rows = [...series].sort((a, b) => a.created - b.created);
  const last = rows.filter(measured).pop();
  if (!last || last.testId !== "arm_curl_30s" || last.setting !== "home") return null;
  if (last.detail.nextLoad !== undefined) return null;
  return loadStepOffer(rows, {
    ctx: o.ctx,
    restrictions: o.context.restrictions,
    clearance: o.context.clearance,
    setting: "home",
    lastCheckLasting: o.lastCheckLasting,
    // A check whose pain answer is not known never qualifies (the safe reading of loadStepOffer).
    painAfterMore: rows.map((r) => r.detail.painAfter !== "same"),
    ...(typeof last.detail.gripYes === "boolean" ? { gripYes: last.detail.gripYes } : {}),
  });
}

/** Keeps the pain answer after a test side (bt_pain_after) on that side's result of the check. */
export function keepPainAfter(
  db: DatabaseSync,
  assessmentId: string,
  testId: string,
  side: string,
  answer: string,
): void {
  if (testId !== "arm_curl_30s") return;
  db.prepare(
    "UPDATE assessment_results SET detail=json_set(detail,'$.painAfter',?) WHERE assessment_id=? AND test_id=? AND side=?",
  ).run(answer, assessmentId, testId, side);
}

/** Keeps the Q26 choice on the latest home arm curl result of that arm. */
export function keepNextLoad(db: DatabaseSync, userId: string, side: ArmSide, text: string): boolean {
  const row = db
    .prepare(
      `SELECT r.id FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id
       WHERE r.user_id=? AND r.test_id='arm_curl_30s' AND r.side=? AND a.setting='home' AND r.value IS NOT NULL
         AND a.status IN ('completed','ended_early')
       ORDER BY r.created DESC, r.rowid DESC LIMIT 1`,
    )
    .get(userId, side) as { id: string } | undefined;
  if (!row) return false;
  db.prepare("UPDATE assessment_results SET detail=json_set(detail,'$.nextLoad',?) WHERE id=?").run(
    text,
    row.id,
  );
  return true;
}
