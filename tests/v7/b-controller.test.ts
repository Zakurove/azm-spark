/**
 * Step B3 (product v7 contract 2.6, 2.11, C-13, C-15, C-16, C-17 and 8.1 B): the RomController of the
 * focus shell. The range blocks run in C-13 order with one runner per movement; after a pain stop the
 * next movement of the same joint asks the pain question first (the same joint re-ask); the lying block
 * ends with the sit before stand minute; STOP opens the stop list and the stopped movement keeps no
 * value; and the controller is the CoachHost of the range blocks, every step with its C-16 kind.
 */
import { describe, expect, it } from "vitest";
import { RomController, itemKey, type RomControllerOptions } from "../../src/features/focus/romController";
import { buildRomProtocol, type RomProtocol, type RomProtocolItem } from "../../src/medical/rom-protocol";
import { ROM_DATA } from "../../src/movements/rom";
import type { BridgeEvent } from "../../src/coach/types";
import { entry, intake, today } from "./a-fixtures";
import { bridges, lines, runBlock, saves } from "./b-shell-driver";
import { MOVEMENT_CASES } from "./b-person";
import { elbowExtensionPose } from "./b-driver";
import { point, rotate } from "./b-poses";

const KNEE = intake({ regions: [entry("knee", "right", ["stiffness"])] });
const MIXED = intake({
  regions: [
    entry("shoulder", "right", ["stiffness"]),
    entry("hip", "right", ["stiffness"]),
    entry("knee", "right", ["stiffness"]),
  ],
});

function protocolOf(h: ReturnType<typeof intake>): RomProtocol {
  return buildRomProtocol({ intake: h, setting: "booth", today: today() });
}

function controller(protocol: RomProtocol, over: Partial<RomControllerOptions> = {}): RomController {
  return new RomController({
    protocol,
    painByRegion: {},
    intake: KNEE,
    lang: "en",
    restSec: 1,
    ...over,
  });
}

const keysOf = (items: readonly RomProtocolItem[]) => items.map(itemKey);

describe("the range blocks in C-13 order", () => {
  it("runs the blocks with a movement today as seated, standing, lying, each in protocol order", () => {
    const p = protocolOf(MIXED);
    const ctl = controller(p);
    expect(ctl.blocks()).toEqual(["seated", "standing", "lying"]);
    ctl.startBlock("lying", 0);
    const s = ctl.current;
    expect(s.kind).toBe("block");
    if (s.kind !== "block") return;
    expect(keysOf(s.items)).toEqual(keysOf(p.items.filter((i) => i.block === "lying" && !i.skipped)));
    expect(ctl.step()).toEqual({ kind: "confirm", finished: false });
  });

  it("leaves out a block with no movement today, and skipped movements", () => {
    const p = protocolOf(KNEE);
    expect(controller(p).blocks()).toEqual(["lying"]);
    const skipped: RomProtocol = {
      ...p,
      items: p.items.map((i) => (i.movementId === "knee_flexion" ? { ...i, skipped: "red_flag" } : i)),
    };
    const ctl = controller(skipped);
    ctl.startBlock("lying", 0);
    const s = ctl.current;
    expect(s.kind === "block" && keysOf(s.items)).toEqual(["knee_extension:right"]);
  });

  it("runs a block end to end on simulated frames: every movement measured and saved, the steps in order", () => {
    const p = protocolOf(KNEE);
    const ctl = controller(p);
    ctl.startBlock("lying", 0);
    const run = runBlock(ctl, {}, 400);
    const saved = saves(run.events);
    expect(saved.map((e) => itemKey(e.item))).toEqual(["knee_flexion:right", "knee_extension:right"]);
    for (const e of saved) {
      expect(e.result.status).toBe("measured");
      expect(Math.abs(e.result.value! - MOVEMENT_CASES[e.item.movementId].target)).toBeLessThanOrEqual(2);
    }
    expect(run.steps).toEqual([
      "block",
      "setup:knee_flexion:right",
      "measure:knee_flexion:right",
      "result:knee_flexion:right",
      "setup:knee_extension:right",
      "measure:knee_extension:right",
      "result:knee_extension:right",
      "sit",
      "end",
    ]);
  });
});

