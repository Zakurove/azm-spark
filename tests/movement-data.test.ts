/**
 * The runtime movement check data (src/movements/check-v1.json) against its types and itself:
 *   1. every id list in src/movements/types.ts equals the ids in the data, both ways;
 *   2. every closed set value (kinds, units, groups, actions, answer values, ...) is one the types allow;
 *   3. referential integrity: every test, cue, screen, reason, question and variant id referenced
 *      anywhere in the data exists, including ids named inside prose;
 *   4. every text has Arabic and English, with the same {tokens};
 *   5. the typed accessors of src/movements/assessments.ts.
 */
import { describe, expect, it } from "vitest";
import {
  CHECK_DATA,
  TEST_IDS,
  cueLine,
  isCheckCueId,
  isTestId,
  precheckItem,
  reasonText,
  screenText,
  testDef,
} from "../src/movements/assessments";
import {
  AFTER_CHECK_IDS,
  AREA_IDS,
  BETWEEN_TEST_IDS,
  CHECK_CUE_IDS,
  LOCK_REASON_IDS,
  POSTPONE_REASON_IDS,
  PRECHECK_IDS,
  REASON_IDS,
  SCREEN_IDS,
  STOP_OPTION_IDS,
  SURGERY_AREA_IDS,
  TEST_ID_LIST,
  UNIT_FORM_IDS,
  type QuestionAction,
  type ShowIf,
  type TestRef,
} from "../src/movements/types";
import { conditions, painOptions, restrictionOptions } from "../src/medical/plan";

const D = CHECK_DATA;
const QUESTIONS = [...D.precheck, ...D.betweenTests, ...D.afterCheck];
const ACTIONS: { q: string; a: QuestionAction }[] = QUESTIONS.flatMap((q) =>
  q.actions.map((a) => ({ q: q.id, a })),
);
const sorted = (xs: Iterable<string>) => [...xs].sort();
const set = (xs: readonly string[]) => new Set<string>(xs);

/** Every string in the data with its path. */
function strings(v: unknown, path = "", out: { path: string; text: string }[] = []) {
  if (typeof v === "string") out.push({ path, text: v });
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) strings(x, `${path}.${k}`, out);
  return out;
}
/** Every object in the data with its path. */
function objects(v: unknown, path = "", out: { path: string; obj: Record<string, unknown> }[] = []) {
  if (Array.isArray(v)) v.forEach((x, i) => objects(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") {
    out.push({ path, obj: v as Record<string, unknown> });
    for (const [k, x] of Object.entries(v)) objects(x, `${path}.${k}`, out);
  }
  return out;
}
/** A condition and every nested anyOf condition. */
function showIfs(s: ShowIf | null | undefined): ShowIf[] {
  return s ? [s, ...(s.anyOf ?? []).flatMap(showIfs)] : [];
}
const ALL_SHOW_IFS = [
  ...QUESTIONS.flatMap((q) => ("showIf" in q ? showIfs(q.showIf) : [])),
  ...D.stopRouting.options.flatMap((o) => showIfs(o.showIf)),
  ...ACTIONS.flatMap(({ a }) => (a.do === "emergency" ? showIfs(a.alsoShowIf) : [])),
];
const testRefs = (a: QuestionAction): TestRef[] => ("tests" in a && Array.isArray(a.tests) ? a.tests : []);
const tokens = (s: string) => sorted(new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])));

