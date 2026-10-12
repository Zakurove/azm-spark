/**
 * The booth demo (/demo, Nasser at KSCDR): POST /api/demo/start signs in a fresh demo person with no
 * registration, tagged by the reserved domain, with the adult confirmation, the focus check and Live
 * coach consents and a filled v7 health form whose program waits for the check; the visitor before is
 * signed out; the reserved domain can never register or sign in; the route is rate limited; and a
 * demo person's activity never reaches the anonymous daily counts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FOCUS_RULES } from "../../server/modules/focus/precheck";
import { DEMO_ALL, DEMO_PER_IP } from "../../server/modules/demo/routes";
import { DEMO_DOMAIN, DEMO_INTAKE, isDemoEmail } from "../../server/modules/demo/store";
import { validateIntake } from "../../src/medical/plan";
import { activeConsent } from "../../server/modules/consents/store";
import { newcomer, PASSWORD, startV7Api, v7Intake, type V7Harness } from "./a-harness";

let h: V7Harness;
const flag = process.env.AZM_V7;
let address = 0;
/** A fresh client address per test, so the per address limit is the test's own. */
const from = () => ({ "x-forwarded-for": `198.51.${Math.floor(++address / 250)}.${address % 250}` });

beforeAll(async () => {
  process.env.AZM_V7 = "1";
  h = await startV7Api(FOCUS_RULES);
});
afterAll(async () => {
  await h.close();
  if (flag === undefined) delete process.env.AZM_V7;
  else process.env.AZM_V7 = flag;
});

const DAY = { painByRegion: {}, redFlagRegions: [], worrying: false, unsteady: false, walk10m: true };
const startBody = {
  setting: "home",
  today: DAY,
  device: { os: "iOS", browser: "Safari" },
  include: { rom: true, gait: true },
};
const counts = (metric: string) =>
  (
    h.db().prepare("SELECT COALESCE(SUM(count),0) AS n FROM product_counts WHERE metric=?").get(metric) as {
      n: number;
    }
  ).n;

