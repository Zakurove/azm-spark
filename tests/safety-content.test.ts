/**
 * What the safety screens show and say (UX spec S36 to S49, map 2.6 and 2.7; council O12, O24-6,
 * O34-4, O34-5, O42, O43), in Arabic and English: the call controls and the 64 px number, the extra
 * cards, the paused line, the ways out, the stop list, the check in cue, the alarm text, the skip
 * notice and the end question. Pure (content.ts); no DOM.
 */
import { describe, expect, it } from "vitest";
import {
  flowReducer,
  initialModel,
  testsOf,
  type FlowData,
  type FlowEvent,
  type FlowModel,
  type FlowState,
} from "../src/features/assessment/flowMachine";
import { overlayFor, screenFor } from "../src/features/assessment/screens";
import {
  alarmView,
  allDone,
  anyTried,
  checkInCueId,
  checkInView,
  emphasise,
  endQuestionView,
  isLastTest,
  names997,
  pausedLine,
  safetyView,
  skipNoticeView,
  stopCueOf,
  stopListView,
  whenText,
} from "../src/features/assessment/safety/content";
import { CHECK_DATA, screenText } from "../src/movements/assessments";
import type { ProtocolItem } from "../src/medical/assessment";
import type { ScreenId, StopOptionId } from "../src/movements/types";

const LANGS = ["ar", "en"] as const;
const NOW = Date.UTC(2026, 9, 11, 9, 0); // 12:00 in Riyadh on a booth day

const item = (testId: ProtocolItem["testId"], side: ProtocolItem["side"], order: number): ProtocolItem => ({
  testId,
  side,
  version: 1,
  order,
  band: "default",
});
const PROTOCOL: ProtocolItem[] = [
  item("shoulder_abduction", "left", 1),
  item("shoulder_abduction", "right", 2),
  { ...item("arm_curl_30s", "left", 3), variant: "arm_only" },
  { ...item("arm_curl_30s", "right", 4), variant: "arm_only" },
  item("trunk_control_seated", "left", 5),
  item("trunk_control_seated", "right", 6),
];

function model(
  o: {
    mode?: "guest" | "signedIn";
    state?: FlowState;
    overlay?: FlowModel["overlay"];
    position?: "chair" | "wheelchair" | "standing";
    sciT6?: boolean;
    data?: Partial<FlowData>;
    protocol?: ProtocolItem[];
  } = {},
): FlowModel {
  const mode = o.mode ?? "guest";
  const m = initialModel({ mode, booth: mode === "guest", homeOpen: true, desktop: false });
  const protocol = o.protocol ?? PROTOCOL;
  const data: FlowData = {
    ...m.data,
    env: {
      setting: m.data.setting,
      ctx: {
        position: o.position ?? "chair",
        support: "none",
        pain: [],
        restrictions: [],
        conditions: o.sciT6 ? ["sci_incomplete"] : [],
        clearance: "yes",
      },
      setup: o.sciT6 ? { sciT6: true } : null,
      firstCheck: true,
      unresolvedChangeReported: false,
      lastCheckLasting: false,
      baseTests: ["shoulder_abduction", "arm_curl_30s", "trunk_control_seated"],
    },
    protocol,
    tests: testsOf(protocol),
    checkId: mode === "signedIn" ? "c1" : null,
    ...o.data,
  };
  return { ...m, state: o.state ?? { kind: "cam.measure", i: 0, side: 0 }, overlay: o.overlay ?? null, data };
}

const safety = (screen: ScreenId, kind: string, alsoShow: ScreenId[] = [], extra = {}) =>
  ({ kind: "safety", safety: kind, screen, alsoShow, faintAnswered: false, ...extra }) as Extract<
    FlowState,
    { kind: "safety" }
  >;

