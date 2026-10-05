/**
 * Step B3, row B3 of contract section 10: «the focus shell runs a protocol end to end on fixtures
 * (pre-check, today questions with rf_region, blocks in C-13 order, stop list, sit before stand, the
 * same joint re-ask)». A FocusSession (the shell without its screens) runs whole checks on the real
 * focus routes (the A harness, FOCUS_RULES, AZM_V7 on, a booth pass) with a simulated person in front
 * of the camera (b-shell-driver.ts), and the server's rows are read back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FOCUS_RULES } from "../../server/modules/focus/precheck";
import { romRowsOf } from "../../server/modules/focus/store";
import { createFocusApi } from "../../src/features/focus/api";
import {
  checkParts,
  checkWarningsOf,
  initialModel,
  painRegions,
  partWarnings,
  reduce,
  todayQuestions,
  type FocusModel,
  type StartResponse,
  type TodayQuestion,
} from "../../src/features/focus/flow";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import { itemKey } from "../../src/features/focus/romController";
import { FocusSession } from "../../src/features/focus/session";
import { cellOf, jointsOf } from "../../src/features/focus/Screens";
import { buildRomProtocol } from "../../src/medical/rom-protocol";
import type { BridgeEvent } from "../../src/coach/types";
import type { Intake } from "../../src/medical/plan";
import { benign } from "../precheck-fixtures";
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

/** Answers the pre-check with benign answers, and the day questions with `today`. */
async function answerAll(s: FocusSession, today: (q: TodayQuestion) => number | boolean) {
  s.dispatch({ type: "BEGIN" });
  const asked: string[] = [];
  while (s.model.state.kind === "question") {
    const id = s.model.state.id;
    asked.push(id);
    s.dispatch({ type: "ANSWER", id, value: benign(id), now: Date.now() });
  }
  const day: TodayQuestion[] = [];
  while (s.model.state.kind === "today") {
    const q = s.model.data.todayQs[s.model.state.index];
    day.push(q);
    s.dispatch({ type: "TODAY", value: today(q) });
  }
  await settle(s, "starting");
  return { asked, day };
}

const noFlags = (q: TodayQuestion) => (q.kind === "pain" ? 2 : q.kind === "rf" ? false : true);

