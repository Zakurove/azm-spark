/**
 * What the results screens show (UX spec S50 to S52 shared rules, P6), pure: one card per test with a
 * row per side in run order, the values as whole numbers, "not measured" sides named with their
 * reason, every test that did not run in one list (C32), the ended early header, and where the
 * save of a signed in check stands (0.7). The register link of the booth QR never carries the visit.
 */
import { describe, expect, it } from "vitest";
import type { ProtocolItem } from "../src/medical/assessment";
import type { ReasonId, TestId } from "../src/movements/types";
import type { StoredCheck } from "../src/features/assessment/api";
import {
  buildResults,
  NOT_REACHED,
  resultsMode,
  storedCheckModel,
  type SideFact,
} from "../src/features/assessment/results/model";
import { registerLink, saveStateOf } from "../src/features/assessment/results/ResultsView";
import { initialModel, type FlowModel, type SideOutcome } from "../src/features/assessment/flowMachine";

const item = (
  testId: TestId,
  side: ProtocolItem["side"],
  order: number,
  extra: Partial<ProtocolItem> = {},
): ProtocolItem => ({ testId, side, version: 1, order, band: "default", ...extra });

const SEATED: ProtocolItem[] = [
  item("shoulder_abduction", "right", 1),
  item("shoulder_abduction", "left", 2),
  item("trunk_control_seated", "right", 3),
  item("trunk_control_seated", "left", 4),
  item("arm_curl_30s", "right", 5),
  item("arm_curl_30s", "left", 6),
];

function build(
  facts: Record<string, SideFact>,
  o: { mode?: "guest" | "first" | "retest"; items?: ProtocolItem[] } = {},
) {
  return buildResults({
    mode: o.mode ?? "first",
    items: o.items ?? SEATED,
    fact: (i) => facts[`${i.testId}:${i.side}`] ?? { kind: "notReached" },
  });
}

const m = (value: number, detail: Record<string, unknown> = {}): SideFact => ({
  kind: "measured",
  value,
  detail,
  variant: null,
});

const ALL: Record<string, SideFact> = {
  "shoulder_abduction:right": m(120.4),
  "shoulder_abduction:left": m(111.6),
  "trunk_control_seated:right": m(18),
  "trunk_control_seated:left": m(16),
  "arm_curl_30s:right": m(13),
  "arm_curl_30s:left": m(9),
};

