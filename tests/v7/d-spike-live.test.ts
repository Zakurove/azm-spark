/**
 * The live spike suite's offline parts (scripts/spike-live; product v7 contract 8.6, DG-2, D-026 item 1
 * and D-027 item 7): the helpers its probes judge with, the command line, the plan and the build on the
 * production modules. The probes themselves need GEMINI_API_KEY and spend credits, so no test runs them.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Recorder,
  arabicShare,
  frames,
  judge,
  percentile,
  scrub,
  speechBounds,
  stats,
  usageUsd,
  wavPcm,
} from "../../scripts/spike-live/lib";
import { PROBES } from "../../scripts/spike-live/suite";
import { PLAN, PROBES as RUN_PROBES, parseArgs } from "../../scripts/spike-live/run.mjs";

const ROOT = join(__dirname, "../..");
const RUN = join(ROOT, "scripts/spike-live/run.mjs");

/** A 16 kHz mono 16 bit WAV of these samples. */
function wav(samples: number[], rate = 16000, channels = 1): Uint8Array {
  const data = new Uint8Array(samples.length * 2);
  const dv = new DataView(data.buffer);
  samples.forEach((v, i) => dv.setInt16(i * 2, v, true));
  const h = new Uint8Array(44);
  const hv = new DataView(h.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => (h[at + i] = c.charCodeAt(0)));
  ascii(0, "RIFF");
  hv.setUint32(4, 36 + data.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  hv.setUint32(16, 16, true);
  hv.setUint16(20, 1, true);
  hv.setUint16(22, channels, true);
  hv.setUint32(24, rate, true);
  hv.setUint32(28, rate * 2 * channels, true);
  hv.setUint16(32, 2 * channels, true);
  hv.setUint16(34, 16, true);
  ascii(36, "data");
  hv.setUint32(40, data.length, true);
  const out = new Uint8Array(44 + data.length);
  out.set(h);
  out.set(data, 44);
  return out;
}

describe("the spike's helpers", () => {
  it("never writes the key or a token name", () => {
    expect(scrub("key=sk-123 and auth_tokens/abc.DEF-9 done", "sk-123")).toBe(
      "key=[key] and auth_tokens/[token] done",
    );
    expect(scrub("nothing", "")).toBe("nothing");
  });

  it("gives nearest rank percentiles and whole millisecond statistics", () => {
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([], 50)).toBeNull();
    expect(stats([100, null, 300, undefined, 200])).toEqual({
      n: 3,
      min: 100,
      p50: 200,
      p90: 300,
      max: 300,
      mean: 200,
    });
    expect(stats([null])).toBeNull();
  });

  it("bounds the spend from above: every token at the audio rates", () => {
    expect(usageUsd({ promptTokens: 1_000_000, responseTokens: 0 })).toBe(3);
    expect(usageUsd({ promptTokens: 0, responseTokens: 1_000_000 })).toBe(12);
  });

  it("reads the PCM of a 16 kHz mono WAV, finds the speech and frames it in 20 ms", () => {
    const quiet = Array.from({ length: 1600 }, () => 0);
    const loud = Array.from({ length: 3200 }, (_, i) => (i % 2 ? 4000 : -4000));
    const file = wav([...quiet, ...loud, ...quiet]);
    const pcm = wavPcm(file);
    expect(pcm.byteLength).toBe((1600 + 3200 + 1600) * 2);
    expect(speechBounds(pcm)).toEqual({ startMs: 100, endMs: 300, totalMs: 400 });
    const f = frames(pcm);
    expect(f).toHaveLength(20);
    expect(f.every((x) => x.byteLength === 640)).toBe(true);
    expect(() => wavPcm(wav([0, 0], 24000))).toThrow("16000");
    expect(() => wavPcm(wav([0, 0], 16000, 2))).toThrow("2 channel");
    expect(() => wavPcm(new Uint8Array(8))).toThrow("not a WAV");
  });

  it("judges a spoken answer by its tool and arguments, and a dose prompt by no tool", () => {
    const yes = { tool: "confirm_max", answer: "yes" };
    expect(judge(yes, [{ name: "confirm_max", args: { answer: "yes", holdId: "h1" } }])).toBe(true);
    expect(judge(yes, [{ name: "confirm_max", args: { answer: "not_yet" } }])).toBe(false);
    expect(judge(yes, [])).toBe(false);
    expect(judge({ tool: "mark_pain", level: 7 }, [{ name: "mark_pain", args: { level: 7 } }])).toBe(true);
    expect(judge({ tool: null }, [])).toBe(true);
    expect(judge({ tool: null }, [{ name: "next_step", args: {} }])).toBe(false);
    expect(arabicShare("نعم yes")).toBeCloseTo(3 / 6);
    expect(arabicShare("123")).toBeNull();
  });

  it("records the transport's events with their times and waits for the next match", async () => {
    let now = 1000;
    const rec = new Recorder(() => now);
    now = 1100;
    rec.push({ type: "outputTranscript", text: "Is that " });
    now = 1200;
    rec.push({ type: "toolCall", calls: [{ id: "c1", name: "confirm_max", args: { answer: "yes" } }] });
    rec.push({ type: "usage", promptTokens: 10, responseTokens: 4 });
    rec.push({ type: "inputTranscript", text: "yes", final: true });
    rec.push({ type: "audio", pcm24k: new ArrayBuffer(48) });
    expect(rec.said(0)).toBe("Is that ");
    expect(rec.heard(150)).toBe("yes");
    expect(rec.toolCalls(150)).toEqual([{ id: "c1", name: "confirm_max", args: { answer: "yes" }, at: 200 }]);
    expect(rec.usage()).toEqual([{ at: 200, promptTokens: 10, responseTokens: 4 }]);
    expect(rec.audioBytes(0)).toBe(48);
    expect((await rec.waitFor((e) => e.type === "toolCall", 0, 10))?.at).toBe(200);
    const later = rec.waitFor((e) => e.type === "turnComplete", 0, 1000);
    now = 1300;
    rec.push({ type: "turnComplete" });
    expect((await later)?.at).toBe(300);
    expect(await rec.waitFor((e) => e.type === "interrupted", 0, 5)).toBeNull();
  });
});

