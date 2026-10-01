/**
 * The booth staff session as the booth screens read it (contract v3 I, O17, O18, 7.2-11; UX spec S55,
 * C34): the staff code, the server answer, booth mode state and the offline preparation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "../src/features/assessment/api";
import { normalizeCode, verifyOutcome } from "../src/features/assessment/booth/passes";
import {
  BOOTH_CACHE,
  isPageFallback,
  boothAssets,
  offlineStatus,
  precacheBooth,
} from "../src/features/assessment/booth/precache";
import { memoryStorage } from "./booth-helpers";

const SESSION = "a".repeat(64);
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
});

describe("booth mode on a staff phone (S55, C34)", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("holds a staff session until it ends; a visitor pass of an earlier build is never read", async () => {
    const { boothModeState } = await import("../src/features/assessment/booth/useBoothMode");
    const { clearBoothPass, saveStaffSession } = await import("../src/features/assessment/boothMode");
    expect(boothModeState()).toMatchObject({ booth: false, setting: "home" });
    saveStaffSession(SESSION, later());
    expect(boothModeState()).toMatchObject({ booth: true, kind: "staff", setting: "booth" });
    clearBoothPass();
    expect(boothModeState().booth).toBe(false);
    storage.setItem(
      "azm.booth",
      JSON.stringify({ kind: "visitor", token: "b".repeat(64), expires: later() }),
    );
    expect(boothModeState().booth).toBe(false);
    // An expired pass is booth mode off.
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
  it("lists the model, the runtime, the chime and the check cues in both languages (no alarm, D-016)", () => {
    const a = boothAssets();
    expect(a).toContain("/models/pose_landmarker_lite.task");
    expect(a).toContain("/wasm/vision_wasm_internal.wasm");
    expect(a).not.toContain("/cues/alarm.mp3");
    expect(a).toContain("/cues/chime.mp3");
    expect(a).toContain("/cues/packs/openai-ash/ar/check_are_you_ok.mp3");
    expect(a).toContain("/cues/packs/openai-ash/en/check_are_you_ok.mp3");
    expect(a.filter((u) => u.startsWith("/cues/packs/openai-ash/ar/")).length).toBe(
      a.filter((u) => u.startsWith("/cues/packs/openai-ash/en/")).length,
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

  it("never keeps the app page that the server sends for a file that does not exist yet", async () => {
    const { caches, stored } = fakeCaches([]);
    const typed = (type: string) =>
      ({ ok: true, headers: new Headers({ "content-type": type }) }) as Response;
    const fetch = vi.fn(async (u: RequestInfo | URL) =>
      String(u).endsWith(".mp3") && String(u).includes("check_")
        ? typed("text/html; charset=utf-8")
        : typed("audio/mpeg"),
    );
    const r = await precacheBooth({
      fetch: fetch as unknown as typeof globalThis.fetch,
      caches,
      assets: ["/cues/packs/openai-ash/ar/check_x.mp3", "/cues/alarm.mp3"],
    });
    expect(r.missing).toEqual(["/cues/packs/openai-ash/ar/check_x.mp3"]);
    expect(r.cached).toEqual(["/cues/alarm.mp3"]);
    expect(stored.has("/cues/packs/openai-ash/ar/check_x.mp3")).toBe(false);
    expect(isPageFallback("/x.html", typed("text/html"))).toBe(false);
    expect(isPageFallback("/x.task", { headers: new Headers() } as Response)).toBe(false);
  });

  it("says ready only with every file kept and a service worker in control", () => {
    expect(offlineStatus(null, true)).toBe("preparing");
    expect(offlineStatus({ cached: ["/a"], missing: [] }, true)).toBe("ready");
    expect(offlineStatus({ cached: ["/a"], missing: [] }, false)).toBe("notReady");
    expect(offlineStatus({ cached: [], missing: ["/cues/alarm.mp3"] }, true)).toBe("notReady");
  });
});