describe("id lists in src/movements/types.ts equal the data", () => {
  const cases: [string, readonly string[], string[]][] = [
    ["tests", TEST_ID_LIST, D.tests.map((t) => t.id)],
    ["precheck", PRECHECK_IDS, D.precheck.map((q) => q.id)],
    ["betweenTests", BETWEEN_TEST_IDS, D.betweenTests.map((q) => q.id)],
    ["afterCheck", AFTER_CHECK_IDS, D.afterCheck.map((q) => q.id)],
    ["screens", SCREEN_IDS, Object.keys(D.screens)],
    ["reasons", REASON_IDS, Object.keys(D.reasons)],
    ["postponeReasons", POSTPONE_REASON_IDS, Object.keys(D.postponeReasons)],
    ["locks.rules", LOCK_REASON_IDS, Object.keys(D.locks.rules)],
    ["cues", CHECK_CUE_IDS, D.cues.map((c) => c.id)],
    ["areas", AREA_IDS, D.areas.map((a) => a.id)],
    ["surgeryAreas", SURGERY_AREA_IDS, D.surgeryAreas.map((a) => a.id)],
    ["stopRouting.options", STOP_OPTION_IDS, D.stopRouting.options.map((o) => o.id)],
    ["progress.unitForms", UNIT_FORM_IDS, Object.keys(D.progress.unitForms)],
  ];
  it.each(cases)("%s", (_name, list, data) => {
    expect(data).toEqual([...list]);
    expect(new Set(data).size).toBe(data.length);
  });
  it("has the 67 check cues and the 4 tests of v1", () => {
    expect(D.cues).toHaveLength(67);
    expect(TEST_IDS).toEqual([
      "shoulder_abduction",
      "arm_curl_30s",
      "trunk_control_seated",
      "chair_stand_30s",
    ]);
  });
  it("condition notes cover every intake condition", () => {
    expect(sorted(Object.keys(D.selection.conditionNotes))).toEqual(sorted(conditions));
  });
});

