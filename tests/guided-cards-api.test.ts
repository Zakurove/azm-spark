/**
 * Booth v2, contract D (guided cards), through the API:
 *   - a workout started with `guided: true` keeps the cards of the day it falls on (the weekday the
 *     phone sends), and its steps run warm up cards, camera sets, the day's exercises, cool down cards;
 *   - each step is saved in its place: a card at a card step, a camera set at a camera step;
 *   - a completed card is kept as a guided record and counts toward the sessions done (adherence); a
 *     skipped card moves on and keeps nothing;
 *   - a program with no camera movement runs on cards alone and ends after its last card;
 *   - a profile left in review before the cards only because no camera movement fitted is planned
 *     again once, ready, with its answers unchanged;
 *   - a workout started without `guided` (an older page) keeps the camera sets alone, as before.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApi } from "../server/api";
import type { Intake } from "../src/medical/plan";
import { sessionSteps, type SessionDay } from "../src/medical/session";

const base: Intake = {
  age: 40,
  conditions: ["none"],
  diagnosisNotes: "",
  medications: "",
  mobility: "seated",
  support: "none",
  pain: [],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: [],
  goal: "habit",
  days: [0, 2, 4],
  time: "09:00",
  sessionMinutes: 30,
  consent: true,
};

let origin: string, server: Server, service: ReturnType<typeof createApi>, dir: string, file: string;
async function call(path: string, body?: unknown, cookie = "", method = body === undefined ? "GET" : "POST") {
  const r = await fetch(origin + "/api" + path, {
    method,
    headers: { origin, "Content-Type": "application/json", "X-Azm-Request": "1", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json(), cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
let n = 0;
async function member(intake: Intake = base) {
  const r = await call("/auth/register", {
    name: "Saad",
    email: `cards-${++n}@example.test`,
    password: "test-password-9281",
    adultConfirmed: true,
  });
  const p = await call("/intake", intake, r.cookie, "PUT");
  expect(p.status).toBe(200);
  return { cookie: r.cookie, id: r.data.user.id as string, plan: p.data.plan };
}
const doneOf = (item: { sets: number; reps?: number; holdSeconds?: number }) =>
  item.holdSeconds
    ? { sets: item.sets, seconds: item.sets * item.holdSeconds }
    : { sets: item.sets, reps: item.sets * (item.reps ?? 8) };
const cameraBody = (index: number, exerciseId: string) => ({
  index,
  summary: { exerciseId, reps: { valid: 1, compensated: 0, partial: 0 }, rpe: 4, romPct: 90 },
  moments: [{ cls: "valid", durSec: 2.4, peakPct: 0.9 }],
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "azm-cards-"));
  file = join(dir, "azm.sqlite");
  service = createApi(file);
  server = createServer((req, res) => void service.handle(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  service.close();
  rmSync(dir, { recursive: true, force: true });
});
afterEach(() => undefined);

describe("a guided workout (D)", () => {
  it("keeps the cards of the day it falls on", async () => {
    const m = await member();
    const weekly = (await call("/plan/weekly", {}, m.cookie)).data.weekly;
    const r = await call(
      "/workouts",
      { version: m.plan.version, demo: false, guided: true, weekday: 1 },
      m.cookie,
    );
    expect(r.status).toBe(200);
    const today: SessionDay = r.data.today;
    // Monday is not planned: the session takes Tuesday's cards.
    expect(today.day).toBe(2);
    expect(today.warmup).toEqual(weekly.days[1].warmup);
    expect(today.extra).toEqual(weekly.days[1].extra);
    expect(today.cooldown).toEqual(weekly.days[1].cooldown);
    expect(today.restSeconds).toBeGreaterThan(0);
    // An older page asks without guided: the camera sets alone, as before.
    const other = await member();
    const legacy = await call("/workouts", { version: other.plan.version, demo: false }, other.cookie);
    expect(legacy.status).toBe(200);
    expect(legacy.data.today).toBeUndefined();
  });

  it("saves each step in its place, keeps completed cards and moves past skipped ones", async () => {
    const m = await member();
    const r = await call(
      "/workouts",
      { version: m.plan.version, demo: false, guided: true, weekday: 0 },
      m.cookie,
    );
    const id = r.data.id as string;
    const today: SessionDay = r.data.today;
    const steps = sessionSteps(r.data.plan, today);
    const [w0, w1] = today.warmup;
    const cam = steps.findIndex((s) => s.kind === "camera");
    expect(cam).toBe(today.warmup.length);
    const card = (index: number, item: typeof w0, extra: Record<string, unknown> = {}) =>
      call(`/workouts/${id}/cards`, { index, id: item.id, done: doneOf(item), rpe: 3, ...extra }, m.cookie);
    // Out of order, the wrong card, or a camera set at a card step: refused.
    expect((await card(1, w1)).status).toBe(409);
    expect((await card(0, w1)).status).toBe(409);
    expect(
      (await call(`/workouts/${id}/sets`, cameraBody(0, "seated_shoulder_press"), m.cookie)).status,
    ).toBe(409);
    // Values outside the card's dose or the effort scale: refused.
    expect((await card(0, w0, { rpe: 11 })).status).toBe(400);
    expect((await card(0, w0, { done: { sets: 40, reps: 8 } })).status).toBe(400);
    expect((await card(0, w0, { done: { sets: 1, seconds: -5 } })).status).toBe(400);
    expect((await card(0, w0, { rpe: 3.5 })).status).toBe(400);
    // The first warm up card done, the second skipped.
    const first = await card(0, w0, { startedAt: Date.now() - 60_000 });
    expect(first.status).toBe(200);
    expect(first.data.saved).toBe(true);
    const skipped = await call(`/workouts/${id}/cards`, { index: 1, id: w1.id, skipped: true }, m.cookie);
    expect(skipped.status).toBe(200);
    expect(skipped.data.saved).toBe(false);
    // A card at the camera step: refused; the camera set: saved.
    expect((await card(cam, today.extra[0])).status).toBe(409);
    const step = steps[cam];
    if (step.kind !== "camera") throw new Error("camera step");
    const set = await call(`/workouts/${id}/sets`, cameraBody(cam, step.prescription.exerciseId), m.cookie);
    expect(set.status).toBe(200);
    expect(set.data.saved).toBe(true);
    // Resumed where it stopped, with its own day.
    const again = await call(
      "/workouts",
      { version: m.plan.version, demo: false, guided: true, weekday: 5 },
      m.cookie,
    );
    expect(again.data.id).toBe(id);
    expect(again.data.nextIndex).toBe(cam + 1);
    expect(again.data.today).toEqual(today);
    const records = (await call("/sessions", undefined, m.cookie)).data.records;
    expect(records).toHaveLength(2);
    const guided = records.find((x: { mode: string }) => x.mode === "guided");
    expect(guided).toMatchObject({ exerciseId: w0.id, slot: "warmup", rpe: 3, done: doneOf(w0) });
    // A start before the workout began is read as the workout's start.
    expect(guided.startedAt).toBeLessThanOrEqual(guided.endedAt);
    expect(guided.endedAt - guided.startedAt).toBeLessThan(59_000);
  });

  it("counts a session of completed cards toward the sessions done; skipped cards alone count nothing", async () => {
    const m = await member();
    const r = await call(
      "/workouts",
      { version: m.plan.version, demo: false, guided: true, weekday: 0 },
      m.cookie,
    );
    const w0 = (r.data.today as SessionDay).warmup[0];
    const before = (await call("/progress", undefined, m.cookie)).data.sessions.weeks.at(-1);
    expect(before.done).toBe(0);
    await call(`/workouts/${r.data.id}/cards`, { index: 0, id: w0.id, skipped: true }, m.cookie);
    expect((await call("/progress", undefined, m.cookie)).data.sessions.weeks.at(-1).done).toBe(0);
    const w1 = (r.data.today as SessionDay).warmup[1];
    const saved = await call(
      `/workouts/${r.data.id}/cards`,
      { index: 1, id: w1.id, done: doneOf(w1), rpe: 6 },
      m.cookie,
    );
    expect(saved.data.saved).toBe(true);
    const p = (await call("/progress", undefined, m.cookie)).data;
    expect(p.sessions.weeks.at(-1).done).toBe(1);
    expect(p.avgEffort).toBe(6);
    // A card has no camera reps: the in range share stays empty.
    expect(p.validShare).toBeNull();
  });

  it("runs a program with no camera movement on cards alone, and ends after the last card", async () => {
    const m = await member({ ...base, conditions: ["upper_limb_unilateral"] });
    expect(m.plan.status).toBe("ready");
    expect(m.plan.exercises).toEqual([]);
    const r = await call(
      "/workouts",
      { version: m.plan.version, demo: false, guided: true, weekday: 0 },
      m.cookie,
    );
    expect(r.status).toBe(200);
    const steps = sessionSteps(r.data.plan, r.data.today);
    expect(steps.length).toBeGreaterThan(3);
    for (const [index, s] of steps.entries()) {
      if (s.kind !== "card") throw new Error("cards only");
      const res = await call(
        `/workouts/${r.data.id}/cards`,
        { index, id: s.item.id, done: doneOf(s.item), rpe: 2 },
        m.cookie,
      );
      expect(res.status).toBe(200);
    }
    expect(
      (await call(`/workouts/${r.data.id}/cards`, { index: steps.length, id: "x", skipped: true }, m.cookie))
        .status,
    ).toBe(409);
    // Ended: the next start waits for the recovery time.
    expect(
      (await call("/workouts", { version: m.plan.version, demo: false, guided: true, weekday: 0 }, m.cookie))
        .data.error,
    ).toBe("RECOVERY");
  });

  it("ends a session after a card of high effort", async () => {
    const m = await member();
    const r = await call(
      "/workouts",
      { version: m.plan.version, demo: false, guided: true, weekday: 0 },
      m.cookie,
    );
    const w0 = (r.data.today as SessionDay).warmup[0];
    await call(`/workouts/${r.data.id}/cards`, { index: 0, id: w0.id, done: doneOf(w0), rpe: 9 }, m.cookie);
    const next = await call(
      "/workouts",
      { version: m.plan.version, demo: false, guided: true, weekday: 0 },
      m.cookie,
    );
    expect(next.data.error).toBe("RECOVERY");
  });

  it("keeps nothing from a preview", async () => {
    const m = await member();
    const r = await call(
      "/workouts",
      { version: m.plan.version, demo: true, guided: true, weekday: 0 },
      m.cookie,
    );
    const w0 = (r.data.today as SessionDay).warmup[0];
    const res = await call(
      `/workouts/${r.data.id}/cards`,
      { index: 0, id: w0.id, done: doneOf(w0), rpe: 2 },
      m.cookie,
    );
    expect(res.status).toBe(200);
    expect(res.data.saved).toBe(false);
    expect((await call("/sessions", undefined, m.cookie)).data.records).toEqual([]);
  });
});

it("plans a profile left in review before the cards only for want of a camera movement again, once", async () => {
  const m = await member();
  const intake = { ...base, conditions: ["upper_limb_unilateral"] };
  const old = {
    status: "review",
    reasons: ["no_exercises"],
    notes: ["self_reported_clearance"],
    exclusions: [
      { exerciseId: "seated_shoulder_press", reason: "tracking_limbs" },
      { exerciseId: "seated_biceps_curl", reason: "tracking_limbs" },
      { exerciseId: "sit_to_stand", reason: "standing" },
    ],
    exercises: [],
    days: [0, 2, 4],
    time: "09:00",
    warmUpMinutes: 5,
    coolDownMinutes: 5,
    estimatedMinutes: 10,
    recoveryHours: 48,
    created: 1_790_000_000_000,
  };
  const db = new DatabaseSync(file);
  db.prepare("UPDATE profiles SET intake=?, plan=?, version=? WHERE user_id=?").run(
    JSON.stringify(intake),
    JSON.stringify(old),
    5,
    m.id,
  );
  const first = (await call("/auth/me", undefined, m.cookie)).data;
  expect(first.plan.status).toBe("ready");
  expect(first.plan.version).toBe(6);
  expect(first.plan.created).toBe(old.created);
  expect(first.intake).toEqual(intake);
  const second = (await call("/auth/me", undefined, m.cookie)).data;
  expect(second.plan).toEqual(first.plan);
  // A review for another reason as well is left alone.
  db.prepare("UPDATE profiles SET plan=?, version=? WHERE user_id=?").run(
    JSON.stringify({ ...old, reasons: ["no_exercises", "cardiac"] }),
    9,
    m.id,
  );
  const third = (await call("/auth/me", undefined, m.cookie)).data;
  expect(third.plan.status).toBe("review");
  expect(third.plan.version).toBe(9);
  db.close();
});
