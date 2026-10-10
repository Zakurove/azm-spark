/**
 * Step B3, row B3 of contract section 10: «the focus shell runs a protocol end to end on fixtures
 * (the day's questions, blocks in C-13 order, stop list, sit before stand, the same joint re-ask)»;
 * since D-032 item 2 the day's questions are one screen. A FocusSession (the shell without its
 * screens) runs whole checks on the real focus routes (the A harness, FOCUS_RULES, AZM_V7 on, a booth
 * pass) with a simulated person in front of the camera (b-shell-driver.ts), and the server's rows are
 * read back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FOCUS_RULES } from "../../server/modules/focus/precheck";
import { romRowsOf } from "../../server/modules/focus/store";
import { createFocusApi } from "../../src/features/focus/api";
import {
  checkParts,
  initialModel,
  painRegions,
  reduce,
  sciWarningOnce,
  startToday,
  type FocusModel,
  type StartResponse,
} from "../../src/features/focus/flow";
import { itemKey } from "../../src/features/focus/romController";
import { FocusSession } from "../../src/features/focus/session";
import { cellOf, jointsOf } from "../../src/features/focus/Screens";
import { buildRomProtocol } from "../../src/medical/rom-protocol";
import type { BridgeEvent } from "../../src/coach/types";
import type { Intake } from "../../src/medical/plan";
import { boothPass, member, startV7Api, v7Intake, type V7Harness } from "./a-harness";
import { runBlock, type PersonPlan } from "./b-shell-driver";

let h: V7Harness;
let pass = "";
let n = 0;

beforeAll(async () => {
  h = await startV7Api(FOCUS_RULES);
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  process.env.AZM_V7 = "1";
  pass = await boothPass(h, Date.now());
});
afterEach(() => {
  for (const k of ["AZM_V7", "AZM_BOOTH_DATES", "AZM_BOOTH_CODE"]) delete process.env[k];
});

/** Fahd's shape (D-025 CT-1): weaker right side after a stroke, walks without an aid; with right knee pain. */
const FAHD: Intake = v7Intake({
  pain: ["knee"],
  regions: [
    { region: "shoulder", side: "right", problems: ["weakness"], origin: "condition" },
    { region: "elbow", side: "right", problems: ["weakness"], origin: "condition" },
    { region: "knee", side: "right", problems: ["weakness", "pain"], origin: "condition" },
  ],
});

async function session(intake = FAHD, consents = ["focus_check"]) {
  n += 1;
  const cookie = await member(h, `shell${n}@example.test`, intake, consents);
  let clock = 1_000_000;
  const s = new FocusSession(
    createFocusApi({
      origin: h.origin,
      headers: { cookie, origin: h.origin },
      boothPass: () => pass,
      online: () => true,
    }),
    { lang: "en", now: () => clock, device: { os: "test", browser: "node" }, restSec: 1, stopRestSeconds: 5 },
  );
  return {
    s,
    tick: (ms: number) => {
      clock += ms;
      return clock;
    },
    get clock() {
      return clock;
    },
  };
}

const settle = async (s: FocusSession, kind: string) => {
  for (let i = 0; i < 200 && s.model.state.kind === kind; i++) await new Promise((r) => setTimeout(r, 5));
};

/**
 * The intro's start (D-034 item 4): straight to the check, with no consent page and no day screen;
 * the start sends pain 0 in each area of the check.
 */
async function begin(s: FocusSession) {
  s.dispatch({ type: "BEGIN" });
  expect(s.model.state.kind).toBe("starting");
  await settle(s, "starting");
}

/** Runs the parts after the start: range parts with the simulated person, the walk not taken today. */
function runParts(s: FocusSession, plan: PersonPlan = {}, t0 = 2_000_000) {
  const ran: string[] = [];
  let t = t0;
  for (let guard = 0; guard < 20 && s.model.state.kind === "part"; guard++) {
    const part = s.model.data.parts[s.model.state.index];
    ran.push(part.kind === "range" ? part.block : "gait");
    if (part.kind === "gait") {
      s.gaitDone();
      continue;
    }
    const run = runBlock(s.ctl!, plan, 900, t);
    t = run.t + 1000;
    if (s.ctl!.current.kind === "ended") break;
  }
  return ran;
}

