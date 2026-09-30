/**
 * The flow machine changes of the round 3 integration (foundation requests of the screen streams):
 *   - the camera primer never leads back to an earlier preparation step (arm curl, helper);
 *   - S29 and S30 answers per arm live in the flow, and a measured arm curl carries its load (Q5);
 *   - S28 Back to S27 only before the first test;
 *   - a model load failure's "later" leaves from the camera states;
 *   - S48: the side lean result waits for its contact answer, a count check stores countSource self
 *     (O22), pushed no is a quality failure with S46, and a held result is posted before a stop;
 *   - the guest check in inputs come from the guest pre-check (O34);
 *   - the context carries the last dose bucket (warn_pd_timing), and the safety state its source.
 */
import { describe, expect, it } from "vitest";
import {
  COUNT_CHECK_SHARE,
  backTarget,
  countCheckDue,
  curlLoadDetail,
  prepSteps,
  restoredModel,
  withContact,
  withSelfCount,
  type FlowEffect,
  type FlowModel,
  type FlowState,
  type ResultPayload,
} from "../src/features/assessment/flowMachine";
import { toSignedInContext, type ContextResponse } from "../src/features/assessment/api";
import { memoryStore, ResultQueue } from "../src/features/assessment/resultQueue";
import { contextOf, guestAtPlan, play, signedStarted, withState } from "./flow-walks";

const cam = (kind: FlowState["kind"], i = 0, side = 0, extra: Record<string, unknown> = {}) =>
  ({ kind, i, side, ...extra }) as FlowState;

/** A signed in first check at home, at its plan (the warnings passed). */
function signedPlan(): FlowModel {
  const m = signedStarted(contextOf({ position: "chair" }));
  return m.state.kind === "warnings" ? play(m, { type: "CONTINUE" }) : m;
}

const results = (m: FlowModel) =>
  m.effects.filter((e): e is Extract<FlowEffect, { type: "result" }> => e.type === "result");

function body(m: FlowModel, i: number, side: number, detail: ResultPayload["detail"] = {}): ResultPayload {
  const item = m.data.tests[i].sides[side];
  return {
    testId: item.testId,
    side: item.side,
    value: 12,
    unit: "count",
    attempts: [{ value: 12, valid: true }],
    quality: { ok: true },
    detail,
    flags: ["contact_unknown"],
    nValid: 1,
    median: 12,
    skippedReason: null,
    variant: null,
    poseModel: "lite",
    movementVersion: 1,
    engineVersion: "e",
  };
}

/** The side's last attempt is saved: SAVED_NEXT completes the side. */
const lastSaved = (m: FlowModel): FlowModel => ({
  ...m,
  data: { ...m.data, run: { ...m.data.run, saved: 9 } },
});

function measured(m: FlowModel, i: number, side: number, detail: ResultPayload["detail"] = {}): FlowModel {
  const item = m.data.tests[i].sides[side];
  return play(m, {
    type: "SIDE_RESULT",
    testId: item.testId,
    side: item.side,
    outcome: { status: "measured", value: 12, payload: { detail: { ...detail } } },
    body: body(m, i, side, detail),
  });
}

describe("the camera primer and the preparation steps", () => {
  it("the primer after the arm curl's grip and load goes on to the setup check, never back", () => {
    const plan = signedPlan();
    const curl = plan.data.tests.findIndex((t) => t.testId === "arm_curl_30s");
    expect(curl).toBeGreaterThanOrEqual(0);
    const m = withState({ ...plan, effects: [] }, { kind: "test.instruction", i: curl });
    expect(prepSteps(m.data, curl)).toEqual(["grip", "load", "primer"]);
    const primer = play(m, { type: "READY" }, { type: "PREP_NEXT" }, { type: "PREP_NEXT" });
    expect(primer.state).toEqual({ kind: "test.primer", i: curl });
    const next = play(primer, { type: "PREP_NEXT" });
    expect(next.state).toEqual({ kind: "cam.setup", i: curl, side: 0 });
    expect(next.data.cameraUsed).toBe(true);
  });
});