describe("results cards (S50 to S52)", () => {
  it("reports per test and side, in run order, with whole values", () => {
    const r = build(ALL, { items: [...SEATED].reverse() });
    expect(r.cards.map((c) => c.testId)).toEqual([
      "shoulder_abduction",
      "trunk_control_seated",
      "arm_curl_30s",
    ]);
    expect(r.cards[0].rows.map((x) => [x.side, x.value])).toEqual([
      ["right", 120],
      ["left", 112],
    ]);
    expect(r.anyMeasured).toBe(true);
    expect(r.endedEarly).toBe(false);
    expect(r.skipped).toEqual([]);
    expect(r.measured).toHaveLength(6);
  });

  it("names a side not measured in its card with the reason, never as a missing card", () => {
    const r = build({ ...ALL, "shoulder_abduction:left": { kind: "notMeasured", reason: "quality" } });
    const card = r.cards.find((c) => c.testId === "shoulder_abduction")!;
    expect(card.rows[1]).toEqual({ side: "left", status: "notMeasured", reason: "quality" });
  });

  it("keeps a side skipped during the check inside its test card when the other side was measured", () => {
    const r = build({ ...ALL, "arm_curl_30s:left": { kind: "skipped", reason: "pain_today" } });
    const curl = r.cards.find((c) => c.testId === "arm_curl_30s")!;
    expect(curl.rows[1]).toEqual({ side: "left", status: "notMeasured", reason: "pain_today" });
    expect(r.skipped).toEqual([]);
  });

  it("lists the tests that did not run in one list with their reasons (P6, C32)", () => {
    const items = [
      ...SEATED.slice(0, 2),
      item("trunk_control_seated", "right", 3, { skipped: "restriction_balance" as ReasonId }),
      item("trunk_control_seated", "left", 4, { skipped: "restriction_balance" as ReasonId }),
      ...SEATED.slice(4),
    ];
    const facts = { ...ALL };
    facts["arm_curl_30s:right"] = { kind: "skipped", reason: "pain_today" };
    facts["arm_curl_30s:left"] = { kind: "skipped", reason: "pain_today" };
    const r = build(facts, { items });
    expect(r.cards.map((c) => c.testId)).toEqual(["shoulder_abduction"]);
    expect(r.skipped.map((e) => e.testId)).toEqual(["trunk_control_seated", "arm_curl_30s"]);
    expect(r.skipped[1].sides.map((x) => x.reason)).toEqual(["pain_today", "pain_today"]);
  });

  it("marks a signed in check that stopped before its end as ended early, never a guest's", () => {
    const facts = { ...ALL };
    delete facts["arm_curl_30s:right"];
    delete facts["arm_curl_30s:left"];
    const r = build(facts);
    expect(r.endedEarly).toBe(true);
    expect(r.skipped).toEqual([
      {
        testId: "arm_curl_30s",
        sides: [
          { side: "right", reason: NOT_REACHED },
          { side: "left", reason: NOT_REACHED },
        ],
      },
    ]);
    const guest = build(facts, { mode: "guest" });
    expect(guest.endedEarly).toBe(false);
    // The guest chose "See my results now" (S46b): by choice, never "not reached".
    expect(guest.skipped[0].sides.map((x) => x.reason)).toEqual(["by_choice", "by_choice"]);
  });

  it("says nothing was measured when every side is skipped or not measured (E state)", () => {
    const none = Object.fromEntries(
      SEATED.map((i) => [`${i.testId}:${i.side}`, { kind: "notMeasured", reason: "quality" } as SideFact]),
    );
    const r = build(none);
    expect(r.anyMeasured).toBe(false);
    expect(r.cards).toHaveLength(3);
    expect(r.cards.every((c) => c.rows.every((x) => x.status === "notMeasured"))).toBe(true);
  });

  it("says each reason once on the screen, under the first side not measured for it (R-13)", () => {
    const none = Object.fromEntries(
      SEATED.map((i) => [`${i.testId}:${i.side}`, { kind: "notMeasured", reason: "quality" } as SideFact]),
    );
    // Nothing measured: six sides, the sentence once.
    expect(build(none).cards.flatMap((c) => c.rows.map((x) => x.reason))).toEqual([
      "quality",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // Different reasons each show once; a measured side has none.
    const mixed = build({
      ...ALL,
      "shoulder_abduction:left": { kind: "notMeasured", reason: "quality" },
      "trunk_control_seated:right": { kind: "skipped", reason: "pain_today" },
      "arm_curl_30s:left": { kind: "notMeasured", reason: "quality" },
    });
    expect(mixed.cards.flatMap((c) => c.rows.map((x) => [x.status, x.reason]))).toEqual([
      ["measured", undefined],
      ["notMeasured", "quality"],
      ["notMeasured", "pain_today"],
      ["measured", undefined],
      ["measured", undefined],
      ["notMeasured", undefined],
    ]);
  });

  it("shows a censored side lean best as more than its value (spec 4.3)", () => {
    const r = build({
      ...ALL,
      "trunk_control_seated:right": m(18, { censored: true }),
      "trunk_control_seated:left": m(16, { contact: true }),
    });
    const lean = r.cards.find((c) => c.testId === "trunk_control_seated")!;
    expect(lean.rows.map((x) => x.censored)).toEqual([true, true]);
    expect(r.cards[0].rows[0].censored).toBeUndefined();
  });
});

describe("the flow and stored checks as results", () => {
  it("picks the variant from the mode and the check kind", () => {
    const base = initialModel({ mode: "signedIn", booth: false, homeOpen: true, desktop: false });
    const withKind = (kind: "baseline" | "retest" | null): FlowModel => ({
      ...base,
      data: { ...base.data, checkKind: kind },
    });
    expect(resultsMode(withKind("baseline"))).toBe("first");
    expect(resultsMode(withKind("retest"))).toBe("retest");
    const guest = initialModel({ mode: "guest", booth: true, homeOpen: false, desktop: false });
    expect(resultsMode(guest)).toBe("guest");
  });

  it("reads an earlier check: values, quality as not measured, skips and an ended early check", () => {
    const result = (
      testId: TestId,
      side: "left" | "right",
      value: number | null,
      skippedReason: string | null,
    ) => ({
      testId,
      side,
      value,
      unit: "deg",
      attempts: [],
      quality: {},
      detail: {},
      flags: [],
      nValid: 3,
      median: value,
      skippedReason,
      variant: null,
      poseModel: "lite" as const,
      movementVersion: 1,
      engineVersion: "t",
      band: "default",
      seriesKey: "k",
      created: 1,
    });
    const check = {
      id: "c1",
      kind: "retest",
      setting: "home",
      session: "full",
      status: "ended_early",
      started: 0,
      completed: 1,
      endedReason: "stop",
      setup: null,
      protocol: SEATED,
      results: [
        result("shoulder_abduction", "right", 118, null),
        result("shoulder_abduction", "left", null, "quality"),
        result("trunk_control_seated", "right", null, "pain_today"),
        result("trunk_control_seated", "left", null, "pain_today"),
      ],
    } as unknown as StoredCheck;
    const r = storedCheckModel(check);
    expect(r.mode).toBe("retest");
    expect(r.cards.map((c) => c.testId)).toEqual(["shoulder_abduction"]);
    expect(r.cards[0].rows.map((x) => x.status)).toEqual(["measured", "notMeasured"]);
    expect(r.skipped.map((e) => e.testId)).toEqual(["trunk_control_seated", "arm_curl_30s"]);
    expect(r.endedEarly).toBe(true);
  });

  it("builds the results of the flow from its outcomes and the camera payloads", async () => {
    const { resultsModel } = await import("../src/features/assessment/results/model");
    const base = initialModel({ mode: "signedIn", booth: false, homeOpen: true, desktop: false });
    const outcomes: Record<string, SideOutcome> = {
      "shoulder_abduction:right": { status: "measured", value: 121, payload: { value: 121, detail: {} } },
      "shoulder_abduction:left": { status: "measured", value: null, payload: { value: 99.6, detail: {} } },
      "trunk_control_seated:right": { status: "notMeasured", reason: "quality" },
      "trunk_control_seated:left": { status: "skipped", reason: "pain_today" },
      "arm_curl_30s:right": { status: "measured", value: null, payload: null },
      "arm_curl_30s:left": { status: "skipped" },
    };
    const model: FlowModel = {
      ...base,
      data: { ...base.data, protocol: SEATED, outcomes, checkKind: "baseline" },
    };
    const r = resultsModel(model);
    expect(r.cards[0].rows.map((x) => x.value)).toEqual([121, 100]);
    const lean = r.cards.find((c) => c.testId === "trunk_control_seated")!;
    expect(lean.rows.map((x) => x.reason)).toEqual(["quality", "pain_today"]);
    const curl = r.cards.find((c) => c.testId === "arm_curl_30s")!;
    // The side lean already said quality above (R-13): the arm curl says only its new reason.
    expect(curl.rows.map((x) => [x.status, x.reason])).toEqual([
      ["notMeasured", undefined],
      ["notMeasured", "by_choice"],
    ]);
  });
});

describe("where the save stands (0.7, S50 to S52 states)", () => {
  const s = (o: Partial<Parameters<typeof saveStateOf>[0]>) =>
    saveStateOf({ guest: false, effectsPending: false, waiting: false, auth: false, online: true, ...o });
  it("never shows a save for a guest (nothing is stored)", () => {
    expect(s({ guest: true, waiting: true, online: false })).toBe("saved");
  });
  it("is saving while the completion is handed to the outbox", () => {
    expect(s({ effectsPending: true })).toBe("saving");
  });
  it("waits offline and is an error online or after the session ended", () => {
    expect(s({ waiting: true, online: false })).toBe("pending");
    expect(s({ waiting: true, online: true })).toBe("error");
    expect(s({ auth: true })).toBe("error");
    expect(s({})).toBe("saved");
  });
});

describe("the booth QR (S50, S57)", () => {
  it("opens the public sign up, never anything of this visit, with its short address", () => {
    expect(registerLink("https://azm-spark.gymwise.ai")).toEqual({
      url: "https://azm-spark.gymwise.ai/?app=1&register=1",
      short: "azm-spark.gymwise.ai",
    });
  });
});