describe("the focus shell end to end on the real routes", () => {
  it("runs Fahd's check: from the intro straight to the parts in C-13 order, every movement saved, complete", async () => {
    const { s } = await session();
    await s.load();
    expect(s.model.state.kind).toBe("intro");
    const ctx = s.model.data.context!;
    expect(ctx.setting).toBe("booth");
    // D-034 item 4: no day screen; the start says pain 0 in each area of the check.
    s.dispatch({ type: "BEGIN" });
    expect(s.model.data.today).toEqual(startToday(ctx));
    expect(Object.values(s.model.data.today.painByRegion).every((v) => v === 0)).toBe(true);
    expect(Object.keys(s.model.data.today.painByRegion)).toContain("knee");
    await settle(s, "starting");

    expect(s.model.state.kind).toBe("part");
    const check = s.model.data.check!;
    expect(s.model.data.parts.map((p) => (p.kind === "range" ? p.block : "gait"))).toEqual(
      checkParts(check.protocol, check.gait).map((p) => (p.kind === "range" ? p.block : "gait")),
    );
    const ran = runParts(s);
    // C-13: seated, standing (when any), the walk, lying (then sit before stand).
    const order = ["seated", "standing", "gait", "lying"];
    expect(ran).toEqual([...ran].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(ran).toContain("gait");
    expect(ran[ran.length - 1]).toBe("lying");

    await settle(s, "completing");
    expect(s.model.state.kind).toBe("done");
    // Every movement of the day measured and stored with the server's own grade (C-3).
    const runs = check.protocol.items.filter((i) => !i.skipped);
    const rows = romRowsOf(h.db(), check.id);
    for (const item of runs) {
      const row = rows.find((r) => r.movementId === item.movementId && r.side === item.side)!;
      expect(row, itemKey(item)).toBeDefined();
      expect(row.source).toBe("measured");
      expect(s.grades.get(itemKey(item))?.saved).toBe(true);
    }
    // Pain before = 0 (D-034 item 4): every knee movement's score before.
    for (const row of rows.filter((r) => r.movementId.startsWith("knee"))) expect(row.painBefore).toBe(0);
    expect(s.unsent).toBe(0);
  }, 60_000);

  it("the stop list mid movement: the server stores the stopped movement, the check goes on and completes", async () => {
    const { s } = await session();
    await s.load();
    await begin(s);
    let stopped: string | null = null;
    runParts(s, {
      at: (_t, ctl) => {
        if (stopped === null && ctl.phase === "attempt" && ctl.current.kind === "measure") {
          stopped = itemKey(ctl.current.item);
          s.requestStop();
          void s.chooseStop("choice");
        }
      },
    });
    await settle(s, "completing");
    expect(s.model.state.kind).toBe("done");
    const rows = romRowsOf(h.db(), s.model.data.check!.id);
    const row = rows.find((r) => `${r.movementId}:${r.side}` === stopped)!;
    expect(row.source).toBe("not_measured_today");
    expect(row.reason).toBe("by_choice");
    expect(row.value).toBeNull();
  }, 60_000);

  it("a second stop choice with no stop list open does nothing (a double tap)", async () => {
    const { s } = await session();
    await s.load();
    await begin(s);
    const posted: string[] = [];
    const api = (s as unknown as { api: { stop: (...a: unknown[]) => Promise<unknown> } }).api;
    const stop = api.stop.bind(api);
    api.stop = (...a: unknown[]) => {
      posted.push(String(a[1]));
      return stop(...a);
    };
    const events: BridgeEvent[] = [];
    s.onBridge((e) => events.push(e));
    let first: Promise<unknown> | null = null;
    let second: Promise<unknown> | null = null;
    runParts(s, {
      at: (_t, ctl) => {
        if (first === null && ctl.phase === "attempt") {
          s.requestStop();
          first = s.chooseStop("tired");
          second = s.chooseStop("tired");
        }
      },
      until: () => first !== null,
    });
    await first;
    expect(await second).toBeNull();
    expect(posted).toEqual(["tired"]);
    expect(events.filter((e) => e.type === "safety_stop")).toHaveLength(1);
  }, 60_000);

  it("a stop that ends the check leaves for Today after its screen", async () => {
    const { s } = await session();
    await s.load();
    await begin(s);
    runParts(s, {
      at: (_t, ctl) => {
        if (!s.stopListOpen && ctl.phase === "attempt") {
          s.requestStop();
          void s.chooseStop("breath");
        }
      },
    });
    expect(s.model.state.kind).toBe("stop_screen");
    s.dispatch({ type: "SEEN" });
    expect(s.model.state).toEqual({ kind: "exit", to: "today" });
  }, 60_000);

  it("a faint stop asks the faint follow up after its screen: yes opens the emergency screen (sf_faint_loc)", async () => {
    const { s } = await session();
    await s.load();
    await begin(s);
    const events: BridgeEvent[] = [];
    s.onBridge((e) => events.push(e));
    runParts(s, {
      at: (_t, ctl) => {
        if (!s.stopListOpen && ctl.phase === "attempt") {
          s.requestStop("faint");
          void s.chooseStop("faint");
        }
      },
    });
    expect(s.model.state).toMatchObject({ kind: "stop_screen", route: { screen: "scr_faint" } });
    // The coach hears the red flag after the app showed its screen (bridge rule 1).
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["safety_stop", "red_flag"]));
    expect(events.find((e) => e.type === "red_flag")).toMatchObject({ p: 0, screen: "scr_faint" });
    s.dispatch({ type: "SEEN" });
    expect(s.model.state.kind).toBe("faint_ask");
    s.dispatch({ type: "FAINT_ANSWER", value: "yes", now: Date.now() });
    expect(s.model.state).toMatchObject({ kind: "stop_screen", route: { screen: "scr_emergency" } });
    s.dispatch({ type: "SEEN" });
    expect(s.model.state).toEqual({ kind: "exit", to: "today" });
  }, 60_000);

  it("a fall stop's follow up answered no shows the fall screen again, then Today", async () => {
    const { s } = await session();
    await s.load();
    await begin(s);
    runParts(s, {
      at: (_t, ctl) => {
        if (!s.stopListOpen && ctl.phase === "attempt") {
          s.requestStop();
          void s.chooseStop("fall");
        }
      },
    });
    const first = s.model.state;
    expect(first.kind).toBe("stop_screen");
    const screen = first.kind === "stop_screen" ? first.route.screen : null;
    expect(["scr_fall", "scr_fall_seated"]).toContain(screen);
    s.dispatch({ type: "SEEN" });
    expect(s.model.state.kind).toBe("faint_ask");
    s.dispatch({ type: "FAINT_ANSWER", value: "no", now: Date.now() });
    expect(s.model.state).toMatchObject({ kind: "stop_screen", route: { screen } });
    s.dispatch({ type: "SEEN" });
    expect(s.model.state).toEqual({ kind: "exit", to: "today" });
  }, 60_000);

  it("a walk stopped for tiredness rests a minute before the next part's card", async () => {
    const { s } = await session();
    await s.load();
    await begin(s);
    let rested = false;
    for (let guard = 0; guard < 20 && s.model.state.kind === "part"; guard++) {
      const part = s.model.data.parts[s.model.state.index];
      if (part.kind === "gait") {
        s.requestStop();
        expect(s.stopListOpen).toBe(true);
        await s.chooseStop("tired");
        break;
      }
      runBlock(s.ctl!, {}, 900, 2_000_000 + guard * 1_000_000);
    }
    expect(s.model.state.kind).toBe("part");
    const part = s.model.state.kind === "part" ? s.model.data.parts[s.model.state.index] : null;
    expect(part).toEqual({ kind: "range", block: "lying" });
    const step = s.ctl!.current;
    expect(step.kind).toBe("rest");
    rested = step.kind === "rest" && step.total === 5_000;
    expect(rested).toBe(true);
  }, 60_000);

  it("the same joint re-ask through the shell: a pain stop on the knee bend, the knee straightening asks first", async () => {
    const knee: Intake = v7Intake({
      pain: ["knee"],
      regions: [{ region: "knee", side: "right", problems: ["pain"], origin: "person" }],
      walking: { status: "no" },
    });
    const { s } = await session(knee);
    await s.load();
    await begin(s);
    const steps: string[] = [];
    runParts(s, {
      hurts: (i) => (i.movementId === "knee_flexion" ? { level: 7 } : null),
      reask: () => 3,
      at: (_t, ctl) => {
        const c = ctl.current;
        const name = "item" in c ? `${c.kind}:${c.item.movementId}` : c.kind;
        if (steps[steps.length - 1] !== name) steps.push(name);
      },
    });
    expect(steps).toEqual(
      expect.arrayContaining([
        "pain_stop:knee_flexion",
        "reask:knee_extension",
        "setup:knee_extension",
        "sit",
      ]),
    );
    expect(steps.indexOf("reask:knee_extension")).toBeLessThan(steps.indexOf("setup:knee_extension"));
    await settle(s, "completing");
    const rows = romRowsOf(h.db(), s.model.data.check!.id);
    expect(rows.find((r) => r.movementId === "knee_flexion")?.reason).toBe("pain_stop");
    expect(rows.find((r) => r.movementId === "knee_extension")?.painBefore).toBe(3);
  }, 60_000);

  it("a hip pain stop at 7 and a re-ask of 7 in the standing block: no walk today (gait-rules eligibility.today)", async () => {
    const hip: Intake = v7Intake({
      regions: [{ region: "hip", side: "right", problems: ["stiffness"], origin: "person" }],
    });
    const { s } = await session(hip);
    await s.load();
    await begin(s);
    expect(s.model.data.parts.map((p) => (p.kind === "range" ? p.block : "gait"))).toEqual([
      "standing",
      "gait",
      "lying",
    ]);
    runBlock(
      s.ctl!,
      {
        hurts: (i) => (i.movementId === "hip_extension" ? { level: 7 } : null),
        reask: () => 7,
      },
      900,
      2_000_000,
    );
    // The walk is not opened: its card says why, then the next part (the lying hip bend, not
    // measured today for pain, so the lying block ends at once) and the end of the check.
    expect(s.model.state).toEqual({ kind: "walk_skipped", index: 1 });
    s.dispatch({ type: "SEEN" });
    await settle(s, "completing");
    expect(s.model.state.kind).toBe("done");
    const rows = romRowsOf(h.db(), s.model.data.check!.id);
    expect(rows.find((r) => r.movementId === "hip_flexion")?.reason).toBe("pain_today");
  }, 60_000);

  it("a hip pain stop by a rise below 6: the walk asks the hip's pain first, and the answer is the walk's score before", async () => {
    const hip: Intake = v7Intake({
      regions: [{ region: "hip", side: "right", problems: ["stiffness"], origin: "person" }],
    });
    const { s } = await session(hip);
    await s.load();
    await begin(s);
    runBlock(
      s.ctl!,
      { hurts: (i) => (i.movementId === "hip_abduction" ? { level: 3 } : null) },
      900,
      2_000_000,
    );
    expect(s.model.state).toEqual({ kind: "walk_pain", index: 1, regions: ["hip"], k: 0 });
    s.answerWalkPain(3);
    expect(s.model.state).toEqual({ kind: "part", index: 1 });
    expect(s.walkBefore).toBe(3);
  }, 60_000);

  it("a walk re-ask of 6 skips the walk", async () => {
    const hip: Intake = v7Intake({
      regions: [{ region: "hip", side: "right", problems: ["stiffness"], origin: "person" }],
    });
    const { s } = await session(hip);
    await s.load();
    await begin(s);
    runBlock(
      s.ctl!,
      { hurts: (i) => (i.movementId === "hip_abduction" ? { level: 3 } : null) },
      900,
      2_000_000,
    );
    s.answerWalkPain(6);
    expect(s.model.state).toEqual({ kind: "walk_skipped", index: 1 });
  }, 60_000);

  it("an MS check goes straight to its first part: no warnings screen (D-032 item 2), then runs and completes", async () => {
    const ms: Intake = v7Intake({
      conditions: ["ms"],
      regions: [{ region: "knee", side: "right", problems: ["stiffness"], origin: "person" }],
      walking: { status: "no" },
    });
    const { s } = await session(ms);
    await s.load();
    await begin(s);
    expect(s.model.state).toEqual({ kind: "part", index: 0 });
    expect(s.model.data.check!.warnings).toEqual([]);
    runParts(s);
    await settle(s, "completing");
    expect(s.model.state.kind).toBe("done");
  }, 60_000);

  it("has no consent page: the intro starts the check and the server records the consents (D-034 item 4)", async () => {
    const { s } = await session(v7Intake(), []);
    await s.load();
    expect(s.model.data.context!.consent.focus_check).toBe(false);
    expect(s.model.state.kind).toBe("intro");
    await begin(s);
    expect(s.model.state.kind).toBe("part");
  });
});