describe("S29 and S30 answers in the flow (Q5)", () => {
  const plan = signedPlan();
  const curl = plan.data.tests.findIndex((t) => t.testId === "arm_curl_30s");
  const arms = plan.data.tests[curl].sides.map((s) => s.side as "left" | "right");

  it("keeps the grip answer and the load per arm, and a new check starts empty", () => {
    const grip = play(withState(plan, { kind: "test.grip", i: curl }), {
      type: "GRIP_ANSWER",
      side: arms[0],
      yes: false,
    });
    expect(grip.data.armCurl.grip).toEqual({ [arms[0]]: false });
    const load = play(withState(grip, { kind: "test.load", i: curl }), {
      type: "LOAD_CHOSEN",
      side: arms[0],
      load: { kind: "bottle", liters: 0.5 },
    });
    expect(load.data.armCurl.load[arms[0]]).toEqual({ kind: "bottle", liters: 0.5 });
    // Only on their own screens.
    expect(play(withState(plan, { kind: "plan" }), { type: "GRIP_ANSWER", side: "left", yes: true })).toEqual(
      withState(plan, { kind: "plan" }),
    );
  });

  it("a measured arm curl carries the load of its arm; the step down names the practice arm", () => {
    const chosen = {
      ...plan,
      effects: [],
      data: {
        ...plan.data,
        armCurl: { grip: {}, load: { [arms[0]]: { kind: "dumbbell" as const, kg: 2 } } },
      },
    };
    const posted = results(measured(withState(chosen, cam("cam.saved", curl, 0)), curl, 0));
    expect(posted).toHaveLength(1);
    expect(posted[0].body.detail).toMatchObject({ loadObject: "dumbbell", loadKg: 2 });
    const heavy = play(withState(chosen, cam("test.practiceCheck", curl, 0)), { type: "PRACTICE_HEAVY" });
    expect(heavy.state).toEqual({ kind: "test.load", i: curl, stepDown: true, arm: arms[0] });
  });

  it("maps a load to its result detail fields (spec 4.2)", () => {
    expect(curlLoadDetail({ kind: "cuff", kg: 1 })).toEqual({ loadObject: "cuff", loadKg: 1 });
    expect(curlLoadDetail({ kind: "bottle", liters: 1.5 })).toEqual({ loadObject: "bottle", loadL: 1.5 });
    expect(curlLoadDetail({ kind: "none" })).toEqual({ loadObject: "none" });
  });
});

describe("S28 Back and the camera's later", () => {
  it("Back from the first instruction card returns to the plan, never once a test has run", () => {
    const plan = signedPlan();
    const first = play(plan, { type: "PLAN_START" });
    expect(first.state).toEqual({ kind: "test.instruction", i: 0 });
    expect(backTarget(first)).toEqual({ kind: "plan" });
    expect(play(first, { type: "BACK" }).state).toEqual({ kind: "plan" });
    const item = plan.data.tests[0].sides[0];
    const ran = {
      ...first,
      data: { ...first.data, outcomes: { [`${item.testId}:${item.side}`]: { status: "measured" as const } } },
    };
    expect(backTarget(ran)).toBeNull();
    expect(backTarget(withState(plan, { kind: "test.instruction", i: 1 }))).toBeNull();
  });

  it("later on a camera state (a model that did not load) leaves to Today", () => {
    const plan = signedPlan();
    expect(play(withState(plan, cam("cam.setup")), { type: "LATER" }).state).toEqual({
      kind: "exit",
      to: "today",
    });
    const guest = guestAtPlan();
    expect(
      play(withState(guest, cam("cam.calibrate", 0, 0, { offer: false })), { type: "LATER" }).state,
    ).toEqual({ kind: "exit", to: "landing" });
  });
});

