/**
 * Flag gating (product v7 contract C-9, section 4 "Flag gating, exactly"):
 *   - with AZM_V7 unset every gated route answers 404 NOT_FOUND, and the gait route refuses its large
 *     body before reading it; with AZM_V7=1 they answer;
 *   - the existing routes behave as today with the flag off: the consents route rejects the new kinds,
 *     the report extraction schema has no regions, PUT /api/intake saves and calls afterIntakeSaved only
 *     with the flag on; POST /api/plan/weekly returns a targeted weekly (one with findings) unchanged,
 *     also with refresh: true;
 *   - agent_sessions rows older than 90 days are deleted when the API starts;
 *   - the default production build holds no v7 page chunk, and a VITE_V7=1 build holds them (8.8).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";

const hooks = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../../server/modules/program/hooks", () => ({
  afterIntakeSaved: (_db: unknown, userId: string) => {
    hooks.calls.push(userId);
  },
}));

import { extractReport } from "../../server/report";
import { AGENT_SESSIONS_KEPT_DAYS } from "../../server/modules/focus/store";
import { testRules } from "./a-focus-rules";
import { DAY, member, register, startV7Api, userId, v7Intake, type V7Harness } from "./a-harness";

let h: V7Harness;
beforeAll(async () => {
  h = await startV7Api(testRules());
});
afterAll(async () => {
  await h.close();
});
afterEach(() => {
  delete process.env.AZM_V7;
});

const ID = "11111111-2222-4333-8444-555555555555";
/** Every gated route of section 4 with a body that would pass its parse. */
const GATED: [string, string, unknown][] = [
  ["GET", "/focus/context", undefined],
  ["POST", "/focus", {}],
  ["POST", `/focus/${ID}/rom`, {}],
  ["POST", `/focus/${ID}/gait`, {}],
  ["POST", `/focus/${ID}/stop`, { option: "tired" }],
  ["POST", `/focus/${ID}/complete`, {}],
  ["GET", "/focus", undefined],
];
/** Gated routes of the other streams, placeholders until they land (contract 1.3). */
const PLACEHOLDER_PATHS: [string, string, unknown][] = [
  ["GET", "/focus/profile", undefined],
  ["POST", "/program/targets", {}],
  ["POST", "/agent/token", {}],
  ["POST", "/agent/usage", {}],
];

describe("the v7 routes behind AZM_V7", () => {
  it("answer 404 NOT_FOUND with the flag unset, signed in or not", async () => {
    const cookie = await member(h, "gate@example.test", v7Intake());
    for (const flag of [undefined, "0", "true"]) {
      if (flag === undefined) delete process.env.AZM_V7;
      else process.env.AZM_V7 = flag;
      for (const [method, path, body] of GATED) {
        expect((await h.call(path, body, cookie, method)).data, `${method} ${path}`).toEqual({
          error: "NOT_FOUND",
        });
        expect((await h.call(path, body, "", method)).status, `${method} ${path} signed out`).toBe(404);
      }
      // The placeholders of B, D and E answer as unknown paths (404 for a signed in caller).
      for (const [method, path, body] of PLACEHOLDER_PATHS)
        expect((await h.call(path, body, cookie, method)).status, `${method} ${path}`).toBe(404);
    }
  });

  it("refuses the gait route's large body from the headers with the flag off", async () => {
    const cookie = await member(h, "gate-body@example.test", v7Intake());
    const big = { pad: "x".repeat(100 * 1024) };
    expect((await h.call(`/focus/${ID}/gait`, big, cookie)).data).toEqual({ error: "NOT_FOUND" });
  });

  it("answer with AZM_V7=1", async () => {
    process.env.AZM_V7 = "1";
    const cookie = await member(h, "gate-on@example.test", v7Intake());
    expect((await h.call("/focus", undefined, cookie)).data).toEqual({ checks: [] });
    expect((await h.call(`/focus/${ID}/complete`, {}, cookie)).data).toEqual({ error: "NOT_FOUND" });
    expect((await h.call("/focus", undefined, "")).data).toEqual({ error: "AUTH_REQUIRED" });
  });

  it("answer 503 FOCUS_RULES_PENDING while the rules of A2 and A4 are not bound", async () => {
    process.env.AZM_V7 = "1";
    const pending = await startV7Api(null);
    try {
      const cookie = await member(pending, "pending@example.test", v7Intake());
      expect((await pending.call("/focus/context", undefined, cookie)).data).toEqual({
        error: "FOCUS_RULES_PENDING",
      });
      expect((await pending.call("/focus", undefined, cookie)).data).toEqual({ checks: [] });
    } finally {
      await pending.close();
    }
  });
});