describe("the intro's joints (plan 1.7: which joints we will measure)", () => {
  it("groups the day's movements by joint in body order, the right side first, each with its movements", () => {
    const items = buildRomProtocol({
      intake: v7Intake({
        regions: [
          { region: "knee", side: "left", problems: ["stiffness"], origin: "person" },
          { region: "shoulder", side: "right", problems: ["stiffness"], origin: "person" },
          { region: "knee", side: "right", problems: ["stiffness"], origin: "person" },
        ],
      }) as Parameters<typeof buildRomProtocol>[0]["intake"],
      setting: "booth",
      today: { painByRegion: {}, redFlagRegions: [] },
    }).items.filter((i) => !i.skipped);
    const joints = jointsOf(items);
    expect(joints.map((g) => g.key)).toEqual(["shoulder:right", "knee:right", "knee:left"]);
    for (const g of joints)
      expect(g.items.map(itemKey)).toEqual(
        items.filter((i) => `${i.region}:${i.side}` === g.key).map(itemKey),
      );
    expect(joints.map(cellOf)).toEqual(["shoulder:right", "knee:right", "knee:left"]);
    expect(cellOf({ region: "back_trunk", side: "none" })).toBe("back_trunk:axial");
  });
});

describe("the day the start sends (2.5; D-034 item 4: no day screen)", () => {
  it("covers the pain of each pain or injury region in body order", () => {
    const intake = v7Intake({
      regions: [
        { region: "knee", side: "right", problems: ["pain"], origin: "person" },
        {
          region: "shoulder",
          side: "left",
          problems: ["injury"],
          origin: "person",
          injury: { since: "gt6m" },
        },
        { region: "hip", side: "right", problems: ["stiffness"], origin: "person" },
      ],
    });
    expect(painRegions(intake)).toEqual(["shoulder", "knee"]);
  });

  it("the start's day: pain 0 in each area of the check, the leg and back regions with the walk (D-034 item 4)", () => {
    const protocol = buildRomProtocol({
      intake: v7Intake({
        regions: [{ region: "shoulder", side: "right", problems: ["stiffness"], origin: "person" }],
      }) as Parameters<typeof buildRomProtocol>[0]["intake"],
      setting: "booth",
      today: { painByRegion: {}, redFlagRegions: [] },
    });
    expect(startToday({ protocol, gait: null })).toEqual({
      painByRegion: { shoulder: 0 },
      redFlagRegions: [],
    });
    expect(startToday(null)).toEqual({ painByRegion: {}, redFlagRegions: [] });
  });
});