describe("closed sets hold only the values the types allow", () => {
  it("questions", () => {
    const groups = set(["system", "every_check", "baseline_setup", "condition", "standing"]);
    const types = set([
      "system",
      "yes_no",
      "yes_no_unsure",
      "yes_no_then_areas",
      "scale_0_10",
      "area_scale_0_10",
      "single",
      "checklist",
      "three_yes_no",
    ]);
    for (const q of D.precheck) {
      expect(groups.has(q.group), q.id).toBe(true);
      expect(types.has(q.type), q.id).toBe(true);
      expect(q.actions.length, q.id).toBeGreaterThan(0);
    }
    const values = set([
      "yes",
      "no",
      "unsure",
      "yes_cleared",
      "right",
      "left",
      "both",
      "weaker",
      "bend_hold",
      "bend_no_hold",
      "no_bend",
      "lt1h",
      "1to2h",
      "2to3h",
      "gt3h",
      "same",
      "more",
      "much",
      "usual",
      "settled",
      "lasting",
    ]);
    for (const q of QUESTIONS)
      for (const o of ("options" in q && q.options) || [])
        expect(values.has(o.value), `${q.id} ${o.value}`).toBe(true);
  });

  it("actions", () => {
    const does = set([
      "record",
      "emergency",
      "postpone",
      "ask",
      "skip",
      "warn",
      "variant",
      "flag",
      "ad_response",
      "booth_only",
      "require_helper",
      "show",
      "stop_check",
      "note",
    ]);
    const ifKeys = set([
      "equals",
      "clearedNot",
      "gte",
      "areaScoreGte",
      "areaLoadsSelectedTest",
      "any",
      "in",
      "allChecked",
      "anyYes",
      "vitalsAbove",
      "vitalsUnavailable",
    ]);
    const stores = set([
      "changeCleared",
      "changeReported",
      "setup.painSides",
      "setup.limbLoss.arm",
      "setup.limbLoss.leg",
      "fingerprint.armProsthesis",
      "fingerprint.legProsthesis",
      "fingerprint.pdState",
      "fingerprint.pdDoseBucket",
      "fingerprint.helperPresent",
      "followUpResolved",
      "assessment.followUp",
    ]);
    const locks = set(["next_day", "60_min", "none"]);
    const sides = set(["weaker", "stronger", "same", "each", "none"]);
    const selectors = set([
      "surgeryArea.loads",
      "area.loads",
      "the test the question was asked for",
      "remaining tests that load the same area",
    ]);
    const variants = set(["arm_only", "arms_assisted", "push_stronger_hand_only", "cuff_or_arm_only"]);
    for (const { q, a } of ACTIONS) {
      expect(does.has(a.do), `${q} ${a.do}`).toBe(true);
      for (const k of Object.keys(a.if)) expect(ifKeys.has(k), `${q} if.${k}`).toBe(true);
      if ("stores" in a && a.stores) expect(stores.has(a.stores), `${q} ${a.stores}`).toBe(true);
      if ("lock" in a && a.lock) expect(locks.has(a.lock), `${q} ${a.lock}`).toBe(true);
      if ("tests" in a && typeof a.tests === "string")
        expect(selectors.has(a.tests), `${q} ${a.tests}`).toBe(true);
      for (const t of testRefs(a)) expect(sides.has(t.side), `${q} ${t.side}`).toBe(true);
      if (a.do === "variant") expect(variants.has(a.variant), `${q} ${a.variant}`).toBe(true);
      if (a.do === "flag") expect(a.flag).toBe("sci_t6");
    }
  });

  it("show conditions", () => {
    const keys = set([
      "anyOf",
      "answer",
      "noUnresolvedChangeReported",
      "unresolvedChangeReported",
      "painAny",
      "supportNot",
      "conditionsAny",
      "flag",
      "notFirstCheck",
      "testSelected",
      "positionIn",
      "setting",
      "clearanceIn",
      "previousFollowUp",
      // alsoShowIf carries the screen to show with its condition
      "screen",
    ]);
    for (const s of ALL_SHOW_IFS) {
      for (const k of Object.keys(s)) expect(keys.has(k), k).toBe(true);
      for (const p of s.painAny ?? []) expect(painOptions).toContain(p);
      for (const c of s.conditionsAny ?? []) expect(conditions).toContain(c);
      for (const p of s.positionIn ?? []) expect(["chair", "wheelchair", "standing"]).toContain(p);
      for (const c of s.clearanceIn ?? []) expect(["yes", "no", "unsure"]).toContain(c);
      if (s.flag) expect(["sci_t6", "helper_required"]).toContain(s.flag);
      if (s.setting) expect(["booth", "home"]).toContain(s.setting);
      if (s.supportNot) expect(s.supportNot).toBe("none");
      if (s.previousFollowUp) expect(s.previousFollowUp).toBe("lasting_unresolved");
    }
  });

  it("tests", () => {
    const kinds: Record<string, string> = {
      shoulder_abduction: "range_test",
      arm_curl_30s: "timed_count",
      trunk_control_seated: "trunk_control",
      chair_stand_30s: "timed_count",
    };
    for (const t of D.tests) {
      expect(t.kind).toBe(kinds[t.id]);
      expect(["deg", "count"]).toContain(t.unit);
      expect(["front", "side"]).toContain(t.view);
      expect(["each", "none"]).toContain(t.sides);
      expect(["max", "single"]).toContain(t.best);
      expect(t.better).toBe("higher");
      expect(["draft", "reviewed", "approved"]).toContain(t.status);
      for (const p of t.positions) expect(["chair", "wheelchair", "standing"]).toContain(p);
      for (const p of t.exclusions.pain) expect(painOptions).toContain(p);
      for (const r of [...t.exclusions.restrictions, ...(t.exclusions.homeOnlyExclusion?.restrictions ?? [])])
        expect(restrictionOptions).toContain(r);
      for (const c of t.exclusions.conditions) expect(conditions).toContain(c);
      for (const l of t.exclusions.limbLoss) expect(["arm", "leg"]).toContain(l);
      for (const c of t.exclusions.homeOnlyExclusion?.clearance ?? [])
        expect(["yes", "no", "unsure"]).toContain(c);
      expect(t.setup.orientation).toBe("portrait");
      expect(t.setup.distanceM).toHaveLength(2);
      // The single noise band of the contract is the default band of the rules.
      expect(t.noiseBand).toBe(t.noiseBandRules.default.abs);
      // Result unit words follow the stored unit.
      expect(t.unit === "deg" ? ["deg"] : ["bends", "stands"]).toContain(t.resultUnit);
    }
    expect(Object.keys(D.engine.model.minFps).sort()).toEqual(["range_test", "timed_count", "trunk_control"]);
    expect(testDef("arm_curl_30s").metric.minFps).toBe(D.engine.model.minFps.timed_count);
    expect(testDef("chair_stand_30s").metric.minFps).toBe(D.engine.model.minFps.timed_count);
  });

  it("status and sign off", () => {
    expect(D.id).toBe("movement_check");
    expect(["draft", "reviewed", "approved"]).toContain(D.status);
    expect(D.signoff.status).toBe(D.status);
    // Nothing is approved before the check as a whole is approved (product rule 7).
    if (D.signoff.status !== "approved") for (const t of D.tests) expect(t.status).not.toBe("approved");
  });
});

