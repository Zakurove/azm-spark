/**
 * Para sports and what they ask of the body (booth v2, contract B1). The goal «العودة إلى الرياضة»
 * names one of these sports; the rules still decide which exercises are safe, and the sport's demands
 * only weight which of the safe exercises are chosen (weekly.ts). The demand tags are also on every
 * library exercise (library.json `demands`), so a week can be read back as "what builds what" (the
 * sport path card on the Program page and the booth).
 *
 * The icons are placeholders (SportIcon.tsx glyphs) until the illustrated set arrives; an icon that
 * starts with "/" is read as an image path, so the set can replace them here without a code change.
 */

export type L = { ar: string; en: string };

export const SPORT_IDS = [
  "wheelchair_basketball",
  "para_athletics",
  "para_powerlifting",
  "boccia",
  "wheelchair_tennis",
  "para_table_tennis",
  "sitting_volleyball",
  "para_swimming",
  "para_archery",
  "handcycling",
  "wheelchair_fencing",
  "wheelchair_rugby",
  "para_badminton",
] as const;
export type SportId = (typeof SPORT_IDS)[number];

export const DEMAND_TAGS = [
  "shoulder_endurance",
  "pushing_power",
  "pressing_strength",
  "trunk_control",
  "trunk_rotation",
  "grip_and_arm",
  "cardio",
  "flexibility",
] as const;
export type DemandTag = (typeof DEMAND_TAGS)[number];

export type SportPosition = "wheelchair" | "seated" | "standing";

export interface Sport {
  id: SportId;
  name: L;
  demands: DemandTag[];
  suits: SportPosition[];
  icon: string;
}

export const DEMANDS: Record<DemandTag, L> = {
  shoulder_endurance: { ar: "تحمّل الكتفين", en: "Shoulder endurance" },
  pushing_power: { ar: "قوة الدفع", en: "Pushing power" },
  pressing_strength: { ar: "قوة الضغط", en: "Pressing strength" },
  trunk_control: { ar: "ثبات الجذع", en: "Trunk control" },
  trunk_rotation: { ar: "دوران الجذع", en: "Trunk rotation" },
  grip_and_arm: { ar: "قبضة اليد وقوة الذراع", en: "Grip and arm strength" },
  cardio: { ar: "لياقة القلب والتنفّس", en: "Heart and breathing fitness" },
  flexibility: { ar: "المرونة", en: "Flexibility" },
};

export const SPORTS: Sport[] = [
  {
    id: "wheelchair_basketball",
    name: { ar: "كرة السلة على الكراسي المتحركة", en: "Wheelchair basketball" },
    demands: ["shoulder_endurance", "pushing_power", "trunk_control", "grip_and_arm", "cardio"],
    suits: ["wheelchair", "seated"],
    icon: "wheelchair_basketball",
  },
  {
    id: "para_athletics",
    name: { ar: "ألعاب القوى البارالمبية", en: "Para athletics" },
    demands: ["pushing_power", "shoulder_endurance", "trunk_control", "cardio"],
    suits: ["wheelchair", "seated", "standing"],
    icon: "para_athletics",
  },
  {
    id: "para_powerlifting",
    name: { ar: "رفع الأثقال البارالمبي", en: "Para powerlifting" },
    demands: ["pressing_strength", "grip_and_arm", "trunk_control", "flexibility"],
    suits: ["wheelchair", "seated", "standing"],
    icon: "para_powerlifting",
  },
  {
    id: "boccia",
    name: { ar: "البوتشيا", en: "Boccia" },
    demands: ["trunk_control", "trunk_rotation", "grip_and_arm", "flexibility"],
    suits: ["wheelchair", "seated"],
    icon: "boccia",
  },
  {
    id: "wheelchair_tennis",
    name: { ar: "التنس على الكراسي المتحركة", en: "Wheelchair tennis" },
    demands: ["trunk_rotation", "shoulder_endurance", "pushing_power", "grip_and_arm", "cardio"],
    suits: ["wheelchair", "seated"],
    icon: "wheelchair_tennis",
  },
  {
    id: "para_table_tennis",
    name: { ar: "كرة الطاولة البارالمبية", en: "Para table tennis" },
    demands: ["trunk_rotation", "trunk_control", "grip_and_arm", "flexibility"],
    suits: ["wheelchair", "seated", "standing"],
    icon: "para_table_tennis",
  },
  {
    id: "sitting_volleyball",
    name: { ar: "الكرة الطائرة جلوسًا", en: "Sitting volleyball" },
    demands: ["trunk_control", "trunk_rotation", "shoulder_endurance", "flexibility"],
    suits: ["seated", "standing"],
    icon: "sitting_volleyball",
  },
  {
    id: "para_swimming",
    name: { ar: "السباحة البارالمبية", en: "Para swimming" },
    demands: ["shoulder_endurance", "cardio", "trunk_control", "flexibility"],
    suits: ["wheelchair", "seated", "standing"],
    icon: "para_swimming",
  },
  {
    id: "para_archery",
    name: { ar: "الرماية بالقوس البارالمبية", en: "Para archery" },
    demands: ["trunk_control", "shoulder_endurance", "grip_and_arm"],
    suits: ["wheelchair", "seated", "standing"],
    icon: "para_archery",
  },
  {
    id: "handcycling",
    name: { ar: "الدراجات اليدوية", en: "Handcycling" },
    demands: ["pushing_power", "cardio", "shoulder_endurance", "grip_and_arm"],
    suits: ["wheelchair", "seated"],
    icon: "handcycling",
  },
  {
    id: "wheelchair_fencing",
    name: { ar: "المبارزة على الكراسي المتحركة", en: "Wheelchair fencing" },
    demands: ["trunk_rotation", "trunk_control", "grip_and_arm", "shoulder_endurance"],
    suits: ["wheelchair", "seated"],
    icon: "wheelchair_fencing",
  },
  {
    id: "wheelchair_rugby",
    name: { ar: "الرجبي على الكراسي المتحركة", en: "Wheelchair rugby" },
    demands: ["pushing_power", "cardio", "trunk_control", "shoulder_endurance"],
    suits: ["wheelchair"],
    icon: "wheelchair_rugby",
  },
  {
    id: "para_badminton",
    name: { ar: "الريشة الطائرة البارالمبية", en: "Para badminton" },
    demands: ["trunk_rotation", "shoulder_endurance", "cardio", "flexibility"],
    suits: ["wheelchair", "seated", "standing"],
    icon: "para_badminton",
  },
];

/** What each camera movement builds (the camera ids of defs.ts; the library tags its own exercises). */
export const CAMERA_DEMANDS: Record<string, DemandTag[]> = {
  seated_shoulder_press: ["pressing_strength", "shoulder_endurance"],
  seated_biceps_curl: ["grip_and_arm"],
  sit_to_stand: ["trunk_control"],
};

export const isSportId = (v: unknown): v is SportId =>
  typeof v === "string" && (SPORT_IDS as readonly string[]).includes(v);

export const sportById = (id: unknown): Sport | undefined =>
  isSportId(id) ? SPORTS.find((s) => s.id === id) : undefined;

/**
 * The sports in the grid for a position: those that suit it first, the others after, each group in
 * the contract's order. "bed" and an unanswered position keep the contract's order.
 */
export function sportsFor(position: string): Sport[] {
  const fits = (s: Sport) => (s.suits as string[]).includes(position);
  return [...SPORTS.filter(fits), ...SPORTS.filter((s) => !fits(s))];
}
