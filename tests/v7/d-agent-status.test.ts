/**
 * Step D5: GET /api/agent/status, what the coach's switch reads (product v7 contract 5, C-5, C-9):
 * whether the server can run the live coach now (switched on with a key; the key itself never leaves
 * the server) and whether the person has the live_coach consent. Behind AZM_V7 like every coach route.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FOCUS_RULES } from "../../server/modules/focus/precheck";
import { member, startV7Api, v7Intake, type V7Harness } from "./a-harness";

const KEY = "test-gemini-key-SECRET-status";
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
  process.env.AZM_AGENT_ENABLED = "1";
  process.env.GEMINI_API_KEY = KEY;
});
afterEach(() => {
  for (const k of ["AZM_V7", "AZM_AGENT_ENABLED", "GEMINI_API_KEY"]) delete process.env[k];
});

const someone = (consents: string[]) => member(h, `status-${++n}@example.test`, v7Intake(), consents);

describe("GET /api/agent/status", () => {
  it("says the coach is available and whether the person consented, never the key", async () => {
    const without = await h.call("/agent/status", undefined, await someone([]), "GET");
    expect(without.status).toBe(200);
    expect(without.data).toEqual({ available: true, consent: false });
    const withIt = await h.call("/agent/status", undefined, await someone(["live_coach"]), "GET");
    expect(withIt.data).toEqual({ available: true, consent: true });
    expect(JSON.stringify(withIt.data)).not.toContain(KEY);
  });

  it("says unavailable while the coach is switched off or has no key", async () => {
    const cookie = await someone(["live_coach"]);
    process.env.AZM_AGENT_ENABLED = "0";
    expect((await h.call("/agent/status", undefined, cookie, "GET")).data).toEqual({
      available: false,
      consent: true,
    });
    process.env.AZM_AGENT_ENABLED = "1";
    delete process.env.GEMINI_API_KEY;
    expect((await h.call("/agent/status", undefined, cookie, "GET")).data.available).toBe(false);
  });

  it("needs a signed in person, and does not exist without AZM_V7", async () => {
    expect((await h.call("/agent/status", undefined, "", "GET")).status).toBe(401);
    const cookie = await someone([]);
    delete process.env.AZM_V7;
    expect((await h.call("/agent/status", undefined, cookie, "GET")).status).toBe(404);
  });
});
