/**
 * Step E3 (product v7 contract 2.10 and section 10 E3): the program page links each exercise to the
 * finding behind it with its one why line (programItems, ProgramScreen), the findings page's «What we
 * will work on» (TargetsSummary: the program's own choice for this check, never a list it does not hold)
 * and the Program tab's link (ProgramLink). Rendered on the server, Arabic first with complete English;
 * every line the pages add passes the wording rules.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { wordingProblems } from "../../scripts/wording-rules.mjs";
import { createPlan } from "../../src/medical/plan";
import { targetedWeekly } from "../../src/medical/targets";
import { engineWeekly, type WeeklyPlan } from "../../src/medical/weekly";
import { V7_DICTIONARIES } from "../../src/i18n/v7";
import type { ProgramApi, ProgramTargets } from "../../src/features/program-v7/api";
import { ProgramScreen, loadProgram, type ProgramLoad } from "../../src/features/program-v7/ProgramPage";
import { TargetsSummaryView, loadSummary, SUMMARY_ITEMS } from "../../src/features/program-v7/TargetsSummary";
import ProgramLink, { ProgramLinkCard } from "../../src/features/program-v7/ProgramLink";
import { doseText, programItems, completedNewestFirst } from "../../src/features/program-v7/program";
import { FAHD, finding, pattern } from "./e-fixtures";

const CHECK = "0f0e0d0c-0b0a-4908-8706-050403020100";
const REF = { checkId: CHECK, romVersion: "r", gaitVersion: null, targetsVersion: "t", created: 5 };
const plan = createPlan(FAHD);
const weekly = targetedWeekly(
  FAHD,
  plan,
  [
    finding("shoulder_flexion", "right", { finding: "marked", priority: 3, path: "umn" }),
    finding("knee_flexion", "right", { finding: "mild", priority: 2, path: "tight", cause: "tight" }),
  ],
  [pattern({ pattern: "stiff_knee", targets: [{ id: "strengthen:calf", side: "right" }] })],
  REF,
)!;
const data: ProgramTargets = { weekly, version: 3, targets: [], referrals: [], unmet: [] };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const screen = (lang: "ar" | "en", load: ProgramLoad) =>
  renderToStaticMarkup(
    createElement(ProgramScreen, {
      lang,
      load,
      onLanguage: () => undefined,
      onExit: () => undefined,
      onRetry: () => undefined,
    }),
  );
const failure = (status: number, code: string) => ({
  ok: false as const,
  error: { kind: "http" as const, status, code, body: {} },
});

describe("programItems", () => {
  it("lists each exercise the findings chose once, with its days, dose and one why line", () => {
    const items = programItems(weekly, "en");
    const chosen = new Set(
      weekly.days
        .flatMap((d) => [...d.warmup, ...d.extra, ...d.cooldown])
        .filter((i) => i.why)
        .map((i) => i.id),
    );
    expect(items.map((i) => i.id).sort()).toEqual([...chosen].sort());
    for (const i of items) {
      expect(i.days.length).toBeGreaterThan(0);
      expect(i.why).toMatch(/^(Because|Your walk|This exercise)/);
      expect(i.dose).not.toBe("");
    }
    expect(items.some((i) => i.result)).toBe(true);
    // The results first, then the history's own (a region the camera cannot measure).
    const firstOther = items.findIndex((i) => !i.result);
    if (firstOther >= 0) expect(items.slice(firstOther).every((i) => !i.result)).toBe(true);
    expect(programItems(engineWeekly(FAHD, plan)!, "en")).toEqual([]);
  });

  it("writes a dose in words: repetitions, seconds, and minutes for walking", () => {
    expect(doseText({ sets: 1, reps: 10 }, "en")).toBe("10 reps");
    expect(doseText({ sets: 2, holdSeconds: 30 }, "en")).toBe("2 × 30 sec");
    expect(doseText({ sets: 1, holdSeconds: 600 }, "en")).toBe("10 minutes");
    expect(doseText({ sets: 3, holdSeconds: 180 }, "en")).toBe("3 × 3 minutes");
    expect(doseText({ sets: 1, holdSeconds: 600 }, "ar")).toBe("١٠ دقائق");
    expect(doseText({ sets: 2, holdSeconds: 30 }, "ar")).toBe("مرتان × ٣٠ ثانية");
    // Arabic counts the seconds: «٥ ثوانٍ».
    expect(doseText({ sets: 10, holdSeconds: 5 }, "ar")).toBe("١٠ مرات × ٥ ثوانٍ");
    expect(doseText({ sets: 10, holdSeconds: 5 }, "en")).toBe("10 × 5 sec");
  });
});

describe("the program page", () => {
  it("shows each exercise with its one reason, its days and the way to its result", () => {
    for (const lang of ["ar", "en"] as const) {
      const html = screen(lang, { kind: "ready", data });
      const items = programItems(weekly, lang);
      expect(html).toContain('data-screen="program"');
      expect(html.match(/class="pv7-item"/g)).toHaveLength(items.length);
      for (const i of items) {
        expect(text(html)).toContain(i.name);
        expect(text(html)).toContain(i.why);
      }
      expect(html.match(/data-action="result"/g)?.length).toBe(items.filter((i) => i.result).length);
      expect(text(html)).toContain(
        lang === "ar" ? "تمارين اخترناها لنتائج قياسك" : "Exercises chosen for your results",
      );
      expect(html).toContain(`dir="${lang === "ar" ? "rtl" : "ltr"}"`);
    }
  });

  it("says plainly when the results need no special exercises", () => {
    const empty = { ...data, weekly: { ...engineWeekly(FAHD, plan)!, findings: REF } as WeeklyPlan };
    const html = screen("en", { kind: "ready", data: empty });
    expect(text(html)).toContain("Your results need no special exercises now");
    expect(html).not.toContain('class="pv7-item"');
  });

  it("each state: loading, no results yet, the plan to update, an error to retry", () => {
    expect(screen("ar", { kind: "loading" })).toContain("نبني برنامجك من نتائجك");
    expect(text(screen("en", { kind: "none" }))).toContain("No movement results yet");
    expect(text(screen("en", { kind: "plan" }))).toContain("Update your medical condition details first");
    expect(screen("en", { kind: "error" })).toContain('data-action="retry"');
  });

  it("loads the week from POST /api/program/targets, or why there is none", async () => {
    const api = (r: Awaited<ReturnType<ProgramApi["targets"]>>) => ({ targets: vi.fn(async () => r) });
    expect(await loadProgram(api({ ok: true, value: data }))).toEqual({ kind: "ready", data });
    expect(await loadProgram(api(failure(404, "NO_FINDINGS")))).toEqual({ kind: "none" });
    expect(await loadProgram(api(failure(409, "PLAN_REQUIRED")))).toEqual({ kind: "plan" });
    expect(await loadProgram(api(failure(409, "INTAKE_UPDATE_REQUIRED")))).toEqual({ kind: "plan" });
    expect(await loadProgram(api(failure(429, "RATE_LIMIT")))).toEqual({ kind: "error" });
    expect(await loadProgram(api({ ok: false, error: { kind: "network" } }))).toEqual({ kind: "error" });
  });
});

describe("What we will work on (TargetsSummary)", () => {
  const checks = (ids: string[]) => ({
    ok: true as const,
    value: {
      checks: ids.map((id, i) => ({
        id,
        kind: "baseline" as const,
        setting: "booth" as const,
        status: "completed" as const,
        started: i,
        completed: 100 - i,
        measured: 2,
        gait: false,
      })),
    },
  });
  const api = (
    stored: WeeklyPlan | undefined,
    latest: string[],
    built: Awaited<ReturnType<ProgramApi["targets"]>>,
  ) => ({
    me: vi.fn(async () => ({
      ok: true as const,
      value: { intake: FAHD, plan: { ...plan, weekly: stored } },
    })),
    checks: vi.fn(async () => checks(latest)),
    targets: vi.fn(async () => built),
  });

  it("shows the week stored from this check without building", async () => {
    const a = api(weekly, [CHECK], failure(500, "SERVER"));
    expect(await loadSummary(a, CHECK)).toEqual({ kind: "ready", weekly });
    expect(a.targets).not.toHaveBeenCalled();
  });

  it("builds the week when this check is the latest and the program does not follow it yet", async () => {
    const a = api(undefined, [CHECK, "older"], { ok: true, value: data });
    expect(await loadSummary(a, CHECK)).toEqual({ kind: "ready", weekly });
    expect(a.targets).toHaveBeenCalledTimes(1);
  });

  it("shows nothing for an earlier check, or when the build fails", async () => {
    const older = api(undefined, ["newer", CHECK], { ok: true, value: data });
    expect(await loadSummary(older, CHECK)).toEqual({ kind: "none" });
    expect(older.targets).not.toHaveBeenCalled();
    expect(await loadSummary(api(undefined, [CHECK], failure(429, "RATE_LIMIT")), CHECK)).toEqual({
      kind: "none",
    });
  });

  it("names the first exercises with their reasons and opens the whole program", () => {
    for (const lang of ["ar", "en"] as const) {
      const html = renderToStaticMarkup(
        createElement(TargetsSummaryView, {
          lang,
          load: { kind: "ready", weekly },
          onOpenProgram: () => undefined,
        }),
      );
      const items = programItems(weekly, lang).slice(0, SUMMARY_ITEMS);
      expect(html.match(/<li data-exercise=/g)).toHaveLength(items.length);
      for (const i of items) expect(text(html)).toContain(i.why);
      expect(html).toContain('data-action="program"');
      expect(text(html)).toContain(lang === "ar" ? "ما سنعمل عليه" : "What we will work on");
    }
    const none = renderToStaticMarkup(
      createElement(TargetsSummaryView, {
        lang: "en",
        load: { kind: "none" },
        onOpenProgram: () => undefined,
      }),
    );
    expect(none).toBe("");
    const loading = renderToStaticMarkup(
      createElement(TargetsSummaryView, {
        lang: "ar",
        load: { kind: "loading" },
        onOpenProgram: () => undefined,
      }),
    );
    expect(loading).toContain('role="status"');
  });
});

describe("the Program tab's link (ProgramLink)", () => {
  it("a week built from the findings: why these exercises, and the results", () => {
    for (const lang of ["ar", "en"] as const) {
      const html = renderToStaticMarkup(
        createElement(ProgramLink, {
          lang,
          plan: { ...plan, weekly },
          onOpenProgram: () => undefined,
          onOpenFindings: () => undefined,
        }),
      );
      expect(html).toContain('data-program-link="built"');
      expect(html).toContain('data-action="program"');
      expect(html).toContain('data-action="findings"');
    }
  });

  it("the invitation once a completed check is found; nothing before", () => {
    const html = renderToStaticMarkup(
      createElement(ProgramLink, {
        lang: "en",
        plan,
        onOpenProgram: () => undefined,
        onOpenFindings: () => undefined,
      }),
    );
    expect(html).toBe("");
    const card = renderToStaticMarkup(
      createElement(ProgramLinkCard, {
        lang: "en",
        kind: "build",
        onOpenProgram: () => undefined,
        onOpenFindings: () => undefined,
      }),
    );
    expect(text(card)).toContain("Let your program follow your results");
    expect(card).not.toContain('data-action="findings"');
  });

  it("reads the completed checks newest first", () => {
    const list = completedNewestFirst([
      {
        id: "a",
        kind: "baseline",
        setting: "booth",
        status: "completed",
        started: 1,
        completed: 10,
        measured: 1,
        gait: false,
      },
      {
        id: "b",
        kind: "retest",
        setting: "booth",
        status: "open",
        started: 2,
        completed: null,
        measured: 0,
        gait: false,
      },
      {
        id: "c",
        kind: "retest",
        setting: "booth",
        status: "completed",
        started: 3,
        completed: 30,
        measured: 1,
        gait: false,
      },
    ]);
    expect(list.map((c) => c.id)).toEqual(["c", "a"]);
  });
});

describe("the copy of the program", () => {
  it("passes the wording rules, Arabic and English with the same keys", () => {
    const leaves = (v: unknown, at: string): [string, string][] =>
      typeof v === "string"
        ? [[at, v]]
        : v && typeof v === "object"
          ? Object.entries(v).flatMap(([k, x]) => leaves(x, `${at}.${k}`))
          : [];
    const ar = leaves(V7_DICTIONARIES.ar.targets, "targets");
    const en = leaves(V7_DICTIONARIES.en.targets, "targets");
    expect(ar.map(([k]) => k)).toEqual(en.map(([k]) => k));
    for (const [k, t] of [...ar, ...en]) expect(wordingProblems(t), k).toEqual([]);
  });
});
