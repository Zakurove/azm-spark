/**
 * The screen contract between CheckApp and the screen folders (round 3 foundation).
 *
 * Each folder owns its screens and exports them from its index.ts as a record keyed by screen id:
 *   flow/     S04 to S33 and S35 (guest steps, consent, intro, pre-check, preparation, postponed)
 *   camera/   S34 (the camera sequence of one test)
 *   safety/   S36 to S49 (safety screens, stop list, check in, alarm, skip notice, S47 to S49)
 *   results/  S50 to S52
 *   booth/    S55 to S58
 * src/features/progress/ exports S01, S02, S03, S53 and S54 for App.tsx.
 * screens.ts maps flow states to these ids and imports only the folder index files, so parallel
 * streams never edit the same file.
 */
import type { ComponentType } from "react";
import type { CheckApi } from "./api";
import type { FlowEvent, FlowModel } from "./flowMachine";

export const FLOW_SCREEN_IDS = [
  "S04",
  "S05",
  "S05a",
  "S05b",
  "S06",
  "S07",
  "S08",
  "S08b",
  "S09",
  "S10",
  "S11",
  "S12",
  "S13",
  "S14",
  "S14b",
  "S16",
  "S17",
  "S18",
  "S19",
  "S20",
  "S21",
  "S22",
  "S23",
  "S24",
  "S25",
  "S26",
  "S27",
  "S28",
  "S29",
  "S30",
  "S31",
  "S32",
  "S33",
  "S35",
] as const;
export const CAMERA_SCREEN_IDS = ["S34"] as const;
export const SAFETY_SCREEN_IDS = [
  "S36",
  "S37",
  "S38",
  "S38b",
  "S39",
  "S40a",
  "S40b",
  "S41",
  "S42",
  "S43",
  "S44",
  "S45",
  "S46",
  "S46b",
  "S47",
  "S48",
  "S49",
] as const;
export const RESULTS_SCREEN_IDS = ["S50", "S51", "S52"] as const;
export const BOOTH_SCREEN_IDS = ["S55", "S55b", "S56", "S57", "S58"] as const;
export const PROGRESS_SCREEN_IDS = ["S01", "S02", "S03", "S53", "S54"] as const;

export type FlowScreenId = (typeof FLOW_SCREEN_IDS)[number];
export type CameraScreenId = (typeof CAMERA_SCREEN_IDS)[number];
export type SafetyScreenId = (typeof SAFETY_SCREEN_IDS)[number];
export type ResultsScreenId = (typeof RESULTS_SCREEN_IDS)[number];
export type BoothScreenId = (typeof BOOTH_SCREEN_IDS)[number];
export type ProgressScreenId = (typeof PROGRESS_SCREEN_IDS)[number];
/** Screens rendered by CheckApp from the flow state. */
export type CheckScreenId = FlowScreenId | CameraScreenId | SafetyScreenId | ResultsScreenId | BoothScreenId;

/** Overlays rendered over a state: S15 (shared), the skip dialog (flow, S28), S41 S43 S44 S45 (safety). */
export type OverlayId = "S15" | "skipDialog" | "S41" | "S43" | "S44" | "S45";

/** What CheckApp passes to every screen of the flow. Language, booth mode and sound come from useCheckUi. */
export interface ScreenProps {
  model: FlowModel;
  dispatch: (event: FlowEvent) => void;
  api: CheckApi;
  /** S32 Try again: keeps the flow and reloads so the browser asks for the camera again. */
  retryCamera(): void;
  /** The save error's Try again (S50 to S52): sends what waits in the check's outbox now. */
  retrySave(): void;
}

export type ScreenComponent = ComponentType<ScreenProps>;
