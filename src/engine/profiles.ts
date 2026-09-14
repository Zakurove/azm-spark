import { ImpairmentProfile, LM } from "./types";

export const PROFILES: ImpairmentProfile[] = [
  {
    id: "wheelchair",
    unscoredRegions: ["lower_limbs"],
    seated: true,
  },
  {
    id: "hemiparesis_left",
    unscoredRegions: [],
    expectedAsymmetry: "left",
    seated: false,
  },
  {
    id: "hemiparesis_right",
    unscoredRegions: [],
    expectedAsymmetry: "right",
    seated: false,
  },
  {
    id: "standing",
    unscoredRegions: [],
    seated: false,
  },
];

export const LOWER_LIMB_LANDMARKS = [LM.l_hip, LM.r_hip, LM.l_knee, LM.r_knee, LM.l_ankle, LM.r_ankle];
export const LEFT_ARM_LANDMARKS = [LM.l_elbow, LM.l_wrist];
export const RIGHT_ARM_LANDMARKS = [LM.r_elbow, LM.r_wrist];

/** Landmarks excluded from scoring for a profile (rendered dimmed, never cause flags). */
export function unscoredLandmarks(p: ImpairmentProfile): number[] {
  const out: number[] = [];
  for (const r of p.unscoredRegions) {
    if (r === "lower_limbs") out.push(LM.l_knee, LM.r_knee, LM.l_ankle, LM.r_ankle);
    if (r === "left_arm") out.push(...LEFT_ARM_LANDMARKS);
    if (r === "right_arm") out.push(...RIGHT_ARM_LANDMARKS);
  }
  return out;
}

export function profileById(id: string): ImpairmentProfile {
  const p = PROFILES.find((x) => x.id === id);
  if (!p) throw new Error(`unknown profile ${id}`);
  return p;
}