describe("S48 answers and the results that wait for them", () => {
  const plan = { ...signedPlan(), effects: [] };
  const trunk = plan.data.tests.findIndex((t) => t.testId === "trunk_control_seated");

  it("the side lean result waits for its contact answer, and yes censors it", () => {
    const m = measured(lastSaved(withState(plan, cam("cam.saved", trunk, 0))), trunk, 0, { censored: false });
    expect(results(m)).toHaveLength(0);
    const asked = play(m, { type: "SAVED_NEXT" });
    expect(asked.state).toMatchObject({ kind: "after.contact", i: trunk, side: 0 });
    expect(results(asked)).toHaveLength(0);
    const yes = play(asked, { type: "AFTER_ANSWER", value: true });
    const posted = results(yes);
    expect(posted).toHaveLength(1);
    expect(posted[0].body.detail).toMatchObject({ contact: true, censored: true });
    expect(posted[0].body.flags).toEqual(expect.arrayContaining(["contact", "censored"]));
    expect(posted[0].body.flags).not.toContain("contact_unknown");
    const item = plan.data.tests[trunk].sides[0];
    const key = `${item.testId}:${item.side}`;
    expect(yes.data.contact[key]).toBe(true);
    expect(yes.data.held).toEqual({});
    // The results screens read the censored side from the outcome.
    expect((yes.data.outcomes[key].payload as { detail: Record<string, unknown> }).detail).toMatchObject({
      contact: true,
      censored: true,
    });
  });

  it("a held result is posted before a stop that names the next side", () => {
    const m = play(measured(lastSaved(withState(plan, cam("cam.saved", trunk, 0))), trunk, 0), {
      type: "SAVED_NEXT",
    });
    const stopped = play(m, { type: "STOP" }, { type: "STOP_OPTION", option: "choice" });
    const types = stopped.effects.map((e) => e.type);
    expect(types.indexOf("result")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("result")).toBeLessThan(types.indexOf("stop"));
    expect(stopped.data.held).toEqual({});
    const ids = stopped.effects.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(stopped.nextEffectId).toBe(Math.max(...ids) + 1);
  });

  it("the count check follows a timed test with 10 to 20 percent unscored, at home only (O22)", () => {
    const curl = plan.data.tests.findIndex((t) => t.testId === "arm_curl_30s");
    const withShare = (share: number) => body(plan, curl, 0, { unscoredShare: share });
    expect(countCheckDue(plan.data, "arm_curl_30s", withShare(0.15))).toBe(true);
    expect(countCheckDue(plan.data, "arm_curl_30s", withShare(COUNT_CHECK_SHARE[0]))).toBe(true);
    expect(countCheckDue(plan.data, "arm_curl_30s", withShare(0.05))).toBe(false);
    expect(countCheckDue(plan.data, "arm_curl_30s", withShare(0.25))).toBe(false);
    expect(countCheckDue(plan.data, "shoulder_abduction", withShare(0.15))).toBe(false);
    const booth = { ...plan.data, config: { ...plan.data.config, booth: true }, setting: "booth" as const };
    expect(countCheckDue(booth, "arm_curl_30s", withShare(0.15))).toBe(false);

    const m = measured(lastSaved(withState(plan, cam("cam.saved", curl, 0))), curl, 0, {
      unscoredShare: 0.15,
    });
    expect(results(m)).toHaveLength(0);
    const asked = play(m, { type: "SAVED_NEXT" });
    expect(asked.state).toMatchObject({ kind: "after.count", i: curl, side: 0 });
    const changed = play(asked, { type: "AFTER_ANSWER", value: 10 });
    expect(changed.state).toMatchObject({ kind: "between", scope: "side" });
    const posted = results(changed);
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toMatchObject({ value: 10, median: 10, detail: { countSource: "self" } });
    expect(posted[0].body.attempts[0].value).toBe(10);
    // Without the unscored share nothing waits.
    const plain = measured(lastSaved(withState(plan, cam("cam.saved", curl, 0))), curl, 0, {
      unscoredShare: 0,
    });
    expect(results(plain)).toHaveLength(1);
    expect(play(plain, { type: "SAVED_NEXT" }).state).toMatchObject({ kind: "between" });
  });

  it("the chair stand asks the count check after its seated minute; pushed no is a quality failure", () => {
    const standing = { ...signedStartedAt("standing"), effects: [] };
    const stand = standing.data.tests.findIndex((t) => t.testId === "chair_stand_30s");
    expect(stand).toBeGreaterThanOrEqual(0);
    const rest = measured(withState(standing, cam("cam.rest", stand, 0, { purpose: "seated" })), stand, 0, {
      unscoredShare: 0.12,
    });
    const asked = play(rest, { type: "REST_DONE" });
    expect(asked.state).toMatchObject({ kind: "after.count", i: stand });
    const yes = play(asked, { type: "AFTER_ANSWER", value: 12 });
    expect(yes.state).toMatchObject({ kind: "between", scope: "test" });
    expect(results(yes)[0].body).toMatchObject({ value: 12, detail: { countSource: "self" } });

    const pushed = play(withState(standing, cam("after.pushed", stand)), {
      type: "AFTER_ANSWER",
      value: false,
    });
    expect(pushed.state).toMatchObject({ kind: "skipNotice", rows: [{ reason: "quality" }] });
    const posted = results(pushed);
    expect(posted[0].body).toMatchObject({ skippedReason: "quality", value: null });
  });

  it("withContact and withSelfCount keep the body consistent", () => {
    const b = body(plan, 0, 0, { censored: true });
    expect(withContact(b, false).detail).toMatchObject({ contact: false, censored: true });
    expect(withContact(b, false).flags).toEqual([]);
    expect(withSelfCount(b, null)).toMatchObject({ value: 12, detail: { countSource: "self" } });
    expect(withSelfCount(b, 12)).toMatchObject({ value: 12, median: 12 });
  });
});

