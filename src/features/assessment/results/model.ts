/**
 * What the results screens show (UX spec S50 to S52, P6), pure, from the flow state or from a stored
 * check (the read only view of an earlier check on My results, S53):
 *   - one card per test that was tried (a side measured, or tried and not measured), with a row per
 *     side in run order: the value with its unit in words, or "Not measured today" with its reason
 *     (a side skipped by the protocol or during the check is named in its card);
 *   - every test that did not run at all, in the two S27 groups "Not today" and "Not part of your
 *     check", with its reason in plain words (and the substitute sentence when it ran, P6);
 *   - whether the check ended early (tests left that never ran) and whether anything was measured.
 * Report per test and side only: never an overall line (S50 to S52 shared rules).
 */
import type { ProtocolItem } from "../../../medical/assessment";
import type { TestSide } from "../../../medical/precheck";
import type { TestId } from "../../../movements/types";
import { reasonGroup, type SentenceDetail } from "../../progress/format";
import type { StoredCheck } from "../api";
import { outcomeKey, type FlowModel, type ResultPayload, type SideOutcome } from "../flowMachine";

export type ResultsMode = "guest" | "first" | "retest";

/**
 * The reason of a test left when a signed in check ended early (not a data reason id): shown as
 * assessment.results.notReached.
 */
export const NOT_REACHED = "not_reached";

export interface ResultRow {
  side: TestSide;
  status: "measured" | "notMeasured";
  /** Whole number, the displayed value (best valid attempt or the count). */
  value?: number;
  /** Side lean best censored by an abort or armrest contact: shown as "more than {value}". */
  censored?: boolean;
  /** The reason id of a side not measured (data:reasons). */
  reason?: string;
  detail?: SentenceDetail;
  variant?: string | null;
  /** Q13: a wheelchair arm raise not measured by quality pairs the reason with tips.wheelchair. */
  wheelchairTip?: boolean;
}

export interface ResultCardModel {
  testId: TestId;
  rows: ResultRow[];
}

export interface SkipEntry {
  testId: TestId;
  sides: { side: TestSide; reason: string; substituteRan?: boolean }[];
}

export interface ResultsModel {
  mode: ResultsMode;
  /** Tests were left that never ran (a signed in check stopped before its end). */
  endedEarly: boolean;
  cards: ResultCardModel[];
  notToday: SkipEntry[];
  notPart: SkipEntry[];
  /** At least one side has a value (else the lead is results.noneMeasured). */
  anyMeasured: boolean;
  /** The test sides measured (S52 matches them with the saved series). */
  measured: { testId: TestId; side: TestSide }[];
}

/** What happened to one side, as the builder reads it. */
export type SideFact =
  | { kind: "measured"; value: number; detail: Record<string, unknown>; variant: string | null }
  | { kind: "notMeasured"; reason: string }
  | { kind: "skipped"; reason: string }
  | { kind: "notReached" };

type SideState =
  | { kind: "row"; row: ResultRow }
  | { kind: "skip"; reason: string; dayLevel: boolean; substituteRan?: boolean };

/**
 * The core of both builders: protocol items in order, what happened to each side, and whether a
 * skipped item was an intake level exclusion (null: unknown, the reason id decides).
 */
export function buildResults(o: {
  mode: ResultsMode;
  items: readonly ProtocolItem[];
  fact(item: ProtocolItem): SideFact;
  intakeExcluded(item: ProtocolItem): boolean | null;
  wheelchair: boolean;
}): ResultsModel {
  const items = [...o.items].sort((a, b) => a.order - b.order);
  const states = new Map<string, SideState>();
  let notReached = false;
  for (const item of items) {
    const key = outcomeKey(item.testId, item.side);
    if (item.skipped) {
      const excluded = o.intakeExcluded(item);
      states.set(key, {
        kind: "skip",
        reason: item.skipped,
        // SPEC-GAP: plan-group-trigger. Without the base selection (a resumed or stored check) the
        // reason id alone decides the group.
        dayLevel: excluded === null ? reasonGroup(item.skipped) === "notToday" : !excluded,
        ...(item.substituteRan ? { substituteRan: true } : {}),
      });
      continue;
    }
    const f = o.fact(item);
    switch (f.kind) {
      case "measured": {
        const censored =
          item.testId === "trunk_control_seated" && (f.detail.censored === true || f.detail.contact === true);
        states.set(key, {
          kind: "row",
          row: {
            side: item.side,
            status: "measured",
            value: Math.round(f.value),
            ...(censored ? { censored: true } : {}),
            detail: f.detail as SentenceDetail,
            variant: f.variant ?? item.variant ?? null,
          },
        });
        break;
      }
      case "notMeasured":
        states.set(key, {
          kind: "row",
          row: {
            side: item.side,
            status: "notMeasured",
            reason: f.reason,
            ...(o.wheelchair && item.testId === "shoulder_abduction" && f.reason === "quality"
              ? { wheelchairTip: true }
              : {}),
          },
        });
        break;
      case "skipped":
        states.set(key, { kind: "skip", reason: f.reason, dayLevel: true });
        break;
      case "notReached":
        // The guest chose "See my results now" (S46b, by_choice), or a signed in check ended before
        // this test (assessment.results.notReached).
        notReached = true;
        states.set(key, {
          kind: "skip",
          reason: o.mode === "guest" ? "by_choice" : NOT_REACHED,
          dayLevel: true,
        });
        break;
    }
  }

  const cards: ResultCardModel[] = [];
  const notToday: SkipEntry[] = [];
  const notPart: SkipEntry[] = [];
  const tests: TestId[] = [];
  for (const item of items) if (!tests.includes(item.testId)) tests.push(item.testId);
  for (const testId of tests) {
    const sides = items
      .filter((i) => i.testId === testId)
      .map((item) => ({ item, state: states.get(outcomeKey(item.testId, item.side))! }));
    if (sides.some((s) => s.state.kind === "row")) {
      cards.push({
        testId,
        rows: sides.map(({ item, state }) =>
          state.kind === "row" ? state.row : { side: item.side, status: "notMeasured", reason: state.reason },
        ),
      });
      continue;
    }
    const skips = sides.map(({ item, state }) => {
      const k = state as Extract<SideState, { kind: "skip" }>;
      return { side: item.side, reason: k.reason, dayLevel: k.dayLevel, substituteRan: k.substituteRan };
    });
    const entry: SkipEntry = {
      testId,
      sides: skips.map(({ side, reason, substituteRan }) => ({
        side,
        reason,
        ...(substituteRan ? { substituteRan } : {}),
      })),
    };
    // A test is "Not part of your check" only when every side is an intake level exclusion.
    const part = skips.every((s) => reasonGroup(s.reason, s.dayLevel) === "notPart");
    (part ? notPart : notToday).push(entry);
  }

  const measured = cards.flatMap((c) =>
    c.rows.filter((r) => r.status === "measured").map((r) => ({ testId: c.testId, side: r.side })),
  );
  return {
    mode: o.mode,
    endedEarly: o.mode !== "guest" && notReached,
    cards,
    notToday,
    notPart,
    anyMeasured: measured.length > 0,
    measured,
  };
}