describe("the spike's command line", () => {
  it("names the four probes of DG-2 in both the runner and the suite", () => {
    expect([...RUN_PROBES]).toEqual(["lock", "answers", "context", "dose"]);
    expect([...PROBES]).toEqual([...RUN_PROBES]);
    for (const p of RUN_PROBES) expect(PLAN[p]).toBeTruthy();
  });

  it("reads the probes and the budget, and refuses an unknown probe or a bad budget", () => {
    expect(parseArgs([])).toMatchObject({
      probes: [...RUN_PROBES],
      budgetUsd: 1,
      plan: false,
      check: false,
      error: null,
    });
    expect(parseArgs(["--probes", "lock,dose", "--budget", "0.5"])).toMatchObject({
      probes: ["lock", "dose"],
      budgetUsd: 0.5,
      error: null,
    });
    expect(parseArgs(["--probes", "lock,bogus"]).error).toBe("unknown probe: bogus");
    expect(parseArgs(["--budget", "0"]).error).toContain("--budget");
  });

  it("is the npm script spike:live, reading the key from .env.local", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["spike:live"]).toBe("node --env-file-if-exists=.env.local scripts/spike-live/run.mjs");
  });

  it("plans without a key and refuses to run without one; --check builds the suite on the production modules", () => {
    const env = { ...process.env, GEMINI_API_KEY: "" };
    const plan = spawnSync(process.execPath, [RUN, "--plan"], { cwd: ROOT, env, encoding: "utf8" });
    expect(plan.status).toBe(0);
    expect(
      plan.stdout
        .trim()
        .split("\n")
        .map((l) => l.split(":")[0]),
    ).toEqual([...RUN_PROBES]);
    const none = spawnSync(process.execPath, [RUN, "--probes", "lock"], { cwd: ROOT, env, encoding: "utf8" });
    expect(none.status).toBe(2);
    expect(none.stderr).toContain("GEMINI_API_KEY is not set");
    const check = spawnSync(process.execPath, [RUN, "--check"], { cwd: ROOT, env, encoding: "utf8" });
    expect(check.stderr).toBe("");
    expect(check.status).toBe(0);
    expect(check.stdout.trim()).toBe("suite built: lock, answers, context, dose");
  }, 60_000);
});
