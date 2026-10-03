/**
 * Booth v2, contract A5: calm feedback. One caption line, a 2 s dwell before a condition shows, at
 * least 3 s on screen, one slot at a time, a dead band so "closer" and "back" never flip, framing
 * hints spoken at most every 12 s and other lines at least 2.5 s apart (safety excepted).
 */
import { describe, expect, it } from "vitest";
import {
  DISTANCE_BANDS,
  FeedbackGate,
  FramingHinter,
  GATE_RULES,
  type GateMessage,
} from "../src/engine/feedbackGate";

const back: GateMessage = { id: "move_back", severity: "info", voice: "move_back", group: "framing" };
const closer: GateMessage = { id: "move_closer", severity: "info", group: "framing" };
const frame: GateMessage = { id: "get_in_frame", severity: "warn", voice: "get_in_frame", group: "framing" };
const sitTall: GateMessage = { id: "sit_tall", severity: "warn", voice: "sit_tall" };
const relax: GateMessage = { id: "relax_shoulders", severity: "warn", voice: "relax_shoulders" };
const stop: GateMessage = { id: "stop_rest", severity: "safety", voice: "stop_rest" };

/** Runs the gate at 30 fps from `from` to `to` ms with a fixed condition; the outputs per frame. */
function run(
  g: FeedbackGate,
  from: number,
  to: number,
  cond: GateMessage | null,
  events: GateMessage[] = [],
) {
  const out: { t: number; shown: string | null; speak: string[] }[] = [];
  let first = true;
  for (let t = from; t < to; t += 33) {
    const o = g.step(t, cond, first ? events : []);
    first = false;
    out.push({ t, shown: o.shown?.id ?? null, speak: o.speak.map((m) => m.id) });
  }
  return out;
}

describe("A5 the feedback gate", () => {
  it("shows a condition only after it has lasted 2 s", () => {
    expect(GATE_RULES.dwellMs).toBe(2000);
    const g = new FeedbackGate();
    const out = run(g, 0, 1950, back);
    expect(out.every((o) => o.shown === null)).toBe(true);
    const later = run(g, 1980, 2200, back);
    expect(later[later.length - 1].shown).toBe("move_back");
    // a condition that comes and goes faster than the dwell never shows
    const h = new FeedbackGate();
    for (let t = 0; t < 10_000; t += 33) {
      const o = h.step(t, Math.floor(t / 1500) % 2 ? back : null);
      expect(o.shown).toBeNull();
    }
  });

  it("does not restart the dwell for a dropped frame shorter than the grace", () => {
    const g = new FeedbackGate();
    let shownAt = -1;
    for (let t = 0; t < 3000; t += 33) {
      const dropped = t > 900 && t < 1050; // about 150 ms without the condition
      const o = g.step(t, dropped ? null : back);
      if (o.shown && shownAt < 0) shownAt = t;
    }
    expect(shownAt).toBeGreaterThanOrEqual(2000);
    expect(shownAt).toBeLessThan(2100);
  });

  it("keeps what shows at least 3 s, then lets a cleared condition go", () => {
    const g = new FeedbackGate();
    run(g, 0, 2100, back);
    const out = run(g, 2100, 6000, null);
    const shownUntil = Math.max(...out.filter((o) => o.shown).map((o) => o.t));
    expect(shownUntil).toBeGreaterThanOrEqual(2000 + 3000 - 100);
    expect(shownUntil).toBeLessThan(2100 + 3000 + 100);
  });

  it("keeps one slot: a coaching cue waits for the shown line's 3 s instead of replacing it", () => {
    const g = new FeedbackGate();
    const a = run(g, 0, 400, null, [sitTall]);
    expect(a[0].shown).toBe("sit_tall");
    const b = run(g, 400, 2000, null, [relax]);
    expect(b.every((o) => o.shown === "sit_tall")).toBe(true);
    const c = run(g, 2000, 5000, null);
    const switched = c.find((o) => o.shown === "relax_shoulders");
    expect(switched).toBeDefined();
    expect(switched!.t).toBeGreaterThanOrEqual(3000);
  });

  it("shows and speaks a safety line at once, whatever is on screen", () => {
    const g = new FeedbackGate();
    run(g, 0, 300, null, [sitTall]);
    const o = g.step(330, null, [stop]);
    expect(o.shown?.id).toBe("stop_rest");
    expect(o.speak.map((m) => m.id)).toEqual(["stop_rest"]);
  });

  it("speaks framing hints at most every 12 s", () => {
    const g = new FeedbackGate();
    const spoken: number[] = [];
    // out of the picture for 3.5 s, back for 3.5 s, again and again for a minute
    for (let t = 0; t < 60_000; t += 33) {
      const o = g.step(t, Math.floor(t / 3500) % 2 === 0 ? frame : null);
      if (o.speak.length) spoken.push(t);
    }
    expect(spoken.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < spoken.length; i++) expect(spoken[i] - spoken[i - 1]).toBeGreaterThanOrEqual(12_000);
  });

  it("speaks other lines at least 2.5 s apart; a line held back stays a caption", () => {
    const g = new FeedbackGate();
    expect(g.step(0, null, [sitTall]).speak).toHaveLength(1);
    expect(g.maySpeak(1000, { id: "training", severity: "praise", voice: "training" })).toBe(false);
    expect(g.maySpeak(2600, { id: "training", severity: "praise", voice: "training" })).toBe(true);
    // shown at 3 s (after sit_tall's minimum), only 0.4 s after the last line: not spoken
    const out = run(g, 2700, 3400, null, [relax]);
    expect(out.some((o) => o.shown === "relax_shoulders")).toBe(true);
    expect(out.every((o) => o.speak.length === 0)).toBe(true);
    // safety is never held back
    expect(g.step(3450, null, [stop]).speak).toHaveLength(1);
  });

  it("drops a coaching cue that waited longer than it is useful", () => {
    const g = new FeedbackGate();
    run(g, 0, 2100, back); // a condition is on screen
    const waited = run(g, 2100, 9000, back, [relax]);
    // the condition is shown for 3 s, then yields to the cue that has waited about 3 s
    expect(waited.some((o) => o.shown === "relax_shoulders")).toBe(true);
    const h = new FeedbackGate();
    h.step(0, null, [stop]); // a safety line holds the slot for its full time
    const late = run(h, 33, 6000, null, [relax]);
    expect(late.some((o) => o.shown === "relax_shoulders")).toBe(false);
  });
});

