/**
 * Step G1 (product v7 contract section 9): the performance overlay (src/features/smoke/PerfOverlay.tsx),
 * /?perf=1 over any page of a VITE_E2E build. The panel shows the pose rate, the model and display
 * frame times, long tasks and the heap, Arabic first, and marks a value outside its section 9 budget.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PerfOverlay, { PerfPanel } from "../../src/features/smoke/PerfOverlay";
import type { PerfSnapshot } from "../../src/features/smoke/perf";
import { wordingProblems } from "../../scripts/wording-rules.mjs";

const snap = (over: Partial<PerfSnapshot> = {}): PerfSnapshot => ({
  poseFps: 29.6,
  modelMs: { n: 120, p50: 11.24, p95: 17.9, max: 30 },
  frameMs: { n: 240, p50: 16.7, p95: 18.2, max: 40 },
  longTasks: { count: 0, maxMs: null, beyondModel: { count: 0, maxMs: null } },
  measures: {},
  delegate: "GPU",
  delegateError: null,
  heapMB: 61.2,
  heapGrowthMB: 3.4,
  ...over,
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("PerfPanel", () => {
  it("shows each measure with its unit, Arabic first", () => {
    const ar = text(renderToStaticMarkup(createElement(PerfPanel, { snapshot: snap(), lang: "ar" })));
    expect(ar).toContain("29.6");
    expect(ar).toContain("11.2");
    expect(ar).toContain("17.9");
    expect(ar).toContain("16.7");
    expect(ar).toContain("61.2");
    expect(ar).toContain("GPU");
    expect(ar).toMatch(/\p{Script=Arabic}/u);
    const en = text(renderToStaticMarkup(createElement(PerfPanel, { snapshot: snap(), lang: "en" })));
    expect(en).toContain("Pose");
    expect(en).toContain("Model");
    expect(en).not.toMatch(/\p{Script=Arabic}/u);
    for (const t of [ar, en]) expect(wordingProblems(t)).toEqual([]);
  });

  it("marks a pose rate under the range floor and long tasks over 50 ms", () => {
    const slow = renderToStaticMarkup(
      createElement(PerfPanel, {
        snapshot: snap({
          poseFps: 11,
          longTasks: { count: 2, maxMs: 91, beyondModel: { count: 1, maxMs: 61 } },
        }),
        lang: "en",
      }),
    );
    expect(slow.match(/data-over="true"/g)).toHaveLength(2);
    const fine = renderToStaticMarkup(createElement(PerfPanel, { snapshot: snap(), lang: "en" }));
    expect(fine).not.toContain('data-over="true"');
  });

  it("lists the azm measures a stream added, and says when nothing is measured yet", () => {
    const html = renderToStaticMarkup(
      createElement(PerfPanel, {
        snapshot: snap({ measures: { "azm:rom_feed": { n: 9, p50: 0.4, p95: 1.1, max: 1.3 } } }),
        lang: "en",
      }),
    );
    expect(text(html)).toContain("azm:rom_feed");
    const empty = text(
      renderToStaticMarkup(
        createElement(PerfPanel, {
          snapshot: snap({ poseFps: null, modelMs: { n: 0, p50: null, p95: null, max: null } }),
          lang: "en",
        }),
      ),
    );
    expect(empty).toContain("no model frames yet");
  });
});

describe("PerfOverlay", () => {
  it("renders nothing on the server: it measures only in the browser, after mounting", () => {
    expect(renderToStaticMarkup(createElement(PerfOverlay))).toBe("");
  });
});