describe("after the start (D-032 item 2: no warnings screen, no helper briefing, no seek care step)", () => {
  const protocolOf = (intake: Intake) =>
    buildRomProtocol({
      intake: intake as Parameters<typeof buildRomProtocol>[0]["intake"],
      setting: "booth",
      today: { painByRegion: {}, redFlagRegions: [] },
    });
  const started = (r: Partial<StartResponse> & Pick<StartResponse, "protocol">): FocusModel => {
    const m0 = initialModel();
    const m: FocusModel = { state: { kind: "starting", error: null }, data: m0.data };
    return reduce(m, {
      type: "START_OK",
      response: {
        id: "c1",
        kind: "baseline",
        gait: null,
        warnings: [],
        helperRequired: [],
        helperBriefing: {},
        ...r,
      },
    });
  };

  it("goes straight to the first part whatever an older server returns", () => {
    const m = started({
      protocol: protocolOf(FAHD),
      warnings: ["warn_sci_t6", "scr_helper_brief_trunk", "warn_ms_cool", "scr_stop_seek_care"],
      helperRequired: ["rom_seated"],
      helperBriefing: { trunk_control_seated: "scr_helper_brief_trunk" },
    });
    expect(m.state).toEqual({ kind: "part", index: 0 });
    expect(m.data.parts.map((p) => (p.kind === "range" ? p.block : "gait"))).toEqual(["seated", "lying"]);
    expect(reduce(m, { type: "PART_DONE" }).state).toEqual({ kind: "part", index: 1 });
  });

  it("says the SCI warning once on the intro for a spinal cord injury at T6 or above or of an unknown level", () => {
    const env = (conditions: string[], sciT6?: boolean) =>
      ({
        ctx: { conditions },
        setup: sciT6 === undefined ? null : { sciT6 },
      }) as never;
    expect(sciWarningOnce(env(["sci_incomplete"]))).toBe(true);
    expect(sciWarningOnce(env(["sci_complete"], true))).toBe(true);
    expect(sciWarningOnce(env(["sci_complete"], false))).toBe(false);
    expect(sciWarningOnce(env(["stroke"]))).toBe(false);
    expect(sciWarningOnce(null)).toBe(false);
  });
});

describe("a movement the server refuses (wave 2: never dropped silently)", () => {
  it("is kept on the session with the refusal's code", async () => {
    const api = {
      saveRom: async () => ({ ok: false, error: { kind: "http", status: 400, code: "RESULT_INVALID" } }),
    } as unknown as ConstructorParameters<typeof FocusSession>[0];
    const s = new FocusSession(api, { lang: "en" });
    s.model = { ...s.model, data: { ...s.model.data, check: { id: "c1" } as StartResponse } };
    const item = { movementId: "knee_flexion", side: "right" } as never;
    (s as unknown as { outbox: unknown[] }).outbox.push({ item, result: {} });
    await s.flush();
    expect(s.unsent).toBe(0);
    expect(s.refused).toEqual([{ movementId: "knee_flexion", side: "right", code: "RESULT_INVALID" }]);
  });
});
