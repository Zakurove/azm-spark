/**
 * Step B4: the findings link on My results (src/features/focus/FindingsLink.tsx, D-026 item 1): the
 * completed focus checks, newest first, each opening its findings page; nothing before its data.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import FindingsLink, { FindingsLinkList, completedChecks } from "../../src/features/focus/FindingsLink";
import type { FocusCheckSummary } from "../../src/features/focus/api";
import { tV7 } from "../../src/i18n/v7";

const DAY = 24 * 60 * 60 * 1000;
const T = Date.UTC(2026, 9, 4, 9, 0, 0);
const check = (
  id: string,
  status: FocusCheckSummary["status"],
  completed: number | null,
): FocusCheckSummary => ({
  id,
  kind: "baseline",
  setting: "booth",
  status,
  started: (completed ?? T) - 20 * 60 * 1000,
  completed,
  measured: 4,
  gait: false,
});

describe("the findings link", () => {
  it("keeps the completed checks only, newest first", () => {
    const list = [
      check("a", "completed", T - 6 * DAY),
      check("b", "ended_early", null),
      check("c", "completed", T),
      check("d", "open", null),
      check("e", "abandoned", null),
      check("f", "completed", T - 3 * DAY),
    ];
    expect(completedChecks(list).map((c) => c.id)).toEqual(["c", "f", "a"]);
  });

  it("lists each completed check with its day, the earliest marked as the starting point", () => {
    const checks = completedChecks([check("a", "completed", T - 3 * DAY), check("c", "completed", T)]);
    const html = renderToStaticMarkup(
      createElement(FindingsLinkList, { lang: "en", checks, onOpenFindings: vi.fn() }),
    );
    // A title of its own, apart from My results' movement check list (UI review).
    expect(html).toContain(tV7("en", "rom.findings.linkTitle"));
    expect(html.indexOf('data-focus-check="c"')).toBeLessThan(html.indexOf('data-focus-check="a"'));
    expect(html).toContain("Sunday 4 October");
    expect(html).toContain("Thursday 1 October");
    expect(html.match(new RegExp(tV7("en", "rom.findings.startPoint"), "g"))).toHaveLength(1);
    const ar = renderToStaticMarkup(
      createElement(FindingsLinkList, { lang: "ar", checks: checks.slice(0, 1), onOpenFindings: vi.fn() }),
    );
    expect(ar).toContain('dir="rtl"');
    expect(ar).toContain("٤ أكتوبر");
    // One check is no starting point of anything yet.
    expect(ar).not.toContain(tV7("ar", "rom.findings.startPoint"));
  });

  it("renders nothing before its data arrives", () => {
    const html = renderToStaticMarkup(
      createElement(FindingsLink, { lang: "en", owner: "u1", onOpenFindings: vi.fn(), onStart: vi.fn() }),
    );
    expect(html).toBe("");
  });
});