describe("S36 to S40b: calls, number, cards (map 2.7, Q22, O12)", () => {
  const rows: [ScreenId, string, ("997" | "937")[], boolean, boolean][] = [
    ["scr_emergency", "S36", ["997"], true, true],
    ["scr_ad", "S37", ["997"], false, true],
    ["scr_faint", "S38", ["997"], false, false],
    ["scr_fall", "S39", ["997"], true, false],
    ["scr_fall_seated", "S39", ["997"], true, false],
    ["scr_stop_seek_care", "S40a", ["997", "937"], false, false],
    ["scr_stop_pain", "S40b", [], false, false],
  ];
  const kinds: Record<string, string> = {
    scr_emergency: "emergency",
    scr_ad: "ad",
    scr_faint: "faint",
    scr_fall: "fall",
    scr_fall_seated: "fall",
    scr_stop_seek_care: "seekCare",
    scr_stop_pain: "pain",
  };
  for (const lang of LANGS)
    for (const [screen, id, calls, big, band] of rows)
      it(`${id} ${screen} (${lang}): 997 first where the text names it, the 64 px number on S36 and S39`, () => {
        const v = safetyView(safety(screen, kinds[screen]), model().data, lang, NOW);
        expect(v.id).toBe(id);
        expect(v.calls).toEqual(calls);
        expect(v.bigNumber).toBe(big);
        expect(v.band).toBe(band);
        expect(v.blocks[0].sentences.join(" ")).toBe(
          screenText(screen, lang)
            .split(/(?<=[.!?؟])\s+/u)
            .join(" "),
        );
        expect(v.heading.length).toBeGreaterThan(0);
      });

  it("names997 follows the texts: scr_stop_pain and scr_faint_sci name no number", () => {
    expect(names997("scr_emergency")).toBe(true);
    expect(names997("scr_no_response")).toBe(true);
    expect(names997("scr_faint_sci")).toBe(false);
    expect(names997("scr_stop_pain")).toBe(false);
  });

  it("S36 for SCI shows the AD card under its heading, right after scr_emergency (O12 (1))", () => {
    for (const lang of LANGS) {
      const v = safetyView(
        safety("scr_emergency", "emergency", ["scr_ad"]),
        model({ sciT6: true }).data,
        lang,
        NOW,
      );
      expect(v.blocks.map((b) => b.screen)).toEqual(["scr_emergency", "scr_ad"]);
      expect(v.blocks[1].heading).toBe(
        lang === "ar" ? "خطوات التعامل مع خلل المنعكسات اللاإرادية" : "What to do for autonomic dysreflexia",
      );
      expect(v.blocks[1].collapsed).toBeFalsy();
      // The conditional lead of O12 (3) waits for the medical seat: never shown.
      const lead = (CHECK_DATA.screens.scr_ad as { emergencyLead?: { ar: string } }).emergencyLead!.ar;
      expect(JSON.stringify(v)).not.toContain(lead.slice(0, 20));
    }
  });

  it("S38 for sci_t6: scr_faint_sci, then the AD card collapsed and read only on Listen (O24-6)", () => {
    const v = safetyView(
      safety("scr_faint", "faint", ["scr_faint_sci"]),
      model({ sciT6: true }).data,
      "ar",
      NOW,
    );
    expect(v.blocks.map((b) => [b.screen, !!b.collapsed])).toEqual([
      ["scr_faint", false],
      ["scr_faint_sci", false],
      ["scr_ad", true],
    ]);
    expect(v.speech.some((l) => l.mark?.startsWith("scr_ad"))).toBe(false);
    expect(v.listen.some((l) => l.mark?.startsWith("scr_ad"))).toBe(true);
    expect(v.askFaint).toBe(true);
  });

  it("speaks every sentence: the stop cue, the body, each card's heading and body, then the paused line", () => {
    const m = model({
      mode: "signedIn",
      sciT6: true,
      data: { lock: { reason: "urgent", until: NOW + 12 * 3600e3 } },
    });
    const v = safetyView(safety("scr_emergency", "emergency", ["scr_ad"]), m.data, "en", NOW);
    const displays = v.speech.map((l) => l.display);
    expect(displays[0]).toBe("Stop now and rest.");
    const body = screenText("scr_emergency", "en").split(/(?<=[.!?])\s+/);
    expect(displays.slice(1, 1 + body.length)).toEqual(body);
    expect(displays).toContain("What to do for autonomic dysreflexia");
    expect(displays[displays.length - 1]).toBe("Today’s check has been postponed for your safety.");
    // English is read aloud, numbers digit by digit; nothing is read as a large number.
    expect(v.speech.filter((l) => l.speech).every((l) => !/\b997\b/.test(l.speech!))).toBe(true);
  });

  it("plays check_stop_now only when a test was running, check_urgent_call on S39 (O12 (5))", () => {
    const running = model().data;
    expect(stopCueOf("emergency", running)).toBe("check_stop_now");
    expect(stopCueOf("fall", running)).toBe("check_urgent_call");
    // From the pre-check: no protocol yet.
    expect(stopCueOf("emergency", model({ protocol: [] }).data)).toBeNull();
    // From the end question: every test has an outcome.
    const outcomes = Object.fromEntries(
      PROTOCOL.map((p) => [`${p.testId}:${p.side}`, { status: "measured" as const }]),
    );
    const done = model({ data: { outcomes } }).data;
    expect(allDone(done)).toBe(true);
    expect(stopCueOf("emergency", done)).toBeNull();
    // The flow records the route's source: a stop on the last test still says check_stop_now.
    expect(stopCueOf("emergency", done, "test")).toBe("check_stop_now");
    expect(stopCueOf("emergency", running, "precheck")).toBeNull();
    expect(stopCueOf("emergency", running, "end")).toBeNull();
  });

  it("the way out: Continue toward S38b or the end question, else Today or the booth start", () => {
    const measured = { "shoulder_abduction:left": { status: "measured" as const, value: 120 } };
    const g = model().data;
    const s = model({ mode: "signedIn" }).data;
    expect(safetyView(safety("scr_emergency", "emergency"), g, "ar", NOW).exitLabel).toBe("ارجع إلى البداية");
    expect(safetyView(safety("scr_emergency", "emergency"), s, "en", NOW).exitLabel).toBe("Return to Today");
    const faint = safetyView(safety("scr_faint", "faint"), s, "en", NOW);
    expect([faint.exitLabel, faint.exitForward]).toEqual(["Continue", true]);
    const answered = safetyView(safety("scr_faint", "faint", [], { faintAnswered: true }), s, "en", NOW);
    expect([answered.exitLabel, answered.exitForward]).toEqual(["Return to Today", false]);
    const fall = safetyView(safety("scr_fall", "fall", [], { askFaint: true }), s, "en", NOW);
    expect(fall.exitForward).toBe(true);
    const pain = safetyView(
      safety("scr_stop_pain", "pain"),
      model({ mode: "signedIn", data: { outcomes: measured } }).data,
      "en",
      NOW,
    );
    expect([
      pain.exitLabel,
      pain.exitForward,
      anyTried(model({ data: { outcomes: measured } }).data),
    ]).toEqual(["Continue", true, true]);
  });

  it("kept, paused and booth lines: signed in keeps results and shows {when}; a guest sees the staff line", () => {
    const measured = { "shoulder_abduction:left": { status: "measured" as const, value: 120 } };
    const lock = { reason: "stop_symptom", until: NOW + 12 * 3600e3 };
    const s = safetyView(
      safety("scr_emergency", "emergency"),
      model({ mode: "signedIn", data: { outcomes: measured, lock } }).data,
      "ar",
      NOW,
    );
    expect(s.kept).toBe("نتائج الاختبارات التي أنهيتها محفوظة.");
    expect(s.paused).toContain("أُجِّل قياس اليوم حرصًا على سلامتك.");
    expect(s.paused).not.toMatch(/[0-9]/);
    expect(s.boothStaff).toBeNull();
    const g = safetyView(
      safety("scr_emergency", "emergency"),
      model({ data: { outcomes: measured, lock } }).data,
      "en",
      NOW,
    );
    expect(g.kept).toBe("Nothing is saved in this trial.");
    expect(g.paused).toBeNull();
    expect(g.boothStaff).toBe("Our team is close by at the booth.");
    // No lock, or one that has ended: no paused line.
    const none = safetyView(safety("scr_stop_pain", "pain"), model({ mode: "signedIn" }).data, "en", NOW);
    expect([none.paused, none.kept]).toEqual([null, null]);
  });

  it("{when} per Q33 (4): tomorrow at midnight, tomorrow after a clock time, digits per Q30", () => {
    // 12:00 Riyadh + 12 h = 00:00 tomorrow: "tomorrow".
    expect(whenText(NOW + 12 * 3600e3, NOW, "en")).toBe("tomorrow");
    expect(whenText(NOW + 12 * 3600e3, NOW, "ar")).toBe("غدًا");
    // 20:00 Riyadh + 8 h = 04:00 tomorrow: "tomorrow after 4:00 am".
    const evening = NOW + 8 * 3600e3;
    expect(whenText(evening + 8 * 3600e3, evening, "en")).toBe("tomorrow after 4:00 am");
    expect(whenText(evening + 8 * 3600e3, evening, "ar")).toBe("غدًا بعد الساعة ٤:٠٠ صباحًا");
    expect(pausedLine(evening + 8 * 3600e3, evening, "en")).toBe(
      "Today’s check has been postponed for your safety. You can try again tomorrow after 4:00 am.",
    );
  });
});