describe("referential integrity", () => {
  const TESTS = set(TEST_ID_LIST);
  const SCREENS = set(SCREEN_IDS);
  const REASONS = set(REASON_IDS);
  const POSTPONE = set(POSTPONE_REASON_IDS);
  const CUES = set(CHECK_CUE_IDS);
  const QIDS = set([...PRECHECK_IDS, ...BETWEEN_TEST_IDS, ...AFTER_CHECK_IDS]);

  it("every referenced test id exists", () => {
    const refs: string[] = [
      ...D.areas.flatMap((a) => a.loads.map((l) => l.test)),
      ...D.surgeryAreas.flatMap((a) => (a.loads ?? []).map((l) => l.test)),
      ...ACTIONS.flatMap(({ a }) => testRefs(a).map((t) => t.test)),
      ...ACTIONS.flatMap(({ a }) => (a.do === "show" ? Object.keys(a.screenByTest) : [])),
      ...ALL_SHOW_IFS.flatMap((s) => (s.testSelected ? [s.testSelected] : [])),
      ...D.precheck.flatMap((q) => [...(q.perTest ?? []), ...Object.keys(q.testTokens ?? {})]),
      ...Object.values(D.selection.basePerPosition).flat(),
    ];
    expect(refs.length).toBeGreaterThan(40);
    expect(refs.filter((r) => !TESTS.has(r))).toEqual([]);
  });

  it("every referenced cue id exists, including cue ids named in prose", () => {
    const refs = [...D.tests.flatMap((t) => t.cues), D.stopRouting.checkIn.cue];
    const prose = strings(D).flatMap(({ path, text }) =>
      path.endsWith(".id") ? [] : [...text.matchAll(/\b(?:check|test)_[a-z0-9_]+\b/g)].map((m) => m[0]),
    );
    expect(prose.length).toBeGreaterThan(20);
    expect([...refs, ...prose].filter((r) => !CUES.has(r))).toEqual([]);
    for (const t of D.tests) expect(new Set(t.cues).size, t.id).toBe(t.cues.length);
  });

  it("every referenced screen id exists, including screens named in prose", () => {
    const refs: string[] = [
      ...ACTIONS.flatMap(({ a }) => ("screen" in a && a.screen ? [a.screen] : [])),
      ...ACTIONS.flatMap(({ a }) => (a.do === "emergency" && a.alsoShowIf ? [a.alsoShowIf.screen] : [])),
      ...ACTIONS.flatMap(({ a }) => (a.do === "show" ? Object.values(a.screenByTest) : [])),
      ...D.stopRouting.options.flatMap((o) =>
        [o.screen, o.alsoShowIf?.screen, o.screenWhen?.screen].filter((s): s is NonNullable<typeof s> => !!s),
      ),
      D.locks.screen,
      ...Object.values(D.postponeReasons),
    ];
    const prose = strings(D).flatMap(({ text }) =>
      [...text.matchAll(/\b(?:scr|warn)_[a-z0-9_]+\b/g)].map((m) => m[0]),
    );
    expect(refs.length).toBeGreaterThan(20);
    expect([...refs, ...prose].filter((r) => !SCREENS.has(r))).toEqual([]);
  });

  it("every referenced reason id exists", () => {
    for (const { q, a } of ACTIONS) {
      if (a.do === "postpone") expect(POSTPONE.has(a.reason), `${q} ${a.reason}`).toBe(true);
      if (a.do === "skip" || a.do === "booth_only")
        expect(REASONS.has(a.reason), `${q} ${a.reason}`).toBe(true);
    }
    for (const o of D.stopRouting.options) if (o.reason) expect(REASONS.has(o.reason), o.id).toBe(true);
  });

  it("every referenced question id exists, including questions named in prose", () => {
    const refs: string[] = [
      ...D.tests.flatMap((t) => t.exclusions.precheck),
      ...ALL_SHOW_IFS.flatMap((s) => (s.answer ? [s.answer.id] : [])),
      ...ACTIONS.flatMap(({ a }) => (a.do === "ask" ? [a.next] : [])),
      ...D.stopRouting.options.flatMap((o) => (o.then ? [o.then] : [])),
    ];
    const prose = strings(D).flatMap(({ path, text }) =>
      path.endsWith(".id") ? [] : [...text.matchAll(/\b(?:pc|bt|ac)_[a-z0-9_]+\b/g)].map((m) => m[0]),
    );
    expect(refs.length).toBeGreaterThan(20);
    expect([...refs, ...prose].filter((r) => !QIDS.has(r))).toEqual([]);
  });

  it("postpone actions show the screen of their reason and use the lock of its rule", () => {
    const lockOf = (rule: string) => rule.split(/[,:]/)[0].trim();
    for (const { q, a } of ACTIONS) {
      if (a.do !== "postpone") continue;
      expect(a.screen, q).toBe(D.postponeReasons[a.reason]);
      expect(a.lock, q).toBe(lockOf(D.locks.rules[a.reason]));
    }
    for (const r of POSTPONE_REASON_IDS) expect(D.locks.rules[r], r).toBeTruthy();
    const urgent = ACTIONS.find(({ a }) => a.do === "emergency")!.a as { lock: string };
    expect(urgent.lock).toBe(lockOf(D.locks.rules.urgent));
    const ad = ACTIONS.find(({ a }) => a.do === "ad_response")!.a as { lock: string };
    expect(ad.lock).toBe(lockOf(D.locks.rules.ad));
    for (const o of D.stopRouting.options.filter((o) => o.check === "ends"))
      expect(o.lock, o.id).toBe(lockOf(D.locks.rules.stop_symptom));
    // Every lock with a duration has its "try again" line.
    for (const { a } of ACTIONS)
      if ("lock" in a && a.lock && a.lock !== "none") expect(D.pausedWhenTokens[a.lock]).toBeDefined();
  });

  it("every variant id exists on its test, apart from the two documented modifiers", () => {
    const variantsOf = (id: string) =>
      new Set<string>(
        (D.tests.find((t) => t.id === id) as { variants?: { id: string }[] }).variants?.map((v) => v.id) ??
          [],
      );
    // SPEC-GAP: variant-modifiers
    // push_stronger_hand_only (chair stand) and cuff_or_arm_only (arm curl)
    // are set by pre-check actions but are not variant ids of the test; see ActionVariant.
    const modifiers: Record<string, string> = {
      push_stronger_hand_only: "chair_stand_30s",
      cuff_or_arm_only: "arm_curl_30s",
    };
    for (const { q, a } of ACTIONS) {
      if (a.do !== "variant") continue;
      for (const t of a.tests) {
        if (modifiers[a.variant]) expect(t.test, `${q} ${a.variant}`).toBe(modifiers[a.variant]);
        else expect(variantsOf(t.test).has(a.variant), `${q} ${t.test} ${a.variant}`).toBe(true);
      }
    }
    for (const load of [...D.areas.flatMap((a) => a.loads), ...D.surgeryAreas.flatMap((a) => a.loads ?? [])])
      if (load.variant)
        expect(variantsOf(load.test).has(load.variant), `${load.test} ${load.variant}`).toBe(true);
    const chairStand = testDef("chair_stand_30s");
    expect(sorted(Object.keys(chairStand.resultTokens.variant))).toEqual(
      sorted(chairStand.variants.map((v) => v.id)),
    );
  });

  it("areas, surgery areas and step replacements point at things that exist", () => {
    const areaIds = set(AREA_IDS);
    for (const s of D.surgeryAreas) {
      expect(!!s.usesArea || !!s.loads, s.id).toBe(true);
      if (s.usesArea) expect(areaIds.has(s.usesArea), s.id).toBe(true);
      // Every surgery area has a label of its own or through its pain area.
      expect(s.label ?? D.areas.find((a) => a.id === s.usesArea)?.label, s.id).toBeDefined();
    }
    for (const t of D.tests) {
      for (const v of ("variants" in t ? t.variants : []) as {
        id: string;
        stepsReplace?: Record<string, unknown>;
      }[])
        for (const k of Object.keys(v.stepsReplace ?? {})) {
          expect(k, `${t.id} ${v.id}`).toMatch(/^\d+$/);
          expect(Number(k), `${t.id} ${v.id}`).toBeLessThan(t.steps.en.length);
        }
    }
    for (const q of D.precheck) {
      for (const a of q.perArea ?? []) expect(q.areaTokens?.[a], `${q.id} ${a}`).toBeDefined();
      for (const t of q.perTest ?? []) expect(q.testTokens?.[t], `${q.id} ${t}`).toBeDefined();
      if (q.perSide) expect(sorted(Object.keys(q.sideTokens ?? {}))).toEqual(["left", "right"]);
    }
  });

  it("every {token} in a text has a source", () => {
    const standard = set(["value", "unit", "seconds"]);
    for (const t of D.tests) {
      const own = set(Object.keys(t.resultTokens));
      for (const k of tokens(t.resultSentence.en))
        expect(standard.has(k) || own.has(k), `${t.id} ${k}`).toBe(true);
    }
    const armCurl = testDef("arm_curl_30s");
    expect(tokens(armCurl.resultTokens.load.held.en)).toEqual(["kg"]);
    expect(tokens(armCurl.resultTokens.load.bottle.en)).toEqual(["l"]);
    expect(tokens(D.screens.scr_paused_today.en)).toEqual(["when"]);
    expect(tokens(D.screens.warn_pd_timing.en)).toEqual(["x"]);
    expect(precheckItem("pc_pd_dose").timingTokens).toBeDefined();
    for (const q of D.precheck) {
      const ask = q.ask ? tokens(q.ask.en) : [];
      if (ask.includes("area")) expect(q.areaTokens, q.id).toBeDefined();
      if (ask.includes("side")) expect(q.sideTokens, q.id).toBeDefined();
      if (ask.includes("test")) expect(q.testTokens, q.id).toBeDefined();
      for (const k of ask) expect(["area", "side", "test"], `${q.id} ${k}`).toContain(k);
    }
  });
});

