/**
 * The pure rules of the flow screens S04 to S33 and S35 (src/features/assessment/flow/copy.ts): what
 * each screen says, lists and reads aloud, computed from the flow model, the check data and the copy.
 */
import { describe, expect, it } from "vitest";
import { t } from "../src/i18n";
import {
  alignedSentences,
  allSeated,
  areaChoices,
  names937,
  cameraProblemOf,
  cardNotes,
  checkWarnings,
  clockText,
  contextRows,
  cueSpeech,
  emphasize,
  EMPHASIS,
  fillTokens,
  firstAreaWithoutScore,
  guestStepView,
  helperBriefScreen,
  illustrationAlt,
  instructionSteps,
  introBoundary,
  introHelperTests,
  introNeeds,
  joinAnd,
  joinList,
  kgRange,
  knownCues,
  loadArms,
  loadChoices,
  loadDetail,
  loadSummary,
  pausedLine,
  pdTimingToken,
  planView,
  postponeScreen,
  questionView,
  riyadhDay,
  boothDaysNow,
  samePress,
  sideLabel,
  skipGroup,
  snapKg,
  splitSentences,
  stepDownChoices,
  summaryCues,
  surgeryAreaLabel,
  testWarnings,
  variantLabel,
  variantWhy,
  warningTone,
  whenOfLock,
  whenText,
} from "../src/features/assessment/flow/copy";
import { estimateMinutes, type ProtocolItem } from "../src/medical/assessment";
import { lockEndsAt } from "../src/medical/precheck";
import { CHECK_DATA, precheckItem, screenText, testDef } from "../src/movements/assessments";
import type { ScreenId } from "../src/movements/types";
import { NOW } from "./flow-fixtures";
import { ctxOf, envOf } from "./precheck-fixtures";

const LANGS = ["ar", "en"] as const;

describe("text helpers", () => {
  it("joins lists with the Arabic or English comma, and the last item with and", () => {
    expect(joinList("ar", ["الكتف", "الركبة"])).toBe("الكتف، الركبة");
    expect(joinList("en", ["Shoulder", "Knee"])).toBe("Shoulder, Knee");
    expect(joinAnd("en", ["the side lean"])).toBe("the side lean");
    expect(joinAnd("en", ["a", "b", "c"])).toBe("a, b and c");
    expect(joinAnd("ar", ["أ", "ب"])).toBe("أ وب");
    expect(joinAnd("ar", [])).toBe("");
  });

  it("splits sentences after . ? and ؟ followed by a space, dropping nothing", () => {
    expect(splitSentences("One. Two? Three")).toEqual(["One.", "Two?", "Three"]);
    expect(splitSentences("أولى. ثانية؟ ثالثة.")).toEqual(["أولى.", "ثانية؟", "ثالثة."]);
    // A decimal point is not a sentence end.
    expect(splitSentences("Hold 1.5 liters. Then rest.")).toEqual(["Hold 1.5 liters.", "Then rest."]);
    const text = screenText("scr_postpone_care", "ar");
    expect(splitSentences(text).join(" ")).toBe(text.replace(/\s+/g, " "));
  });

  it("pairs display and speech sentences one to one, or plays the line whole when they differ", () => {
    const shown = "One. Two.";
    expect(alignedSentences(shown).lines).toEqual([{ display: "One." }, { display: "Two." }]);
    expect(alignedSentences(shown, "Uno. Dos.")).toEqual({
      lines: [
        { display: "One.", speech: "Uno." },
        { display: "Two.", speech: "Dos." },
      ],
      aligned: true,
    });
    expect(alignedSentences(shown, "Uno dos.")).toEqual({
      lines: [{ display: shown, speech: "Uno dos." }],
      aligned: false,
    });
    // The helper briefings have a vocalised line per display sentence (7.2-12).
    for (const id of ["scr_helper_brief_stand", "scr_helper_brief_trunk"] as const) {
      const s = CHECK_DATA.screens[id];
      expect(alignedSentences(s.ar, s.arTts).aligned, id).toBe(true);
    }
  });

  it("finds the 937 advice line of a postpone text; no postpone text names 997 (Q22, D-016)", () => {
    for (const lang of ["ar", "en"] as const) {
      expect(names937(screenText("scr_postpone_care", lang))).toBe(true);
      expect(screenText("scr_postpone_care", lang)).not.toMatch(/997|٩٩٧/);
    }
    expect(names937(screenText("scr_postpone_unwell", "en"))).toBe(false);
    expect(names937("call ٩٣٧ now")).toBe(true);
  });

  it("fills known tokens and leaves unknown ones in place", () => {
    expect(fillTokens("a {x} b {y}", { x: "1" })).toBe("a 1 b {y}");
  });

  it("reads cue lines: Arabic shows ar and speaks arTts, English both en", () => {
    const cue = CHECK_DATA.cues.find((c) => c.id === "check_sound")!;
    expect(cueSpeech("check_sound", "ar")).toEqual({ display: cue.ar, speech: cue.arTts });
    expect(cueSpeech("check_sound", "en")).toEqual({ display: cue.en, speech: cue.en });
    expect(knownCues(["check_sound", "not_a_cue"])).toEqual(["check_sound"]);
  });
});