describe("the same joint re-ask (contract 2.6, rom-protocol 6 pain_during)", () => {
  const hurtsOnKneeBend = {
    answerMax: (i: RomProtocolItem) =>
      i.movementId === "knee_flexion" ? ("hurts" as const) : ("yes" as const),
    pain: () => ({ level: 6 }),
  };

  it("a pain stop on knee_flexion, then knee_extension asks first", () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    const run = runBlock(ctl, { ...hurtsOnKneeBend, reask: () => 3 }, 400);
    expect(run.steps).toContain("pain_stop:knee_flexion:right");
    const reask = run.steps.indexOf("reask:knee_extension:right");
    expect(reask).toBeGreaterThan(run.steps.indexOf("pain_stop:knee_flexion:right"));
    expect(run.steps[reask + 1]).toBe("setup:knee_extension:right");
    const [bend, straight] = saves(run.events);
    expect(bend.result.status).toBe("stopped");
    expect(bend.result.reason).toBe("pain_stop");
    expect(bend.result.painLimited).toBe(true);
    // The re-ask's answer is the next movement's score before.
    expect(straight.result.painBefore).toBe(3);
    expect(straight.result.status).toBe("measured");
    // The coach hears the pain stop first (P0), then the re-ask (P1).
    const evs = bridges(run.events);
    const stop = evs.findIndex((e) => e.type === "safety_stop" && e.reason === "pain_stop");
    const ask = evs.findIndex(
      (e: BridgeEvent) => e.type === "ask_pain" && e.movement === "knee_extension" && stop >= 0,
    );
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(ask).toBeGreaterThan(stop);
  });

  it("an answer of 6 or more skips the region's remaining movements (pain_today)", () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    const run = runBlock(ctl, { ...hurtsOnKneeBend, reask: () => 6 }, 400);
    expect(run.steps).not.toContain("setup:knee_extension:right");
    const straight = saves(run.events).find((e) => e.item.movementId === "knee_extension")!;
    expect(straight.result.status).toBe("not_measured");
    expect(straight.result.reason).toBe("pain_today");
    expect(straight.result.value).toBeNull();
  });

  it("asks before the next movement of the same joint only, not another joint", () => {
    const h = intake({
      regions: [entry("hip", "right", ["stiffness"]), entry("knee", "right", ["stiffness"])],
    });
    const p = protocolOf(h);
    const lying = p.items.filter((i) => i.block === "lying" && !i.skipped).map(itemKey);
    expect(lying[0]).toBe("hip_flexion:right");
    const ctl = controller(p, { intake: h });
    ctl.startBlock("lying", 0);
    const run = runBlock(
      ctl,
      { answerMax: (i) => (i.movementId === "hip_flexion" ? "hurts" : "yes"), pain: () => ({ level: 7 }) },
      600,
    );
    expect(run.steps).toContain("pain_stop:hip_flexion:right");
    expect(run.steps.filter((s) => s.startsWith("reask"))).toEqual([]);
  });

  it("a pain below the rule after «it hurts» keeps the value pain limited and asks nothing more", () => {
    // No pain before (null counts as 0): 1 is below the rule, 2 would be a rise of 2.
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    const run = runBlock(
      ctl,
      {
        answerMax: (i, _h, k) => (i.movementId === "knee_flexion" && k === 2 ? "hurts" : "yes"),
        pain: () => ({ level: 1 }),
      },
      400,
    );
    const bend = saves(run.events).find((e) => e.item.movementId === "knee_flexion")!;
    expect(bend.result.status).toBe("measured");
    expect(bend.result.painLimited).toBe(true);
    expect(run.steps.filter((s) => s.startsWith("reask"))).toEqual([]);
  });
});

describe("sit before stand (rom-protocol 6 sit_before_stand)", () => {
  it("ends the lying block with the minute, a timer the coach cannot skip", () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    const run = runBlock(ctl, { until: (c) => c.current.kind === "sit" }, 400);
    const s = ctl.current;
    expect(s.kind).toBe("sit");
    if (s.kind !== "sit") return;
    expect(s.total).toBe(ROM_DATA.engine.sitBeforeStandSeconds * 1000);
    expect(lines(run.events)).toContain("sit_before_stand");
    expect(ctl.step()).toEqual({ kind: "timer", finished: false });
    expect(ctl.handleTool("next_step", {})).toEqual({
      accepted: false,
      reason: "not_allowed",
      say: "tap_to_confirm",
    });
    expect(ctl.ready(run.t)).toBe(false);
    expect(ctl.next(run.t)).toBe(false);
    ctl.tick(s.until - 1);
    expect(ctl.current.kind).toBe("sit");
    ctl.tick(s.until);
    expect(ctl.current.kind).toBe("end");
  });

  it("has no minute after a seated or standing block", () => {
    const h = intake({ regions: [entry("elbow", "right", ["stiffness"])] });
    const ctl = controller(protocolOf(h), { intake: h });
    ctl.startBlock("seated", 0);
    const run = runBlock(ctl, {}, 400);
    expect(run.steps).not.toContain("sit");
    expect(run.steps[run.steps.length - 1]).toBe("end");
  });
});

