// Demand tags of the library (booth v2, contract B2): a first pass by script from category and muscles,
// then the hand review in OVERRIDES, which is the final word for each exercise it names. Idempotent:
//   node scripts/library-demands.mjs src/exercises/library.json
import { readFileSync, writeFileSync } from "node:fs";
const FILE = process.argv[2];
const lib = JSON.parse(readFileSync(FILE, "utf8"));

function byScript(e) {
  const m = new Set(e.muscles), out = new Set();
  const name = e.name.en.toLowerCase();
  if (e.category === "flexibility") out.add("flexibility");
  if (e.category === "core" || e.category === "balance") out.add("trunk_control");
  if (m.has("obliques") && /twist|rotation|bicycle/.test(name)) out.add("trunk_rotation");
  if (e.category === "upper_body") {
    if (/press/.test(name)) out.add("pressing_strength");
    if (m.has("shoulders") && !/press/.test(name)) out.add("shoulder_endurance");
    if (m.has("triceps") || m.has("chest")) out.add("pushing_power");
    if (m.has("biceps") || m.has("forearms")) out.add("grip_and_arm");
    if (m.has("back")) out.add("shoulder_endurance");
  }
  return out;
}

// Hand review (tech lead, 3 Oct 2026): what each exercise actually builds for a para sport.
const OVERRIDES = {
  seated_shoulder_press: ["pressing_strength", "shoulder_endurance"],
  chest_press: ["pressing_strength", "pushing_power"],
  seated_arnold_press: ["pressing_strength", "shoulder_endurance"],
  wall_push_ups: ["pushing_power", "pressing_strength"],
  resistance_band_rows: ["shoulder_endurance", "grip_and_arm"],
  seated_dumbbell_row: ["shoulder_endurance", "grip_and_arm"],
  reverse_flys: ["shoulder_endurance"],
  seated_tricep_extensions: ["pushing_power"],
  overhead_tricep_extension: ["pushing_power"],
  tricep_kickbacks: ["pushing_power"],
  core_breathing_exercise: ["trunk_control"],
  seated_torso_rotation: ["trunk_rotation", "trunk_control"],
  seated_bicycle: ["trunk_rotation", "cardio"],
  seated_oblique_twist: ["trunk_rotation", "trunk_control"],
  side_bend: ["trunk_control"],
  pelvic_tilts: ["trunk_control", "flexibility"],
  arm_circles: ["flexibility", "shoulder_endurance"],
  seated_spinal_twist: ["flexibility", "trunk_rotation"],
  finger_stretches: ["flexibility", "grip_and_arm"],
  seated_marching: ["cardio"],
  seated_knee_lifts: ["trunk_control", "cardio"],
  seated_calf_stretch: ["flexibility"],
  seated_reach: ["trunk_control", "flexibility"],
  // Leg strength builds none of the eight demands: these stay untagged and are never sport weighted.
  seated_leg_extensions: [],
  heel_raises: [],
  toe_raises: [],
  seated_hip_abduction: [],
  seated_hip_adduction: [],
  leg_press_with_band: [],
  glute_squeeze: [],
  hamstring_curl_with_band: [],
};

const ORDER = ["shoulder_endurance","pushing_power","pressing_strength","trunk_control","trunk_rotation","grip_and_arm","cardio","flexibility"];
const out = lib.map((e) => {
  const tags = OVERRIDES[e.id] ?? [...byScript(e)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const { contraindications, demands: _old, ...rest } = e;
  return { ...rest, demands: tags, contraindications };
});
writeFileSync(FILE, JSON.stringify(out, null, 1) + "\n");
for (const e of out) console.log(e.id.padEnd(30), e.category.padEnd(12), (OVERRIDES[e.id] ? "hand  " : "script"), JSON.stringify(e.demands));
