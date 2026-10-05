/**
 * Step B4, contract section 4: GET /api/focus/profile?checkId= on the real focus routes (A's harness,
 * FOCUS_RULES, AZM_V7, a booth pass): the latest completed check by default or the one named, its
 * profile from the stored rows with the defaults computed on read, the findings, the body map summary,
 * the walk's card with its final findings and their lines, the changes against the first check (like
 * with like, the same setting) and the walk's changes; 404 NONE without a completed check of the person.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FOCUS_RULES } from "../../server/modules/focus/precheck";
import { gaitOf, romRowsOf } from "../../server/modules/focus/store";
import { withGaitLines } from "../../src/medical/gait-rules";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import type { Intake, Sex } from "../../src/medical/plan";
import type { RomProtocol, RomProtocolItem } from "../../src/medical/rom-protocol";
import { bodyMapSummary, buildRomProfile, compareRom, romFindings } from "../../src/medical/rom-profile";
import { fill } from "../precheck-fixtures";
import { gaitBody, romBody } from "./a-focus-bodies";
import {
  DAY,
  HOUR,
  T0,
  boothPass,
  member,
  startV7Api,
  v1Intake,
  v7Intake,
  type V7Harness,
} from "./a-harness";

let h: V7Harness;
let pass = "";
let n = 0;
const setTime = (t: number) => vi.setSystemTime(t);

beforeAll(async () => {
  h = await startV7Api(FOCUS_RULES);
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setTime(T0);
  process.env.AZM_V7 = "1";
  pass = await boothPass(h, T0);
});
afterEach(() => {
  vi.useRealTimers();
  for (const k of ["AZM_V7", "AZM_BOOTH_DATES", "AZM_BOOTH_CODE"]) delete process.env[k];
});

/** Fahd's shape (D-025 CT-1): weaker right side after a stroke, the condition's regions on the map. */
const FAHD = v7Intake({
  regions: [
    { region: "shoulder", side: "right", problems: ["weakness"], origin: "condition" },
    { region: "knee", side: "right", problems: ["weakness"], origin: "condition" },
  ],
}) as Intake & { sex: Sex };

async function person(intake: Intake = FAHD) {
  n += 1;
  const cookie = await member(h, `profile${n}@example.test`, intake, ["focus_check"]);
  return cookie;
}

const booth = () => ({ "x-azm-booth": pass });

/** A started booth focus check (the walk planned when the person walks). */
async function started(cookie: string) {
  const c = await h.call("/focus/context", undefined, cookie, "GET", booth());
  if (c.status !== 200 || !c.data.env) throw new Error(`context ${c.status} ${JSON.stringify(c.data)}`);
  const r = await h.call(
    "/focus",
    {
      setting: "booth",
      answers: fill(c.data.env),
      today: { painByRegion: {}, redFlagRegions: [], walk10m: true },
      device: { os: "iOS", browser: "Safari" },
      include: { rom: true, gait: true },
    },
    cookie,
    "POST",
    booth(),
  );
  if (r.status !== 200) throw new Error(`start ${r.status} ${JSON.stringify(r.data)}`);
  return r.data as { id: string; kind: string; protocol: RomProtocol; gait: GaitPlan | null };
}

const item = (p: RomProtocol, movementId: string, side = "right") => {
  const i = p.items.find((x) => x.movementId === movementId && x.side === side && !x.skipped);
  if (!i)
    throw new Error(`no runnable ${movementId} ${side}: ${JSON.stringify(p.items.map((x) => x.movementId))}`);
  return i as RomProtocolItem;
};

/** Posts a measured result for each movement (best `value`, median 2 short of it), then completes. */
async function check(
  cookie: string,
  values: Record<string, number>,
  opts: { gait?: Record<string, unknown> | null } = {},
) {
  const s = await started(cookie);
  for (const [movementId, value] of Object.entries(values)) {
    const r = await h.call(`/focus/${s.id}/rom`, romBody(item(s.protocol, movementId), value), cookie);
    if (r.status !== 200) throw new Error(`rom ${movementId} ${r.status} ${JSON.stringify(r.data)}`);
  }
  if (opts.gait !== undefined && opts.gait !== null) {
    const r = await h.call(`/focus/${s.id}/gait`, opts.gait, cookie);
    if (r.status !== 200) throw new Error(`gait ${r.status} ${JSON.stringify(r.data)}`);
  }
  const done = await h.call(`/focus/${s.id}/complete`, {}, cookie);
  if (done.status !== 200) throw new Error(`complete ${done.status} ${JSON.stringify(done.data)}`);
  return { ...s, complete: done.data };
}