describe("the stop list", () => {
  const atAttempt = (then: (t: number, ctl: RomController) => void) => {
    let done = false;
    return (t: number, ctl: RomController) => {
      if (!done && ctl.phase === "attempt") {
        done = true;
        then(t, ctl);
      }
    };
  };

  it("STOP stops the movement for good: no value, nothing saved from the phone, the stop list open (safety)", () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    const run = runBlock(ctl, { at: atAttempt((t, c) => c.requestStop(t)), until: (c) => !!c.stopList }, 200);
    expect(ctl.stopList).toEqual({
      preselect: null,
      item: expect.objectContaining({ movementId: "knee_flexion" }),
    });
    expect(ctl.step()).toEqual({ kind: "safety", finished: false });
    expect(saves(run.events)).toEqual([]);
    expect(bridges(run.events).some((e) => e.type === "safety_stop" && e.reason === "user_stop")).toBe(true);
    // The person's taps do nothing until the list is answered.
    expect(ctl.ready(run.t)).toBe(false);
    ctl.stopRouted({ endsCheck: false, afterRest: false }, run.t + 1000);
    expect(ctl.current.kind).toBe("setup");
    expect(ctl.current.kind === "setup" && ctl.current.item.movementId).toBe("knee_extension");
    // The stopped movement is never offered again.
    const rest = runBlock(ctl, {}, 300, run.t + 1000);
    expect(saves(rest.events).map((e) => itemKey(e.item))).toEqual(["knee_extension:right"]);
  });

  it("a stop for tiredness rests a minute before the next movement", () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    const run = runBlock(ctl, { at: atAttempt((t, c) => c.requestStop(t)), until: (c) => !!c.stopList }, 200);
    ctl.stopRouted({ endsCheck: false, afterRest: true }, run.t);
    const s = ctl.current;
    expect(s.kind).toBe("rest");
    expect(ctl.step().kind).toBe("timer");
    if (s.kind !== "rest") return;
    expect(s.total).toBe(60_000);
    ctl.tick(run.t + 59_000);
    expect(ctl.current.kind).toBe("rest");
    ctl.tick(run.t + 60_000);
    expect(ctl.current.kind).toBe("setup");
  });

  it("a stop for pain asks the pain question before the same joint's next movement", () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    const run = runBlock(ctl, { at: atAttempt((t, c) => c.requestStop(t)), until: (c) => !!c.stopList }, 200);
    ctl.stopRouted({ endsCheck: false, afterRest: false, then: "bt_pain_after" }, run.t);
    expect(ctl.current.kind).toBe("reask");
  });

  it("a stop for pain on a result card asks the pain question before that joint's next movement", () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    const run = runBlock(ctl, { until: (c) => c.current.kind === "result" }, 300);
    ctl.requestStop(run.t);
    // Nothing was running: no movement is stopped, the measured one keeps its value.
    expect(ctl.stopList?.item).toBeNull();
    ctl.stopRouted({ endsCheck: false, afterRest: false, then: "bt_pain_after" }, run.t + 500);
    expect(ctl.current.kind).toBe("result");
    ctl.next(run.t + 1000);
    expect(ctl.current.kind).toBe("reask");
    expect(ctl.current.kind === "reask" && ctl.current.item.movementId).toBe("knee_extension");
  });

  it("a stop for pain on the block card asks before the block's first movement", () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    ctl.requestStop(10);
    ctl.stopRouted({ endsCheck: false, afterRest: false, then: "bt_pain_after" }, 20);
    expect(ctl.current.kind).toBe("block");
    ctl.ready(30);
    expect(ctl.current.kind === "reask" && ctl.current.item.movementId).toBe("knee_flexion");
  });

  it("a stop that ends the check ends the range blocks", () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    const run = runBlock(
      ctl,
      { at: atAttempt((t, c) => c.requestStop(t, "chest")), until: (c) => !!c.stopList },
      200,
    );
    expect(ctl.stopList?.preselect).toBe("chest");
    ctl.stopRouted({ endsCheck: true, afterRest: false }, run.t);
    expect(ctl.current.kind).toBe("ended");
  });
});

