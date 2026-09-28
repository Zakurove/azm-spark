/**
 * The screen registry: which screen shows for each flow state (UX spec Appendix A, second column).
 * It imports only the folder index files, so the parallel streams (flow, camera, safety, results,
 * booth) each edit their own index and never this file.
 */
import { BOOTH_SCREENS } from "./booth";
import { CAMERA_SCREENS } from "./camera";
import { FLOW_SCREENS, SkipDialog } from "./flow";
import { questionOf, type FlowModel, type SafetyKind } from "./flowMachine";
import { RESULTS_SCREENS } from "./results";
import { SAFETY_SCREENS } from "./safety";
import type { CheckScreenId, OverlayId, ScreenComponent } from "./screenTypes";

export const SCREENS: Record<CheckScreenId, ScreenComponent> = {
  ...FLOW_SCREENS,
  ...CAMERA_SCREENS,
  ...SAFETY_SCREENS,
  ...RESULTS_SCREENS,
  ...BOOTH_SCREENS,
};

/** Overlays other than S15 (the leave dialog is shared and rendered by CheckApp). */
export const OVERLAYS: Record<Exclude<OverlayId, "S15">, ScreenComponent> = {
  skipDialog: SkipDialog,
  S41: SAFETY_SCREENS.S41,
  S43: SAFETY_SCREENS.S43,
  S44: SAFETY_SCREENS.S44,
  S45: SAFETY_SCREENS.S45,
};

const GUEST_STEP_SCREENS = ["S06", "S07", "S08", "S08b", "S10", "S11"] as const;

const SAFETY_SCREEN: Record<SafetyKind, CheckScreenId> = {
  emergency: "S36",
  ad: "S37",
  faint: "S38",
  fall: "S39",
  seekCare: "S40a",
  pain: "S40b",
};

/** The question screen of a pre-check question id, by its data type (S17 to S24; S56 for vitals). */
export function questionScreen(id: string): CheckScreenId {
  const q = questionOf(id);
  switch (q?.item.type) {
    case "yes_no":
      return "S17";
    case "yes_no_unsure":
      return "S18";
    case "scale_0_10":
      return "S19";
    case "area_scale_0_10":
      return "S20";
    case "single":
      return "S21";
    case "list_confirm":
      return "S22";
    case "three_yes_no":
      return "S23";
    case "yes_no_then_areas":
      return "S24";
    case "system":
      return "S56";
    default:
      return "S17";
  }
}

/** The screen of the model's current state, or null for entry (loading) and exit. */
export function screenFor(m: FlowModel): CheckScreenId | null {
  const s = m.state;
  switch (s.kind) {
    case "entry":
    case "exit":
      return null;
    case "boothOnly":
      return "S05b";
    case "desktopGate":
      return "S04";
    case "guestWelcome":
      return "S05";
    case "adultGate":
    case "adultEnd":
      return "S05a";
    case "guestSetup":
      return GUEST_STEP_SCREENS[s.step - 1];
    case "guestStaff":
      return "S09";
    case "consent":
      return "S12";
    case "context":
      return "S13";
    case "resumeNotice":
      // O6 (2): the resume line on the notice screen, before the sound check and the re-ask.
      return "S16";
    case "intro":
      return "S14";
    case "soundCheck":
      return "S14b";
    case "precheckNotice":
      return "S16";
    case "question":
      return questionScreen(s.id);
    case "starting":
      return s.lastQuestion ? questionScreen(s.lastQuestion) : "S27";
    case "warnings":
      return "S25";
    case "plan":
      return "S27";
    case "test.instruction":
      return "S28";
    case "test.grip":
    case "test.practiceCheck":
      return "S29";
    case "test.load":
      return "S30";
    case "test.helper":
      return "S26";
    case "test.primer":
      return "S31";
    case "cam.setup":
    case "cam.calibrate":
    case "cam.practice":
    case "cam.countdown":
    case "cam.measure":
    case "cam.saved":
    case "cam.retry":
    case "cam.rest":
      return "S34";
    case "after.contact":
    case "after.pushed":
    case "after.count":
      return "S48";
    case "between":
      return "S47";
    case "skipNotice":
      return "S46";
    case "guestAfterTest":
      return "S46b";
    case "stopDone":
      return "S42";
    case "faintAsk":
      return "S38b";
    case "endQuestion":
      return "S49";
    case "safety":
      return SAFETY_SCREEN[s.safety];
    case "postponed":
      return "S33";
    case "paused":
      return "S35";
    case "cam.problem":
      return "S32";
    case "results":
      return m.data.config.mode === "guest" ? "S50" : m.data.checkKind === "retest" ? "S52" : "S51";
  }
}

/** The overlay shown over the current state, if any. */
export function overlayFor(m: FlowModel): OverlayId | null {
  switch (m.overlay?.kind) {
    case undefined:
      return null;
    case "leave":
      return "S15";
    case "skipDialog":
      return "skipDialog";
    case "stopList":
      return "S41";
    case "checkIn":
      return "S43";
    case "goOn":
      return "S44";
    case "alarm":
      return "S45";
  }
}
