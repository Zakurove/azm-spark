/**
 * Saad's story (booth v2, D-018): the persona of the booth's first door, «قصة سعد» · Saad's story.
 *
 * Saad, 22, played football with his friends every afternoon. A car accident injured his spinal
 * cord (incomplete, T10), and he now uses a wheelchair. Rehab ended, and sport left his life. His goal
 * is wheelchair basketball.
 *
 * Everything here is fictional and shown as a sample: the report image (public/booth/saad-report.png,
 * drawn by scripts/booth/saad-report.mjs, labelled «نموذج توضيحي» · Sample), the cached extraction the
 * booth shows when the live reading does not answer in time, and Saad's own answers. The report is read
 * by the same extractReport as at home; the safety answers (clearance, symptoms, recent change) are
 * Saad's own, never read from the report (rules before AI).
 */
import type { SportId } from "../../medical/sports";

export type L = { ar: string; en: string };

/** The fields the report reading returns (server/report.ts Extraction, sanitized). */
export interface BoothExtraction {
  document: string;
  extracted: {
    age: number | null;
    conditions: string[];
    diagnosisNotes: string;
    medications: string;
    mobility: string;
    support: string;
    pain: string[];
    restrictions: string[];
    symptoms: string;
    recentChange: string;
  };
  missing: string[];
  questions: string[];
  summary: string;
  confidence: string;
}

export const SAAD = {
  name: { ar: "سعد", en: "Saad" } as L,
  age: 22,
  /** The door's line on the booth home. */
  teaser: {
    ar: "كان يلعب كرة القدم كل عصر. بعد حادث سير صار يستخدم كرسيًا متحركًا، وهدفه الآن كرة السلة.",
    en: "He played football every afternoon. After a car accident he uses a wheelchair, and his goal now is basketball.",
  } as L,
  /** The story in three short lines, shown beside his report. */
  story: [
    {
      ar: "سعد، 22 سنة، كان يلعب كرة القدم مع أصدقائه كل عصر.",
      en: "Saad, 22, played football with his friends every afternoon.",
    },
    {
      ar: "أصيب حبله الشوكي في حادث سير، وصار يستخدم كرسيًا متحركًا.",
      en: "A car accident injured his spinal cord, and he now uses a wheelchair.",
    },
    {
      ar: "انتهى التأهيل وغابت الرياضة. هدفه الآن كرة السلة على الكراسي المتحركة.",
      en: "Rehab ended and sport left his life. His goal now is wheelchair basketball.",
    },
  ] as L[],
} as const;

/** The demo report document (rendered locally by scripts/booth/saad-report.mjs). */
export const SAAD_REPORT_SRC = "/booth/saad-report.png";

/**
 * What the report reading returns for Saad's report: shown when the live reading has not answered
 * within READ_FALLBACK_MS (or cannot answer), so the booth never waits. It is the answer the live
 * reading gives for the same document.
 */
export const SAAD_EXTRACTION: BoothExtraction = {
  document: "medical_report",
  extracted: {
    age: 22,
    conditions: ["sci_incomplete"],
    diagnosisNotes:
      "Incomplete spinal cord injury at T10 (AIS C) after a road traffic accident in March 2025. Completed inpatient and outpatient rehabilitation. Encouraged to start regular adapted exercise and to explore para sport.",
    medications: "Baclofen 10 mg",
    mobility: "wheelchair",
    support: "unknown",
    pain: [],
    restrictions: [],
    symptoms: "unknown",
    recentChange: "unknown",
  },
  missing: ["support", "symptoms", "recentChange"],
  questions: [],
  summary: "",
  confidence: "high",
};

/** The live reading waits this long before the booth shows the cached reading (contract C2). */
export const READ_FALLBACK_MS = 8000;

/**
 * Saad's own answers to the questions a report never answers (rules before AI): his doctor cleared
 * him for exercise, no warning symptoms, no recent change. He has light dumbbells and a band at home,
 * and trains three afternoons a week, a day apart (his condition asks for a rest day between sessions).
 */
export const SAAD_ANSWERS = {
  support: "none",
  clearance: "yes",
  symptoms: "no",
  recentChange: "no",
  equipment: ["weights", "bands"],
  days: [0, 2, 4],
  time: "17:00",
  sessionMinutes: 30,
} as const;

/** Saad's goal: back to sport, wheelchair basketball (preselected in story mode). */
export const SAAD_GOAL: { goal: "sport"; sport: SportId } = {
  goal: "sport",
  sport: "wheelchair_basketball",
};

/**
 * The then and now example of the results step: the same check 4 weeks later, always shown with the
 * Example tag («مثال»). Whole degrees of elbow range in the seated shoulder press; the person's own
 * points, never a norm and never a promise.
 */
export const THEN_NOW_EXAMPLE = { start: 74, now: 88, weeks: 4 } as const;
