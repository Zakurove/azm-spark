/**
 * Booth passes as the booth screens read them (contract v3 I, O17, O18, 7.2-11; UX spec S55, S55b):
 * the staff code, the server answers, the visitor token redeem, the ended mark, booth mode state and
 * the offline preparation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "../src/features/assessment/api";
import {
  markVisitorPhone,
  normalizeCode,
  redeemOutcome,
  tokenOutcome,
  verifyOutcome,
  visitorLink,
  wasVisitorPhone,
} from "../src/features/assessment/booth/passes";
import {
  BOOTH_CACHE,
  boothAssets,
  offlineStatus,
  precacheBooth,
} from "../src/features/assessment/booth/precache";
import { memoryStorage } from "./booth-helpers";

const SESSION = "a".repeat(64);
const TOKEN = "b".repeat(64);
const later = () => Date.now() + 60_000;
const ok = <T>(value: T): ApiResult<T> => ({ ok: true, value });
const http = (status: number, code: string): ApiResult<never> => ({
  ok: false,
  error: { kind: "http", status, code, body: {} },
});

describe("the staff code and the verify answer (S55)", () => {
  it("normalises Arabic Indic and Persian digits and trims, keeping letters as typed", () => {
    expect(normalizeCode(" ١٢٣٤٥٦ ")).toBe("123456");
    expect(normalizeCode("۱۲۳۴۵۶")).toBe("123456");
    expect(normalizeCode("Azm٢٠٢٦")).toBe("Azm2026");
  });

  it("reads every verify answer", () => {
    expect(verifyOutcome(ok({ ok: true, session: SESSION, expires: later() }))).toMatchObject({
      kind: "on",
      session: SESSION,
    });
    expect(verifyOutcome(ok({ ok: false }))).toEqual({ kind: "wrong" });
    expect(verifyOutcome(ok({ ok: false, closed: true }))).toEqual({ kind: "closed" });
    expect(verifyOutcome({ ok: false, error: { kind: "offline" } })).toEqual({ kind: "offline" });
    expect(verifyOutcome({ ok: false, error: { kind: "network" } })).toEqual({ kind: "error" });
    expect(verifyOutcome(http(429, "RATE_LIMIT"))).toEqual({ kind: "limited" });
    expect(verifyOutcome(http(500, "SERVER"))).toEqual({ kind: "error" });
    // A session of the wrong form or already ended never turns booth mode on.
    expect(verifyOutcome(ok({ ok: true, session: "nope", expires: later() }))).toEqual({ kind: "error" });
    expect(verifyOutcome(ok({ ok: true, session: SESSION, expires: Date.now() - 1 }))).toEqual({
      kind: "error",
    });
  });

  it("reads the visitor token answer; 403 BOOTH_SESSION means the staff session has ended", () => {
    expect(tokenOutcome(ok({ token: TOKEN, expires: later() }))).toMatchObject({ kind: "qr", token: TOKEN });
    expect(tokenOutcome(http(403, "BOOTH_SESSION"))).toEqual({ kind: "sessionEnded" });
    expect(tokenOutcome({ ok: false, error: { kind: "offline" } })).toEqual({ kind: "offline" });
    expect(tokenOutcome(ok({ token: "short", expires: later() }))).toEqual({ kind: "error" });
  });

  it("links the visitor QR to this site with the token only", () => {
    expect(visitorLink("https://azm.example/", TOKEN)).toBe(`https://azm.example/?boothToken=${TOKEN}`);
    expect(visitorLink("http://127.0.0.1:5205", TOKEN)).toBe(`http://127.0.0.1:5205/?boothToken=${TOKEN}`);
  });
});

describe("the visitor's phone (S55b)", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads every redeem answer", () => {
    expect(redeemOutcome(ok({ ok: true, token: TOKEN, expires: later() }))).toMatchObject({ kind: "on" });
    expect(redeemOutcome(ok({ ok: false }))).toEqual({ kind: "ended" });
    expect(redeemOutcome(http(400, "BOOTH_INVALID"))).toEqual({ kind: "ended" });
    expect(redeemOutcome({ ok: false, error: { kind: "offline" } })).toEqual({ kind: "offline" });
    expect(redeemOutcome({ ok: false, error: { kind: "network" } })).toEqual({ kind: "error" });
    expect(redeemOutcome(http(429, "RATE_LIMIT"))).toEqual({ kind: "error" });
  });

  it("keeps this phone's own pass and the visitor mark after a redeem, never the QR token", async () => {
    const { redeemToken } = await import("../src/features/assessment/booth/VisitorTokenPage");
    const { readBoothPass } = await import("../src/features/assessment/boothMode");
    const own = "c".repeat(64);
    const boothRedeem = vi.fn(async () => ok({ ok: true as const, token: own, expires: later() }));
    expect(await redeemToken({ boothRedeem }, TOKEN)).toBe("on");
    expect(boothRedeem).toHaveBeenCalledWith(TOKEN);
    expect(readBoothPass()).toMatchObject({ kind: "visitor", token: own });
    expect(storage.getItem("azm.booth")).not.toContain(TOKEN);
    expect(wasVisitorPhone()).toBe(true);
  });

  it("ends a token of the wrong form without a call, and a refused one without booth mode", async () => {
    const { redeemToken } = await import("../src/features/assessment/booth/VisitorTokenPage");
    const { readBoothPass } = await import("../src/features/assessment/boothMode");
    const boothRedeem = vi.fn(async () => ok({ ok: false as const }));
    expect(await redeemToken({ boothRedeem }, "not-a-token")).toBe("ended");
    expect(boothRedeem).not.toHaveBeenCalled();
    expect(await redeemToken({ boothRedeem }, TOKEN)).toBe("ended");
    expect(readBoothPass()).toBeNull();
    expect(wasVisitorPhone()).toBe(false);
  });

  it("says booth mode has ended once a visitor pass is gone (tokenEnded), never before", async () => {
    const { boothModeState } = await import("../src/features/assessment/booth/useBoothMode");
    const { saveVisitorToken, clearBoothPass, saveStaffSession } =
      await import("../src/features/assessment/boothMode");
    expect(boothModeState()).toMatchObject({ booth: false, tokenEnded: false, setting: "home" });
    saveVisitorToken(TOKEN, later());
    markVisitorPhone();
    expect(boothModeState()).toMatchObject({
      booth: true,
      kind: "visitor",
      tokenEnded: false,
      setting: "booth",
    });
    clearBoothPass();
    expect(boothModeState()).toMatchObject({ booth: false, tokenEnded: true, setting: "home" });
    // A staff phone that was never a visitor's never shows it.
    storage.clear();
    saveStaffSession(SESSION, later());
    expect(boothModeState()).toMatchObject({ booth: true, kind: "staff", tokenEnded: false });
    // An expired pass is booth mode off.
    storage.clear();
    saveStaffSession(SESSION, Date.now() - 1);
    expect(boothModeState().booth).toBe(false);
  });
});

/* ------------------------------------------------------------------ O18 */