describe("S41 the stop list (Q31 (3), O43)", () => {
  it("lists the data's options, urgent first, ad_signs only with sci_t6, and no pressed by mistake row", () => {
    for (const lang of LANGS) {
      const plain = stopListView(model().data, lang);
      expect(plain.urgent.map((r) => r.id)).toEqual(["chest", "stroke_signs", "faint", "breath", "fall"]);
      expect(plain.other.map((r) => r.id)).toEqual(["pain", "tired", "choice", "other"]);
      const sci = stopListView(model({ sciT6: true }).data, lang);
      expect(sci.urgent.map((r) => r.id)).toEqual([
        "chest",
        "stroke_signs",
        "ad_signs",
        "faint",
        "breath",
        "fall",
      ]);
      expect(sci.ask).toBe(CHECK_DATA.stopRouting.ask[lang]);
      for (const r of [...sci.urgent, ...sci.other]) {
        expect(r.label).toBe(CHECK_DATA.stopRouting.options.find((o) => o.id === r.id)!.label[lang]);
        expect(r.icon.length).toBeGreaterThan(0);
      }
    }
  });

  it("without a context reads the most conservative person: every symptom row shows (stopEnv)", () => {
    const d = { ...model().data, env: null };
    expect(stopListView(d, "en").urgent.map((r) => r.id)).toContain("ad_signs");
  });

  const expected: Record<StopOptionId, string> = {
    chest: "S36",
    stroke_signs: "S36",
    ad_signs: "S37",
    faint: "S38",
    breath: "S40a",
    fall: "S39",
    pain: "S47",
    tired: "S42",
    choice: "S42",
    other: "S42",
  };
  for (const [option, screen] of Object.entries(expected))
    it(`one tap on ${option} routes to ${screen}`, () => {
      const m = model({ sciT6: true, overlay: { kind: "stopList", takeYourTime: false } });
      const next = flowReducer(m, { type: "STOP_OPTION", option: option as StopOptionId, now: NOW });
      expect(next.overlay).toBeNull();
      expect(screenFor(next)).toBe(screen);
    });

  it("a seated person's fall shows the seated fall text (screenWhen)", () => {
    const m = model({ position: "wheelchair", overlay: { kind: "stopList", takeYourTime: false } });
    const next = flowReducer(m, { type: "STOP_OPTION", option: "fall", now: NOW });
    expect(next.state).toMatchObject({ kind: "safety", screen: "scr_fall_seated", askFaint: true });
    const standing = flowReducer(
      model({ position: "standing", overlay: { kind: "stopList", takeYourTime: false } }),
      {
        type: "STOP_OPTION",
        option: "fall",
        now: NOW,
      },
    );
    expect(standing.state).toMatchObject({ screen: "scr_fall" });
  });
});

