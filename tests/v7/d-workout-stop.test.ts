/**
 * D-030 item 2, D5-7: an emergency stop during a coached workout sets the same next day lock as one in
 * a check, as v1 does (the conservative choice; Nasser may revisit it). POST /api/agent/stop takes the
 * person's stop list answer in a workout of theirs, routes it with v1's rules on the person's stored
 * intake (never the client's), sets the stop's lock, keeps the dates the next check reads (Q33 (2),
 * (3)) and counts the safety event. Behind AZM_V7 like every coach route.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FOCUS_RULES } from "../../server/modules/focus/precheck";
import { currentLock } from "../../server/modules/assessments/store";
import { member, startV7Api, userId, v7Intake, type V7Harness } from "./a-harness";

let h: V7Harness;
let n = 0;

beforeAll(async () => {
  h = await startV7Api(FOCUS_RULES);
});
afterAll(async () => {
  await h.close();
});
beforeEach(() => {
  process.env.AZM_V7 = "1";
});
afterEach(() => {
  delete process.env.AZM_V7;
});

/** A member with a guided workout of today (POST /api/workouts as the Program page starts it). */
async function withWorkout(intake = v7Intake()): Promise<{ cookie: string; id: string; user: string }> {
  const cookie = await member(h, `stop-${++n}@example.test`, intake, []);
  const weekly = await h.call("/plan/weekly", {}, cookie);
  expect(weekly.status).toBe(200);
  const w = await h.call("/workouts", { version: weekly.data.version, demo: false, guided: true }, cookie);
  expect(w.status, JSON.stringify(w.data)).toBe(200);
  return { cookie, id: w.data.id as string, user: await userId(h, cookie) };
}

const safetyCount = (reason: string) =>
  (
    h.db().prepare("SELECT SUM(count) AS n FROM safety_events WHERE reason=?").get(reason) as {
      n: number | null;
    }
  ).n ?? 0;

describe("POST /api/agent/stop, a stop list answer in a coached workout", () => {
  it("sets the next day lock of an emergency, with its screen, as a check's stop does", async () => {
    const { cookie, id, user } = await withWorkout();
    const before = safetyCount("workout:stop:chest");
    const r = await h.call("/agent/stop", { workoutId: id, option: "chest" }, cookie);
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.route).toMatchObject({ option: "chest", screen: "scr_emergency", endsCheck: true });
    expect(r.data.lock).not.toBeNull();
    const lock = currentLock(h.db(), user, Date.now());
    expect(lock).not.toBeNull();
    expect(lock!.until).toBeGreaterThan(Date.now());
    expect(lock!.releasableByClearance).toBe(false);
    expect(safetyCount("workout:stop:chest")).toBe(before + 1);
    // The next focus check reads the lock (its context carries it, and it cannot start today).
    const ctx = await h.call("/focus/context", undefined, cookie, "GET");
    expect(ctx.data.lock).not.toBeNull();
  });

  it("sets no lock for tiredness, pain, a choice or another reason", async () => {
    const { cookie, id, user } = await withWorkout();
    for (const option of ["tired", "pain", "choice", "other"]) {
      const r = await h.call("/agent/stop", { workoutId: id, option }, cookie);
      expect(r.status, option).toBe(200);
      expect(r.data.lock, option).toBeNull();
    }
    expect(currentLock(h.db(), user, Date.now())).toBeNull();
  });

  it("adds the dysreflexia screen beside the emergency one for a spinal cord injury", async () => {
    const { cookie, id } = await withWorkout(
      v7Intake({ conditions: ["sci_incomplete"], mobility: "wheelchair" }),
    );
    const r = await h.call("/agent/stop", { workoutId: id, option: "chest" }, cookie);
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.route.alsoShow).toContain("scr_ad");
  });

  it("refuses another person's workout, an option outside the list and unknown keys", async () => {
    const mine = await withWorkout();
    const other = await withWorkout();
    expect((await h.call("/agent/stop", { workoutId: other.id, option: "chest" }, mine.cookie)).status).toBe(
      404,
    );
    const bad = await h.call("/agent/stop", { workoutId: mine.id, option: "bored" }, mine.cookie);
    expect(bad.status).toBe(400);
    expect(bad.data).toEqual({ error: "STOP_INVALID", field: "option" });
    const extra = await h.call(
      "/agent/stop",
      { workoutId: mine.id, option: "chest", note: "x" },
      mine.cookie,
    );
    expect(extra.data).toEqual({ error: "STOP_INVALID", field: "note" });
  });

  it("takes a demo exercise's stop with no workout (D-038 item 3): the same lock, counted as a demo's", async () => {
    const cookie = await member(h, `stop-${++n}@example.test`, v7Intake(), []);
    const user = await userId(h, cookie);
    const before = safetyCount("demo:stop:chest");
    const r = await h.call("/agent/stop", { demo: "seated_biceps_curl", option: "chest" }, cookie);
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.route).toMatchObject({ option: "chest", screen: "scr_emergency" });
    expect(currentLock(h.db(), user, Date.now())).not.toBeNull();
    expect(safetyCount("demo:stop:chest")).toBe(before + 1);
    // Nothing of a workout is stored for it.
    expect(h.db().prepare("SELECT COUNT(*) AS n FROM workouts WHERE user_id=?").get(user)).toEqual({ n: 0 });
    for (const body of [
      { demo: "hip_flexion", option: "chest" },
      { demo: "seated_biceps_curl", workoutId: "0f0e0d0c-0b0a-4908-8706-050403020100", option: "chest" },
    ]) {
      const bad = await h.call("/agent/stop", body, cookie);
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("needs a signed in person, and does not exist without AZM_V7", async () => {
    const { cookie, id } = await withWorkout();
    expect((await h.call("/agent/stop", { workoutId: id, option: "chest" }, "")).status).toBe(401);
    delete process.env.AZM_V7;
    expect((await h.call("/agent/stop", { workoutId: id, option: "chest" }, cookie)).status).toBe(404);
  });
});

describe("the coached workout's stop call (sendWorkoutStop)", () => {
  it("posts the answer with the request header, tries a lost call twice more, and stops at any answer", async () => {
    const { sendWorkoutStop } = await import("../../src/features/coach-agent/api");
    const calls: { url: string; init: RequestInit }[] = [];
    let fail = 2;
    const flaky = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (fail-- > 0) throw new TypeError("network");
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const id = "0b6f1c1e-1d2a-4c8e-9a1b-2f3c4d5e6f70";
    expect(await sendWorkoutStop(id, "chest", flaky, () => "pass_1")).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe("/api/agent/stop");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ workoutId: id, option: "chest" });
    expect(calls[0].init.headers).toMatchObject({ "X-Azm-Request": "1", "X-Azm-Booth": "pass_1" });
    const refused: string[] = [];
    const answer = (async (url: string) => {
      refused.push(url);
      return new Response('{"error":"NOT_FOUND"}', { status: 404 });
    }) as unknown as typeof fetch;
    expect(await sendWorkoutStop(id, "chest", answer, () => null)).toBe(false);
    expect(refused).toHaveLength(1);
  });
});