function fakeCaches(pre: string[] = []) {
  const stored = new Map<string, unknown>(pre.map((u) => [u, {}]));
  const cache = {
    match: async (u: string) => stored.get(u),
    put: async (u: string, r: unknown) => void stored.set(u, r),
  };
  const opened: string[] = [];
  return {
    stored,
    opened,
    caches: { open: async (name: string) => (opened.push(name), cache) } as unknown as CacheStorage,
  };
}

describe("offline preparation of a booth phone (O18)", () => {
  it("lists the model, the runtime, the alarm, the chime and the check cues in both languages", () => {
    const a = boothAssets();
    expect(a).toContain("/models/pose_landmarker_lite.task");
    expect(a).toContain("/wasm/vision_wasm_internal.wasm");
    expect(a).toContain("/cues/alarm.mp3");
    expect(a).toContain("/cues/chime.mp3");
    expect(a).toContain("/cues/ar/check_are_you_ok.mp3");
    expect(a).toContain("/cues/en/check_are_you_ok.mp3");
    expect(a.filter((u) => u.startsWith("/cues/ar/")).length).toBe(
      a.filter((u) => u.startsWith("/cues/en/")).length,
    );
    expect(new Set(a).size).toBe(a.length);
  });

  it("keeps what it fetched, skips what is already kept, and reports what is missing", async () => {
    const { caches, stored, opened } = fakeCaches(["/a"]);
    const fetch = vi.fn(async (u: RequestInfo | URL) => ({ ok: String(u) !== "/missing" }) as Response);
    const r = await precacheBooth({
      fetch: fetch as unknown as typeof globalThis.fetch,
      caches,
      assets: ["/a", "/b", "/missing"],
    });
    expect(opened).toEqual([BOOTH_CACHE]);
    expect(r.cached.sort()).toEqual(["/a", "/b"]);
    expect(r.missing).toEqual(["/missing"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(stored.has("/b")).toBe(true);
    const failing = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const r2 = await precacheBooth({
      fetch: failing as unknown as typeof globalThis.fetch,
      caches,
      assets: ["/c"],
    });
    expect(r2).toEqual({ cached: [], missing: ["/c"] });
  });

  it("says ready only with every file kept and a service worker in control", () => {
    expect(offlineStatus(null, true)).toBe("preparing");
    expect(offlineStatus({ cached: ["/a"], missing: [] }, true)).toBe("ready");
    expect(offlineStatus({ cached: ["/a"], missing: [] }, false)).toBe("notReady");
    expect(offlineStatus({ cached: [], missing: ["/cues/alarm.mp3"] }, true)).toBe("notReady");
  });
});