describe("emphasis (UX spec 0.2)", () => {
  it("bolds whole words only and keeps the text unchanged", () => {
    const text = precheckItem("pc_urgent").ask!.ar;
    const parts = emphasize(text, EMPHASIS.pc_urgent.ar);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(parts.filter((p) => p.strong).map((p) => p.text)).toContain("الآن");
    // A word inside another word is not bolded.
    expect(emphasize("اليومي", ["اليوم"]).some((p) => p.strong)).toBe(false);
    expect(emphasize("Do you feel unwell today?", EMPHASIS.pc_unwell.en)).toEqual([
      { text: "Do you feel unwell ", strong: false },
      { text: "today", strong: true },
      { text: "?", strong: false },
    ]);
    expect(emphasize("plain", [])).toEqual([{ text: "plain", strong: false }]);
  });

  it("finds its words in the data texts it is for", () => {
    for (const [id, words] of Object.entries(EMPHASIS)) {
      const item = precheckItem(id as "pc_urgent");
      for (const lang of LANGS) {
        const texts = [item.ask?.[lang] ?? "", ...(item.list?.[lang] ?? [])].join(" ");
        const found = emphasize(texts, words[lang]).filter((p) => p.strong);
        expect(found.length, `${id} ${lang}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("durations (O40)", () => {
  it("fills boundary.intro with the range, the Arabic noun chosen by the larger number", () => {
    expect(introBoundary("en", [9, 11])).toContain("about 9 to 11 minutes");
    expect(introBoundary("ar", [9, 11])).toContain("نحو 9 إلى 11 دقيقة");
    expect(introBoundary("ar", [8, 10])).toContain("نحو 8 إلى 10 دقائق");
    for (const lang of LANGS) expect(introBoundary(lang, [16, 21])).not.toMatch(/\{\w+\}/);
    // The rest of the boundary text is unchanged, including "you can skip any test".
    expect(introBoundary("en", [9, 11])).toContain("You can skip any test.");
  });
});

describe("guest steps (S06 to S11, Q19)", () => {
  it("has six steps in the spec order with the spec's choice kinds", () => {
    const screens = ([1, 2, 3, 4, 5, 6] as const).map((n) => guestStepView("en", n));
    expect(screens.map((s) => s.screen)).toEqual(["S06", "S07", "S08", "S08b", "S10", "S11"]);
    expect(screens.map((s) => s.multiple)).toEqual([false, false, true, false, true, true]);
  });

  it("offers the positions with bed last, and the weaker side as right, left, none", () => {
    expect(guestStepView("en", 1).options.map((o) => o.value)).toEqual([
      "chair",
      "wheelchair",
      "standing",
      "bed",
    ]);
    expect(guestStepView("en", 2).options.map((o) => o.value)).toEqual(["right", "left", "none"]);
    expect(guestStepView("ar", 1).hint).toBe(t("ar", "assessment.guest.position.hint"));
  });

  it("reads the conditions step from the data, with none first and exclusive (Q19 (1))", () => {
    const gb = CHECK_DATA.selection.guestBooth;
    for (const lang of LANGS) {
      const v = guestStepView(lang, 3);
      expect(v.question).toBe(gb.conditionsStep.title[lang]);
      expect(v.hint).toBe(gb.conditionsStep.helper[lang]);
      expect(v.options[0]).toEqual({ value: "none", label: gb.conditionsStep.noneChip[lang] });
      expect(v.exclusive).toBe("none");
      expect(v.exclusiveFirst).toBe(true);
      expect(v.options.map((o) => o.value)).toContain("sci_unsure");
      for (const o of v.options) expect(o.label.startsWith("assessment."), o.value).toBe(false);
    }
  });

  it("asks the clearance question and its answers word for word from the data (Q19 (2), 7.2-5)", () => {
    const c = CHECK_DATA.selection.guestBooth.clearance;
    const v = guestStepView("ar", 4);
    expect(v.question).toBe(c.ask.ar);
    expect(v.options.map((o) => o.label)).toEqual(["نعم", "لا", "لست متأكدًا"]);
    expect(v.hint).toBeUndefined();
  });

  it("keeps none last and exclusive on the pain and restriction steps", () => {
    for (const step of [5, 6] as const) {
      const v = guestStepView("en", step);
      expect(v.options.at(-1)!.value).toBe("none");
      expect(v.exclusive).toBe("none");
      expect(v.exclusiveFirst).toBeUndefined();
      expect(v.hint).toBe(t("en", "assessment.guest.chooseAll"));
    }
  });
});

describe("S13 context summary", () => {
  it("lists position, weaker side, pain and restrictions in the copy labels, never the conditions", () => {
    const rows = contextRows(
      "en",
      ctxOf({
        position: "wheelchair",
        support: "left",
        pain: ["shoulder", "knee"],
        conditions: ["stroke"],
        restrictions: [],
      }),
    );
    expect(rows.map((r) => r.label)).toEqual([
      t("en", "assessment.context.position"),
      t("en", "assessment.context.support"),
      t("en", "assessment.context.pain"),
      t("en", "assessment.context.restrictions"),
    ]);
    expect(rows[0].value).toBe(t("en", "assessment.options.position.wheelchair"));
    expect(rows[1].value).toBe(t("en", "assessment.context.sideLeft"));
    expect(rows[2].value).toBe(
      `${t("en", "assessment.options.pain.shoulder")}, ${t("en", "assessment.options.pain.knee")}`,
    );
    expect(rows[3].value).toBe(t("en", "assessment.context.none"));
    expect(JSON.stringify(rows)).not.toContain(t("en", "assessment.options.condition.stroke"));
  });

  it("shows none for no weaker side and leaves out values that have no label", () => {
    const rows = contextRows("ar", ctxOf({ support: "none", pain: ["none", "not_a_label"] }));
    expect(rows[1].value).toBe(t("ar", "assessment.context.none"));
    expect(rows[2].value).toBe(t("ar", "assessment.context.none"));
  });
});

describe("S14 what you need today", () => {
  const needs = (o: Partial<Parameters<typeof introNeeds>[0]>) =>
    introNeeds({
      tests: [],
      position: "chair",
      setting: "home",
      retest: false,
      helperTests: [],
      loadPossible: true,
      ...o,
    });

  it("lists the chair lines by test, then phone, space, helper, load and shoes", () => {
    expect(
      needs({
        tests: ["shoulder_abduction", "trunk_control_seated", "arm_curl_30s"],
        helperTests: ["trunk_control_seated"],
      }),
    ).toEqual(["chairArmrests", "chairArmless", "phone", "space", "helper", "loadFirst"]);
    expect(
      needs({
        tests: ["shoulder_abduction", "arm_curl_30s", "chair_stand_30s"],
        position: "standing",
        retest: true,
      }),
    ).toEqual(["chairArmless", "chairStand", "phone", "space", "loadSame", "shoes"]);
    expect(needs({ tests: ["shoulder_abduction"] })).toEqual(["chairSteady", "phone", "space"]);
  });

  it("names the wheelchair only for the side lean, and no load when none is possible", () => {
    expect(
      needs({
        tests: ["shoulder_abduction", "trunk_control_seated", "arm_curl_30s"],
        position: "wheelchair",
      }),
    ).toEqual(["wheelchair", "phone", "space", "loadFirst"]);
    expect(needs({ tests: ["shoulder_abduction", "arm_curl_30s"], position: "wheelchair" })).toEqual([
      "phone",
      "space",
      "loadFirst",
    ]);
    expect(needs({ tests: ["arm_curl_30s"], loadPossible: false })).toEqual([
      "chairArmless",
      "phone",
      "space",
    ]);
  });

  it("never lists a helper or a load at the booth", () => {
    expect(
      needs({
        tests: ["shoulder_abduction", "trunk_control_seated", "arm_curl_30s"],
        setting: "booth",
        helperTests: ["trunk_control_seated"],
      }),
    ).toEqual(["chairArmrests", "chairArmless", "phone", "space"]);
  });

  it("expects a helper for the side lean at home and the chair stand for the Q11 groups", () => {
    const tests = ["trunk_control_seated", "chair_stand_30s"] as const;
    expect(introHelperTests(tests, ctxOf(), "home")).toEqual(["trunk_control_seated"]);
    expect(introHelperTests(tests, ctxOf({ conditions: ["parkinsons"] }), "home")).toEqual([
      "trunk_control_seated",
      "chair_stand_30s",
    ]);
    expect(introHelperTests(tests, ctxOf({ conditions: ["parkinsons"] }), "booth")).toEqual([]);
  });

  it("treats chair and wheelchair users as seated", () => {
    expect(allSeated("chair")).toBe(true);
    expect(allSeated("wheelchair")).toBe(true);
    expect(allSeated("standing")).toBe(false);
  });
});

describe("pre-check question views (S17 to S24)", () => {
  it("reads pc_urgent with its list, the emphasis words, and Listen in order", () => {
    const env = envOf();
    for (const lang of LANGS) {
      const v = questionView(env, {}, "pc_urgent", lang);
      const item = precheckItem("pc_urgent");
      expect(v.kind).toBe("yes_no");
      expect(v.question).toBe(item.ask![lang]);
      expect(v.list).toEqual(item.list![lang]);
      expect(v.emphasis).toEqual(EMPHASIS.pc_urgent[lang]);
      expect(v.options.map((o) => o.value)).toEqual(["yes", "no"]);
      // Listen: the question, every list line, then each answer.
      expect(v.speech.map((s) => s.display)).toEqual([
        item.ask![lang],
        ...item.list![lang],
        ...item.options!.map((o) => o.label[lang]),
      ]);
    }
  });

  it("asks the first check form of pc_change, and lists the examples at home only (O45)", () => {
    const item = precheckItem("pc_change");
    const home = questionView(envOf(), {}, "pc_change", "en");
    expect(home.question).toBe(item.examples!.askFirstCheck!.en);
    expect(home.list).toEqual(item.examples!.list.en);
    expect(home.listHeading).toBe(item.examples!.heading.en);
    const booth = questionView(envOf({}, { setting: "booth" }), {}, "pc_change", "en");
    expect(booth.question).toBe(item.askFirstCheck!.en);
    expect(booth.list).toBeUndefined();
    const later = questionView(envOf({}, { firstCheck: false }), {}, "pc_change", "en");
    expect(later.question).toBe(item.examples!.ask.en);
  });

  it("asks pc_change_cleared directly when a change is unresolved (Q33 (2))", () => {
    const env = envOf({}, { firstCheck: false, unresolvedChangeReported: true });
    const v = questionView(env, {}, "pc_change_cleared", "ar");
    expect(v.question).toBe(precheckItem("pc_change_cleared").askDirect!.ar);
  });

  it("asks pc_trunk_armrests in the form of the person's position (Q12 (1))", () => {
    const item = precheckItem("pc_trunk_armrests");
    for (const position of ["chair", "wheelchair"] as const) {
      const v = questionView(envOf({ position }), {}, "pc_trunk_armrests", "en");
      expect(v.question).toBe(item.askByPosition![position].en);
    }
  });

  it("fills the {test}, {area} and {side} tokens of instance questions", () => {
    const env = envOf();
    const helper = questionView(env, {}, "pc_helper:chair_stand_30s", "en");
    expect(helper.question).toContain(precheckItem("pc_helper").testTokens!.chair_stand_30s!.en);
    expect(helper.question).not.toMatch(/\{\w+\}/);
    const side = questionView(env, {}, "pc_arm_pain_side:shoulder", "ar");
    expect(side.question).not.toMatch(/\{\w+\}/);
    const fn = questionView(env, {}, "pc_arm_function:left", "en");
    expect(fn.question).not.toMatch(/\{\w+\}/);
    expect(fn.kind).toBe("single");
  });

  it("shows each pc_steadi item on its own screen under the group heading (S23)", () => {
    const item = precheckItem("pc_steadi");
    const v = questionView(envOf({}, { firstCheck: false }), {}, "pc_steadi:unsteady", "en");
    expect(v.kind).toBe("subYesNo");
    expect(v.groupHeading).toBe(t("en", "assessment.precheck.steadi.heading"));
    expect(v.question).toBe(item.items!.find((x) => x.id === "unsteady")!.ask.en);
    const fell = questionView(envOf(), {}, "pc_steadi:fell", "en");
    const sub = item.items!.find((x) => x.id === "fell")!;
    expect(fell.question).toBe((sub.askFirstCheck ?? sub.ask).en);
  });

  it("asks the surgery follow up with the surgery areas, then the clearance per area (S24)", () => {
    const env = envOf();
    const areas = questionView(env, { pc_surgery_recent: "yes" }, "pc_surgery_recent:areas", "en");
    expect(areas.kind).toBe("areaChips");
    expect(areas.question).toBe(precheckItem("pc_surgery_recent").followUp!.en);
    expect(areas.areas!.map((a) => a.id)).toEqual(CHECK_DATA.surgeryAreas.map((a) => a.id));
    const flare = questionView(env, { pc_arthritis_flare: "yes" }, "pc_arthritis_flare:areas", "en");
    expect(flare.areas!.map((a) => a.id)).toEqual(CHECK_DATA.areas.map((a) => a.id));
    const area = CHECK_DATA.surgeryAreas[0].id;
    const clear = questionView(env, {}, `pc_surgery_recent:${area}`, "en");
    expect(clear.kind).toBe("areaClear");
    expect(clear.groupHeading).toBe(surgeryAreaLabel(area, "en"));
    expect(clear.question).toBe(precheckItem("pc_surgery_recent").clearAsk!.en);
  });

  it("gives the scales no answer lines to read, and the areas in data order (S19, S20)", () => {
    const env = envOf();
    const now = questionView(env, {}, "pc_pain_now", "en");
    expect(now.kind).toBe("scale");
    expect(now.speech).toHaveLength(1);
    const areas = questionView(env, { pc_pain_now: 3 }, "pc_pain_areas", "ar");
    expect(areas.kind).toBe("areaScale");
    expect(areas.areas).toEqual(areaChoices("ar"));
  });

  it("reads pc_sci_ready as a list with two answers and its vocalised lines (S22)", () => {
    const v = questionView(envOf({ conditions: ["sci_complete"] }), {}, "pc_sci_ready", "ar");
    const item = precheckItem("pc_sci_ready");
    expect(v.kind).toBe("listConfirm");
    expect(v.list).toEqual(item.list!.ar);
    expect(v.options.map((o) => o.value)).toEqual(["done", "not_yet"]);
    expect(v.speech[0].speech).toBe(item.ask!.arTts);
    expect(v.speech.slice(1, 1 + v.list!.length).map((s) => s.speech)).toEqual(item.list!.arTts);
  });

  it("refuses an unknown question id", () => {
    expect(() => questionView(envOf(), {}, "pc_nothing", "en")).toThrow(RangeError);
  });

  it("finds the first chosen area without a score", () => {
    expect(firstAreaWithoutScore({})).toBeNull();
    expect(firstAreaWithoutScore({ knee: 3, hip: null })).toBe("hip");
    expect(firstAreaWithoutScore({ knee: 0 })).toBeNull();
  });
});

describe("locks and {when} (S33, S35, Q33 (4))", () => {
  it("writes clock times with the data suffixes", () => {
    expect(clockText("en", { hour: 3, minute: 5, suffix: "pm" })).toBe("3:05 pm");
    expect(clockText("ar", { hour: 11, minute: 30, suffix: "am" })).toBe("11:30 صباحًا");
  });

  it("fills scr_paused_today with the {when} form, or shows its first sentence without one", () => {
    expect(whenText("en", { token: "min60_start" })).toBe("in about an hour");
    expect(whenText("en", { token: "nextDay_clock", time: { hour: 8, minute: 0, suffix: "am" } })).toBe(
      "tomorrow after 8:00 am",
    );
    expect(pausedLine("en", { token: "nextDay_midnight" })).toBe(
      "Today’s check has been postponed for your safety. You can try again tomorrow.",
    );
    expect(pausedLine("en", null)).toBe("Today’s check has been postponed for your safety.");
    for (const lang of LANGS) expect(pausedLine(lang, { token: "min60_start" })).not.toMatch(/\{/);
  });

  it("computes {when} of a lock the phone knows, at the start and on a return", () => {
    const until60 = lockEndsAt("ms_heat" as never, NOW)!;
    expect(whenOfLock({ reason: "ms_heat", until: until60 }, NOW, "start")).toEqual({ token: "min60_start" });
    expect(whenOfLock({ reason: "ms_heat", until: until60 }, NOW, "return")?.token).toBe("min60_active");
    const untilDay = lockEndsAt("unwell" as never, NOW)!;
    expect(whenOfLock({ reason: "unwell", until: untilDay }, NOW, "start")?.token).toMatch(/^nextDay/);
    expect(whenOfLock({ reason: "sci_ready", until: null }, NOW, "start")).toBeNull();
    expect(whenOfLock(null, NOW, "start")).toBeNull();
  });

  it("maps each postpone reason to its data screen, the server's screen first", () => {
    expect(postponeScreen("unwell", null)).toBe("scr_postpone_unwell");
    expect(postponeScreen("recent_change", null)).toBe("scr_postpone_care");
    expect(postponeScreen("sci_ready", null)).toBe("scr_postpone_sci");
    expect(postponeScreen("unwell", "scr_postpone_care")).toBe("scr_postpone_care");
    expect(postponeScreen("not_a_reason", null)).toBe("scr_postpone_care");
  });
});

describe("warnings (S25, S28)", () => {
  it("keeps the test warnings and helper briefings off S25, in the outcome order", () => {
    expect(
      checkWarnings(["warn_sci_t6", "warn_pain_high", "scr_helper_brief_stand", "warn_ms_cool"]),
    ).toEqual(["warn_pain_high", "warn_ms_cool"]);
    expect(warningTone("warn_pain_high")).toBe("warn");
    expect(warningTone("warn_ms_cool")).toBe("info");
    expect(warningTone("scr_note_care")).toBe("info");
  });

  it("puts warn_sci_t6 on every card and the weak shoulder only on the arm tests", () => {
    const w = ["warn_sci_t6", "warn_weak_shoulder"];
    expect(testWarnings(w, "shoulder_abduction")).toEqual(["warn_sci_t6", "warn_weak_shoulder"]);
    expect(testWarnings(w, "arm_curl_30s")).toEqual(["warn_sci_t6", "warn_weak_shoulder"]);
    expect(testWarnings(w, "chair_stand_30s")).toEqual(["warn_sci_t6"]);
    expect(testWarnings([], "chair_stand_30s")).toEqual([]);
  });

  it("fills warn_pd_timing only from a known dose bucket", () => {
    expect(pdTimingToken("1to2h", "en")).toBe("1 to 2 hours");
    expect(pdTimingToken(null, "en")).toBeNull();
    expect(pdTimingToken("nope", "en")).toBeNull();
  });
});

describe("the plan (S27, P6)", () => {
  const item = (p: Partial<ProtocolItem> & Pick<ProtocolItem, "testId">): ProtocolItem => ({
    side: "none",
    version: 1,
    order: 0,
    band: "default",
    ...p,
  });

  it("groups day level reasons as not today and intake reasons as not part", () => {
    expect(skipGroup("pain_today")).toBe("notToday");
    expect(skipGroup("helper_needed")).toBe("notToday");
    expect(skipGroup("position_seated")).toBe("notPart");
    expect(skipGroup("restriction_overhead")).toBe("notPart");
  });

  it("explains a variant set by a rule, and shows no chip for default variants", () => {
    const env = envOf();
    const curl = { testId: "arm_curl_30s" as const, side: "left" as const, variant: "arm_only" as const };
    expect(variantWhy(curl, { ...env, setting: "booth" })).toBe("booth");
    expect(variantWhy(curl, envOf({ restrictions: ["no_resistance"] }))).toBe("noResistance");
    expect(variantWhy(curl, { ...env, setup: { painSides: ["left"] } })).toBe("painArm");
    expect(variantWhy(curl, env)).toBe("safety");
    expect(variantWhy({ testId: "chair_stand_30s", side: "none", variant: "arms_assisted" }, env)).toBe(
      "handsAllowed",
    );
    expect(variantWhy({ testId: "chair_stand_30s", side: "none", variant: "standard" }, env)).toBeNull();
    expect(variantLabel("chair_stand_30s", "standard", "en")).toBeNull();
    expect(variantLabel("arm_curl_30s", "held", "en")).toBeNull();
    expect(variantLabel("arm_curl_30s", "arm_only", "en")).toBeTruthy();
  });

  it("lists the tests that run in order, per side, and each skip in its group with its reason", () => {
    const env = envOf({ position: "standing" });
    const protocol = [
      item({ testId: "shoulder_abduction", side: "right", order: 1 }),
      item({ testId: "shoulder_abduction", side: "left", order: 2, skipped: "pain_today" }),
      item({ testId: "arm_curl_30s", side: "right", order: 3, variant: "arm_only" }),
      item({ testId: "arm_curl_30s", side: "left", order: 4, variant: "arm_only" }),
      item({ testId: "trunk_control_seated", side: "none", order: 5, skipped: "helper_needed" }),
      item({ testId: "chair_stand_30s", side: "none", order: 6, skipped: "restriction_weight_bearing" }),
    ];
    const v = planView(protocol, env, "en", NOW, false);
    expect(v.rows.map((r) => r.testId)).toEqual(["shoulder_abduction", "arm_curl_30s"]);
    expect(v.rows[0].perSide).toBe("arm");
    expect(v.rows[0].sideLines).toHaveLength(1);
    expect(v.rows[0].sideLines[0]).toContain(sideLabel("shoulder_abduction", "left", "en"));
    expect(v.rows[1].variant).toBe(variantLabel("arm_curl_30s", "arm_only", "en"));
    expect(v.rows[1].variantWhy).toBe("safety");
    expect(v.notToday.map((s) => s.testId)).toEqual(["trunk_control_seated"]);
    expect(v.notPart.map((s) => s.testId)).toEqual(["chair_stand_30s"]);
    expect(v.minutes).toEqual(estimateMinutes(protocol, env.ctx, "home", false));
  });

  it("offers the booth only on booth days, and never for a test skipped for clearance (D-016)", () => {
    const env = envOf({ position: "standing", clearance: "unsure" });
    const skip = [item({ testId: "trunk_control_seated", skipped: "booth_only_trunk" })];
    const boothDay = Date.UTC(2026, 9, 11, 9);
    expect(boothDaysNow(boothDay)).toBe(true);
    expect(riyadhDay(boothDay)).toBe("2026-10-11");
    expect(planView(skip, env, "en", boothDay, false).notPart[0].boothOffer).toBe(true);
    expect(planView(skip, env, "en", NOW, false).notPart[0].boothOffer).toBe(false);
    const stand = [item({ testId: "chair_stand_30s", skipped: "clearance" })];
    expect(planView(stand, env, "en", boothDay, false).notPart[0].boothOffer).toBe(false);
  });

  it("has no rows when every test is skipped (O21)", () => {
    const v = planView(
      [item({ testId: "shoulder_abduction", skipped: "pain_today" })],
      envOf(),
      "ar",
      NOW,
      false,
    );
    expect(v.rows).toEqual([]);
    expect(v.notToday).toHaveLength(1);
  });
});

describe("the instruction card (S28)", () => {
  it("speaks the summary cues of the S28 table, by variant for the chair stand", () => {
    expect(summaryCues("shoulder_abduction")).toEqual(["test_abd_start", "test_abd_thumb", "test_abd_raise"]);
    expect(summaryCues("chair_stand_30s", "arms_assisted")).toContain("test_stand_hands_ok");
    expect(summaryCues("chair_stand_30s", "standard")).toContain("test_stand_arms_cross");
    // R3C-26: no arm cue asks for both arms when one arm is lost; the card's step line says it.
    expect(summaryCues("chair_stand_30s", "one_arm_cross")).toEqual(["test_stand_start", "test_stand_full"]);
  });

  it("applies zero based step replacements and the booth phone step", () => {
    const def = testDef("arm_curl_30s") as unknown as {
      steps: { en: string[] };
      variants: { id: string; stepsReplace?: Record<string, { en: string }> }[];
    };
    const armOnly = def.variants.find((v) => v.id === "arm_only");
    const steps = instructionSteps("arm_curl_30s", "arm_only", false, "en");
    for (const [k, text] of Object.entries(armOnly?.stepsReplace ?? {}))
      expect(steps[Number(k)]).toBe(text.en);
    expect(steps).toHaveLength(def.steps.en.length);
    const booth = instructionSteps("shoulder_abduction", undefined, true, "ar");
    expect(booth).toContain(t("ar", "assessment.primer.placeBooth"));
    expect(instructionSteps("shoulder_abduction", undefined, false, "ar")).not.toContain(
      t("ar", "assessment.primer.placeBooth"),
    );
  });

  it("names the drawing by test, seat and variant, never starting with the word drawing", () => {
    for (const lang of LANGS)
      for (const test of [
        "shoulder_abduction",
        "arm_curl_30s",
        "trunk_control_seated",
        "chair_stand_30s",
      ] as const)
        for (const position of ["chair", "wheelchair", "standing"] as const) {
          const alt = illustrationAlt(test, position, undefined, lang);
          expect(alt).not.toMatch(/^(رسم|Drawing)/);
          expect(alt).not.toMatch(/\{\w+\}/);
        }
    expect(illustrationAlt("arm_curl_30s", "chair", "arm_only", "en")).toContain(
      t("en", "assessment.test.altLoad.none"),
    );
  });

  it("shows the card notes that apply to the variant and seat", () => {
    const notes = cardNotes("chair_stand_30s", "arms_assisted_steady", "standing", "en");
    const def = testDef("chair_stand_30s") as unknown as { cardNotes?: { id: string }[] };
    if (def.cardNotes?.some((n) => n.id === "steady_support")) expect(notes.length).toBeGreaterThan(0);
    expect(cardNotes("chair_stand_30s", "standard", "standing", "en")).toEqual([]);
  });
});

describe("loads (S29, S30, Q5)", () => {
  it("keeps kilograms in range on the 0.5 kg grid", () => {
    expect(kgRange("dumbbell")).toMatchObject({ min: 0.5, max: 4, step: 0.5, start: 1 });
    expect(kgRange("cuff")).toMatchObject({ min: 0.5, max: 2, step: 0.5, start: 0.5 });
    expect(snapKg("dumbbell", 1.3)).toBe(1.5);
    expect(snapKg("dumbbell", 9)).toBe(4);
    expect(snapKg("cuff", 0)).toBe(0.5);
    expect(snapKg("dumbbell", 3, 2)).toBe(2);
  });

  it("offers only lighter choices after a practice that was not easy", () => {
    expect(stepDownChoices({ kind: "dumbbell", kg: 2 })).toEqual({ kinds: ["dumbbell", "none"], maxKg: 1.5 });
    expect(stepDownChoices({ kind: "dumbbell", kg: 0.5 })).toEqual({ kinds: ["none"] });
    expect(stepDownChoices({ kind: "bottle", liters: 1 })).toEqual({
      kinds: ["bottle", "none"],
      bottles: [0.5],
    });
    expect(stepDownChoices({ kind: "bottle", liters: 0.5 })).toMatchObject({ kinds: ["none"] });
    expect(stepDownChoices({ kind: "none" })).toEqual({ kinds: ["none"] });
    expect(stepDownChoices(undefined)).toEqual({ kinds: ["none"] });
  });

  it("allows no weight at the booth or for arm only, and no dumbbell after a grip yes", () => {
    const ctx = ctxOf();
    expect(loadChoices({ ctx, setting: "booth" })).toEqual(["none"]);
    expect(loadChoices({ ctx, setting: "home", variant: "arm_only" })).toEqual(["none"]);
    expect(loadChoices({ ctx, setting: "home", gripYes: true })).not.toContain("dumbbell");
    expect(loadChoices({ ctx, setting: "home" })).toContain("dumbbell");
    expect(loadChoices({ ctx, setting: "home", variant: "cuff_or_arm_only" })).toEqual(["cuff", "none"]);
  });

  it("names the arms that choose a load, and the load in data words and result fields", () => {
    const sides = [
      { testId: "arm_curl_30s", side: "right", variant: "held" },
      { testId: "arm_curl_30s", side: "left", variant: "arm_only" },
    ] as ProtocolItem[];
    expect(loadArms(sides)).toEqual(["right"]);
    expect(loadSummary({ kind: "cuff", kg: 1 }, "en")).toContain("1");
    expect(loadSummary({ kind: "none" }, "en")).toBe(testDef("arm_curl_30s").resultTokens.load.none.en);
    expect(loadDetail({ kind: "bottle", liters: 1.5 })).toEqual({ loadObject: "bottle", loadL: 1.5 });
    expect(loadDetail({ kind: "dumbbell", kg: 2 })).toEqual({ loadObject: "dumbbell", loadKg: 2 });
    expect(loadDetail({ kind: "none" })).toEqual({ loadObject: "none" });
  });

  it("briefs the helper with the stand or trunk text, and the arm tests with the line only", () => {
    expect(helperBriefScreen("chair_stand_30s")).toBe("scr_helper_brief_stand");
    expect(helperBriefScreen("trunk_control_seated")).toBe("scr_helper_brief_trunk");
    expect(helperBriefScreen("shoulder_abduction")).toBeNull();
  });
});

describe("camera and answers", () => {
  it("maps getUserMedia errors to the S32 variants (map 2.9)", () => {
    const err = (name: string) => Object.assign(new Error(name), { name });
    expect(cameraProblemOf(err("NotAllowedError"))).toBe("denied");
    expect(cameraProblemOf(err("SecurityError"))).toBe("denied");
    expect(cameraProblemOf(err("NotFoundError"))).toBe("none");
    expect(cameraProblemOf(err("OverconstrainedError"))).toBe("none");
    expect(cameraProblemOf(err("NotReadableError"))).toBe("busy");
    expect(cameraProblemOf(err("AbortError"))).toBe("busy");
    expect(cameraProblemOf(null)).toBe("busy");
  });

  it("counts an answer only when the press starts and ends on the same button (O11a)", () => {
    const a = { id: "a" } as unknown as Element;
    const b = { id: "b" } as unknown as Element;
    expect(samePress(a, a, 1)).toBe(true);
    expect(samePress(a, b, 1)).toBe(false);
    // A click with no press seen (a switch device, a synthetic click) counts, as does a keyboard or
    // assistive technology click (detail 0).
    expect(samePress(null, a, 1)).toBe(true);
    expect(samePress(null, a, 0)).toBe(true);
  });
});

describe("data coverage of the flow screens", () => {
  it("has every screen text the flow shows", () => {
    const ids: ScreenId[] = [
      "scr_booth_no_check",
      "scr_sound_off",
      "scr_sound_still_off",
      "scr_paused_today",
      "warn_pain_high",
      "warn_ms_cool",
      "warn_pd_timing",
      "scr_note_care",
      "warn_sci_t6",
      "warn_weak_shoulder",
      "scr_helper_brief_stand",
      "scr_helper_brief_trunk",
      ...(Object.values(CHECK_DATA.postponeReasons) as ScreenId[]),
    ];
    for (const id of ids)
      for (const lang of LANGS) expect(screenText(id, lang), `${id} ${lang}`).toBeTruthy();
  });
});