describe("Arabic and English", () => {
  // The standard and one_arm_cross chair stand sentences add nothing after the seconds.
  const EMPTY_ALLOWED = [
    ".tests[3].resultTokens.variant.standard",
    ".tests[3].resultTokens.variant.one_arm_cross",
  ];
  const BILINGUAL = objects(D).filter(({ obj }) => "ar" in obj || "en" in obj || "arTts" in obj);

  it("every text has both ar and en, of the same kind", () => {
    expect(BILINGUAL.length).toBeGreaterThan(300);
    for (const { path, obj } of BILINGUAL) {
      expect(obj.ar, `${path}.ar`).toBeDefined();
      expect(obj.en, `${path}.en`).toBeDefined();
      expect(Array.isArray(obj.ar), path).toBe(Array.isArray(obj.en));
      expect(typeof obj.ar, path).toBe(typeof obj.en);
    }
  });

  it("no text is empty, and lists match item for item", () => {
    for (const { path, obj } of BILINGUAL) {
      if (typeof obj.ar === "string") {
        if (EMPTY_ALLOWED.includes(path)) {
          expect([obj.ar, obj.en], path).toEqual(["", ""]);
          continue;
        }
        expect((obj.ar as string).trim(), `${path}.ar`).not.toBe("");
        expect((obj.en as string).trim(), `${path}.en`).not.toBe("");
      } else if (Array.isArray(obj.ar)) {
        for (const s of [...(obj.ar as string[]), ...(obj.en as string[])])
          expect(s.trim(), path).not.toBe("");
        // Stem lists are independent per language; every other list is a translation.
        if (!path.endsWith("forbiddenInProgressText"))
          expect((obj.ar as string[]).length, path).toBe((obj.en as string[]).length);
      }
    }
  });

  it("Arabic and English use the same {tokens}", () => {
    for (const { path, obj } of BILINGUAL)
      if (typeof obj.ar === "string" && typeof obj.en === "string")
        expect(tokens(obj.ar), path).toEqual(tokens(obj.en as string));
  });

  it("unit words have every Arabic plural form and the English one and other", () => {
    for (const [unit, forms] of Object.entries(D.progress.unitForms)) {
      expect(sorted(Object.keys(forms.ar)), unit).toEqual(
        sorted(["zero", "one", "two", "few", "many", "other"]),
      );
      expect(sorted(Object.keys(forms.en)), unit).toEqual(["one", "other"]);
    }
  });

  it("every cue has display Arabic, vocalized Arabic for speech and English", () => {
    const MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
    const bare = (s: string) =>
      s
        .replace(MARKS, "")
        .replace(/[ٱإأآ]/g, "ا")
        .trim();
    // Digits are spelled out for speech; everything else in arTts is the display text with marks.
    const SPOKEN_DIGITS = ["check_urgent_call"];
    for (const c of D.cues) {
      expect(c.arTts, c.id).not.toBe(c.ar);
      expect(c.arTts, c.id).not.toMatch(/\d/);
      if (!SPOKEN_DIGITS.includes(c.id)) expect(bare(c.arTts), c.id).toBe(bare(c.ar));
    }
    expect(bare(cueLine("check_urgent_call").arTts)).toContain("تسعة، تسعة، سبعة");
  });
});

