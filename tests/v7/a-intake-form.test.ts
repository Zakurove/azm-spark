/**
 * The intake form in both builds (product v7 contract C-9, 1.2): a default build keeps the four steps
 * and the v1 pain question exactly as before; a VITE_V7 build adds the "Your body" step after
 * "Movement and precautions" (its own lazily loaded chunk) and drops the v1 pain question, which the
 * body map answers (pain[] is written from it, contract 2.2 rule 3).
 *
 * A default build spreads a saved intake into its draft, so a v7 intake (saved by a VITE_V7 build on
 * staging, or before a rollback of the build flag) brings its sex, body map, walking, height and
 * safety answers along unseen, while mobility and pain[] stay editable. The intake the form validates
 * and saves keeps the cross field rules with the v1 answers the person changed (Gate A review, D-024):
 * mobility bed walks no, and a v1 pain area the person unticks takes pain and injury off the body map
 * entries of its region, so the intake can always be saved.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { validateIntake, type Intake } from "../../src/medical/plan";
import type { RegionEntry } from "../../src/medical/body-map";

async function load(v7: boolean) {
  vi.resetModules();
  vi.doMock("../../src/app/v7flag", () => ({ V7_UI: v7 }));
  return await import("../../src/app/IntakeForm");
}
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

  it("adds the Your body step in a v7 build", async () => {
    const IntakeForm = await form(true);
    const html = renderToStaticMarkup(
      createElement(IntakeForm, { lang: "en", initial: null, onSaved: () => {} }),
    );
    expect(steps(html)).toBe(5);
    expect(html).toContain("1 / 5");
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
        surgery: { since: "gt6m", cleared: "yes", avoid: [] },
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
        surgery: { since: "gt6m", cleared: "yes", avoid: [] },
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
