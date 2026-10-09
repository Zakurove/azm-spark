/**
 * The intake form in both builds (product v7 contract C-9, 1.2): a default build keeps the four steps
 * and the v1 questions exactly as before; a VITE_V7 build has three short steps (D-034 item 5:
 * «حالتك وحركتك», «جسمك وسلامتك», «هدفك ووقتك», its v7 parts in their own lazily loaded chunk). It no
 * longer asks the diagnosis notes, the medications, the v1 support side or the v1 pain question (the
 * body map answers them: pain[] is written from it, contract 2.2 rule 3, and the support side
 * follows its weakness), and has no review step: the consent closes the goal step.
 *
 * A default build spreads a saved intake into its draft, so a v7 intake (saved by a VITE_V7 build on
 * staging, or before a rollback of the build flag) brings its sex, body map, walking, height and
 * safety answers along unseen, while mobility and pain[] stay editable. The intake the form validates
 * and saves keeps the cross field rules with the v1 answers the person changed (Gate A review, D-024):
 * mobility bed walks no, and a v1 pain area the person unticks takes pain and injury off the body map
 * entries of its region, so the intake can always be saved.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { createElement } from "react";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import { validateIntake, type Intake } from "../../src/medical/plan";
import type { RegionEntry } from "../../src/medical/body-map";

async function load(v7: boolean) {
  vi.resetModules();
  vi.stubEnv("VITE_V7", v7 ? "1" : "");
  vi.doMock("../../src/app/v7flag", () => ({ V7_UI: v7 }));
  return await import("../../src/app/IntakeForm");
}
/** The form's first step once every lazy part has loaded. */
async function firstStep(v7: boolean, lang: "ar" | "en", initial: Intake | null = null): Promise<string> {
  const IntakeForm = await form(v7);
  return new Promise((resolve, reject) => {
    let html = "";
    const out = new PassThrough();
    out.on("data", (chunk) => (html += chunk));
    out.on("end", () => resolve(html));
    const stream = renderToPipeableStream(createElement(IntakeForm, { lang, initial, onSaved: () => {} }), {
      onAllReady: () => stream.pipe(out),
      onError: reject,
    });
  });
}
const plain = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
async function form(v7: boolean) {
  return (await load(v7)).default;
}
const steps = (html: string) => html.match(/<ol>.*?<\/ol>/s)![0].match(/<li/g)!.length;

const v1: Intake = {
  age: 58,
  conditions: ["arthritis"],
  diagnosisNotes: "",
  medications: "",
  mobility: "standing",
  support: "none",
  pain: [],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: [],
  goal: "mobility",
  days: [0, 2, 4],
  time: "09:00",
  sessionMinutes: 30,
  consent: true,
};
const kneeRight: RegionEntry = { region: "knee", side: "right", problems: ["pain"], origin: "person" };
/** The review's example: an intake a VITE_V7 build saved, with the right knee painful. */
const savedV7: Intake = {
  ...v1,
  pain: ["knee"],
  sex: "male",
  regions: [kneeRight],
  walking: { status: "without_aid" },
  heightCm: 172,
  romFlags: { osteoporosis: false, neckCaution: false, inflammatoryArthritis: "no" },
};

