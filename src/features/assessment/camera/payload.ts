/**
 * The result of one test side as the flow records it and the server stores it (contract v2 E,
 * server validate.ts checkResult): derived numbers only, never video.
 *
 *   measured       value (best of the valid attempts, or the single trial), median, nValid, the
 *                  scored attempts, quality, the engine's detail and flags
 *   not measured   no value and no attempts, with the reason (quality, needed_arms, ...), exactly
 *                  as a skip is stored (spec 4.0: a stopped or failed test stores no score)
 *
 * Detail keys are kept only when the server accepts them (RESULT_DETAIL_KEYS mirrors DETAIL_SPEC of
 * server/modules/assessments/validate.ts; tests/s34-payload.test.ts keeps the two lists equal).
 */
import { ENGINE_VERSION, type SideResult } from "../../../engine/modes";
import type { ProtocolItem } from "../../../medical/assessment";
import { testDef } from "../../../movements/assessments";
import type { DeviceInfo, FlowEvent, ResultPayload, SideOutcome } from "../flowMachine";

export const RESULT_DETAIL_KEYS: readonly string[] = [
  "bentElbowAccepted",
  "loadKg",
  "loadL",
  "loadObject",
  "armrest",
  "armrests",
  "armMode",
  "legProsthesis",
  "footwear",
  "pdState",
  "countSource",
  "pushHand",
  "sameChair",
  "gripYes",
  "reference",
  "view",
  "pivot",
  "compensated",
  "unscoredShare",
  "censored",
  "contact",
  "rangeLo",
  "rangeHi",
  "partial",
  "first10sCount",
  "last10sCount",
  "viewAngle",
  "medianFps",
  "returnSec",
  "shoulderShift",
  "hSit",
  "rise",
  "riseToday",
  "halfwayCredited",
  "stoppedEarly",
  "secondsCompleted",
  "bentElbow",
  "pastVertical",
  "planeZ",
  "planeOkSec",
  "spreadDeg",
  "elbowDeg",
  "shrug",
  "shoulderShrinkMax",
  "trunkLeanAtPeak",
  "trunkLeanMax",
  "leanShiftAtPeak",
  "leanShiftMax",
  "phoneRollDeg",
  "shoulderHike",
  "planeRatio",
  "upright",
  "uprightSd",
  "band",
  "abortLimit",
  "abort",
  "armSupportLikely",
  "wristSupport",
  "trunkShrinkMax",
  "widthChangeMax",
  "hipShiftMax",
];

const FLAG = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}$/;

/** The quality summary as the server takes it: flat scalars and short lists of ids. */
function qualityOf(r: SideResult): Record<string, unknown> {
  const q = r.quality;
  return {
    ok: q.ok,
    retries: q.retries,
    issues: q.issues.filter((i) => ID.test(i)).slice(0, 40),
    medianFps: q.medianFps === null ? null : Math.round(q.medianFps * 10) / 10,
    maxPausedShare: Math.round(q.maxPausedShare * 1000) / 1000,
  };
}

function detailOf(
  r: SideResult,
  extra: Record<string, number | boolean | string>,
): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  for (const [k, v] of Object.entries({ ...r.detail, ...extra })) {
    if (!KEY.test(k) || !RESULT_DETAIL_KEYS.includes(k)) continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    out[k] = v;
  }
  if (r.censored) out.censored = true;
  return out;
}

export interface SideRecord {
  outcome: SideOutcome;
  body: ResultPayload;
}

/**
 * The flow record of a finished runner side. `item` is the frozen protocol item of the side;
 * `extra` adds setup fingerprint details the screen knows (the load object of the arm curl).
 */
export function sideRecord(
  r: SideResult,
  item: Pick<ProtocolItem, "version" | "variant">,
  device: Pick<DeviceInfo, "model">,
  extra: Record<string, number | boolean | string> = {},
): SideRecord {
  const def = testDef(r.testId);
  const measured = r.status === "measured" && r.value !== null && r.nValid > 0 && r.quality.ok;
  const base = {
    testId: r.testId,
    side: r.side,
    unit: def.unit,
    quality: qualityOf(r),
    flags: [...new Set(r.flags)].filter((f) => FLAG.test(f)).slice(0, 20),
    variant: r.variant ?? item.variant ?? null,
    poseModel: device.model,
    movementVersion: item.version,
    engineVersion: ENGINE_VERSION,
  };
  if (!measured) {
    const reason = r.reason ?? "quality";
    return {
      outcome: { status: "notMeasured", reason, value: null, payload: r },
      body: {
        ...base,
        value: null,
        attempts: [],
        detail: {},
        nValid: 0,
        median: null,
        skippedReason: reason,
        variant: null,
      },
    };
  }
  const attempts = r.attempts.slice(0, def.attempts).map((a) => {
    const valid = a.outcome === "valid" && a.value !== null;
    const flags = [...new Set(a.flags)].filter((f) => FLAG.test(f)).slice(0, 20);
    return {
      value: a.value === null ? null : Math.round(a.value),
      valid,
      durationSec: Math.min(300, Math.max(0, Math.round((a.t1 - a.t0) / 100) / 10)),
      ...(flags.length ? { flags } : {}),
    };
  });
  return {
    outcome: { status: "measured", value: r.value, payload: r },
    body: {
      ...base,
      value: Math.round(r.value!),
      attempts,
      detail: detailOf(r, extra),
      nValid: attempts.filter((a) => a.valid).length,
      median: r.median,
      skippedReason: null,
    },
  };
}

/** The SIDE_RESULT event of a finished side. */
export function sideResultEvent(record: SideRecord): FlowEvent {
  return {
    type: "SIDE_RESULT",
    testId: record.body.testId,
    side: record.body.side,
    outcome: record.outcome,
    body: record.body,
  };
}
