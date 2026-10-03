/**
 * The results and My results screens as they render (no DOM, static markup), in Arabic and English:
 *   (S02 is a dialog that mounts on the client: e2e/results.spec.ts covers it.)
 *   - S01: one gold action at most, never a disabled primary, the offline line in place of starting,
 *     the lock card as a status with the care team release only when releasable;
 *   - S03: a fieldset with its legend and the three answers as buttons, none selected;
 *   - S50 to S52: one h1, the title per variant, values as text, "not measured" with its reason, the
 *     skip groups, the next step, the register block for a guest, and no disclaimer (D-017);
 *   - S52 and S53: verdicts in words from the data, the change in words, the number line's text
 *     alternative, the band sentence only with a verdict, the no verdict lines without a verdict;
 *   - S53 sessions: "n of every 10", never a percentage;
 *   - S54: the banner read with the h1, the Example tag on every card;
 *   - wording: no forbidden progress stem, no dash, no percentage, and Arabic Indic digits only in
 *     Arabic text (UX spec 0.2, Q30).
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Lang } from "../src/app/i18n";
import { disclaimersIn } from "./no-disclaimers";
import { t } from "../src/i18n";
import { CHECK_DATA } from "../src/movements/assessments";
import type { ProtocolItem } from "../src/medical/assessment";
import { seriesKey, type StoredResult } from "../src/medical/progress-rules";
import { testDef } from "../src/movements/assessments";
import type { TestId } from "../src/movements/types";
import { seriesViews } from "../src/medical/series";
import { CheckUiContext, DEFAULT_UI } from "../src/features/assessment/shared/CheckUi";
import { initialModel, type FlowModel, type SideOutcome } from "../src/features/assessment/flowMachine";
import { createCheckApi } from "../src/features/assessment/api";
import { ResultsScreen } from "../src/features/assessment/results/ResultsView";
import { ResultCards } from "../src/features/assessment/results/ResultCards";
import { buildResults } from "../src/features/assessment/results/model";
import { EntryCard, NextDayQuestion, TODAY_VARIANTS } from "../src/features/progress/EntryCards";
import { ExampleProgress } from "../src/features/progress/ExamplePage";
import { SessionsBlock } from "../src/features/progress/Sessions";
import { HowToRead, SeriesCard, ThenNow, comparisonLines } from "../src/features/progress/ThenNow";
import type { EntryState } from "../src/features/progress/variant";
import type { SeriesViewLike } from "../src/features/progress/series";

const LANGS: Lang[] = ["ar", "en"];
const DAY = 24 * 60 * 60 * 1000;
const noop = () => undefined;

function html(lang: Lang, node: ReactElement, ui: Partial<typeof DEFAULT_UI> = {}): string {
  return renderToStaticMarkup(
    createElement(CheckUiContext.Provider, { value: { ...DEFAULT_UI, lang, ...ui } }, node),
  );
}

/** The visible text: tags removed, hidden SVG text left out. */
function text(markup: string): string {
  return markup
    .replace(/<bdi lang="en"[^>]*>[^<]*<\/bdi>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const normalise = (s: string) => s.replace(/[ً-ٰٟـ]/g, "").toLowerCase();

/** The copy rules every rendered results text follows. */
function expectCleanCopy(lang: Lang, markup: string) {
  const plain = text(markup);
  const stems = CHECK_DATA.progress.forbiddenInProgressText[lang];
  expect(stems.filter((s) => normalise(plain).includes(normalise(s)))).toEqual([]);
  expect(plain).not.toMatch(/[‐-―−]/);
  expect(plain).not.toMatch(/\p{L}-\p{L}/u);
  expect(plain).not.toContain("%");
  if (lang === "ar") expect(plain).not.toMatch(/[0-9]/);
}

const countTag = (markup: string, re: RegExp) => (markup.match(re) ?? []).length;

/* ------------------------------------------------------------ fixtures */

const RAISE = { reference: "trunk", bentElbowAccepted: false };
const CURL = { loadObject: "dumbbell", loadKg: 2, view: "side", armrest: "removed", compensated: 0 };
const T0 = Date.UTC(2026, 5, 1, 6);

function stored(testId: TestId, side: "left" | "right", day: number, value: number): StoredResult {
  const def = testDef(testId);
  const base = {
    testId,
    side,
    setting: "home" as const,
    poseModel: "lite",
    movementVersion: def.version,
    detail: testId === "arm_curl_30s" ? CURL : RAISE,
    position: "chair" as const,
    variant: null,
  };
  return {
    ...base,
    value,
    unit: def.unit,
    created: T0 + day * DAY,
    seriesKey: seriesKey(base),
    flags: [],
    nValid: 3,
    median: value,
    band: "default",
  };
}

const VIEWS = seriesViews(
  [
    stored("shoulder_abduction", "right", 0, 100),
    stored("shoulder_abduction", "right", 28, 106),
    stored("shoulder_abduction", "right", 56, 122),
    stored("shoulder_abduction", "left", 0, 117),
    stored("shoulder_abduction", "left", 28, 115),
    stored("arm_curl_30s", "left", 0, 14),
    stored("arm_curl_30s", "left", 28, 7),
    stored("arm_curl_30s", "right", 0, 12),
  ],
  () => ({ position: "chair", support: "none", conditions: [], pain: [], setup: null }),
  { lastCheckLasting: false },
) as SeriesViewLike[];
const view = (testId: TestId, side: string) => VIEWS.find((v) => v.testId === testId && v.side === side)!;

const entry = (over: Partial<EntryState>): EntryState => ({
  variant: "first",
  followUp: false,
  endedEarlyToday: false,
  minutes: [16, 21],
  dates: {},
  lock: null,
  resume: null,
  ...over,
});

/* ------------------------------------------------------------ S01, S02, S03 */

describe("S01 entry card", () => {
  const card = (lang: Lang, s: Partial<EntryState>, offline = false) =>
    html(
      lang,
      createElement(EntryCard, {
        state: entry(s),
        offline,
        onStart: noop,
        onResults: noop,
        onOpenHealth: noop,
      }),
    );

  for (const lang of LANGS) {
    it(`never has more than one gold action nor a disabled button (${lang})`, () => {
      const variants: Partial<EntryState>[] = [
        { variant: "first" },
        { variant: "blocked" },
        { variant: "homeSoon" },
        { variant: "locked", lock: { when: { token: "nextDay_midnight" }, releasable: true } },
        { variant: "resume", resume: { check: {} as never, n: 2, total: 3 } },
        { variant: "leanRepeat" },
        { variant: "due" },
        { variant: "repeatOffer", dates: { from: T0, to: T0 + 5 * DAY } },
        { variant: "tooSoon", dates: { earliest: T0 } },
        { variant: "upcoming", dates: { next: T0 + 20 * DAY } },
      ];
      for (const v of variants) {
        const m = card(lang, v);
        expect(countTag(m, /class="cta"/g), String(v.variant)).toBeLessThanOrEqual(1);
        expect(m).not.toContain("disabled");
        expect(m).toContain('data-screen="S01"');
        expectCleanCopy(lang, m);
      }
    });
  }

  it("Today shows it only when a check is due or open, its action outlined beside the session start (C43)", () => {
    expect([...TODAY_VARIANTS].sort()).toEqual(["due", "first", "leanRepeat", "repeatOffer", "resume"]);
    const m = html(
      "en",
      createElement(EntryCard, {
        state: entry({ variant: "due" }),
        offline: false,
        onStart: noop,
        quiet: true,
      }),
    );
    expect(m).not.toContain('class="cta"');
    expect(m).toMatch(/class="ghost"[^>]*>Start the check/);
  });

  it("writes the first body with the minutes and the 4 weeks", () => {
    const m = card("en", { variant: "first", minutes: [16, 21] });
    expect(text(m)).toContain("about 16 to 21 minutes, then check again every 4 weeks");
    expect(m).toContain(t("en", "assessment.entry.first.cta"));
  });

  it("shows the lock as a cream status with the care team release only when releasable", () => {
    const releasable = card("ar", {
      variant: "locked",
      lock: { when: { token: "nextDay_midnight" }, releasable: true },
    });
    expect(releasable).toContain('role="status"');
    expect(releasable).toContain(t("ar", "assessment.entry.locked.cleared"));
    expect(releasable).not.toContain("{when}");
    const fixed = card("ar", { variant: "locked", lock: { when: null, releasable: false } });
    expect(fixed).not.toContain(t("ar", "assessment.entry.locked.cleared"));
    expect(fixed).not.toContain("{when}");
  });

  it("offers nothing to start in homeSoon and tooSoon, and the early start text button when upcoming", () => {
    expect(card("en", { variant: "homeSoon" })).not.toContain("<button");
    expect(card("en", { variant: "tooSoon", dates: { earliest: T0 } })).not.toContain("<button");
    const up = card("en", { variant: "upcoming", dates: { next: T0 } });
    expect(up).toContain("check-text-button");
    expect(up).toContain(t("en", "assessment.entry.upcoming.early"));
  });

  it("replaces the start with the offline line and keeps text only variants as they are", () => {
    const off = card("en", { variant: "due" }, true);
    expect(off).toContain(t("en", "assessment.state.offline.startBlocked"));
    expect(off).not.toContain('class="cta"');
    expect(card("en", { variant: "homeSoon" }, true)).not.toContain(
      t("en", "assessment.state.offline.startBlocked"),
    );
  });

  it("adds the ended early line with its results link", () => {
    const m = card("en", { variant: "tooSoon", dates: { earliest: T0 }, endedEarlyToday: true });
    expect(m).toContain(t("en", "assessment.entry.endedEarly"));
    expect(m).toContain(t("en", "assessment.entry.endedEarlyLink"));
  });
});

describe("S03 next day question", () => {
  it("asks the next day question in a fieldset with three answers, none selected", () => {
    for (const lang of LANGS) {
      const m = html(
        lang,
        createElement(NextDayQuestion, { lang, onSend: async () => undefined, onNotNow: noop }),
      );
      expect(m).toContain("<fieldset");
      expect(m).toContain("<legend");
      expect(countTag(m, /aria-pressed="false"/g)).toBe(3);
      expect(m).toContain(t(lang, "assessment.after.send"));
      expect(m).toContain(t(lang, "assessment.after.notNow"));
      expectCleanCopy(lang, m);
    }
  });
});

/* ------------------------------------------------------------ S50 to S52 */

const SEATED: ProtocolItem[] = [
  { testId: "shoulder_abduction", side: "right", version: 1, order: 1, band: "default" },
  { testId: "shoulder_abduction", side: "left", version: 1, order: 2, band: "default" },
  { testId: "trunk_control_seated", side: "right", version: 1, order: 3, band: "default" },
  { testId: "trunk_control_seated", side: "left", version: 1, order: 4, band: "default" },
  { testId: "arm_curl_30s", side: "right", version: 1, order: 5, band: "default" },
  { testId: "arm_curl_30s", side: "left", version: 1, order: 6, band: "default" },
];

function flow(
  mode: "guest" | "signedIn",
  kind: "baseline" | "retest" | null,
  outcomes: Record<string, SideOutcome>,
) {
  const booth = mode === "guest";
  const base = initialModel({ mode, booth, homeOpen: !booth, desktop: false });
  const model: FlowModel = {
    ...base,
    state: { kind: "results" },
    data: { ...base.data, protocol: SEATED, outcomes, checkKind: kind, setting: booth ? "booth" : "home" },
  };
  return model;
}

const measured = (value: number, detail: Record<string, unknown> = {}): SideOutcome => ({
  status: "measured",
  value,
  payload: { value, detail },
});
const OUTCOMES: Record<string, SideOutcome> = {
  "shoulder_abduction:right": measured(121, RAISE),
  "shoulder_abduction:left": { status: "notMeasured", reason: "quality" },
  "trunk_control_seated:right": { status: "skipped", reason: "pain_today" },
  "trunk_control_seated:left": { status: "skipped", reason: "pain_today" },
  "arm_curl_30s:right": measured(14, CURL),
  "arm_curl_30s:left": measured(2, CURL),
};

function screen(lang: Lang, model: FlowModel, ui: Partial<typeof DEFAULT_UI> = {}) {
  return html(
    lang,
    createElement(ResultsScreen, {
      model,
      dispatch: noop,
      api: createCheckApi(),
      retryCamera: noop,
      retrySave: noop,
    }),
    { booth: model.data.config.booth, guest: model.data.config.mode === "guest", ...ui },
  );
}

describe("S50 to S52 results", () => {
  for (const lang of LANGS) {
    it(`S50 guest: the values, the register block and the new visitor button, no footer (${lang})`, () => {
      const m = screen(lang, flow("guest", null, OUTCOMES));
      expect(countTag(m, /<h1/g)).toBe(1);
      expect(m).toContain(t(lang, "assessment.guest.resultsTitle"));
      // C31: no banner; the register block is «أنشئ حسابًا مجانيًا».
      expect(m).toMatch(new RegExp(`<h2 id="rs-keep-title">${t(lang, "assessment.guest.register")}</h2>`));
      expect(m).toContain('role="img"');
      expect(m).toContain("register=1");
      expect(m).toContain(t(lang, "assessment.guest.newVisitor"));
      expect(m).not.toContain(t(lang, "assessment.results.nextHeading"));
      expect(m).toContain(CHECK_DATA.progress.labels.notMeasured[lang]);
      // C32: one line names the skipped test, then its reason once; no "Not part of your check".
      expect(text(m)).toContain(
        text(
          renderToStaticMarkup(
            createElement(
              "p",
              null,
              t(lang, "assessment.plan.notToday", { tests: testDef("trunk_control_seated").name[lang] }),
            ),
          ),
        ),
      );
      expect(countTag(m, new RegExp(CHECK_DATA.reasons.pain_today[lang].slice(0, 12), "g"))).toBe(1);
      // D-017 item 2: no footer disclaimer (see your doctor, not medical, the boundary line).
      expect(disclaimersIn(lang, text(m))).toEqual([]);
      expect(m).not.toContain("check-results-footer");
      expectCleanCopy(lang, m.replace(/data-qr="[^"]*"/g, ""));
    });

    it(`S51 first check: the starting point lead, values as text and the next step (${lang})`, () => {
      const m = screen(lang, flow("signedIn", "baseline", OUTCOMES));
      expect(m).toContain(t(lang, "assessment.results.startTitle"));
      expect(m).toContain(CHECK_DATA.boundary.firstResult[lang]);
      expect(m).toContain(t(lang, "assessment.results.nextHeading"));
      expect(m).toContain(t(lang, "assessment.results.keepProgram"));
      expect(m).toContain(t(lang, "assessment.common.backToToday"));
      expect(m).toContain(t(lang, "assessment.results.seeOverTime"));
      expect(m).not.toContain("rs-keep");
      // The value is read with its unit ("121 degrees"), and the arm curl of 2 in its dual form.
      expect(m).toContain(lang === "ar" ? "١٢١ درجة" : "121 degrees");
      expect(m).toContain(lang === "ar" ? "مرتين" : "2 bends");
      // C41: the sentence that restates a value is its accessible name, never a visible line.
      expect(m).toMatch(/class="rs-value" role="img" aria-label="[^"]+"/);
      // The next check as a date only, and no footer disclaimer (D-017 item 2).
      expect(m).toContain(
        t(lang, "assessment.results.nextDate", { date: "{date}" }).split("{date}")[0].trim(),
      );
      expect(m).not.toContain(CHECK_DATA.progress.nextDue[lang].slice(-20));
      expect(disclaimersIn(lang, text(m))).toEqual([]);
      expect(m).not.toContain("check-results-footer");
      expect(m).not.toMatch(/verdict|pg-pill/);
      expectCleanCopy(lang, m);
    });
  }

  it("S50 off the booth: one line and the Create a free account button, no QR (C31)", () => {
    const m0 = flow("guest", null, OUTCOMES);
    const model = {
      ...m0,
      data: { ...m0.data, config: { ...m0.data.config, booth: false, homeOpen: true } },
    };
    const m = screen("en", model, { booth: false });
    expect(m).toContain(t("en", "assessment.guest.register"));
    expect(text(m)).toContain(t("en", "assessment.guest.keepBody", { weeks: 4 }).slice(0, 20));
    expect(m).not.toContain("data-qr");
    expect(m).not.toContain('id="rs-keep-title"');
  });

  it("S51 ended early: the ended early title and lead, without the next check date", () => {
    const outcomes = { ...OUTCOMES };
    delete outcomes["arm_curl_30s:right"];
    delete outcomes["arm_curl_30s:left"];
    const m = screen("en", flow("signedIn", "baseline", outcomes));
    expect(m).toContain(t("en", "assessment.results.endedEarlyTitle"));
    expect(m).toContain(t("en", "assessment.results.endedEarlyBody"));
    expect(m).not.toContain("Your next check is on");
  });

  it("S51 empty: the lead says nothing was measured", () => {
    const none = Object.fromEntries(
      SEATED.map((i) => [
        `${i.testId}:${i.side}`,
        { status: "notMeasured", reason: "quality" } as SideOutcome,
      ]),
    );
    expect(screen("ar", flow("signedIn", "baseline", none))).toContain(
      t("ar", "assessment.results.noneMeasured"),
    );
  });

  it("S51 save states: the not saved chip, and the save error with Try again", () => {
    const pending = screen("en", flow("signedIn", "baseline", OUTCOMES), { savedLater: true, online: false });
    expect(pending).toContain('data-save="pending"');
    expect(pending).toContain(t("en", "assessment.common.notSavedYet"));
    const error = screen("en", flow("signedIn", "baseline", OUTCOMES), { savedLater: true, online: true });
    expect(error).toContain('data-save="error"');
    expect(error).toContain(t("en", "assessment.state.error.title"));
    expect(error).toContain(t("en", "assessment.common.retry"));
    const saved = screen("en", flow("signedIn", "baseline", OUTCOMES));
    expect(saved).not.toContain(t("en", "assessment.common.notSavedYet"));
  });

  it("S52 re-test: the now title, the values of today until the comparisons load", () => {
    const m = screen("ar", flow("signedIn", "retest", OUTCOMES));
    expect(m).toContain(t("ar", "assessment.results.nowTitle"));
    expect(m).toContain('data-screen="S52"');
    expect(m).not.toContain(CHECK_DATA.boundary.firstResult.ar);
    expect(disclaimersIn("ar", text(m))).toEqual([]);
  });

  it("the per test cards show then and now when the comparison of a side is known", () => {
    const model = buildResults({
      mode: "retest",
      items: SEATED.filter((i) => i.testId === "shoulder_abduction"),
      fact: () => ({ kind: "measured", value: 122, detail: {}, variant: null }),
    });
    const views = new Map([["shoulder_abduction:right", view("shoulder_abduction", "right")]]);
    const m = html("en", createElement(ResultCards, { model, views }));
    expect(m).toContain(CHECK_DATA.progress.verdicts.higher.en);
    expect(m).toContain(CHECK_DATA.progress.labels.start.en);
    expect(countTag(m, /class="pg-thennow"/g)).toBe(1);
  });
});

/* ------------------------------------------------------------ then and now, sessions, example */

describe("then and now (S52, S53)", () => {
  for (const lang of LANGS) {
    it(`says start and now in one line and the verdict in words, nothing else per card (C42, ${lang})`, () => {
      const v = view("shoulder_abduction", "right");
      expect(v.verdict).toBe("higher");
      const m = html(lang, createElement(ThenNow, { view: v }));
      expect(m).toContain(CHECK_DATA.progress.verdicts.higher[lang]);
      expect(countTag(m, /class="pg-startnow"/g)).toBe(1);
      expect(m).toContain(CHECK_DATA.progress.labels.start[lang]);
      expect(m).toContain(CHECK_DATA.progress.labels.now[lang]);
      // No change line, no range bar, no legend and no band paragraph on the card.
      expect(m).not.toContain(CHECK_DATA.progress.labels.change[lang]);
      expect(m).not.toMatch(/pg-line|pg-legend|pg-band-note/);
      expect(text(m)).not.toContain(CHECK_DATA.progress.bandSentence[lang].slice(0, 12));
      expectCleanCopy(lang, m);
    });

    it(`says how to read the cards once, with the band sentence (C42, ${lang})`, () => {
      const m = html(lang, createElement(HowToRead));
      expect(m).toContain(t(lang, "progress.howToRead"));
      expect(text(m)).toContain(CHECK_DATA.progress.bandSentence[lang].slice(0, 12));
      expectCleanCopy(lang, m);
    });
  }

  it("adds the lower line and no percentage for a lower result", () => {
    const v = view("arm_curl_30s", "left");
    expect(v.verdict).toBe("lower");
    expect(comparisonLines("en", v)).toContain(CHECK_DATA.progress.lowerExtra.en);
    expect(html("en", createElement(ThenNow, { view: v }))).toContain(
      CHECK_DATA.progress.lowerExtra.en.slice(0, 20),
    );
  });

  it("shows one value and «حدّدنا نقطة بدايتك» for a series of one check (C42)", () => {
    const v = view("arm_curl_30s", "right");
    const m = html("en", createElement(ThenNow, { view: v }));
    expect(m).not.toContain("pg-pill");
    expect(m).not.toContain(CHECK_DATA.progress.labels.start.en);
    expect(m).not.toContain(CHECK_DATA.progress.labels.now.en);
    expect(m).toContain(CHECK_DATA.progress.startingPointSet.en);
  });

  it("shows the no verdict line without a pill or a band", () => {
    const v = {
      ...view("shoulder_abduction", "left"),
      verdict: null,
      noVerdict: "shoulderPain",
    } as SeriesViewLike;
    const m = html("en", createElement(ThenNow, { view: v }));
    expect(m).not.toContain("pg-pill");
    expect(m).not.toContain("pg-band-note");
    expect(m).toContain(CHECK_DATA.progress.noVerdict.shoulderPain.en);
    const drop = { ...v, noVerdict: undefined, largeDrop: true } as SeriesViewLike;
    expect(html("en", createElement(ThenNow, { view: drop }))).toContain(
      CHECK_DATA.progress.largeDrop.text.en,
    );
  });

  it("offers a heavier weight with two equal buttons, none selected (Q26)", () => {
    const v = {
      ...view("arm_curl_30s", "left"),
      loadStep: { from: { kind: "dumbbell", kg: 2 }, to: { kind: "dumbbell", kg: 3 } },
    } as SeriesViewLike;
    const m = html("en", createElement(ThenNow, { view: v, heavierOffer: { chosen: null, onChoose: noop } }));
    expect(countTag(m, /aria-pressed="false"/g)).toBe(2);
    expect(m).not.toContain('class="cta"');
  });

  it("draws the trend from the third check with its table toggle, in a series card", () => {
    const m = html("ar", createElement(SeriesCard, { view: view("shoulder_abduction", "right") }));
    expect(m).toContain("<article");
    expect(m).toContain(CHECK_DATA.progress.labels.trend.ar);
    expect(m).toContain(t("ar", "progress.trend.table"));
    expect(html("ar", createElement(SeriesCard, { view: view("shoulder_abduction", "left") }))).not.toContain(
      CHECK_DATA.progress.labels.trend.ar,
    );
  });
});

describe("sessions (S53)", () => {
  const data = {
    weeks: Array.from({ length: 8 }, (_, i) => ({ start: T0 + i * 7 * DAY, done: i % 3, planned: 3 })),
    validShare: 0.83,
    avgEffort: 5.24,
    activeMinutesPerWeek: 44.6,
  };
  for (const lang of LANGS) {
    it(`gives reps within range as n of every 10, never a percentage (${lang})`, () => {
      const m = html(lang, createElement(SessionsBlock, { data }));
      expect(text(m)).toContain(lang === "ar" ? "٨ من كل ١٠" : "8 of every 10");
      expect(m).toContain("<dl");
      expect(countTag(m, /pg-square is-done/g)).toBe(data.weeks.reduce((n, w) => n + w.done, 0));
      expectCleanCopy(lang, m);
    });
  }

  it("says there are no sessions yet, with the way to the program", () => {
    const m = html(
      "en",
      createElement(SessionsBlock, {
        data: { weeks: [], validShare: null, avgEffort: null, activeMinutesPerWeek: null },
        onOpenProgram: noop,
      }),
    );
    expect(m).toContain(t("en", "progress.sessions.none"));
    expect(m).toContain(t("en", "progress.sessions.toProgram"));
  });
});

describe("S54 example", () => {
  for (const lang of LANGS) {
    it(`shows one labelled example card, the banner read with the h1, no code away from the booth (C37, R-13, ${lang})`, () => {
      const m = renderToStaticMarkup(
        createElement(ExampleProgress, {
          lang,
          onLanguage: noop,
          canTryCheck: false,
          booth: false,
          onTryCheck: noop,
          onRegister: noop,
        }),
      );
      expect(countTag(m, /<article/g)).toBe(1);
      expect(countTag(m, new RegExp(`>${t(lang, "progress.example.tag")}<`, "g"))).toBeGreaterThanOrEqual(1);
      expect(m).toContain(CHECK_DATA.progress.verdicts.higher[lang]);
      // The page is already on the person's phone: Create a free account, never a code to scan.
      expect(m).not.toContain("data-qr");
      expect(m).not.toContain(t(lang, "assessment.guest.scan"));
      expect(m).not.toContain(t(lang, "progress.sessions.heading"));
      const banner = /<span id="([^"]+)">([^<]+)<\/span>/.exec(m)!;
      expect(banner[2]).toBe(t(lang, "progress.example.banner"));
      expect(m).toMatch(new RegExp(`<h1[^>]*aria-describedby="${banner[1]}"`));
      expect(m).toContain('role="region"');
      // Home checks closed and no booth: the register action leads, the booth only line shows.
      expect(m).not.toContain(t(lang, "progress.example.tryCheck"));
      expect(m).toContain(t(lang, "assessment.guest.boothOnly.title"));
      // D-017 item 2: no results footer disclaimer on the example either.
      expect(disclaimersIn(lang, text(m))).toEqual([]);
      expect(m).not.toContain("check-results-footer");
      expectCleanCopy(lang, m);
    });
  }

  it("offers to try the check at the booth, with the sign up code for the visitor's own phone", () => {
    const m = renderToStaticMarkup(
      createElement(ExampleProgress, {
        lang: "en",
        onLanguage: noop,
        canTryCheck: true,
        booth: true,
        onTryCheck: noop,
        onRegister: noop,
      }),
    );
    expect(m).toContain(t("en", "progress.example.tryCheck"));
    expect(m).not.toContain(t("en", "assessment.guest.boothOnly.title"));
    expect(m).toContain("data-qr");
    expect(m).toContain("register=1");
  });
});