/** Runs the parts after the start: range parts with the simulated person, the walk not taken today. */
function runParts(s: FocusSession, plan: PersonPlan = {}, t0 = 2_000_000) {
  const ran: string[] = [];
  let t = t0;
  // The warnings of the whole check and a helper briefing are read and confirmed first.
  const confirm = () => {
    if (s.model.state.kind === "warnings") s.dispatch({ type: "SEEN" });
    if (s.model.state.kind === "brief") s.dispatch({ type: "HELPER_READY" });
  };
  confirm();
  for (let guard = 0; guard < 20 && s.model.state.kind === "part"; guard++, confirm()) {
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
  it("runs Fahd's check: pre-check, the day questions, the parts in C-13 order, every movement saved, complete", async () => {
    const { s } = await session();
    await s.load();
    expect(s.model.state.kind).toBe("intro");
    const ctx = s.model.data.context!;
    expect(ctx.setting).toBe("booth");
    const { asked, day } = await answerAll(s, noFlags);
    expect(asked.length).toBeGreaterThan(0);
    // The day questions: the knee's pain now, rf_region for each region of the day, the walk's 10 m.
    expect(day.filter((q) => q.kind === "pain")).toEqual([{ kind: "pain", region: "knee" }]);
    expect(day.filter((q) => q.kind === "rf").map((q) => (q as { region: string }).region)).toEqual(
      expect.arrayContaining(["shoulder", "elbow", "knee"]),
    );
    expect(day.some((q) => q.kind === "walk10m")).toBe(true);

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
    // The knee's pain today is every knee movement's score before.
    for (const row of rows.filter((r) => r.movementId.startsWith("knee"))) expect(row.painBefore).toBe(2);
    expect(s.unsent).toBe(0);
  }, 60_000);

  it("a red flag region shows the seek care screen once, and its movements are not measured (red_flag)", async () => {
    const { s } = await session();
    await s.load();
    await answerAll(s, (q) => (q.kind === "rf" ? q.region === "elbow" : noFlags(q)));
    expect(s.model.state).toEqual({ kind: "seek_care", then: "parts" });
    const check = s.model.data.check!;
    const elbow = check.protocol.items.filter((i) => i.region === "elbow");
    expect(elbow.length).toBeGreaterThan(0);
    for (const i of elbow) expect(i.skipped).toBe("red_flag");
    s.dispatch({ type: "SEEN" });
    expect(s.model.state).toEqual({ kind: "part", index: 0 });
    runParts(s);
    await settle(s, "completing");
    const rows = romRowsOf(h.db(), check.id);
    for (const i of elbow) {
      const row = rows.find((r) => r.movementId === i.movementId);
      expect(row?.source).toBe("not_measured_today");
      expect(row?.reason).toBe("red_flag");
    }
  }, 60_000);

  it("the stop list mid movement: the server stores the stopped movement, the check goes on and completes", async () => {
    const { s } = await session();
    await s.load();
    await answerAll(s, noFlags);
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
    await answerAll(s, noFlags);
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
    await answerAll(s, noFlags);
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
    await answerAll(s, noFlags);
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
    await answerAll(s, noFlags);
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
    await answerAll(s, noFlags);
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
    await answerAll(s, noFlags);
    const steps: string[] = [];
    runParts(s, {
      answerMax: (i) => (i.movementId === "knee_flexion" ? "hurts" : "yes"),
      pain: () => ({ level: 7 }),
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

  it("an emergency answer shows its screen at once and the server records the lock", async () => {
    const { s } = await session();
    await s.load();
    s.dispatch({ type: "BEGIN" });
    let guard = 0;
    while (s.model.state.kind === "question" && guard++ < 50) {
      const id = s.model.state.id;
      s.dispatch({ type: "ANSWER", id, value: id === "pc_urgent" ? "yes" : benign(id), now: Date.now() });
    }
    expect(s.model.state.kind).toBe("postponed");
    if (s.model.state.kind !== "postponed") return;
    expect(s.model.state.status).toBe("emergency");
    expect(s.model.state.screen).toBe("scr_emergency");
    for (let i = 0; i < 100 && s.model.state.kind === "postponed" && !s.model.state.lock; i++)
      await new Promise((r) => setTimeout(r, 5));
    expect(s.model.state.kind === "postponed" && s.model.state.lock).toBeTruthy();
  });

  it("a hip pain stop at 7 and a re-ask of 7 in the standing block: no walk today (gait-rules eligibility.today)", async () => {
    const hip: Intake = v7Intake({
      regions: [{ region: "hip", side: "right", problems: ["stiffness"], origin: "person" }],
    });
    const { s } = await session(hip);
    await s.load();
    await answerAll(s, noFlags);
    expect(s.model.data.parts.map((p) => (p.kind === "range" ? p.block : "gait"))).toEqual([
      "standing",
      "gait",
      "lying",
    ]);
    runBlock(
      s.ctl!,
      {
        answerMax: (i) => (i.movementId === "hip_extension" ? "hurts" : "yes"),
        pain: () => ({ level: 7 }),
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
    await answerAll(s, noFlags);
    runBlock(
      s.ctl!,
      { answerMax: (i) => (i.movementId === "hip_abduction" ? "hurts" : "yes"), pain: () => ({ level: 3 }) },
      900,
      2_000_000,
    );
    expect(s.model.state).toEqual({ kind: "walk_pain", index: 1, regions: ["hip"], k: 0, then: "part" });
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
    await answerAll(s, noFlags);
    runBlock(
      s.ctl!,
      { answerMax: (i) => (i.movementId === "hip_abduction" ? "hurts" : "yes"), pain: () => ({ level: 3 }) },
      900,
      2_000_000,
    );
    s.answerWalkPain(6);
    expect(s.model.state).toEqual({ kind: "walk_skipped", index: 1 });
  }, 60_000);

  it("an MS check reads warn_ms_cool once before the first part, then runs and completes", async () => {
    const ms: Intake = v7Intake({
      conditions: ["ms"],
      regions: [{ region: "knee", side: "right", problems: ["stiffness"], origin: "person" }],
      walking: { status: "no" },
    });
    const { s } = await session(ms);
    await s.load();
    await answerAll(s, noFlags);
    expect(s.model.state).toEqual({ kind: "warnings" });
    expect(s.model.data.check!.warnings).toContain("warn_ms_cool");
    runParts(s);
    await settle(s, "completing");
    expect(s.model.state.kind).toBe("done");
  }, 60_000);

  it("closes without the v7 body questions, and asks for the consent first", async () => {
    const { s } = await session(v7Intake(), []);
    await s.load();
    expect(s.model.state.kind).toBe("consent");
    await s.consent();
    expect(s.model.state.kind).toBe("intro");
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

describe("the day questions (2.5)", () => {
  it("asks the pain of each pain or injury region in body order, then rf_region, then the walk", () => {
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

  it("includes nothing for the walk when it is not planned", () => {
    const qs = todayQuestions(
      v7Intake({ walking: { status: "no" } }),
      { rulesVersion: "x", items: [], deferred: [], notMeasured: [], sitBeforeStand: false },
      null,
    );
    expect(qs.filter((q) => q.kind === "walk10m" || q.kind === "pdFreezing")).toEqual([]);
  });
});

describe("the v1 warnings and helper briefings the start returns (C-2, C-16, v1.1 S25, S26 and S28)", () => {
  const MS_CHAIR = v7Intake({
    mobility: "wheelchair",
    conditions: ["ms"],
    regions: [
      { region: "back_trunk", side: "axial", problems: ["stiffness"], origin: "person" },
      { region: "knee", side: "right", problems: ["stiffness"], origin: "person" },
    ],
  });
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

  it("shows the warnings of the whole check once before the first part, then the helper briefing, then the part", () => {
    const protocol = protocolOf(MS_CHAIR);
    let m = started({
      protocol,
      warnings: ["warn_sci_t6", "scr_helper_brief_trunk", "warn_ms_cool"],
      helperRequired: ["rom_seated"],
      helperBriefing: { trunk_control_seated: "scr_helper_brief_trunk" },
    });
    expect(m.state).toEqual({ kind: "warnings" });
    expect(checkWarningsOf(m.data.check!.warnings)).toEqual(["warn_ms_cool"]);
    m = reduce(m, { type: "SEEN" });
    // The side bend in seated_armrests runs in the seated block: its briefing is a confirm step first.
    expect(m.state).toEqual({ kind: "brief", index: 0, screen: "scr_helper_brief_trunk" });
    expect(reduce(m, { type: "PART_DONE" }).state).toEqual(m.state);
    m = reduce(m, { type: "HELPER_READY" });
    expect(m.state).toEqual({ kind: "part", index: 0 });
  });

  it("goes straight to the first part when every warning is shown with its part", () => {
    const m = started({ protocol: protocolOf(MS_CHAIR), warnings: ["warn_sci_t6", "warn_weak_shoulder"] });
    expect(m.state).toEqual({ kind: "part", index: 0 });
  });

  it("shows the seek care screen of a red flag region first, then the warnings", () => {
    let m = started({ protocol: protocolOf(MS_CHAIR), warnings: ["warn_ms_cool", "scr_stop_seek_care"] });
    expect(m.state).toEqual({ kind: "seek_care", then: "parts" });
    m = reduce(m, { type: "SEEN" });
    expect(m.state).toEqual({ kind: "warnings" });
    m = reduce(m, { type: "SEEN" });
    expect(m.state).toEqual({ kind: "part", index: 0 });
  });

  it("the chair stand's briefing comes before the standing block and before the walk", () => {
    const protocol = protocolOf(
      v7Intake({
        regions: [
          { region: "shoulder", side: "right", problems: ["stiffness"], origin: "person" },
          { region: "hip", side: "right", problems: ["stiffness"], origin: "person" },
        ],
      }),
    );
    const gait = {
      offered: true,
      modes: ["overground"],
      padAllowed: false,
      helperRequired: true,
      antalgicOnly: false,
      staticStance: false,
      views: { overground: ["side"], walking_pad: [] },
    } as unknown as GaitPlan;
    let m = started({ protocol, gait, helperBriefing: { chair_stand_30s: "scr_helper_brief_stand" } });
    const kinds = m.data.parts.map((p) => (p.kind === "range" ? p.block : "gait"));
    expect(kinds).toEqual(["seated", "standing", "gait", "lying"]);
    // The seated block has no side bend: no briefing before it.
    expect(m.state).toEqual({ kind: "part", index: 0 });
    m = reduce(m, { type: "PART_DONE" });
    expect(m.state).toEqual({ kind: "brief", index: 1, screen: "scr_helper_brief_stand" });
    m = reduce(m, { type: "HELPER_READY" });
    expect(m.state).toEqual({ kind: "part", index: 1 });
    m = reduce(m, { type: "PART_DONE" });
    expect(m.state).toEqual({ kind: "brief", index: 2, screen: "scr_helper_brief_stand" });
    m = reduce(reduce(m, { type: "HELPER_READY" }), { type: "PART_DONE" });
    expect(m.state).toEqual({ kind: "part", index: 3 });
  });

  it("warn_sci_t6 goes with every part, and warn_weak_shoulder with a block that moves an arm", () => {
    const protocol = protocolOf(FAHD);
    const warnings: StartResponse["warnings"] = ["warn_sci_t6", "warn_weak_shoulder", "warn_ms_cool"];
    expect(partWarnings(warnings, { kind: "range", block: "seated" }, protocol)).toEqual([
      "warn_sci_t6",
      "warn_weak_shoulder",
    ]);
    expect(partWarnings(warnings, { kind: "range", block: "lying" }, protocol)).toEqual(["warn_sci_t6"]);
    expect(partWarnings(warnings, { kind: "gait" }, protocol)).toEqual(["warn_sci_t6"]);
    expect(partWarnings(["warn_ms_cool"], { kind: "gait" }, protocol)).toEqual([]);
  });
});