describe("S43, S44, S45: the check in and the alarm (O34-4, O34-5, O42)", () => {
  it("asks at the booth with check_are_you_ok, or the no raise form when a hand must not be raised", () => {
    const d = model().data;
    expect(
      checkInCueId({ ...d, checkIn: { raiseAllowed: true, noArmSignal: false, fineZoneSide: "right" } }),
    ).toBe("check_are_you_ok");
    expect(
      checkInCueId({ ...d, checkIn: { raiseAllowed: false, noArmSignal: false, fineZoneSide: "right" } }),
    ).toBe("check_are_you_ok_noraise");
    // No inputs kept (the guest flow): the safer no raise form.
    expect(checkInCueId({ ...d, checkIn: null })).toBe("check_are_you_ok_noraise");
    const v = checkInView(
      { ...d, checkIn: { raiseAllowed: true, noArmSignal: false, fineZoneSide: null } },
      "ar",
    );
    expect(v.question).toBe("هل أنت بخير؟");
    expect(v.short).toBe("ارفع يدك");
    expect(checkInView({ ...d, checkIn: null }, "en")).toMatchObject({
      question: "Are you all right?",
      short: "Tell our team",
    });
  });

  it("S45 heads with the first sentence of scr_no_response; the help variant with Get help now", () => {
    for (const lang of LANGS) {
      const plain = alarmView(false, lang);
      const all = screenText("scr_no_response", lang).split(/(?<=[.!?؟])\s+/u);
      expect(plain.heading).toBe(all[0]);
      expect(plain.body.map((l) => l.display)).toEqual(all.slice(1));
      expect(plain.body.map((l) => l.mark)).toEqual(all.slice(1).map((_, i) => `alarm:${i}`));
      const help = alarmView(true, lang);
      expect(help.heading).toBe(lang === "ar" ? "اطلب المساعدة الآن" : "Get help now");
      expect(help.body.map((l) => l.display)).toEqual(all.slice(1));
    }
  });

  const run = (m: FlowModel, ...events: FlowEvent[]) =>
    events.reduce((x, e) => flowReducer(x, { now: NOW, ...e }), m);

  it("the stop list's 30 s runs the check in; 15 s more opens the alarm; only fine leaves it", () => {
    let m = run(model({ overlay: { kind: "stopList", takeYourTime: false } }), { type: "STOP_NO_INPUT" });
    expect(overlayFor(m)).toBe("S43");
    m = run(m, { type: "CHECKIN_TIMEOUT" });
    expect(overlayFor(m)).toBe("S45");
    expect(overlayFor(run(m, { type: "STOP" }))).toBe("S45");
    expect(overlayFor(run(m, { type: "CALL" }))).toBe("S45");
    m = run(m, { type: "FINE", via: "button" });
    expect(m.overlay).toEqual({ kind: "stopList", takeYourTime: true, fineVia: "button" });
  });

  it("a test trigger: fine goes on to S44; no response and fine gives S44 after the alarm; help to S41", () => {
    const at = model();
    const asked = run(at, { type: "TRIGGER", trigger: "no_movement" });
    expect(overlayFor(asked)).toBe("S43");
    expect(run(asked, { type: "FINE", via: "button" }).overlay).toEqual({
      kind: "goOn",
      afterAlarm: false,
      canRedo: true,
    });
    const alarmed = run(asked, { type: "CHECKIN_TIMEOUT" }, { type: "FINE", via: "button" });
    expect(alarmed.overlay).toEqual({ kind: "goOn", afterAlarm: true, canRedo: false, timer: true });
    const help = run(asked, { type: "NEED_HELP" });
    expect(help.overlay).toMatchObject({ kind: "alarm", help: true });
    expect(run(help, { type: "FINE", via: "button" }).overlay).toEqual({
      kind: "stopList",
      takeYourTime: false,
    });
  });
});