describe("a region the re-ask skipped, and a rest before a block", () => {
  const HIP = intake({ regions: [entry("hip", "right", ["stiffness"])] });

  it("a later block of only that region's movements ends at once: saved as pain_today, no card, no minute", () => {
    // Hip: extension and abduction standing, flexion lying. A pain stop on the extension, then 6 at
    // the abduction's re-ask: the region is not measured today, in the lying block too.
    const p = protocolOf(HIP);
    expect(p.items.map((i) => `${i.movementId}:${i.block}`)).toEqual([
      "hip_extension:standing",
      "hip_abduction:standing",
      "hip_flexion:lying",
    ]);
    const ctl = controller(p, { intake: HIP });
    ctl.startBlock("standing", 0);
    const run = runBlock(
      ctl,
      {
        answerMax: (i) => (i.movementId === "hip_extension" ? "hurts" : "yes"),
        pain: () => ({ level: 7 }),
        reask: () => 6,
      },
      400,
    );
    expect(run.steps).toContain("reask:hip_abduction:right");
    expect(ctl.current.kind).toBe("end");
    ctl.startBlock("lying", run.t + 1000);
    expect(ctl.current).toEqual({ kind: "end", block: "lying" });
    const flexion = saves(ctl.drain()).find((e) => e.item.movementId === "hip_flexion")!;
    expect(flexion.result.status).toBe("not_measured");
    expect(flexion.result.reason).toBe("pain_today");
  });

  it("a block can start with a rest (after the walk stopped for tiredness), then its card", () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0, { restFirst: true });
    const s = ctl.current;
    expect(s.kind).toBe("rest");
    if (s.kind !== "rest") return;
    expect(s.total).toBe(60_000);
    expect(ctl.step()).toEqual({ kind: "timer", finished: false });
    ctl.tick(59_000);
    expect(ctl.current.kind).toBe("rest");
    ctl.tick(60_000);
    expect(ctl.current.kind).toBe("block");
  });
});

describe("the live setup check while the start pose is taken", () => {
  it("tells the coach a setup issue once, when it appears (P2 setup_issue)", () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    const run = runBlock(
      ctl,
      {
        // Someone stands right beside the person while the start pose is taken.
        people: (lm, _t, c) =>
          c.phase === "calibrating" ? [lm, lm.map((p) => ({ ...p, x: p.x + 0.04 }))] : [lm],
        until: (c) => c.phase === "practice" || c.setupIssue !== null,
      },
      60,
    );
    expect(ctl.setupIssue).toBe("second_person");
    const issues = bridges(run.events).filter((e) => e.type === "setup_issue");
    expect(issues).toEqual([expect.objectContaining({ p: 2, type: "setup_issue", issue: "second_person" })]);
  });
});

describe("corrections and lines", () => {
  it("a compensation's line reaches the caption and the local voice within 1 s of its onset (2.6, section 9 P2)", () => {
    const h = intake({ regions: [entry("elbow", "right", ["stiffness"])] });
    const ctl = controller(protocolOf(h), { intake: h });
    ctl.startBlock("seated", 0);
    let from = Infinity;
    let spoken: number | null = null;
    runBlock(
      ctl,
      {
        // In the first scored attempt of elbow straightening, the upper arm moves 14 degrees forward.
        pose: (item, lack, t, c) => {
          if (item.movementId !== "elbow_extension") return null;
          if (c.phase === "attempt" && c.attempt.index === 1 && lack <= 60 && from === Infinity)
            from = t + 500;
          const px = elbowExtensionPose(lack);
          return t >= from ? rotate(px, [14, 16, 18, 20, 22], point(px, 12), -14) : px;
        },
        at: (t, c) => {
          if (spoken === null && from !== Infinity && lines(c.drain()).includes("elbow_by_side")) spoken = t;
        },
        until: () => spoken !== null,
      },
      200,
    );
    expect(spoken).not.toBeNull();
    expect(spoken! - from).toBeLessThanOrEqual(1000);
  });

  it("plays the runner's phase lines and asks the maximum question locally", () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    const run = runBlock(ctl, { until: (c) => c.current.kind === "result" }, 200);
    const said = lines(run.events);
    for (const l of ["practice", "ask_max", "recorded", "again"] as const) expect(said).toContain(l);
  });
});