describe("S57: our staff correct a timed count at the booth", () => {
  const home = signedPlan();
  const booth: FlowModel = {
    ...home,
    effects: [],
    data: { ...home.data, config: { ...home.data.config, booth: true }, setting: "booth" },
  };
  const curl = booth.data.tests.findIndex((t) => t.testId === "arm_curl_30s");

  it("the result waits on S34h and is posted with the staff count and countSource staff", () => {
    const saved = measured(lastSaved(withState(booth, cam("cam.saved", curl, 0))), curl, 0);
    expect(results(saved)).toHaveLength(0);
    const corrected = play(saved, { type: "STAFF_COUNT", count: 14 });
    const item = booth.data.tests[curl].sides[0];
    const key = `${item.testId}:${item.side}`;
    expect(corrected.data.staffCount[key]).toBe(14);
    expect(corrected.data.outcomes[key].value).toBe(14);
    const next = play(corrected, { type: "SAVED_NEXT" });
    const posted = results(next);
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toMatchObject({ value: 14, detail: { countSource: "staff" } });
  });

  it("a count given before the result arrives goes into it; never at home or out of range", () => {
    const early = play(withState(booth, cam("cam.saved", curl, 0)), { type: "STAFF_COUNT", count: 9 });
    const arrived = measured(lastSaved(early), curl, 0);
    const posted = results(play(arrived, { type: "SAVED_NEXT" }));
    expect(posted[0].body).toMatchObject({ value: 9, detail: { countSource: "staff" } });
    const atHome = withState({ ...home, effects: [] }, cam("cam.saved", curl, 0));
    expect(play(atHome, { type: "STAFF_COUNT", count: 9 }).data.staffCount).toEqual({});
    expect(
      play(withState(booth, cam("cam.saved", curl, 0)), { type: "STAFF_COUNT", count: 61 }).data.staffCount,
    ).toEqual({});
  });
});

describe("the guest check in, the context and the safety source", () => {
  it("a guest at the booth never has the check in on (D-016)", () => {
    expect(guestAtPlan().data.checkIn).toBe(false);
  });

  it("the context carries the last check's dose bucket (warn_pd_timing)", () => {
    const raw = { lastPdDoseBucket: "1_2h" } as unknown as ContextResponse;
    expect(toSignedInContext({ ...raw, setting: "home" } as ContextResponse).lastPdDoseBucket).toBe("1_2h");
    expect(toSignedInContext({ setting: "home" } as ContextResponse).lastPdDoseBucket).toBeNull();
  });

  it("a safety screen records where it was routed from", () => {
    const plan = signedPlan();
    const stop = play(
      withState(plan, cam("cam.measure")),
      { type: "STOP" },
      { type: "STOP_OPTION", option: "chest" },
    );
    expect(stop.state).toMatchObject({ kind: "safety", from: "test" });
    const end = play(withState(plan, { kind: "endQuestion" }), { type: "END_ANSWER", yes: true });
    expect(end.state).toMatchObject({ kind: "safety", from: "end" });
  });

  it("a snapshot saved before the new fields restores with their empty values", () => {
    const plan = signedPlan();
    const old = { ...plan, data: { ...plan.data } } as FlowModel;
    delete (old.data as Partial<FlowModel["data"]>).held;
    delete (old.data as Partial<FlowModel["data"]>).armCurl;
    const back = restoredModel(old);
    expect(back.data.held).toEqual({});
    expect(back.data.armCurl).toEqual({ grip: {}, load: {} });
    expect(back.data.protocol).toEqual(plan.data.protocol);
  });
});

/** A signed in first check at home for a person in the given position, at its plan. */
function signedStartedAt(position: "standing" | "chair"): FlowModel {
  const m = signedStarted(contextOf({ position }));
  return m.state.kind === "warnings" ? play(m, { type: "CONTINUE" }) : m;
}

describe("the next day answer in the outbox (S03, 0.7)", () => {
  it("is kept in storage for its account and sent with postAfter when the server can be reached", async () => {
    const store = memoryStore();
    let online = false;
    const sent: string[] = [];
    const q = new ResultQueue(
      {
        postAfter: async (answer) => {
          if (!online) return { ok: false, error: { kind: "network" } };
          sent.push(answer);
          return { ok: true, value: {} as never };
        },
      },
      store,
      "user-1",
    );
    await q.enqueue({ type: "after", answer: "settled" });
    expect(await store.all()).toHaveLength(1);
    expect(await q.flush()).toMatchObject({ sent: 0, waiting: 1 });
    online = true;
    expect(await q.flush()).toMatchObject({ sent: 1, waiting: 0 });
    expect(sent).toEqual(["settled"]);
    // Another account never sends it.
    await q.enqueue({ type: "after", answer: "usual" });
    const other = new ResultQueue(
      { postAfter: async () => ({ ok: true, value: {} as never }) },
      store,
      "user-2",
    );
    expect(await other.flush()).toMatchObject({ sent: 0, waiting: 0 });
    expect(await store.all()).toHaveLength(1);
  });
});