describe("the intake form", () => {
  afterEach(() => {
    vi.doUnmock("../../src/app/v7flag");
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps four steps in a default build", async () => {
    const IntakeForm = await form(false);
    const html = renderToStaticMarkup(
      createElement(IntakeForm, { lang: "ar", initial: null, onSaved: () => {} }),
    );
    expect(steps(html)).toBe(4);
    expect(html).toContain("١ / ٤");
    expect(html).toContain("الحركة والاحتياطات");
  });

  it("keeps the v1 first step in a default build: the diagnosis notes and the medications", async () => {
    const text = plain(await firstStep(false, "ar"));
    for (const line of ["العمر", "ما حالتك الطبية؟", "تفاصيل التشخيص أو تعليمات الطبيب", "الأدوية الحالية"])
      expect(text).toContain(line);
    expect(text).not.toContain("الجنس");
    expect(text).not.toContain("ما الوضعية الأنسب لك في التمرين؟");
  });

  it("has three short steps in a v7 build (D-034 item 5)", async () => {
    const IntakeForm = await form(true);
    const html = renderToStaticMarkup(
      createElement(IntakeForm, { lang: "en", initial: null, onSaved: () => {} }),
    );
    expect(steps(html)).toBe(3);
    expect(html).toContain("1 / 3");
    const loaded = plain(await firstStep(true, "ar"));
    for (const name of ["حالتك وحركتك", "جسمك وسلامتك", "هدفك ووقتك"]) expect(loaded).toContain(name);
    expect(loaded).not.toContain("المراجعة");
  });

  it("asks age and sex, the conditions, how the person exercises and walking first, and nothing the rules do not read", async () => {
    for (const lang of ["ar", "en"] as const) {
      const html = await firstStep(true, lang);
      // The form card, after the step list.
      const text = plain(html.slice(html.indexOf('class="intake-card"')));
      const order = (
        lang === "ar"
          ? ["العمر", "الجنس", "ما حالتك الطبية؟", "ما الوضعية الأنسب لك في التمرين؟", "هل تستطيع المشي؟"]
          : [
              "Age",
              "Sex",
              "Which conditions apply to you?",
              "Which position suits you best for exercise?",
              "Can you walk?",
            ]
      ).map((line) => text.indexOf(line));
      expect(order.every((at) => at >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      // How the person exercises is four buttons.
      expect(html.match(/class="intake-mobility"/g)).toHaveLength(1);
      expect(html.match(/<button[^>]*data-value="(seated|wheelchair|standing|bed)"/g)).toHaveLength(4);
    }
    const text = plain(await firstStep(true, "ar"));
    for (const gone of [
      "تفاصيل التشخيص أو تعليمات الطبيب",
      "الأدوية الحالية",
      "هل يحتاج أحد جانبي جسمك إلى مراعاة خاصة؟",
      "هل تؤلمك إحدى هذه المناطق عند الحركة؟",
    ])
      expect(text).not.toContain(gone);
  });

  it("asks the side of a stroke on the first step, under the conditions", async () => {
    const html = await firstStep(true, "en", { ...v1, conditions: ["stroke"] });
    const text = plain(html.slice(html.indexOf('class="intake-card"')));
    expect(text).toContain("Which side is weaker?");
    expect(text.indexOf("Which side is weaker?")).toBeGreaterThan(
      text.indexOf("Which conditions apply to you?"),
    );
    expect(text.indexOf("Which side is weaker?")).toBeLessThan(
      text.indexOf("Which position suits you best for exercise?"),
    );
  });

  it("asks the position that suits the person, with the same four answers (D-035 item 5)", async () => {
    const { labels } = await import("../../src/app/platform-copy");
    expect(labels("ar").mobility).toBe("ما الوضعية الأنسب لك في التمرين؟");
    expect(labels("en").mobility).toBe("Which position suits you best for exercise?");
    const html = await firstStep(true, "ar");
    expect([...html.matchAll(/data-value="(seated|wheelchair|standing|bed)"/g)].map((m) => m[1])).toEqual([
      "seated",
      "wheelchair",
      "standing",
      "bed",
    ]);
  });

  it("opens a v7 form with the medical report as a standout card, before the questions (D-035 item 5)", async () => {
    for (const lang of ["ar", "en"] as const) {
      const html = await firstStep(true, lang);
      const card = html.match(/<button[^>]*class="report-card"[^>]*>.*?<\/button>/s)?.[0] ?? "";
      expect(card, lang).not.toBe("");
      expect(plain(card)).toContain(lang === "ar" ? "عندك تقرير طبي؟" : "Have a medical report?");
      expect(plain(card)).toContain(
        lang === "ar"
          ? "ارفع تقريرك الطبي، ونقرأه لك ونملأ حالتك"
          : "Upload your medical report, we read it and fill in your condition",
      );
      // The icon: a document with a spark.
      expect(card).toContain('data-icon="report"');
      const text = plain(html.slice(html.indexOf('class="intake-card"')));
      expect(text.indexOf(lang === "ar" ? "عندك تقرير طبي؟" : "Have a medical report?")).toBeLessThan(
        text.indexOf(lang === "ar" ? "العمر" : "Age"),
      );
    }
    // A default build keeps its secondary link under the questions.
    const v1 = await firstStep(false, "ar");
    expect(v1).toContain("report-open");
    expect(v1).not.toContain("report-card");
  });

  it("lists the answer that lets the person go ahead first in each safety question (D-035 item 5)", async () => {
    const { SAFETY_ANSWERS } = await load(true);
    expect(SAFETY_ANSWERS).toEqual({
      symptoms: ["no", "yes"],
      recentChange: ["no", "yes"],
      restrictions: ["no", "yes"],
      clearance: ["yes", "no", "unsure"],
    });
  });
});

describe("a v7 intake edited in a default build (Gate A review)", () => {
  afterEach(() => {
    vi.doUnmock("../../src/app/v7flag");
    vi.resetModules();
  });

  it("saves after the knee is unticked under the areas that hurt: the knee leaves the body map", async () => {
    const { intakeBody } = await load(false);
    const edited: Intake = { ...savedV7, pain: [] };
    // Without the reconcile the pain mirror refuses it, and the build has no body map to fix it.
    expect(validateIntake(edited)).toBe(false);
    const body = intakeBody(edited);
    expect(validateIntake(body)).toBe(true);
    expect(body).toEqual({ ...edited, regions: [] });
    // The person's answers and the other hidden fields stay as they were.
    expect(body.pain).toEqual([]);
    expect(body.walking).toEqual({ status: "without_aid" });
    expect(body.sex).toBe("male");
    expect(body.heightCm).toBe(172);
    expect(body.romFlags).toEqual(savedV7.romFlags);
  });

  it("saves after mobility changes to bed: walking becomes no", async () => {
    const { intakeBody } = await load(false);
    const edited: Intake = { ...savedV7, mobility: "bed" };
    expect(validateIntake(edited)).toBe(false);
    const body = intakeBody(edited);
    expect(validateIntake(body)).toBe(true);
    expect(body).toEqual({ ...edited, walking: { status: "no" } });
    // Both edits at once.
    const both = intakeBody({ ...savedV7, mobility: "bed", pain: [] });
    expect(validateIntake(both)).toBe(true);
    expect(both.walking).toEqual({ status: "no" });
    expect(both.regions).toEqual([]);
  });

  it("takes pain and injury off only the entries of the unticked area, and keeps their other problems", async () => {
    const { intakeBody } = await load(false);
    const regions: RegionEntry[] = [
      { region: "neck", side: "axial", problems: ["pain"], origin: "person" },
      { region: "shoulder", side: "right", problems: ["pain"], origin: "person" },
      { region: "hip", side: "both", problems: ["stiffness"], origin: "condition" },
      { region: "knee", side: "right", problems: ["pain", "stiffness"], origin: "condition" },
      {
        region: "knee",
        side: "left",
        problems: ["injury", "after_surgery"],
        origin: "person",
        injury: { since: "gt6m" },
        surgery: { since: "gt6m" },
      },
      {
        region: "ankle_foot",
        side: "right",
        problems: ["injury"],
        origin: "person",
        injury: { since: "3m_6m", achilles: false },
      },
    ];
    const saved: Intake = { ...savedV7, pain: ["shoulder", "knee"], regions };
    expect(validateIntake(saved)).toBe(true);
    // The knee is unticked; the shoulder stays.
    const body = intakeBody({ ...saved, pain: ["shoulder"] });
    expect(validateIntake(body)).toBe(true);
    expect(body.regions).toEqual([
      regions[0],
      regions[1],
      regions[2],
      { region: "knee", side: "right", problems: ["stiffness"], origin: "condition" },
      {
        region: "knee",
        side: "left",
        problems: ["after_surgery"],
        origin: "person",
        surgery: { since: "gt6m" },
      },
      regions[5],
    ]);
    // «لا شيء مما سبق» unticks every area: the neck and the ankle and foot have no v1 pain area and stay.
    const none = intakeBody({ ...saved, pain: [] });
    expect(validateIntake(none)).toBe(true);
    expect(none.regions!.map((e) => `${e.region}:${e.side}:${e.problems.join("+")}`)).toEqual([
      "neck:axial:pain",
      "hip:both:stiffness",
      "knee:right:stiffness",
      "knee:left:after_surgery",
      "ankle_foot:right:injury",
    ]);
    // An area ticked again before saving brings its entries back as they were.
    expect(intakeBody(saved)).toEqual(saved);
  });

  it("leaves an intake without the v7 fields, and an unedited v7 intake, exactly as they are", async () => {
    const { intakeBody } = await load(false);
    for (const draft of [v1, { ...v1, mobility: "bed" as const, pain: ["knee"] }, savedV7]) {
      expect(intakeBody(draft)).toEqual(draft);
      expect(Object.keys(intakeBody(draft))).toEqual(Object.keys(draft));
    }
  });

  it("writes pain[] from the body map in a v7 build, as before", async () => {
    const { intakeBody } = await load(true);
    const body = intakeBody({ ...savedV7, pain: [] });
    expect(body.pain).toEqual(["knee"]);
    expect(body.regions).toEqual([kneeRight]);
    expect(validateIntake(body)).toBe(true);
  });
});
