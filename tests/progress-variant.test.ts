/**
 * The S01 entry card variant (UX spec S01 table, H9, Q12 (2), Q31 (6), O6): the first matching row
 * wins, from the context, the progress and the list of checks. Also where an open check stopped, the
 * repeat window after a lower result, and today's ended early line.
 */
import { describe, expect, it } from "vitest";
import type { ContextResponse, ProgressResponse, StoredCheck } from "../src/features/assessment/api";
import {
  canStartFrom,
  endedEarlyToday,
  entryState,
  repeatWindow,
  resumePoint,
  type EntryInputs,
} from "../src/features/progress/variant";
import type { ProtocolItem } from "../src/medical/assessment";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 10, 9);

function context(over: Partial<ContextResponse> = {}): ContextResponse {
  return {
    ctx: {
      position: "chair",
      support: "none",
      pain: [],
      restrictions: [],
      conditions: ["none"],
      clearance: "yes",
    },
    setting: "home",
    setup: null,
    firstCheck: true,
    completedBefore: false,
    unresolvedChangeReported: false,
    faintReportedUnresolved: false,
    lastCheckLasting: false,
    lastPdDoseBucket: null,
    lock: null,
    retestDue: null,
    earliestNext: null,
    early: false,
    sideLeanRepeat: null,
    openCheck: null,
    followUpDue: false,
    consent: true,
    consentVersion: 1,
    baselineRanges: {},
    baseTests: ["shoulder_abduction", "trunk_control_seated", "arm_curl_30s"],
    homeOpen: true,
    adultConfirmed: true,
    ...over,
  } as ContextResponse;
}

const state = (over: Partial<ContextResponse> = {}, extra: Partial<EntryInputs> = {}) =>
  entryState({
    context: context(over),
    progress: null,
    checks: [],
    now: NOW,
    resumeAllowed: () => true,
    ...extra,
  });

const DONE = { firstCheck: false, completedBefore: true };
const item = (testId: ProtocolItem["testId"], side: ProtocolItem["side"], order: number, skipped?: string) =>
  ({ testId, side, version: 1, order, band: "default", ...(skipped ? { skipped } : {}) }) as ProtocolItem;

function check(over: Partial<StoredCheck>): StoredCheck {
  return {
    id: "c1",
    kind: "baseline",
    setting: "home",
    session: "full",
    status: "completed",
    started: NOW - DAY,
    completed: NOW - DAY,
    endedReason: null,
    setup: null,
    protocol: [],
    results: [],
    ...over,
  } as StoredCheck;
}