/* ------------------------------------------------------------ from the flow */

/** The result a camera screen measured, when the flow kept it with the outcome. */
function payloadOf(o: SideOutcome | undefined): Partial<ResultPayload> | null {
  const p = o?.payload;
  return p && typeof p === "object" ? (p as Partial<ResultPayload>) : null;
}

export function resultsMode(m: FlowModel): ResultsMode {
  if (m.data.config.mode === "guest") return "guest";
  return m.data.checkKind === "retest" ? "retest" : "first";
}

/** The position of the person today (the signed in context, or the guest's answer). */
function positionOf(m: FlowModel): string | undefined {
  return m.data.env?.ctx.position ?? m.data.signedIn?.ctx?.position ?? m.data.guest.position;
}

export function resultsModel(m: FlowModel): ResultsModel {
  const d = m.data;
  return buildResults({
    mode: resultsMode(m),
    items: d.protocol,
    wheelchair: positionOf(m) === "wheelchair",
    intakeExcluded: (item) =>
      d.base.length === 0
        ? null
        : d.base.some((b) => b.testId === item.testId && b.side === item.side && b.excluded !== undefined),
    fact: (item) => {
      const o = d.outcomes[outcomeKey(item.testId, item.side)];
      const p = payloadOf(o);
      if (o?.status === "measured") {
        const raw = typeof o.value === "number" ? o.value : typeof p?.value === "number" ? p.value : null;
        if (raw === null) return { kind: "notMeasured", reason: "quality" };
        return {
          kind: "measured",
          value: raw,
          detail: (p?.detail ?? {}) as Record<string, unknown>,
          variant: p?.variant ?? null,
        };
      }
      if (o?.status === "notMeasured") return { kind: "notMeasured", reason: o.reason ?? "quality" };
      if (o?.status === "skipped") return { kind: "skipped", reason: o.reason ?? "by_choice" };
      return { kind: "notReached" };
    },
  });
}

/* ------------------------------------------------------------ from a stored check */

/**
 * The results of an earlier check (GET /api/assessments), for its read only view on My results: its
 * frozen protocol, and per side its stored row (a value, quality as "not measured", or a skip).
 */
export function storedCheckModel(check: StoredCheck, wheelchair: boolean): ResultsModel {
  const byKey = new Map(check.results.map((r) => [outcomeKey(r.testId, r.side), r]));
  return buildResults({
    mode: check.kind === "retest" ? "retest" : "first",
    items: check.protocol,
    wheelchair,
    intakeExcluded: () => null,
    fact: (item) => {
      const r = byKey.get(outcomeKey(item.testId, item.side));
      if (!r)
        return check.status === "ended_early"
          ? { kind: "notReached" }
          : { kind: "skipped", reason: "by_choice" };
      if (r.skippedReason === null && typeof r.value === "number")
        return { kind: "measured", value: r.value, detail: r.detail, variant: r.variant };
      if (r.skippedReason === "quality" || r.skippedReason === null)
        return { kind: "notMeasured", reason: "quality" };
      return { kind: "skipped", reason: r.skippedReason };
    },
  });
}

/** Rows of a skip entry that share one reason are named once, without their sides (S27). */
export function sharedReason(entry: SkipEntry): string | null {
  const first = entry.sides[0]?.reason;
  return first !== undefined && entry.sides.every((s) => s.reason === first) ? first : null;
}
