/**
 * Step E2 (product v7 contract 2.10): createWeekly keeps the why lines. The weekly AI may still word the
 * summary and arrange the goal's share, but the finding items, their days, blocks, doses and why lines
 * are fixed: the model receives the why lines as fixed text it must not change, and sanitizeSelection
 * keeps the targeted items. Without a key, or when the model fails, the rules' week is the answer.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWeekly } from "../../server/weekly-ai";
import { createPlan } from "../../src/medical/plan";
import { libraryById } from "../../src/medical/pool";
import { targetedBuild } from "../../src/medical/targets";
import type { WeeklyPlan } from "../../src/medical/weekly";
import { FAHD, finding, pattern } from "./e-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

const REF = { checkId: "c1", romVersion: "r", gaitVersion: null, targetsVersion: "t", created: 9 };
const plan = createPlan(FAHD);
const build = targetedBuild(
  FAHD,
  plan,
  [
    finding("shoulder_flexion", "right", { finding: "marked", priority: 3, path: "umn" }),
    finding("knee_flexion", "right", { finding: "mild", priority: 2, path: "umn" }),
  ],
  [pattern({ pattern: "stiff_knee", targets: [{ id: "strengthen:calf", side: "right" }] })],
  REF,
)!;

const blocks = (w: WeeklyPlan) =>
  w.days.map((d) => ({
    warmup: d.warmup.filter((i) => i.why).map((i) => i.id),
    extra: d.extra.filter((i) => i.why).map((i) => i.id),
    cooldown: d.cooldown.filter((i) => i.why).map((i) => i.id),
  }));

function stubModel(days: unknown[]) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(String(init.body));
      const content = JSON.stringify({
        summary: {
          ar: "أسبوعك مبني على نتائجك وهدفك.",
          en: "Your week is built on your results and your goal.",
        },
        why: [],
        tips: [],
        days,
      });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }),
  );
  return calls;
}

describe("createWeekly with a targeted week", () => {
  it("without a key, answers the rules' week", async () => {
    const w = await createWeekly(FAHD, plan, undefined, build);
    expect(w).toEqual(build.weekly);
    expect(w!.findings).toEqual(REF);
  });

  it("keeps every finding item in its day and block, with its dose and why line, whatever the model asks", async () => {
    const goal = build.pool.map((e) => e.id);
    const finding = build.items.map((i) => i.exerciseId);
    // The model leaves the finding items out, moves one to another day and asks for a draft it was not offered.
    stubModel(
      plan.days.map((_, d) => ({
        focus: { ar: "يوم", en: "Day" },
        warmup: [goal[d], goal[d + 1]],
        extra: [finding[0], "glute_bridge", goal[d + 2]],
        cooldown: [goal[d + 3], goal[d + 4]],
        notes: [],
      })),
    );
    const w = (await createWeekly(FAHD, plan, "test-key", build))!;
    expect(w.source).toBe("ai");
    expect(w.findings).toEqual(REF);
    expect(blocks(w)).toEqual(blocks(build.weekly));
    const why = new Map(build.items.map((i) => [i.exerciseId, i.why]));
    for (const d of w.days)
      for (const i of [...d.warmup, ...d.extra, ...d.cooldown]) {
        if (why.has(i.id) && i.why) expect(i.why).toEqual(why.get(i.id));
        expect(i.id).not.toBe("glute_bridge");
        expect(libraryById(i.id), i.id).toBeDefined();
      }
    expect(w.summary.en).toBe("Your week is built on your results and your goal.");
  });

  it("gives the model the why lines as fixed text", async () => {
    const calls = stubModel(
      plan.days.map(() => ({
        focus: { ar: "يوم", en: "Day" },
        warmup: [],
        extra: [],
        cooldown: [],
        notes: [],
      })),
    );
    await createWeekly(FAHD, plan, "test-key", build);
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]);
    const user = body.messages.find((m: { role: string }) => m.role === "user").content as string;
    for (const i of build.items) expect(user).toContain(i.why.en);
    expect(body.messages[0].content).toMatch(/never change/i);
  });

  it("falls back to the rules' week when the model fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    const w = await createWeekly(FAHD, plan, "test-key", build);
    expect(w).toEqual(build.weekly);
  });

  it("the legacy week is unchanged without a targeted build", async () => {
    const w = await createWeekly(FAHD, plan);
    expect(w!.findings).toBeUndefined();
    for (const d of w!.days)
      for (const i of [...d.warmup, ...d.extra, ...d.cooldown]) expect(i.why).toBeUndefined();
  });
});