describe("A5 the distance dead band", () => {
  it("never flips between closer and back while the size flickers at a band edge", () => {
    const hinter = new FramingHinter();
    const seen: string[] = [];
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 600; i++) {
      const size = DISTANCE_BANDS.farEnter + 0.012 * rand(); // hovering at the far edge
      const presence = i % 7 === 0 ? "partial" : "ok"; // the wrists blink at the frame edge
      const h = hinter.hint(presence, size);
      if (h && seen[seen.length - 1] !== h) seen.push(h);
    }
    expect(seen).toEqual(["move_closer"]);
  });

  it("enters far below 0.10 and leaves above 0.125; enters near above 0.42 and leaves below 0.36", () => {
    const h = new FramingHinter();
    expect(h.hint("ok", 0.2)).toBeNull();
    expect(h.hint("ok", 0.11)).toBeNull();
    expect(h.hint("ok", 0.095)).toBe("move_closer");
    expect(h.hint("ok", 0.12)).toBe("move_closer");
    expect(h.hint("ok", 0.13)).toBeNull();
    expect(h.hint("ok", 0.4)).toBeNull();
    expect(h.hint("ok", 0.43)).toBe("move_back");
    expect(h.hint("ok", 0.38)).toBe("move_back");
    expect(h.hint("ok", 0.35)).toBeNull();
    expect(h.hint("partial", 0.2)).toBe("move_back");
    expect(h.hint("none", 0.2)).toBeNull();
  });

  it("through the gate, a flickering edge shows one stable hint", () => {
    const hinter = new FramingHinter();
    const g = new FeedbackGate();
    const shown: string[] = [];
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let t = 0; t < 20_000; t += 33) {
      const size = DISTANCE_BANDS.farEnter + 0.015 * rand();
      const hint = hinter.hint(t % 400 < 33 ? "partial" : "ok", size);
      const o = g.step(t, hint === "move_closer" ? closer : hint === "move_back" ? back : null);
      const id = o.shown?.id ?? "none";
      if (shown[shown.length - 1] !== id) shown.push(id);
    }
    expect(shown.filter((s) => s === "move_back")).toHaveLength(0);
    expect(shown.length).toBeLessThanOrEqual(3);
  });
});