describe("existing routes with the flag off", () => {
  it("refuse the new consent kinds as unknown", async () => {
    const cookie = await register(h, "consent-off@example.test");
    for (const kind of ["focus_check", "live_coach"])
      expect((await h.call("/consents", { kind, version: 1 }, cookie)).data).toEqual({
        error: "CONSENT_INVALID",
        field: "kind",
      });
  });

  it("keep the report extraction schema without regions", async () => {
    let sent: any = null;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ document: "medical_report" }) } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    try {
      await extractReport({ kind: "text", text: "report" }, "test-key");
    } finally {
      fetchSpy.mockRestore();
    }
    const schema = sent.response_format.json_schema.schema;
    expect(schema.properties).not.toHaveProperty("regions");
    expect(schema.required).not.toContain("regions");
  });

  it("save the intake and call afterIntakeSaved only with AZM_V7=1", async () => {
    hooks.calls.length = 0;
    const cookie = await register(h, "intake-hook@example.test");
    const id = await userId(h, cookie);
    expect((await h.call("/intake", v7Intake(), cookie, "PUT")).status).toBe(200);
    expect(hooks.calls).toEqual([]);
    process.env.AZM_V7 = "1";
    expect((await h.call("/intake", v7Intake({ age: 59 }), cookie, "PUT")).status).toBe(200);
    expect(hooks.calls).toEqual([id]);
    // A refused intake is not saved and calls nothing.
    expect((await h.call("/intake", { age: 3 }, cookie, "PUT")).status).toBe(400);
    expect(hooks.calls).toEqual([id]);
  });

  it("never replace a targeted weekly (one with findings), also with refresh: true", async () => {
    const cookie = await member(h, "weekly@example.test", v7Intake());
    const id = await userId(h, cookie);
    const first = await h.call("/plan/weekly", {}, cookie);
    expect(first.status).toBe(200);
    // A weekly without findings is replaced by a refresh, as today.
    const refreshed = await h.call("/plan/weekly", { refresh: true }, cookie);
    expect(refreshed.status).toBe(200);
    // A targeted weekly is returned unchanged.
    const db = h.db();
    const row = db.prepare("SELECT plan, version FROM profiles WHERE user_id=?").get(id) as {
      plan: string;
      version: number;
    };
    const plan = JSON.parse(row.plan);
    const targeted = {
      ...plan.weekly,
      summary: { ar: "خطة موجهة", en: "A targeted week" },
      findings: { checkId: "c1", romVersion: "r", gaitVersion: null, targetsVersion: "t", created: 1 },
    };
    db.prepare("UPDATE profiles SET plan=? WHERE user_id=?").run(
      JSON.stringify({ ...plan, weekly: targeted }),
      id,
    );
    for (const flag of [undefined, "1"]) {
      if (flag) process.env.AZM_V7 = flag;
      for (const body of [{}, { refresh: true }])
        expect((await h.call("/plan/weekly", body, cookie)).data).toEqual({
          weekly: targeted,
          version: row.version,
        });
    }
  });
});

describe("coach session retention", () => {
  it("deletes agent_sessions rows minted more than 90 days ago when the API starts", async () => {
    const cookie = await register(h, "retention@example.test");
    const id = await userId(h, cookie);
    const db = h.db();
    const insert = db.prepare(
      `INSERT INTO agent_sessions(id,user_id,block,segment,ref,day,device,model,instruction_version,minutes_reserved,minted)
       VALUES(?,?,'rom','rom:seated:1',?,'2026-07-01','d','m','coach_si_1',4,?)`,
    );
    const now = Date.now();
    insert.run("old", id, "ref-old", now - (AGENT_SESSIONS_KEPT_DAYS + 1) * DAY);
    insert.run("kept", id, "ref-kept", now - (AGENT_SESSIONS_KEPT_DAYS - 1) * DAY);
    await h.restart();
    expect(h.db().prepare("SELECT id FROM agent_sessions ORDER BY id").all()).toEqual([{ id: "kept" }]);
  });
});

describe("the v7 pages in the production builds (8.8)", () => {
  const PAGES = ["FocusApp", "FindingsPage", "ProgramPage", "ShowcaseEntry"];
  async function chunks(v7: boolean): Promise<string[]> {
    const outDir = mkdtempSync(join(tmpdir(), "azm-v7-build-"));
    const saved = { v7: process.env.VITE_V7, e2e: process.env.VITE_E2E, node: process.env.NODE_ENV };
    if (v7) process.env.VITE_V7 = "1";
    else delete process.env.VITE_V7;
    delete process.env.VITE_E2E;
    process.env.NODE_ENV = "production";
    try {
      await build({
        root: join(__dirname, "../.."),
        configFile: join(__dirname, "../../vite.config.ts"),
        logLevel: "silent",
        mode: "production",
        build: { outDir, emptyOutDir: true, copyPublicDir: false },
      });
      const files = readdirSync(join(outDir, "assets"));
      const index = files.find((f) => /^index-.*\.js$/.test(f))!;
      const first = readFileSync(join(outDir, "assets", index), "utf8");
      return [...files, `first-script-mentions-focus:${first.includes("focus=1")}`];
    } finally {
      for (const [k, v] of [
        ["VITE_V7", saved.v7],
        ["VITE_E2E", saved.e2e],
        ["NODE_ENV", saved.node],
      ] as const)
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      rmSync(outDir, { recursive: true, force: true });
    }
  }

  it("keeps every v7 page out of the default build and in the VITE_V7=1 build", async () => {
    const plain = await chunks(false);
    for (const page of PAGES)
      expect(
        plain.some((f) => f.startsWith(`${page}-`)),
        page,
      ).toBe(false);
    expect(plain).toContain("first-script-mentions-focus:false");
    const v7 = await chunks(true);
    for (const page of PAGES)
      expect(
        v7.some((f) => f.startsWith(`${page}-`)),
        page,
      ).toBe(true);
    expect(v7).toContain("first-script-mentions-focus:true");
  }, 120_000);
});
