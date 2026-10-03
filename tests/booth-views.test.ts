/**
 * What the booth screens show (contract C2, C3, C8): the reading chips, the medical engine's three
 * groups with Saad's adapted dose, the week, and the words in both languages (no dashes, no
 * disclaimers, no time estimates).
 */
import { describe, expect, it } from "vitest";
import { reasonText } from "../src/app/platform-copy";
import { engineWeekly } from "../src/medical/weekly";
import { boothCopy } from "../src/features/booth/copy";
import { planFor, selfBase, storyBase } from "../src/features/booth/intake";
import { registerUrl } from "../src/features/booth/Program";
import { countUpAt } from "../src/features/booth/Results";
import { SAAD_EXTRACTION, SAAD_GOAL } from "../src/features/booth/story";
import { cameraWeek, engineView, readingChips } from "../src/features/booth/views";
import { disclaimersIn } from "./no-disclaimers";

const saad = () => planFor(storyBase(SAAD_EXTRACTION), SAAD_GOAL.goal, SAAD_GOAL.sport);

describe("the reading chips", () => {
  it("show what Saad's report says, in reading order, with no pain noted", () => {
    expect(readingChips(SAAD_EXTRACTION, "ar").map((c) => [c.kind, c.value])).toEqual([
      ["age", "٢٢ سنة"],
      ["condition", "إصابة غير كاملة في الحبل الشوكي"],
      ["mobility", "يستخدم كرسيًا متحركًا"],
      ["pain", "لا ألم حالي مذكور"],
      ["medications", "Baclofen 10 mg"],
    ]);
    expect(readingChips(SAAD_EXTRACTION, "en").map((c) => c.value)).toEqual([
      "22 years",
      "Incomplete spinal cord injury",
      "Uses a wheelchair",
      "No current pain noted",
      "Baclofen 10 mg",
    ]);
  });

  it("name pain and doctor's advice when a report has them", () => {
    const chips = readingChips(
      {
        ...SAAD_EXTRACTION,
        extracted: { ...SAAD_EXTRACTION.extracted, pain: ["shoulder"], restrictions: ["no_overhead"] },
      },
      "en",
    );
    expect(chips.find((c) => c.kind === "pain")?.value).toBe("Shoulder");
    expect(chips.find((c) => c.kind === "restrictions")?.value).toBe("Avoid overhead movement");
  });
});

describe("the medical engine view", () => {
  it("Saad: two camera movements in, a lighter dose and longer rest, the sit to stand out for wheelchair users", () => {
    const { intake, plan } = saad();
    const v = engineView(intake, plan, "en", reasonText);
    expect(v.status).toBe("ready");
    expect(v.included.map((i) => i.title)).toEqual(["Seated Shoulder Press", "Seated Biceps Curl"]);
    expect(v.library).toBeGreaterThan(10);
    expect(v.adapted.map((a) => a.id)).toEqual(["rest", "dose", "recovery", "temperature"]);
    const rest = v.adapted[0];
    expect(rest.value).toBe(`${plan.exercises[0].restSeconds} s`);
    expect(rest.base).toBe("instead of 30 s");
    expect(v.excluded).toEqual([
      { id: "sit_to_stand", title: "Sit to Stand", note: "Not for wheelchair users" },
    ]);
    const ar = engineView(intake, plan, "ar", reasonText);
    expect(ar.excluded[0].note).toBe("ليس لمستخدمي الكرسي المتحرك");
    expect(ar.adapted[1].value).toMatch(/^[٠-٩]+ × [٠-٩]+$/);
  });

  it("a visitor with no condition keeps the usual dose; no weights leave the curl out", () => {
    const { intake, plan } = planFor(
      selfBase({ conditions: ["none"], clearance: null, position: "seated", side: "none" }),
      "strength",
    );
    const v = engineView(intake, plan, "en", reasonText);
    expect(v.excluded.map((e) => [e.id, e.note])).toContainEqual([
      "seated_biceps_curl",
      "Needs light weights",
    ]);
    expect(v.excluded.map((e) => [e.id, e.note])).toContainEqual([
      "sit_to_stand",
      "Needs rising and standing",
    ]);
  });

  it("a plan held for review names its reasons as the portal does", () => {
    const { intake, plan } = planFor(
      selfBase({ conditions: ["cardiac"], clearance: null, position: "seated", side: "none" }),
      "habit",
    );
    const v = engineView(intake, plan, "ar", reasonText);
    expect(v.status).toBe("review");
    expect(v.review).toContain(reasonText.cardiac.ar);
  });
});

describe("the starting point's count up", () => {
  it("starts at 0 even when a frame comes just before the start, and ends on the value", () => {
    // A first animation frame stamped before the effect's own clock: never a negative number.
    expect(countUpAt(84, -3, 1300)).toBe(0);
    expect(countUpAt(84, 0, 1300)).toBe(0);
    expect(countUpAt(84, 650, 1300)).toBeGreaterThan(42);
    expect(countUpAt(84, 1300, 1300)).toBe(84);
    expect(countUpAt(84, 5000, 1300)).toBe(84);
  });
});

describe("the week and the register code", () => {
  it("shows each training day with the camera movements and up to two library exercises", () => {
    const { intake, plan } = saad();
    const week = cameraWeek(plan, engineWeekly(intake, plan), "en");
    expect(week.map((d) => d.day)).toEqual([0, 2, 4]);
    for (const d of week) {
      expect(d.camera).toEqual(["Seated Shoulder Press", "Seated Biceps Curl"]);
      expect(d.extra.length).toBeGreaterThan(0);
      expect(d.extra.length).toBeLessThanOrEqual(2);
      expect(d.focus.length).toBeGreaterThan(0);
    }
  });

  it("opens the register tab on the visitor's phone, in the page's language", () => {
    expect(registerUrl("ar", "https://azm.example")).toBe("https://azm.example/?app=1&register=1");
    expect(registerUrl("en", "https://azm.example")).toBe("https://azm.example/?app=1&register=1&lang=en");
  });
});

describe("the booth's words", () => {
  const text = (lang: "ar" | "en") => {
    const k = boothCopy(lang);
    const out: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") out.push(v);
      else if (typeof v === "function") {
        for (const args of [[3], [3, 10], ["3", "10"]]) {
          try {
            const r = (v as (...a: unknown[]) => unknown)(...args);
            if (typeof r === "string") out.push(r);
          } catch {
            /* a function of other arguments */
          }
        }
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(k);
    return out.join("\n");
  };

  it("hold no disclaimer and name no time at the booth", () => {
    for (const lang of ["ar", "en"] as const) {
      expect(disclaimersIn(lang, text(lang))).toEqual([]);
      expect(text(lang)).not.toMatch(/دقيقة|دقائق|minute|seconds? (to|left)|takes/i);
    }
  });

  it("say «حالتك الطبية» and the complete set of keys in both languages", () => {
    expect(text("ar")).toContain("حالتك الطبية");
    expect(Object.keys(boothCopy("en")).sort()).toEqual(Object.keys(boothCopy("ar")).sort());
  });

  it("ask the one safety question in the contract's words", () => {
    expect(boothCopy("ar").safetyAsk).toBe("هل تشعر الآن بألم في الصدر أو دوخة أو توعك؟");
  });
});
