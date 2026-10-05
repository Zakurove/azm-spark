/**
 * The intake corpus of stream E's pool tests (product v7 contract 2.10 rule 3): every v1 condition,
 * mobility, pain area set, restriction set and equipment set in combination, and the same intakes
 * again with v7 fields (sex, walking, the body map and the safety answers), each with one of a cycle
 * of body maps and answers. Deterministic, so the pool of each intake can be pinned. Not a test file.
 */
import type { Intake } from "../../src/medical/plan";
import { painIdsFromRegions, type RegionEntry, type RomIntakeFlags } from "../../src/medical/body-map";

export const base: Intake = {
  age: 52,
  conditions: ["none"],
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
  time: "18:00",
  sessionMinutes: 30,
  consent: true,
};

/** A v1 intake (no v7 field). */
export const v1 = (over: Partial<Intake> = {}): Intake => ({ ...base, ...over });

/** A v7 intake: the v1 answers, sex, walking without an aid, an empty body map and no flag. */
export const v7 = (over: Partial<Intake> = {}): Intake => {
  const h: Intake = {
    ...base,
    sex: "female",
    walking: { status: "without_aid" },
    regions: [],
    romFlags: { osteoporosis: false, neckCaution: false },
    ...over,
  };
  // The pain mirror (contract 2.2 rule 3): pain and injury entries keep their v1 pain area.
  const mirror = painIdsFromRegions(h.regions ?? []).filter((p) => !h.pain.includes(p));
  return mirror.length ? { ...h, pain: [...h.pain, ...mirror] } : h;
};

export const entry = (
  region: RegionEntry["region"],
  side: RegionEntry["side"],
  problems: RegionEntry["problems"],
  extra: Partial<RegionEntry> = {},
): RegionEntry => ({ region, side, problems, origin: "person", ...extra });

/** A hip replacement in the last 6 weeks, cleared, with the limits the person was told. */
export const hipReplacement = (
  hipAvoid?: NonNullable<RegionEntry["surgery"]>["hipAvoid"],
  side: "left" | "right" = "right",
): RegionEntry =>
  entry("hip", side, ["after_surgery"], {
    surgery: {
      since: "lt6w",
      cleared: "yes",
      avoid: [],
      hipReplacement: true,
      ...(hipAvoid ? { hipAvoid } : {}),
      stretchAllowed: "yes",
      loadAllowed: "yes",
    },
  });

const CONDITION_SETS: string[][] = [
  ["none"],
  ["stroke"],
  ["ms"],
  ["cerebral_palsy"],
  ["sci_complete"],
  ["sci_incomplete"],
  ["parkinsons"],
  ["lower_limb_unilateral"],
  ["upper_limb_unilateral"],
  ["arthritis"],
  ["cfs_moderate"],
  ["cardiac"],
  ["other"],
  ["stroke", "arthritis"],
  ["parkinsons", "arthritis"],
];
const MOBILITY: Intake["mobility"][] = ["standing", "seated", "wheelchair", "bed"];
const PAIN: string[][] = [[], ["shoulder"], ["back", "knee"], ["hip"], ["wrist", "elbow"]];
const RESTRICTIONS: string[][] = [
  [],
  ["no_overhead"],
  ["no_weight_bearing"],
  ["balance_support"],
  ["no_resistance"],
  ["no_overhead", "balance_support"],
];
const EQUIPMENT: string[][] = [[], ["weights", "bands"]];

/** The v7 answers the v7 copy of each intake takes in turn. */
const V7_VARIANTS: { name: string; over: Partial<Intake> }[] = [
  { name: "no regions", over: {} },
  { name: "hip replacement, limits not given", over: { regions: [hipReplacement()] } },
  { name: "hip replacement, no limits", over: { regions: [hipReplacement(["none"])] } },
  { name: "hip replacement, bend past 90", over: { regions: [hipReplacement(["flex90"])] } },
  { name: "hip replacement, leg back", over: { regions: [hipReplacement(["back_out"], "left")] } },
  {
    name: "knee injury 3 weeks ago",
    over: { regions: [entry("knee", "left", ["injury"], { injury: { since: "lt6w" } })] },
  },
  {
    name: "neck surgery 2 months ago, not cleared",
    over: {
      regions: [entry("neck", "axial", ["after_surgery"], { surgery: { since: "6w_3m", cleared: "no" } })],
    },
  },
  {
    name: "Achilles tear 4 months ago",
    over: {
      regions: [entry("ankle_foot", "right", ["injury"], { injury: { since: "3m_6m", achilles: true } })],
    },
  },
  {
    name: "osteoporosis and a stiff back",
    over: {
      regions: [entry("back_trunk", "axial", ["stiffness"])],
      romFlags: { osteoporosis: true, neckCaution: false },
    },
  },
  {
    name: "neck caution, does not sit unsupported",
    over: { romFlags: { osteoporosis: false, neckCaution: true, sitUnsupported: "no" } },
  },
  {
    name: "weak right ankle that cannot lift the foot",
    over: {
      regions: [entry("ankle_foot", "right", ["weakness"])],
      romFlags: { osteoporosis: false, neckCaution: false, footLift: { right: false } },
    },
  },
  {
    name: "below knee limb loss, walks with a cane",
    over: {
      regions: [entry("knee", "left", ["limb_loss"], { limbLoss: { level: "below_knee" } })],
      walking: { status: "with_aid", aid: "cane" },
    },
  },
  { name: "does not walk", over: { walking: { status: "no" } } },
];

export interface CorpusIntake {
  key: string;
  h: Intake;
}

/** Every v1 combination, then the same intakes with v7 fields (mobility bed walks no). */
export function corpus(): CorpusIntake[] {
  const out: CorpusIntake[] = [];
  for (const conditions of CONDITION_SETS)
    for (const mobility of MOBILITY)
      for (const pain of PAIN)
        for (const restrictions of RESTRICTIONS)
          for (const equipment of EQUIPMENT) {
            const over = { conditions, mobility, pain, restrictions, equipment };
            const key = JSON.stringify(over);
            out.push({ key: `v1 ${key}`, h: v1(over) });
          }
  const v1Count = out.length;
  for (let i = 0; i < v1Count; i++) {
    const { h } = out[i];
    const variant = V7_VARIANTS[i % V7_VARIANTS.length];
    const v7h = v7({ ...h, ...variant.over });
    const walking = v7h.mobility === "bed" ? { walking: { status: "no" as const } } : {};
    out.push({ key: `${out[i].key.replace(/^v1 /, "v7 ")} ${variant.name}`, h: { ...v7h, ...walking } });
  }
  return out;
}

export const flags = (over: Partial<RomIntakeFlags> = {}): RomIntakeFlags => ({
  osteoporosis: false,
  neckCaution: false,
  ...over,
});