describe("POST /api/demo/start", () => {
  it("signs in a fresh, tagged demo person with the consents and a filled health form", async () => {
    const r = await h.call("/demo/start", {}, "", "POST", from());
    expect(r.status).toBe(200);
    expect(r.cookie).toMatch(/^azm_session=[0-9a-f]{64}$/);
    expect(r.data.demo).toBe(true);
    expect(r.data.user.email).toMatch(
      /^demo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@demo\.azm-spark\.invalid$/,
    );
    expect(r.data.user.name).toBe("زائر");
    expect(isDemoEmail(r.data.user.email)).toBe(true);
    expect(r.data.awaitingCheck).toBe(true);
    expect(r.data.plan).toMatchObject({ status: "ready", version: 1 });

    // Signed in as for a normal sign in: /auth/me reads the same person and the filled intake.
    const me = await h.call("/auth/me", undefined, r.cookie);
    expect(me.status).toBe(200);
    expect(me.data.user).toEqual(r.data.user);
    expect(me.data.intake).toEqual(DEMO_INTAKE);
    expect(validateIntake(me.data.intake)).toBe(true);
    expect(me.data.intake).toMatchObject({ sex: "male", walking: { status: "without_aid" }, consent: true });
    expect(me.data.intake.age).toBeGreaterThanOrEqual(40);
    expect(me.data.intake.age).toBeLessThan(50);
    expect(me.data.awaitingCheck).toBe(true);

    // Stored: the adult confirmation and the two v7 consents a first check would record.
    const db = h.db();
    const id = r.data.user.id as string;
    expect(db.prepare("SELECT 1 FROM adult_confirmations WHERE user_id=?").get(id)).toBeTruthy();
    expect(activeConsent(db, id, "focus_check")).not.toBeNull();
    expect(activeConsent(db, id, "live_coach")).not.toBeNull();

    // The focus check is ready at once: the consents are there, range movements and the walk are offered.
    const ctx = await h.call("/focus/context", undefined, r.cookie);
    expect(ctx.status).toBe(200);
    expect(ctx.data.consent).toEqual({ focus_check: true, live_coach: true });
    const items = (
      ctx.data.protocol.items as { movementId: string; skipped?: string; block: string }[]
    ).filter((i) => !i.skipped);
    expect(items.map((i) => i.movementId)).toContain("shoulder_flexion");
    // Nothing lying down at a booth.
    expect(items.every((i) => i.block !== "lying")).toBe(true);
    expect(ctx.data.gait).toMatchObject({ offered: true, views: { overground: ["side", "front", "back"] } });
  });

  it("each start is a new person; the visitor before is signed out", async () => {
    const first = await h.call("/demo/start", {}, "", "POST", from());
    const second = await h.call("/demo/start", {}, first.cookie, "POST", from());
    expect(second.status).toBe(200);
    expect(second.data.user.id).not.toBe(first.data.user.id);
    expect(second.cookie).not.toBe(first.cookie);
    expect((await h.call("/auth/me", undefined, first.cookie)).status).toBe(401);
    expect((await h.call("/auth/me", undefined, second.cookie)).data.user.id).toBe(second.data.user.id);
  });

  it("a real person who opens the demo is signed out of their own account, which stays", async () => {
    const real = await newcomer(h, "real-visitor@example.test", v7Intake());
    const demo = await h.call("/demo/start", {}, real, "POST", from());
    expect(demo.status).toBe(200);
    expect((await h.call("/auth/me", undefined, real)).status).toBe(401);
    const back = await h.call("/auth/login", { email: "real-visitor@example.test", password: PASSWORD });
    expect(back.status).toBe(200);
    expect(back.data.user.email).toBe("real-visitor@example.test");
  });

  it("the reserved domain never registers and a demo account never signs in by password", async () => {
    const r = await h.call("/demo/start", {}, "", "POST", from());
    const login = await h.call("/auth/login", { email: r.data.user.email, password: PASSWORD });
    expect(login.status).toBe(400);
    expect(login.data).toEqual({ error: "CREDENTIAL_FORMAT" });
    const reg = await h.call("/auth/register", {
      name: "Someone",
      email: `demo-x@${DEMO_DOMAIN}`,
      password: PASSWORD,
      adultConfirmed: true,
    });
    expect(reg.status).toBe(400);
    expect(reg.data).toEqual({ error: "CREDENTIAL_FORMAT" });
  });

  it("refuses a body", async () => {
    const r = await h.call("/demo/start", { name: "x" }, "", "POST", from());
    expect(r.status).toBe(400);
    expect(r.data).toEqual({ error: "DEMO_INVALID", field: "body" });
  });

  it("is rate limited per address and in all", async () => {
    const one = from();
    const answers: number[] = [];
    for (let i = 0; i <= DEMO_PER_IP; i++)
      answers.push((await h.call("/demo/start", {}, "", "POST", one)).status);
    expect(answers.slice(0, DEMO_PER_IP).every((s) => s === 200)).toBe(true);
    expect(answers[DEMO_PER_IP]).toBe(429);
    // Another address still gets one, until every address together has used the overall limit.
    expect((await h.call("/demo/start", {}, "", "POST", from())).status).toBe(200);
    let last = 200;
    for (let i = 0; i < DEMO_ALL && last === 200; i++)
      last = (await h.call("/demo/start", {}, "", "POST", from())).status;
    expect(last).toBe(429);
    const people = h
      .db()
      .prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE ?")
      .get(`%@${DEMO_DOMAIN}`) as { n: number };
    expect(people.n).toBeLessThanOrEqual(DEMO_ALL + 10);
  });

  it("answers 404 with the v7 flag off", async () => {
    process.env.AZM_V7 = "0";
    try {
      expect((await h.call("/demo/start", {}, "", "POST", from())).status).toBe(404);
    } finally {
      process.env.AZM_V7 = "1";
    }
  });
});

describe("the demo person's activity stays out of the daily counts", () => {
  it("a demo focus check start is not counted; a real one is", async () => {
    await h.restart(); // a fresh rate limit window for this test's own demo person
    const demo = await h.call("/demo/start", {}, "", "POST", from());
    const before = counts("focus_started");
    const started = await h.call("/focus", startBody, demo.cookie);
    expect(started.status).toBe(200);
    expect(counts("focus_started")).toBe(before);
    const real = await newcomer(h, "counted@example.test", v7Intake(), ["focus_check"]);
    expect((await h.call("/focus", startBody, real)).status).toBe(200);
    expect(counts("focus_started")).toBe(before + 1);
  });
});
