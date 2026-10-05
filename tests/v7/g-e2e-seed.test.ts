/**
 * The v7 e2e seed (contract 1.2 e2e/v7-seed.ts and 8.7; D-026 item 8, DG-6): the fake coach of
 * ?e2eCoach=fake mints no token, so its usage reports name E2E_COACH_SESSION_ID, and the seed writes
 * that agent_sessions row for the person of the run. With it the page hide usage report answers 200
 * on the e2e server, whose coach is switched off (1.2.1: AZM_AGENT_ENABLED=0).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { E2E_COACH_REF, E2E_COACH_SEGMENT, seedCoachSession } from "../../e2e/v7-seed";
import { E2E_COACH_SESSION_ID } from "../../src/features/coach-agent/e2eCoach";
import { FOCUS_RULES } from "../../server/modules/focus/precheck";
import { member, startV7Api, userId, v7Intake, type V7Harness } from "./a-harness";

let h: V7Harness;
let n = 0;
beforeAll(async () => {
  h = await startV7Api(FOCUS_RULES);
});
afterAll(async () => {
  await h.close();
});
afterEach(() => {
  delete process.env.AZM_V7;
});

/** A signed in person of the run, with a v7 intake. */
async function person(): Promise<{ cookie: string; id: string }> {
  process.env.AZM_V7 = "1";
  const cookie = await member(h, `seed-${n++}@example.test`, v7Intake());
  return { cookie, id: await userId(h, cookie) };
}

/** The fake coach's page hide report (e2eCoach.ts sends its reports like a real segment). */
const report = (over: Record<string, unknown> = {}) => ({
  sessionId: E2E_COACH_SESSION_ID,
  connectMs: 40,
  durationSec: 90,
  turns: 3,
  toolCalls: { confirm_max: { ok: 1, rejected: 0 } },
  promptTokens: null,
  responseTokens: null,
  firstAudioMs: null,
  endReason: "user_end",
  ...over,
});
const usage = (cookie: string, body: unknown) => h.call("/agent/usage", body, cookie);
const row = () =>
  h.db().prepare("SELECT * FROM agent_sessions WHERE id=?").get(E2E_COACH_SESSION_ID) as
    Record<string, unknown> | undefined;

describe("seedCoachSession (DG-6)", () => {
  it("writes the fake mint's session row, so the page hide report answers 200 with the coach off", async () => {
    delete process.env.AZM_AGENT_ENABLED;
    const { cookie, id } = await person();
    expect((await usage(cookie, report())).status).toBe(404);
    seedCoachSession(h.file, id);
    expect(row()).toMatchObject({
      user_id: id,
      block: "session",
      segment: E2E_COACH_SEGMENT,
      ref: E2E_COACH_REF,
      minutes_used: null,
      reported: null,
    });
    expect(await usage(cookie, report())).toMatchObject({ status: 200, data: { ok: true } });
    // The report is stored on the row like a real segment's: counts and times only.
    expect(row()).toMatchObject({ user_id: id, minutes_used: 1.5, turns: 3, end_reason: "user_end" });
  });

  it("gives the row to the person seeded last: one fixed id per e2e database", async () => {
    const a = await person();
    const b = await person();
    seedCoachSession(h.file, a.id);
    seedCoachSession(h.file, b.id);
    expect(row()).toMatchObject({ user_id: b.id, minutes_used: null, end_reason: null });
    // Another person's session reads as missing (ownSession), so only the last seeded can report.
    expect((await usage(a.cookie, report())).status).toBe(404);
    expect((await usage(b.cookie, report())).status).toBe(200);
    expect(
      h.db().prepare("SELECT COUNT(*) AS n FROM agent_sessions WHERE id=?").get(E2E_COACH_SESSION_ID),
    ).toEqual({
      n: 1,
    });
  });
});
