/**
 * Step B3 (product v7 contract 2.6, 2.11, C-13, C-15, C-16, C-17 and 8.1 B): the RomController of the
 * focus shell. The range blocks run in C-13 order with one runner per movement; after a pain stop the
 * next movement of the same joint asks the pain question first (the same joint re-ask); the lying block
 * ends with the sit before stand minute; STOP opens the stop list and the stopped movement keeps no
 * value; and the controller is the CoachHost of the range blocks, every step with its C-16 kind.
 */
import { describe, expect, it } from "vitest";
import {
  RomController,
  SIT_STAND_MS,
  STOP_REST_SECONDS,
  itemKey,
  type RomControllerOptions,
} from "../../src/features/focus/romController";
import { SAFETY_TIMING } from "../../src/features/assessment/safety/timing";
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

describe("no «can you move this joint» (D-034 item 4)", () => {
  it("never asks it, even for a protocol kept before D-034 that says askCanMove: the person just tries", () => {
    const p = protocolOf(KNEE);
    const old: RomProtocol = { ...p, items: p.items.map((i) => ({ ...i, askCanMove: true })) };
    const ctl = controller(old);
    ctl.startBlock("lying", 0);
    ctl.ready(10);
    expect(ctl.current.kind).toBe("setup");
    ctl.ready(20);
    expect(ctl.current.kind).toBe("measure");
    expect(ctl.phase).toBe("calibrating");
  });
});

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
    // The lying block's last measurement goes straight into the sit before stand minute, its result
    // shown in the timer: no one alone stands up to tap a card first (UI review).
    expect(run.steps).toEqual([
      "block",
      "setup:knee_flexion:right",
      "measure:knee_flexion:right",
      "result:knee_flexion:right",
      "setup:knee_extension:right",
      "measure:knee_extension:right",
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

  describe("on the neck and the back, one joint whatever the bend's direction (the body map cell)", () => {
    const NECK = intake({ regions: [entry("neck", "axial", ["stiffness"])] });
    const BACK = intake({ regions: [entry("back_trunk", "axial", ["stiffness"])] });

    it("a pain stop on a neck side bend asks before the other side bend, and 6 skips the neck", () => {
      const ctl = controller(protocolOf(NECK), { intake: NECK });
      ctl.startBlock("seated", 0);
      const run = runBlock(
        ctl,
        {
          answerMax: (i) => (i.movementId === "neck_lateral_flexion" && i.side === "right" ? "hurts" : "yes"),
          pain: () => ({ level: 6 }),
          reask: () => 6,
        },
        600,
      );
      const stop = run.steps.indexOf("pain_stop:neck_lateral_flexion:right");
      expect(stop).toBeGreaterThanOrEqual(0);
      expect(run.steps.slice(stop + 1).find((s) => !s.startsWith("result"))).toBe(
        "reask:neck_lateral_flexion:left",
      );
      expect(run.steps.filter((s) => s.startsWith("setup"))).toEqual(["setup:neck_lateral_flexion:right"]);
      for (const id of ["neck_flexion", "neck_extension"]) {
        const row = saves(run.events).find((e) => e.item.movementId === id)!;
        expect(row.result.status).toBe("not_measured");
        expect(row.result.reason).toBe("pain_today");
      }
    });

    it("the neck's re-ask answer is the score before of its next movements", () => {
      const ctl = controller(protocolOf(NECK), { intake: NECK });
      ctl.startBlock("seated", 0);
      const run = runBlock(
        ctl,
        {
          answerMax: (i) => (i.movementId === "neck_lateral_flexion" && i.side === "right" ? "hurts" : "yes"),
          pain: () => ({ level: 6 }),
          reask: () => 3,
        },
        900,
      );
      expect(run.steps).toContain("reask:neck_lateral_flexion:left");
      const after = saves(run.events).filter(
        (e) => e.item.movementId !== "neck_lateral_flexion" || e.item.side === "left",
      );
      expect(after.map((e) => itemKey(e.item))).toEqual([
        "neck_lateral_flexion:left",
        "neck_flexion:none",
        "neck_extension:none",
      ]);
      for (const e of after) expect(e.result.painBefore).toBe(3);
    });

    it("a pain stop on the forward bend asks before the side bends", () => {
      const ctl = controller(protocolOf(BACK), { intake: BACK });
      ctl.startBlock("standing", 0);
      const run = runBlock(
        ctl,
        {
          answerMax: (i) => (i.movementId === "trunk_flexion" ? "hurts" : "yes"),
          pain: () => ({ level: 6 }),
          reask: () => 7,
        },
        600,
      );
      const stop = run.steps.indexOf("pain_stop:trunk_flexion:none");
      expect(stop).toBeGreaterThanOrEqual(0);
      expect(run.steps.slice(stop + 1).find((s) => !s.startsWith("result"))).toBe(
        "reask:trunk_lateral_flexion:right",
      );
      expect(run.steps.filter((s) => s.startsWith("setup"))).toEqual(["setup:trunk_flexion:none"]);
      for (const side of ["right", "left"]) {
        const row = saves(run.events).find(
          (e) => e.item.movementId === "trunk_lateral_flexion" && e.item.side === side,
        )!;
        expect(row.result.reason).toBe("pain_today");
      }
    });

    it("a stop list pain answer on a neck side bend asks before the next neck movement", () => {
      const ctl = controller(protocolOf(NECK), { intake: NECK });
      ctl.startBlock("seated", 0);
      let stopped = false;
      const run = runBlock(
        ctl,
        {
          at: (t, c) => {
            if (!stopped && c.phase === "attempt") {
              stopped = true;
              c.requestStop(t);
            }
          },
          until: (c) => !!c.stopList,
        },
        200,
      );
      ctl.stopRouted({ endsCheck: false, afterRest: false, then: "bt_pain_after" }, run.t);
      expect(ctl.current.kind === "reask" && itemKey(ctl.current.item)).toBe("neck_lateral_flexion:left");
    });

    it("the coach's mark_pain of 6 between neck movements asks before the next one", () => {
      const ctl = controller(protocolOf(NECK), { intake: NECK });
      ctl.startBlock("seated", 0);
      const run = runBlock(ctl, { until: (c) => c.current.kind === "result" }, 300);
      expect(ctl.current.kind === "result" && itemKey(ctl.current.item)).toBe("neck_lateral_flexion:right");
      expect(ctl.handleTool("mark_pain", { level: 6 })).toMatchObject({ accepted: true, say: "pain_stop" });
      ctl.next(run.t + 500);
      expect(ctl.current.kind === "reask" && itemKey(ctl.current.item)).toBe("neck_lateral_flexion:left");
    });
  });

  it("a pain below the rule after «it hurts» keeps the value pain limited and asks nothing more", () => {
    // No pain before (null counts as 0): 1 is below the rule, 2 would be a rise of 2.
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    const run = runBlock(
      ctl,
      {
        answerMax: (i, h) => (i.movementId === "knee_flexion" && h.attempt === 1 ? "hurts" : "yes"),
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
    expect(ctl.handleTool("next_step", { intent: "next" })).toEqual({
      accepted: false,
      reason: "not_allowed",
      say: "tap_to_confirm",
    });
    expect(ctl.ready(run.t)).toBe(false);
    expect(ctl.next(run.t)).toBe(false);
    ctl.tick(s.until - 1);
    expect(ctl.current.kind).toBe("sit");
    // The minute is over: «يمكنك الوقوف الآن ببطء» holds a few seconds, or until a tap, then the end.
    ctl.tick(s.until);
    const standing = ctl.current;
    expect(standing.kind === "sit" && standing.standing).toBe(s.until + SIT_STAND_MS);
    ctl.tick(s.until + SIT_STAND_MS - 1);
    expect(ctl.current.kind).toBe("sit");
    ctl.tick(s.until + SIT_STAND_MS);
    expect(ctl.current.kind).toBe("end");
  });

  it("lets the person tap on once the minute is over, never before", () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    runBlock(ctl, { until: (c) => c.current.kind === "sit" }, 400);
    const s = ctl.current;
    if (s.kind !== "sit") throw new Error("no sit");
    expect(ctl.next(s.until - 1)).toBe(false);
    ctl.tick(s.until);
    expect(ctl.next(s.until + 100)).toBe(true);
    expect(ctl.current.kind).toBe("end");
  });

  it("starts the minute the moment the last lying measurement ends, with its result shown in the timer", () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    const run = runBlock(ctl, { until: (c) => c.current.kind === "sit" }, 400);
    const s = ctl.current;
    expect(s.kind).toBe("sit");
    if (s.kind !== "sit") return;
    expect(s.last?.item.movementId).toBe("knee_extension");
    expect(s.last?.result.status).toBe("measured");
    expect(run.steps.filter((x) => x.startsWith("result"))).toEqual(["result:knee_flexion:right"]);
    // The measured value was saved as any other.
    expect(saves(run.events).map((e) => e.item.movementId)).toEqual(["knee_flexion", "knee_extension"]);
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

  it("rests v1's stop rest, read from SAFETY_TIMING (check_rest_minute)", () => {
    expect(STOP_REST_SECONDS).toBe(SAFETY_TIMING.stopRestSec);
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
    // D-038 item 2: about the person only («unclear»), never «second_person».
    expect(ctl.setupIssue).toBe("unclear");
    const issues = bridges(run.events).filter((e) => e.type === "setup_issue");
    expect(issues).toEqual([expect.objectContaining({ p: 2, type: "setup_issue", issue: "unclear" })]);
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

describe("the typical value of a position without a matched norm (rom-protocol 3.12, 4.3 rule 7)", () => {
  // An MS wheelchair user at the booth with the back and the right knee on the body map: the forward
  // bend is seated, the side bend in seated_armrests, the knee straightening seated, none graded.
  const MS_CHAIR = intake({
    mobility: "wheelchair",
    conditions: ["ms"],
    regions: [entry("back_trunk", "axial", ["stiffness"]), entry("knee", "right", ["stiffness"])],
  });

  it("has no typical, no band, for every ungraded position, and the graded one keeps its norm", () => {
    const p = protocolOf(MS_CHAIR);
    const ctl = controller(p, { intake: MS_CHAIR });
    const ungraded = p.items.filter((i) => !i.skipped && !i.graded);
    expect(ungraded.map(itemKey)).toEqual(
      expect.arrayContaining(["trunk_flexion:none", "trunk_lateral_flexion:right", "knee_extension:right"]),
    );
    for (const item of ungraded)
      expect(ctl.norm(item), itemKey(item)).toEqual({ typical: null, withinFrom: null, withinUpTo: null });
    const lyingKnee = { ...p.items.find((i) => i.movementId === "knee_flexion")!, skipped: undefined };
    expect(ctl.norm(lyingKnee).typical).toBeGreaterThan(100);
  });

  it("tells the coach no typical at the hold and in the result of an ungraded movement", () => {
    const p = protocolOf(MS_CHAIR);
    const ctl = controller(p, { intake: MS_CHAIR });
    ctl.startBlock("seated", 0);
    const run = runBlock(ctl, {}, 900);
    const events = bridges(run.events);
    const trunk = events.filter(
      (e) => (e.type === "end_range_hold" || e.type === "movement_result") && e.movement === "trunk_flexion",
    );
    expect(trunk.length).toBeGreaterThanOrEqual(2);
    for (const e of trunk) expect("typical" in e && e.typical).toBeNull();
  });
});

describe("the walk after the range blocks (gait-rules eligibility.today, rom-protocol pain_during)", () => {
  const WALK = ["hip", "knee", "ankle_foot", "back_trunk"] as const;
  const HIP = intake({ regions: [entry("hip", "right", ["pain"])] });

  it("a hip pain stop at 7 and a re-ask of 7: the walk is not offered today", () => {
    const ctl = controller(protocolOf(HIP), { intake: HIP, painByRegion: { hip: 2 } });
    expect(ctl.walkGate(WALK)).toEqual({ skip: false, ask: [], before: 2 });
    ctl.startBlock("standing", 0);
    runBlock(
      ctl,
      {
        answerMax: (i) => (i.movementId === "hip_extension" ? "hurts" : "yes"),
        pain: () => ({ level: 7 }),
        reask: () => 7,
      },
      600,
    );
    expect(ctl.walkGate(WALK).skip).toBe(true);
  });

  it("a pain stop at 6 on the last standing movement: the walk is not offered today", () => {
    const ctl = controller(protocolOf(HIP), { intake: HIP, painByRegion: { hip: 2 } });
    ctl.startBlock("standing", 0);
    runBlock(
      ctl,
      { answerMax: (i) => (i.movementId === "hip_abduction" ? "hurts" : "yes"), pain: () => ({ level: 6 }) },
      600,
    );
    expect(ctl.current.kind).toBe("end");
    expect(ctl.walkGate(WALK).skip).toBe(true);
  });

  it("a pain stop by a rise of 2 below 6: the walk asks the hip's pain first; 6 or more then skips the walk and the hip", () => {
    const ctl = controller(protocolOf(HIP), { intake: HIP, painByRegion: { hip: 2 } });
    ctl.startBlock("standing", 0);
    runBlock(
      ctl,
      { answerMax: (i) => (i.movementId === "hip_abduction" ? "hurts" : "yes"), pain: () => ({ level: 4 }) },
      600,
    );
    expect(ctl.walkGate(WALK)).toEqual({ skip: false, ask: ["hip"], before: 2 });
    ctl.answerWalkPain("hip", 3, 1_000_000);
    expect(ctl.walkGate(WALK)).toEqual({ skip: false, ask: [], before: 3 });
    // The answer is the next hip movement's score before (the lying hip bend asks nothing more).
    ctl.startBlock("lying", 1_000_100);
    const run = runBlock(ctl, {}, 600, 1_000_100);
    expect(run.steps.filter((s) => s.startsWith("reask"))).toEqual([]);
    expect(saves(run.events).find((e) => e.item.movementId === "hip_flexion")?.result.painBefore).toBe(3);
  });

  it("a walk re-ask of 6 skips the walk and the region's later movements (pain_today)", () => {
    const ctl = controller(protocolOf(HIP), { intake: HIP, painByRegion: { hip: 2 } });
    ctl.startBlock("standing", 0);
    runBlock(
      ctl,
      { answerMax: (i) => (i.movementId === "hip_abduction" ? "hurts" : "yes"), pain: () => ({ level: 4 }) },
      600,
    );
    ctl.answerWalkPain("hip", 6, 1_000_000);
    expect(ctl.walkGate(WALK).skip).toBe(true);
    ctl.startBlock("lying", 1_000_100);
    expect(ctl.current).toEqual({ kind: "end", block: "lying" });
    expect(saves(ctl.drain()).find((e) => e.item.movementId === "hip_flexion")?.result.reason).toBe(
      "pain_today",
    );
  });
});

describe("the phone's roll and tilt (FeedEnv, rom-protocol true vertical, the setup's level check)", () => {
  const BACK = intake({ regions: [entry("back_trunk", "axial", ["stiffness"])] });
  const sideBendOnly = (p: RomProtocol): RomProtocol => ({
    ...p,
    items: p.items.map((i) =>
      i.movementId === "trunk_lateral_flexion" && i.side === "left" ? i : { ...i, skipped: "red_flag" },
    ),
  });
  const measuredBend = (plan: Parameters<typeof runBlock>[1]) => {
    const ctl = controller(sideBendOnly(protocolOf(BACK)), { intake: BACK });
    ctl.startBlock("standing", 0);
    const run = runBlock(ctl, plan, 400);
    return saves(run.events).find((e) => e.item.movementId === "trunk_lateral_flexion")!.result;
  };
  const target = MOVEMENT_CASES.trunk_lateral_flexion.target;

  it("measures a level phone with no orientation reading (a null roll) as a level one", () => {
    const res = measuredBend({ env: {} });
    expect(res.status).toBe("measured");
    expect(Math.abs(res.value! - target)).toBeLessThanOrEqual(2);
  });

  it("measures the side bend against true vertical on a phone rolled 4 degrees, with the sensor's roll", () => {
    const res = measuredBend({ roll: 4 });
    expect(res.status).toBe("measured");
    expect(Math.abs(res.value! - target)).toBeLessThanOrEqual(2);
    // Without the roll the same picture reads the bend against the picture's vertical.
    const blind = measuredBend({ roll: 4, env: {} });
    expect(Math.abs(blind.value! - target)).toBeGreaterThanOrEqual(3);
  });

  it("shows the level issue while the start pose is taken when the phone is tilted past the movement's level", () => {
    const ctl = controller(sideBendOnly(protocolOf(BACK)), { intake: BACK });
    ctl.startBlock("standing", 0);
    runBlock(
      ctl,
      { env: { rollDeg: 0, tilt: { rollDeg: 0, pitchDeg: 12 } }, until: (c) => c.setupIssue !== null },
      30,
    );
    expect(ctl.setupIssue).toBe("tilt");
  });
});

describe("the second try from the result card (D-035 item 1)", () => {
  const BEND = MOVEMENT_CASES.knee_flexion;
  const atCard = () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    const run = runBlock(ctl, { until: (c) => c.current.kind === "result" }, 300);
    return { ctl, run };
  };

  it("a result whose card may offer one more try is saved when the card is left", () => {
    const { ctl, run } = atCard();
    const s = ctl.current;
    if (s.kind !== "result") throw new Error("no result card");
    expect(s.item.movementId).toBe("knee_flexion");
    expect(s.result).toMatchObject({ status: "measured", nValid: 1 });
    expect(saves(run.events)).toEqual([]);
    expect(ctl.canTryAgain).toBe(true);
    expect(ctl.next(run.t + 500)).toBe(true);
    const saved = saves(ctl.drain());
    expect(saved.map((e) => [itemKey(e.item), e.result.value])).toEqual([
      ["knee_flexion:right", s.result.value],
    ]);
  });

  it("one more try runs the same movement again, keeps the further value and is saved once; never a third", () => {
    const { ctl, run } = atCard();
    const first = ctl.current.kind === "result" ? ctl.current.result : null;
    expect(ctl.tryAgain(run.t + 200)).toBe(true);
    expect(ctl.current.kind).toBe("measure");
    expect(ctl.phase).toBe("calibrating");
    expect(saves(ctl.drain())).toEqual([]);
    const again = runBlock(
      ctl,
      { target: () => BEND.target + 10, until: (c) => c.current.kind === "result" },
      120,
      run.t + 200,
    );
    const s = ctl.current;
    if (s.kind !== "result") throw new Error("no result card");
    expect(s.result.nValid).toBe(2);
    expect(s.result.attempts.map((a) => a.index)).toEqual([1, 2]);
    expect(s.result.value).toBeGreaterThan(first!.value!);
    expect(ctl.canTryAgain).toBe(false);
    expect(ctl.tryAgain(again.t + 100)).toBe(false);
    // Nothing more to offer: the second try's result is saved at once, the only save of the movement.
    ctl.next(again.t + 500);
    const saved = [...saves(again.events), ...saves(ctl.drain())];
    expect(saved).toHaveLength(1);
    expect(saved[0].result).toMatchObject({ nValid: 2, value: s.result.value });
  });

  it("a stop during the second try keeps the first value: saved, the stop list opens over its card", () => {
    const { ctl, run } = atCard();
    const first = ctl.current.kind === "result" ? ctl.current.result : null;
    ctl.tryAgain(run.t + 200);
    ctl.drain();
    ctl.requestStop(run.t + 1500);
    expect(ctl.current.kind).toBe("result");
    expect(ctl.stopList).toEqual({ preselect: null, item: null });
    const saved = saves(ctl.drain());
    expect(saved).toHaveLength(1);
    expect(saved[0].result).toMatchObject({ status: "measured", value: first!.value, nValid: 1 });
  });

  it("the stop list opened from a result card saves that result first", () => {
    const { ctl, run } = atCard();
    ctl.requestStop(run.t + 300);
    const saved = saves(ctl.drain());
    expect(saved.map((e) => itemKey(e.item))).toEqual(["knee_flexion:right"]);
    expect(ctl.canTryAgain).toBe(false);
  });

  it("the lying block's last movement goes into the sit minute, saved at once (no second try there)", () => {
    const ctl = controller(protocolOf(KNEE));
    ctl.startBlock("lying", 0);
    const run = runBlock(ctl, { until: (c) => c.current.kind === "sit" }, 400);
    const keys = saves(run.events).map((e) => itemKey(e.item));
    expect(keys).toContain("knee_extension:right");
    expect(keys).toContain("knee_flexion:right");
  });
});
