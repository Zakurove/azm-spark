/**
 * D-030 item 2, D5-10 (safety): the focus check's emergency screen carries v1's autonomic dysreflexia
 * screen for a spinal cord injury (O12 (1), emergencyAlsoShow), as v1's flow and the server's stop
 * route add it: on the phone's own routing of a stop list answer (FocusSession.chooseStop) and after
 * the faint question's yes (flow.ts FAINT_ANSWER).
 */
import { describe, expect, it } from "vitest";
import { FocusSession } from "../../src/features/focus/session";
import { initialModel, reduce, type FocusContext, type FocusModel } from "../../src/features/focus/flow";
import type { FocusApi } from "../../src/features/focus/api";
import { workoutStopEnv } from "../../src/features/coach-agent/workoutCoach";
import { stopRoute, type PrecheckEnv } from "../../src/medical/precheck";
import { v1Intake } from "./a-harness";

const SCI = workoutStopEnv(v1Intake({ conditions: ["sci_incomplete"], mobility: "wheelchair" }));
const NO_SCI = workoutStopEnv(v1Intake({ conditions: ["stroke"] }));

function context(env: PrecheckEnv): FocusContext {
  return {
    intakeReady: true,
    setting: "home",
    homeOpen: true,
    adultConfirmed: true,
    consent: { focus_check: true, live_coach: false },
    env,
    protocol: null,
    gait: null,
    lock: null,
    open: null,
    lastCompleted: null,
    earliestNext: null,
  };
}

/** A session on the walk's part (the stop list with nothing to stop on the phone), no check posted. */
function onTheWalk(env: PrecheckEnv): FocusSession {
  const api = { stop: async () => ({ ok: true, value: {} }) } as unknown as FocusApi;
  const s = new FocusSession(api, { lang: "en", now: () => 1_000_000 });
  const base = initialModel();
  s.model = {
    state: { kind: "part", index: 0 },
    data: { ...base.data, context: context(env), parts: [{ kind: "gait" } as never] },
  };
  return s;
}

describe("the focus check's emergency screen for a spinal cord injury (D5-10)", () => {
  it("shows the dysreflexia screen beside the emergency one when the phone routes a stop", async () => {
    const s = onTheWalk(SCI);
    s.requestStop("chest");
    await s.chooseStop("chest");
    expect(s.model.state).toMatchObject({ kind: "stop_screen", route: { screen: "scr_emergency" } });
    const route = (s.model.state as Extract<FocusModel["state"], { kind: "stop_screen" }>).route;
    expect(route.alsoShow).toContain("scr_ad");
  });

  it("adds nothing for a person without a spinal cord injury", async () => {
    const s = onTheWalk(NO_SCI);
    s.requestStop("chest");
    await s.chooseStop("chest");
    const route = (s.model.state as Extract<FocusModel["state"], { kind: "stop_screen" }>).route;
    expect(route.screen).toBe("scr_emergency");
    expect(route.alsoShow).not.toContain("scr_ad");
  });

  it("shows it after the faint question's yes, and not after a no", () => {
    const faint = stopRoute("faint", SCI);
    const asking: FocusModel = {
      state: {
        kind: "faint_ask",
        route: {
          option: faint.option,
          screen: faint.screen,
          alsoShow: faint.alsoShow,
          endsCheck: faint.endsCheck,
          reason: faint.reason,
          then: "sf_faint_loc",
          afterRest: faint.afterRest,
        },
      },
      data: { ...initialModel().data, context: context(SCI) },
    };
    const yes = reduce(asking, { type: "FAINT_ANSWER", value: "yes", now: 1_000_000 });
    expect(yes.state).toMatchObject({ kind: "stop_screen", route: { screen: "scr_emergency" } });
    expect((yes.state as Extract<FocusModel["state"], { kind: "stop_screen" }>).route.alsoShow).toContain(
      "scr_ad",
    );
    const no = reduce(asking, { type: "FAINT_ANSWER", value: "no", now: 1_000_000 });
    expect((no.state as Extract<FocusModel["state"], { kind: "stop_screen" }>).route.screen).toBe(
      faint.screen,
    );
  });
});