const profile = (cookie: string, checkId?: string) =>
  h.call(
    `/focus/profile${checkId === undefined ? "" : `?checkId=${encodeURIComponent(checkId)}`}`,
    undefined,
    cookie,
  );

describe("GET /api/focus/profile", () => {
  it("writes the walk's lines with the gait rules' withGaitLines, a plain import (D-027 item 7)", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../../server/modules/focus/profile.ts", import.meta.url)),
      "utf8",
    );
    expect(src).toMatch(
      /import \{[^}]*\bwithGaitLines\b[^}]*\} from "\.\.\/\.\.\/\.\.\/src\/medical\/gait-rules";/,
    );
    // No lookup by name and no empty lines fallback: the export is there since the wave 2 merge.
    expect(src).not.toMatch(/WITH_GAIT_LINES|EMPTY_LINES| in ns/);
  });

  it("is a v7 route for a signed in person (404 with the flag off, 401 without a session)", async () => {
    const cookie = await person();
    delete process.env.AZM_V7;
    expect(await profile(cookie)).toMatchObject({ status: 404, data: { error: "NOT_FOUND" } });
    process.env.AZM_V7 = "1";
    expect(await profile("")).toMatchObject({ status: 401, data: { error: "AUTH_REQUIRED" } });
  });

  it("answers 404 NONE without a completed check of the person: none yet, an open one, another's, a bad id", async () => {
    const cookie = await person();
    expect(await profile(cookie)).toMatchObject({ status: 404, data: { error: "NONE" } });
    const open = await started(cookie);
    expect(await profile(cookie)).toMatchObject({ status: 404, data: { error: "NONE" } });
    expect(await profile(cookie, open.id)).toMatchObject({ status: 404, data: { error: "NONE" } });
    const other = await person();
    setTime(T0 + HOUR);
    const theirs = await check(other, { knee_flexion: 120 });
    expect(await profile(cookie, theirs.id)).toMatchObject({ status: 404, data: { error: "NONE" } });
    expect(await profile(cookie, "not-an-id")).toMatchObject({ status: 404, data: { error: "NONE" } });
    expect(await profile(cookie, "")).toMatchObject({ status: 404, data: { error: "NONE" } });
  });

  it("shows the latest completed check as complete answered it: the stored rows, the defaults, the findings, the body map", async () => {
    const cookie = await person();
    const s = await check(cookie, { knee_flexion: 95, knee_extension: 4, shoulder_flexion: 150 });
    const r = await profile(cookie);
    expect(r.status).toBe(200);
    expect(Object.keys(r.data).sort()).toEqual([
      "bodyMap",
      "changes",
      "findings",
      "gait",
      "gaitChanges",
      "profile",
    ]);
    // The same profile and findings complete answered with (the same rows, the check's completion time).
    expect(r.data.profile).toEqual(s.complete.profile);
    expect(r.data.findings).toEqual(s.complete.findings);
    // Each stored row under its own source; a region off the body map takes its typical default.
    const db = h.db();
    const rows = romRowsOf(db, s.id);
    const expected = buildRomProfile({ intake: FAHD, rows, now: r.data.profile.created });
    expect(r.data.profile).toEqual(expected);
    expect(r.data.findings).toEqual(romFindings(expected, FAHD));
    expect(r.data.bodyMap).toEqual(bodyMapSummary(expected));
    const knee = r.data.profile.entries.find(
      (e: { movementId: string; side: string }) => e.movementId === "knee_flexion" && e.side === "right",
    );
    expect(knee).toMatchObject({ source: "measured", value: 95, checkId: s.id });
    const otherKnee = r.data.profile.entries.find(
      (e: { movementId: string; side: string }) => e.movementId === "knee_flexion" && e.side === "left",
    );
    expect(otherKnee).toMatchObject({ source: "default", finding: "default" });
    expect(r.data.bodyMap["knee:right"]).toBeDefined();
    expect(r.data.bodyMap["knee:left"]).toBeUndefined();
    // The first check: nothing to compare with yet; no walk was stored.
    expect(r.data).toMatchObject({ changes: [], gaitChanges: [], gait: null });
    // The profile's time is the check's completion.
    const completed = (
      db.prepare("SELECT completed FROM focus_checks WHERE id=?").get(s.id) as { completed: number }
    ).completed;
    expect(r.data.profile.created).toBe(completed);
  });

  it("compares a retest with the earliest completed check like with like, and shows an earlier check on its own", async () => {
    const cookie = await person();
    const first = await check(cookie, { knee_flexion: 90, knee_extension: 20, shoulder_flexion: 120 });
    // 3 days later, a new booth day.
    setTime(T0 + 3 * DAY);
    pass = await boothPass(h, T0 + 3 * DAY);
    const second = await check(cookie, { knee_flexion: 120, knee_extension: 18, shoulder_flexion: 160 });
    expect(second.kind).toBe("retest");
    const r = await profile(cookie);
    expect(r.status).toBe(200);
    expect(
      r.data.profile.entries.find(
        (e: { movementId: string; side: string }) => e.movementId === "knee_flexion" && e.side === "right",
      ).value,
    ).toBe(120);
    const db = h.db();
    expect(r.data.changes).toEqual(
      compareRom(romRowsOf(db, first.id), romRowsOf(db, second.id), FAHD.conditions),
    );
    const change = (id: string) => r.data.changes.find((c: { movementId: string }) => c.movementId === id);
    expect(change("knee_flexion")).toMatchObject({
      first: 90,
      latest: 120,
      direction: "better",
      bandDeg: 10,
    });
    // A lack 2 degrees smaller is within the lying knee's band of 11: about the same.
    expect(change("knee_extension")).toMatchObject({ first: 20, latest: 18, direction: "same", bandDeg: 11 });
    // Stroke: the arm raise to the front's neurological band (18).
    expect(change("shoulder_flexion")).toMatchObject({
      first: 120,
      latest: 160,
      direction: "better",
      bandDeg: 18,
    });
    // The earlier check named by its id: its own profile, with nothing before it to compare.
    const earlier = await profile(cookie, first.id);
    expect(earlier.status).toBe(200);
    expect(
      earlier.data.profile.entries.find(
        (e: { movementId: string; side: string }) => e.movementId === "knee_flexion" && e.side === "right",
      ).value,
    ).toBe(90);
    expect(earlier.data.changes).toEqual([]);
    expect(earlier.data.profile).toEqual(first.complete.profile);
  });

  it("shows the walk with its final findings and their lines, and the walk's changes like with like", async () => {
    const cookie = await person();
    const s = await started(cookie);
    expect(s.gait?.offered).toBe(true);
    const walk = (cadence: number) => {
      const body = gaitBody(s.gait!, "overground");
      (body.analysis.combined as Record<string, { value: number }>).cadence.value = cadence;
      return body;
    };
    // The first check, with its walk (start again to post into a fresh check of the same plan).
    const first = await check(cookie, { knee_flexion: 100 }, { gait: walk(100) });
    const db = h.db();
    const stored = gaitOf(db, first.id)!;
    const r = await profile(cookie);
    expect(r.data.gait).toEqual({
      id: stored.id,
      mode: "overground",
      views: stored.views.map(({ quality: _q, poseModel: _p, ...v }) => v),
      metrics: stored.metrics,
      patterns: withGaitLines(stored.findings.patterns),
      findings: stored.findings.findings,
      quality: stored.quality,
      replay: stored.replay,
      provisional: false,
      rulesVersion: stored.rulesVersion,
      created: stored.created,
    });
    expect(r.data.gait).toEqual(first.complete.gait);
    expect(r.data.gaitChanges).toEqual([]);
    // The retest walks the same way, 12 steps a minute quicker: a change past 5.
    setTime(T0 + 3 * DAY);
    pass = await boothPass(h, T0 + 3 * DAY);
    await check(cookie, { knee_flexion: 100 }, { gait: walk(112) });
    const again = await profile(cookie);
    expect(again.data.gaitChanges).toEqual([{ metric: "cadence", first: 100, latest: 112, direction: "up" }]);
  });

  it("needs the intake's body questions (409 INTAKE_UPDATE_REQUIRED once they are gone)", async () => {
    const cookie = await person();
    await check(cookie, { knee_flexion: 100 });
    expect((await profile(cookie)).status).toBe(200);
    const saved = await h.call("/intake", v1Intake(), cookie, "PUT");
    expect(saved.status).toBe(200);
    expect(await profile(cookie)).toMatchObject({ status: 409, data: { error: "INTAKE_UPDATE_REQUIRED" } });
  });
});
