/**
 * D-027 item 3 (change log W2-11): My results hides the movement check's empty state once a focus
 * check is complete. The empty state («ستظهر نتائج قياساتك هنا. أجرِ قياس الحركة لتحدد نقطة بدايتك.»)
 * asks a person who already has a focus starting point to take a check to set one.
 *
 *   - checksSection decides what the movement check's section of My results shows: the empty state
 *     only while no focus check is known to be complete; nothing with one; the loading cards while
 *     that is not known yet (a VITE_V7=1 build), so the empty state never flashes before the focus
 *     checks arrive. Without the prop (the default build) it is the page as before;
 *   - the findings link reports what it loaded (null when it starts, then how many completed checks;
 *     0 when the call fails), and App hands that to My results in a VITE_V7=1 build only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checksSection } from "../../src/features/progress/ResultsPage";
import { loadCompleted } from "../../src/features/focus/FindingsLink";
import type { FocusApi, FocusCheckSummary } from "../../src/features/focus/api";

const T = Date.UTC(2026, 9, 5, 9, 0, 0);
const check = (id: string, status: FocusCheckSummary["status"], completed: number | null) =>
  ({
    id,
    kind: "baseline",
    setting: "booth",
    status,
    started: T - 20 * 60 * 1000,
    completed,
    measured: 2,
    gait: false,
  }) satisfies FocusCheckSummary;

describe("the movement check's section of My results", () => {
  it("shows the empty state only while no focus check is complete", () => {
    expect(checksSection("ok", true)).toBe("empty");
    expect(checksSection("ok", true, false)).toBe("empty");
    expect(checksSection("ok", true, true)).toBe("none");
  });

  it("waits with the loading cards until the focus checks are known", () => {
    expect(checksSection("ok", true, null)).toBe("loading");
    expect(checksSection("loading", true, true)).toBe("loading");
  });

  it("keeps the movement check's own results, errors and offline card whatever the focus checks", () => {
    for (const focusDone of [undefined, null, false, true]) {
      expect(checksSection("ok", false, focusDone)).toBe("cards");
      expect(checksSection("error", false, focusDone)).toBe("error");
      expect(checksSection("offline", false, focusDone)).toBe("offline");
    }
  });
});

describe("the findings link's load", () => {
  const api = (r: Awaited<ReturnType<FocusApi["checks"]>>) => ({ checks: vi.fn(async () => r) });

  it("gives the completed checks, newest first", async () => {
    const list = await loadCompleted(
      api({
        ok: true,
        value: {
          checks: [check("a", "completed", T - 1000), check("b", "open", null), check("c", "completed", T)],
        },
      }) as unknown as FocusApi,
    );
    expect(list.map((c) => c.id)).toEqual(["c", "a"]);
  });

  it("gives none when the call fails, so the page stays as before", async () => {
    const list = await loadCompleted(
      api({ ok: false, error: { kind: "network" } } as never) as unknown as FocusApi,
    );
    expect(list).toEqual([]);
  });
});

describe("App's wiring (VITE_V7=1 builds only)", () => {
  const app = readFileSync(join(__dirname, "../../src/app/App.tsx"), "utf8");

  it("hands the findings link's count to My results", () => {
    expect(app).toMatch(/<FindingsLink[\s\S]*?onCompleted=\{/);
    expect(app).toMatch(/<ResultsPage[\s\S]*?focusDone=\{FindingsLink \? focusDone : undefined\}/);
  });
});