describe("typed accessors", () => {
  it("testDef returns the definition of each test and refuses an unknown id", () => {
    for (const id of TEST_IDS) expect(testDef(id).id).toBe(id);
    expect(testDef("shoulder_abduction").metric.id).toBe("shoulder_abduction_deg");
    expect(testDef("trunk_control_seated").substituteFor.position).toBe("standing");
    expect(() => testDef("hold_test" as never)).toThrow(/Unknown movement check test/);
  });

  it("precheckItem finds pre-check, between tests and after check questions", () => {
    expect(precheckItem("pc_urgent").group).toBe("every_check");
    expect(precheckItem("bt_pain_after").when).toContain("after each test");
    expect(precheckItem("ac_next_day").options.map((o) => o.value)).toEqual(["usual", "settled", "lasting"]);
    expect(() => precheckItem("pc_trunk_surgery" as never)).toThrow(/Unknown movement check question/);
  });

  it("screenText, reasonText and cueLine return the language asked for", () => {
    expect(screenText("scr_postpone_unwell", "en")).toBe("Let’s do the check on a day when you feel well.");
    expect(screenText("scr_postpone_unwell", "ar")).toBe(D.screens.scr_postpone_unwell.ar);
    expect(reasonText("by_choice", "en")).toBe("Skipped by your choice.");
    expect(reasonText("by_choice", "ar")).toBe("تخطيت هذا الاختبار باختيارك.");
    expect(cueLine("check_go")).toEqual({
      id: "check_go",
      ar: expect.any(String),
      arTts: expect.any(String),
      en: "Go.",
    });
    expect(() => screenText("scr_missing" as never, "en")).toThrow(/Unknown movement check screen/);
    expect(() => reasonText("missing" as never, "en")).toThrow(/Unknown movement check reason/);
    expect(() => cueLine("check_missing" as never)).toThrow(/Unknown movement check cue/);
  });

  it("guards narrow strings from the engine or the network", () => {
    expect(isTestId("arm_curl_30s")).toBe(true);
    expect(isTestId("arm_curl")).toBe(false);
    expect(isCheckCueId("test_trunk_to_middle")).toBe(true);
    expect(isCheckCueId("sit_tall")).toBe(false);
  });
});