describe("S01 variants, first matching row wins", () => {
  it("1 blocked: clinical review; the card is hidden for a mobility bed", () => {
    expect(state({ blocked: "clinical_review" }).variant).toBe("blocked");
    expect(state({ blocked: "unsupported_position" }).variant).toBeNull();
  });

  it("2 homeSoon: home checks closed, booth mode or not (Q31 (6); the booth runs the guest check, C34)", () => {
    expect(state({ homeOpen: false }).variant).toBe("homeSoon");
  });

  it("3 locked: a lock that has not ended, with the release when releasable", () => {
    const s = state({
      lock: { until: NOW + DAY, releasableByClearance: true, when: { token: "nextDay_midnight" } },
    });
    expect(s.variant).toBe("locked");
    expect(s.lock).toEqual({ when: { token: "nextDay_midnight" }, releasable: true });
    expect(
      state({ lock: { until: NOW - 1, releasableByClearance: false, when: { token: "min60_start" } } })
        .variant,
    ).toBe("first");
  });

  it("4 resume: an open check within its 30 minutes, never one with a safety screen (O6)", () => {
    const open = check({
      id: "open1",
      status: "open",
      completed: null,
      protocol: [
        item("shoulder_abduction", "right", 1),
        item("shoulder_abduction", "left", 2),
        item("arm_curl_30s", "right", 3),
        item("arm_curl_30s", "left", 4),
      ],
      results: [
        { testId: "shoulder_abduction", side: "right", value: 120, skippedReason: null },
        { testId: "shoulder_abduction", side: "left", value: 110, skippedReason: null },
      ] as StoredCheck["results"],
    });
    const over = { ...DONE, openCheck: { id: "open1", setting: "home" as const, resumeUntil: NOW + 60_000 } };
    const s = state(over, { checks: [open] });
    expect(s.variant).toBe("resume");
    expect(s.resume).toMatchObject({ n: 2, total: 2 });
    expect(state(over, { checks: [open], resumeAllowed: () => false }).variant).toBe("upcoming");
    expect(
      state({ ...over, openCheck: { ...over.openCheck, resumeUntil: NOW - 1 } }, { checks: [open] }).variant,
    ).toBe("upcoming");
  });

  it("5 followUp: the next day question shows above the card, then the rows below apply", () => {
    const s = state({ ...DONE, followUpDue: true, retestDue: NOW + 20 * DAY });
    expect(s.followUp).toBe(true);
    expect(s.variant).toBe("upcoming");
  });

  it("6 first: no completed home check, once 48 hours have passed since any booth check", () => {
    const s = state();
    expect(s.variant).toBe("first");
    expect(s.minutes?.[0]).toBeGreaterThan(0);
    expect(state({ earliestNext: NOW + DAY }).variant).toBe("tooSoon");
  });

  it("7 leanRepeat: inside the side lean only session window (Q12 (2))", () => {
    const lean = { from: NOW - DAY, to: NOW + 4 * DAY, baseTests: ["trunk_control_seated" as const] };
    const s = state({ ...DONE, sideLeanRepeat: lean, retestDue: NOW + 20 * DAY });
    expect(s.variant).toBe("leanRepeat");
    expect(s.dates).toMatchObject({ from: lean.from, to: lean.to });
    expect(state({ ...DONE, sideLeanRepeat: { ...lean, from: NOW + DAY } }).variant).toBe("upcoming");
  });

  it("8 due: the re-test is due today or earlier", () => {
    expect(state({ ...DONE, retestDue: NOW - DAY }).variant).toBe("due");
    expect(state({ ...DONE, retestDue: NOW }).variant).toBe("due");
  });

  it("9 repeatOffer: 2 to 7 days after a lower result of a current home series", () => {
    const progress = {
      tests: [{ current: true, setting: "home", repeatOffer: true, latest: { date: NOW - 3 * DAY } }],
    } as unknown as ProgressResponse;
    const s = state({ ...DONE, retestDue: NOW + 25 * DAY }, { progress });
    expect(s.variant).toBe("repeatOffer");
    expect(s.dates.from).toBe(NOW - DAY);
    expect(s.dates.to).toBe(NOW + 4 * DAY);
    expect(repeatWindow(progress)).toEqual({ from: NOW - DAY, to: NOW + 4 * DAY });
    const booth = { tests: [{ ...progress.tests[0], setting: "booth" }] } as unknown as ProgressResponse;
    expect(repeatWindow(booth)).toBeNull();
  });

  it("10 tooSoon: less than 48 hours since the last completed check", () => {
    const s = state({ ...DONE, earliestNext: NOW + DAY, retestDue: NOW + 27 * DAY });
    expect(s.variant).toBe("tooSoon");
    expect(s.dates.earliest).toBe(NOW + DAY);
  });

  it("11 upcoming: otherwise, with the next date", () => {
    const s = state({ ...DONE, retestDue: NOW + 20 * DAY });
    expect(s.variant).toBe("upcoming");
    expect(s.dates.next).toBe(NOW + 20 * DAY);
  });

  it("starts a check only from the variants whose primary action starts one", () => {
    expect(["first", "due", "leanRepeat", "repeatOffer"].every((v) => canStartFrom(v as never))).toBe(true);
    expect(
      ["homeSoon", "locked", "tooSoon", "upcoming", "blocked", null].some((v) => canStartFrom(v as never)),
    ).toBe(false);
  });
});

describe("the extra lines of S01", () => {
  it("says today's check ended early only for a check today with results kept", () => {
    const ended = check({ status: "ended_early", completed: NOW - 60_000, results: [{}] as never });
    expect(endedEarlyToday([ended], NOW)).toBe(true);
    expect(endedEarlyToday([{ ...ended, results: [] }], NOW)).toBe(false);
    expect(endedEarlyToday([{ ...ended, completed: NOW - 2 * DAY }], NOW)).toBe(false);
    expect(endedEarlyToday([{ ...ended, status: "completed" }], NOW)).toBe(false);
    expect(state({ blocked: "clinical_review" }, { checks: [ended] }).endedEarlyToday).toBe(false);
  });

  it("finds where an open check stopped: the first test with a side not done", () => {
    const protocol = [
      item("shoulder_abduction", "right", 1),
      item("shoulder_abduction", "left", 2),
      item("trunk_control_seated", "right", 3, "pain_today"),
      item("arm_curl_30s", "right", 4),
    ];
    const at = (outcomes: Record<string, unknown>) =>
      resumePoint({ id: "x", kind: "baseline", setting: "home", protocol, outcomes, setup: null } as never);
    expect(at({})).toEqual({ n: 1, total: 2 });
    expect(at({ "shoulder_abduction:right": {}, "shoulder_abduction:left": {} })).toEqual({ n: 2, total: 2 });
  });
});
