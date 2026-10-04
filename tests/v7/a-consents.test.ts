/**
 * The two v7 consent kinds (product v7 contract C-8, section 4): focus_check (range compared with
 * norms, a new purpose) and live_coach (the voice coach sends audio outside the Kingdom), version 1
 * each. With AZM_V7 off they are unknown kinds exactly as today (400 on accept, 404 on revoke); with
 * it on they are accepted and revoked like the v1 kinds, and revoking focus_check ends every open
 * focus check (consent_revoked) while what was stored stays with the person.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { CONSENT_VERSIONS, activeConsent } from "../../server/modules/consents/store";
import { tV7, V7_DICTIONARIES } from "../../src/i18n/v7";
import { disclaimersIn } from "../no-disclaimers";
import { member, startV7Api, userId, v7Intake, type V7Harness } from "./a-harness";

/**
 * The digest of the focus check consent text (rom namespace, consent keys) that CONSENT_VERSIONS
 * focus_check 1 stands for. A changed text needs a new consent version, and then a new digest here.
 */
const FOCUS_CHECK_TEXT_V1 = "8c8cc9077c6116df0078e987e8470d8a9f06f45838be0b46c83ab3aafcef0408";

let h: V7Harness;
beforeAll(async () => {
  h = await startV7Api(null);
});
afterAll(async () => {
  await h.close();
});
afterEach(() => {
  delete process.env.AZM_V7;
});

describe("consent kinds", () => {
  it("adds focus_check and live_coach at version 1 beside the v1 kinds", () => {
    expect(CONSENT_VERSIONS).toMatchObject({ focus_check: 1, live_coach: 1, report_reading: 1 });
    expect(CONSENT_VERSIONS.movement_check).toBeGreaterThanOrEqual(1);
  });

  it("refuses the v7 kinds as unknown while AZM_V7 is off, as today", async () => {
    const cookie = await member(h, "off@example.test", v7Intake());
    for (const kind of ["focus_check", "live_coach"]) {
      expect(await h.call("/consents", { kind, version: 1 }, cookie)).toMatchObject({
        status: 400,
        data: { error: "CONSENT_INVALID", field: "kind" },
      });
      expect((await h.call(`/consents/${kind}`, {}, cookie, "DELETE")).status).toBe(404);
    }
    // The v1 kinds are unchanged.
    expect((await h.call("/consents", { kind: "movement_check", version: 1 }, cookie)).status).toBe(200);
    process.env.AZM_V7 = "0";
    expect((await h.call("/consents", { kind: "live_coach", version: 1 }, cookie)).status).toBe(400);
  });

  it("accepts, versions and revokes them with AZM_V7=1", async () => {
    process.env.AZM_V7 = "1";
    const cookie = await member(h, "on@example.test", v7Intake());
    const id = await userId(h, cookie);
    expect((await h.call("/consents", { kind: "focus_check", version: 2 }, cookie)).data).toEqual({
      error: "CONSENT_VERSION",
      version: 1,
    });
    const accepted = await h.call("/consents", { kind: "focus_check", version: 1 }, cookie);
    expect(accepted.status).toBe(200);
    expect(accepted.data).toMatchObject({ kind: "focus_check", version: 1 });
    expect((await h.call("/consents", { kind: "live_coach", version: 1 }, cookie)).status).toBe(200);
    const db = h.db();
    expect(activeConsent(db, id, "focus_check")).not.toBeNull();
    expect(activeConsent(db, id, "live_coach")).not.toBeNull();

    expect((await h.call("/consents/live_coach", {}, cookie, "DELETE")).data).toEqual({
      kind: "live_coach",
      revoked: true,
    });
    expect(activeConsent(db, id, "live_coach")).toBeNull();
    expect(activeConsent(db, id, "focus_check")).not.toBeNull();
  });

  it("ends every open focus check when focus_check is revoked, and keeps what was stored", async () => {
    process.env.AZM_V7 = "1";
    const cookie = await member(h, "revoke@example.test", v7Intake(), ["focus_check"]);
    const id = await userId(h, cookie);
    const db = h.db();
    const insert = db.prepare(
      `INSERT INTO focus_checks(id,user_id,kind,setting,status,protocol,gait_plan,today,precheck,versions,device,intake_version,started,active,completed,ended_reason)
       VALUES(?,?,'baseline','booth',?,'{}',NULL,'{}','{}','{}','{}',1,1,1,?,NULL)`,
    );
    insert.run("open-1", id, "open", null);
    insert.run("done-1", id, "completed", 5);
    db.prepare(
      `INSERT INTO rom_measurements(id,user_id,check_id,movement_id,side,source,finding,attempts,flags,quality,norms_version,created)
       VALUES('row-1',?,'open-1','knee_flexion','right','measured','mild','[]','[]','{}','n',2)`,
    ).run(id);
    // Another person's open check is not touched.
    const other = await member(h, "other@example.test", v7Intake(), ["focus_check"]);
    insert.run("open-2", await userId(h, other), "open", null);

    expect((await h.call("/consents/focus_check", {}, cookie, "DELETE")).data).toEqual({
      kind: "focus_check",
      revoked: true,
    });
    const rows = db.prepare("SELECT id, status, ended_reason FROM focus_checks ORDER BY id").all();
    expect(rows).toEqual([
      { id: "done-1", status: "completed", ended_reason: null },
      { id: "open-1", status: "abandoned", ended_reason: "consent_revoked" },
      { id: "open-2", status: "open", ended_reason: null },
    ]);
    expect(db.prepare("SELECT id FROM rom_measurements").all()).toEqual([{ id: "row-1" }]);
    expect(activeConsent(db, id, "focus_check")).toBeNull();
  });
});

describe("the focus check consent text (version 1)", () => {
  const text = (lang: "ar" | "en") =>
    Object.values((V7_DICTIONARIES[lang].rom as { consent: Record<string, string> }).consent).join(" ");

  it("is the text version 1 stands for", () => {
    const consent = (lang: "ar" | "en") => (V7_DICTIONARIES[lang].rom as { consent: unknown }).consent;
    const digest = createHash("sha256")
      .update(JSON.stringify({ ar: consent("ar"), en: consent("en") }))
      .digest("hex");
    expect({ version: CONSENT_VERSIONS.focus_check, digest }).toEqual({
      version: 1,
      digest: FOCUS_CHECK_TEXT_V1,
    });
  });

  it("names the purpose, what is kept, the processor and the transfer outside the Kingdom (PDPL)", () => {
    expect(tV7("en", "rom.consent.body")).toContain("your sex and age");
    expect(tV7("ar", "rom.consent.body")).toContain("جنسك وعمرك");
    expect(tV7("en", "rom.consent.pointWhere")).toContain("Railway");
    expect(tV7("en", "rom.consent.pointWhere")).toContain("outside the Kingdom");
    expect(tV7("ar", "rom.consent.pointWhere")).toContain("Railway");
    expect(tV7("ar", "rom.consent.pointWhere")).toContain("خارج المملكة");
    expect(tV7("ar", "rom.consent.pointProfile")).toContain("حالتك الطبية");
    expect(tV7("en", "rom.consent.pointKept")).toContain("numbers only");
  });

  it("holds no disclaimer beyond the consent screen's own video point (D-017)", () => {
    expect(disclaimersIn("ar", text("ar"))).toEqual(["يبقى الفيديو"]);
    expect(disclaimersIn("en", text("en"))).toEqual(["The video stays"]);
  });
});
