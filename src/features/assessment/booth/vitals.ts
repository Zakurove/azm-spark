/**
 * S56 staff vitals (pc_booth_vitals, council Q21, O47; UX spec S56): the pure rules of the form.
 *
 * Staff type two readings, each with the pulse, the systolic and the diastolic, and say whether the
 * cuff flagged an irregular heartbeat. The phone takes the mean of the two readings (Q21 (3)) and
 * hands the pre-check its answer; the Q21 limits and the O47 rows are applied by src/medical/precheck
 * (evaluatePrecheck), never here, so the screen never shows or decides a threshold.
 *
 * Input ranges (UX spec S56): pulse 30 to 250, systolic 60 to 260, diastolic 30 to 160. They only
 * catch typing slips; they are not clinical limits. Typed Arabic Indic and Persian digits and the
 * decimal marks ٫ ، , are normalised first (UX spec 0.2, parseNumberInput).
 *
 * The usual systolic of a visitor with SCI at T6 or above is never asked: the booth build does not
 * render that field (O47 (2)), so the answer never carries usualSystolic.
 */
import { parseNumberInput } from "../shared/format";

export type VitalKind = "hr" | "sys" | "dia";
export type VitalField = `${VitalKind}${1 | 2}`;

export const VITAL_FIELDS: readonly VitalField[] = ["hr1", "sys1", "dia1", "hr2", "sys2", "dia2"];

/** The typing ranges of UX spec S56 (not thresholds). */
export const VITAL_RANGES: Record<VitalKind, readonly [number, number]> = {
  hr: [30, 250],
  sys: [60, 260],
  dia: [30, 160],
};

export const kindOf = (f: VitalField): VitalKind => f.slice(0, -1) as VitalKind;

export type VitalsInput = Record<VitalField, string>;

export const EMPTY_VITALS: VitalsInput = { hr1: "", sys1: "", dia1: "", hr2: "", sys2: "", dia2: "" };

/** A typed value: its number when it is inside the field's range, else why not. */
export type VitalParse = { ok: true; value: number } | { ok: false; error: "empty" | "range" };

export function parseVital(field: VitalField, raw: string): VitalParse {
  if (raw.trim() === "") return { ok: false, error: "empty" };
  const n = parseNumberInput(raw);
  const [min, max] = VITAL_RANGES[kindOf(field)];
  if (n === null || n < min || n > max) return { ok: false, error: "range" };
  return { ok: true, value: n };
}

/** The answer of pc_booth_vitals (src/medical/precheck.ts, the staff entry format). */
export interface VitalsAnswer {
  systolic1: number;
  diastolic1: number;
  systolic2: number;
  diastolic2: number;
  /** The mean of the two pulse readings (Q21 (3): the mean of two readings is used). */
  restingHeartRate: number;
  irregularHeartbeat: boolean;
}

export const mean = (a: number, b: number) => (a + b) / 2;

export interface VitalsCheck {
  /** Fields that are empty or outside their range, in form order. */
  invalid: VitalField[];
  /** The irregular heartbeat question has no answer. */
  irregularMissing: boolean;
  /** The answer, when every field is valid and the irregular question is answered. */
  answer: VitalsAnswer | null;
}

/** Validates the whole form (Continue): every field, then the irregular heartbeat answer. */
export function checkVitals(input: VitalsInput, irregular: boolean | null): VitalsCheck {
  const values: Partial<Record<VitalField, number>> = {};
  const invalid: VitalField[] = [];
  for (const f of VITAL_FIELDS) {
    const p = parseVital(f, input[f]);
    if (p.ok) values[f] = p.value;
    else invalid.push(f);
  }
  const irregularMissing = irregular === null;
  if (invalid.length > 0 || irregularMissing) return { invalid, irregularMissing, answer: null };
  const v = values as Record<VitalField, number>;
  return {
    invalid,
    irregularMissing,
    answer: {
      systolic1: v.sys1,
      diastolic1: v.dia1,
      systolic2: v.sys2,
      diastolic2: v.dia2,
      restingHeartRate: mean(v.hr1, v.hr2),
      irregularHeartbeat: irregular === true,
    },
  };
}

/** The means shown read only once both readings of a kind are valid (null until then). */
export function meansOf(input: VitalsInput): Record<VitalKind, number | null> {
  const pair = (k: VitalKind) => {
    const a = parseVital(`${k}1`, input[`${k}1`]);
    const b = parseVital(`${k}2`, input[`${k}2`]);
    return a.ok && b.ok ? mean(a.value, b.value) : null;
  };
  return { hr: pair("hr"), sys: pair("sys"), dia: pair("dia") };
}

/** A typed field keeps digits and one decimal mark only (the field shows back what was typed). */
export function cleanTyped(raw: string): string {
  return raw.replace(/[^\d٠-٩۰-۹٫،,.]/g, "").slice(0, 6);
}
