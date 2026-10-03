import { afterEach, describe, expect, it, vi } from "vitest";
import { createWeekly } from "../server/weekly-ai";
import { createPlan, type Intake } from "../src/medical/plan";
import { DEMANDS, SPORTS, sportById, type DemandTag } from "../src/medical/sports";
import {
  eligibleExercises,
  engineWeekly,
  libraryById,
  sportPath,
  type WeeklyPlan,
} from "../src/medical/weekly";

/** Saad (D-018): 22, incomplete spinal cord injury, a wheelchair user, cleared to exercise. */
const saad: Intake = {
  age: 22,
  conditions: ["sci_incomplete"],
  diagnosisNotes: "",
  medications: "",
  mobility: "wheelchair",
  support: "none",
  pain: [],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: ["weights"],
  goal: "sport",
  sport: "wheelchair_basketball",
  days: [0, 2, 4],
  time: "17:00",
  sessionMinutes: 40,
  consent: true,
};
const DASH = /[‐-―−]|\s-\s/;
const extrasOf = (w: WeeklyPlan) => w.days.flatMap((d) => d.extra.map((i) => libraryById(i.id)!));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the weekly plan shaped by the sport (booth v2, B4)", () => {
  it("keeps the safe pool of the rules: the sport only weights what is chosen", () => {
    for (const sport of SPORTS) {
      const h: Intake = { ...saad, sport: sport.id };
      const plain: Intake = { ...saad, goal: "strength", sport: undefined };
      expect(eligibleExercises(h, createPlan(h)).map((e) => e.id)).toEqual(
        eligibleExercises(plain, createPlan(plain)).map((e) => e.id),
      );
    }
  });

  it("fills the week with exercises that build the sport's demands, every demand at least once", () => {
    for (const sport of SPORTS) {
      const h: Intake = { ...saad, sport: sport.id };
      const plan = createPlan(h);
      const pool = eligibleExercises(h, plan);
      const weekly = engineWeekly(h, plan)!;
      const extras = extrasOf(weekly);
      expect(extras.length, sport.id).toBeGreaterThan(0);
      // Every extra builds something the sport asks for.
      for (const e of extras)
        expect(
          e.demands.some((d) => sport.demands.includes(d)),
          `${sport.id}: ${e.id}`,
        ).toBe(true);
      // Every demand the safe pool can build appears in the week, through the library or through a
      // camera movement (stretches cover flexibility).
      const path = sportPath(sport, plan, weekly);
      for (const demand of sport.demands) {
        const possible = pool.some((e) => e.demands.includes(demand));
        if (!possible) continue;
        expect(
          path.find((s) => s.demand === demand)!.exercises.length,
          `${sport.id}: ${demand}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("names each day after the demand it builds, and the sport in the summary and the reasons", () => {
    const weekly = engineWeekly(saad, createPlan(saad))!;
    const names = Object.values(DEMANDS);
    for (const d of weekly.days) expect(names).toContainEqual(d.focus);
    const sport = sportById("wheelchair_basketball")!;
    expect(weekly.summary.ar).toContain(sport.name.ar);
    expect(weekly.summary.en).toContain("wheelchair basketball");
    expect(weekly.summary.ar).toContain("حالتك الطبية");
    expect(
      weekly.why.some((w) => w.ar.includes(sport.name.ar) && w.en.includes("wheelchair basketball")),
    ).toBe(true);
    expect(DASH.test(JSON.stringify([weekly.summary, weekly.why, weekly.tips]))).toBe(false);
  });

  it("does not change the weekly plan of the other goals", () => {
    const h: Intake = { ...saad, goal: "habit", sport: undefined };
    const weekly = engineWeekly(h, createPlan(h))!;
    expect(weekly.summary.en).not.toMatch(/basketball|sport/i);
  });
});

describe("the sport path (booth v2, B5)", () => {
  it("lists every demand of the sport with the exercises this week that build it", () => {
    const plan = createPlan(saad);
    const weekly = engineWeekly(saad, plan)!;
    const sport = sportById("wheelchair_basketball")!;
    const path = sportPath(sport, plan, weekly);
    expect(path.map((s) => s.demand)).toEqual(sport.demands);
    for (const step of path) {
      expect(new Set(step.exercises.map((e) => e.id)).size).toBe(step.exercises.length);
      for (const e of step.exercises) {
        if (e.camera) expect(plan.exercises.map((x) => x.exerciseId)).toContain(e.id);
        else expect(libraryById(e.id)!.demands).toContain(step.demand as DemandTag);
      }
    }
    // The camera press builds shoulder endurance, and comes first.
    expect(path.find((s) => s.demand === "shoulder_endurance")!.exercises[0]).toEqual({
      id: "seated_shoulder_press",
      camera: true,
    });
    expect(path.every((s) => s.exercises.length > 0)).toBe(true);
  });

  it("shows the camera movements alone before the weekly plan has arrived", () => {
    const plan = createPlan(saad);
    const path = sportPath(sportById("wheelchair_basketball")!, plan, null);
    expect(path.flatMap((s) => s.exercises).every((e) => e.camera)).toBe(true);
  });
});

describe("the weekly plan model call with a sport (booth v2, B4)", () => {
  it("sends the sport and its demands, and each candidate's demands", async () => {
    const plan = createPlan(saad);
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        bodies.push(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
      }),
    );
    await createWeekly(saad, plan, "test-key");
    const sent = JSON.parse(bodies[0]) as { messages: { content: string }[] };
    const [system, user] = sent.messages.map((m) => m.content);
    expect(system).toMatch(/sport/i);
    const person = JSON.parse(user.slice(user.indexOf("{"), user.indexOf("\n\nSafe candidates")));
    expect(person.goal).toBe("sport");
    expect(person.sport).toEqual({
      name: "Wheelchair basketball",
      demands: sportById("wheelchair_basketball")!.demands,
    });
    const tail = user.slice(user.indexOf("Safe candidates:\n") + "Safe candidates:\n".length);
    const candidates = JSON.parse(tail.slice(0, tail.lastIndexOf("]") + 1));
    expect(candidates.every((c: { demands?: unknown }) => Array.isArray(c.demands))).toBe(true);
  });

  it("falls back to the rules' sport shaped week when the model fails", async () => {
    const plan = createPlan(saad);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const weekly = (await createWeekly(saad, plan, "test-key"))!;
    expect(weekly.source).toBe("engine");
    expect(weekly.summary.en).toContain("wheelchair basketball");
  });
});