describe("S42, S46, S49", () => {
  it("S42 finishes after the last test", () => {
    const d = model().data;
    expect(isLastTest(d, 0)).toBe(false);
    expect(isLastTest(d, 2)).toBe(true);
    const skipped = { ...d, outcomes: { "trunk_control_seated:left": { status: "skipped" as const } } };
    expect(isLastTest(skipped, 1)).toBe(false);
  });

  it("S46 titles by what skipped the test, with a row per test side and its reason", () => {
    const pain = skipNoticeView([{ testId: "arm_curl_30s", side: "left", reason: "pain_more" }], "en");
    expect(pain.title).toBe("Today we skip the tests that use the area that hurts");
    expect(pain.cue).toBeNull();
    expect(pain.rows[0]).toMatchObject({ test: "Arm bends in 30 seconds", side: "Your left arm" });
    expect(pain.rows[0].reason).toContain("hurts more today");
    const choice = skipNoticeView(
      [{ testId: "trunk_control_seated", side: "right", reason: "by_choice" }],
      "ar",
    );
    expect([choice.cue, choice.title]).toEqual(["check_skip_ok", "لا بأس، سنتخطى هذا الاختبار."]);
    expect(choice.rows[0].side).toBe("الميل إلى يمينك");
    const quality = skipNoticeView([{ testId: "shoulder_abduction", side: "left", reason: "quality" }], "en");
    expect(quality.title).toBe("We could not measure this clearly today. Next time, try the setup tips.");
    expect(quality.rows[0].reason).toBeNull();
    const hands = skipNoticeView([{ testId: "chair_stand_30s", side: "none", reason: "needed_arms" }], "en");
    expect(hands.title).toBe("You needed your hands, which is fine");
    expect(hands.rows[0].side).toBeNull();
  });

  it("S49 asks the general form, or names the side with its token and speech line", () => {
    const general = endQuestionView(null, "ar");
    expect(general.text).toBe(CHECK_DATA.endOfCheck[0].ask.ar);
    const side = endQuestionView("left", "ar");
    expect(side.text).toContain("ذراعك اليسرى");
    expect(side.text).not.toContain("{side}");
    expect(side.arTts).toBe(CHECK_DATA.endOfCheck[0].askSide.arTtsBySide!.left);
    expect(endQuestionView("right", "en").text).toContain("your right arm");
  });

  it("bolds the meaning words without changing the text (0.2)", () => {
    const text = CHECK_DATA.endOfCheck[0].ask.ar;
    const parts = emphasise(text, ["اليوم", "جديد ومفاجئ"]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(parts.filter((p) => p.strong).map((p) => p.text)).toEqual(["اليوم", "جديد ومفاجئ"]);
    const en = CHECK_DATA.endOfCheck[0].ask.en;
    expect(emphasise(en, ["today", "new, sudden"]).filter((p) => p.strong)).toHaveLength(2);
  });
});
