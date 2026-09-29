/**
 * Flow screens S04 to S33 and S35 (owned by the flow stream); screens.ts reads only this record.
 *
 *   S04 DesktopGate · S05 GuestWelcome · S05a AdultGate (and its end card) · S05b BoothOnly
 *   S06 to S11 GuestStep · S09 TalkToStaff · S12 Consent · S13 ContextCheck · S14 Intro
 *   S14b SoundCheck · S16 PrecheckNotice (and the O6 resume line) · S17 to S24 QuestionScreen
 *   S25 Warnings · S26 HelperBrief · S27 Plan · S28 Instruction · S29 ArmCurlQuestion (grip and the
 *   practice check) · S30 LoadChoice · S31 CameraPrimer · S32 CameraProblem · S33 Postponed
 *   S35 PausedToday
 */
import type { FlowScreenId, ScreenComponent } from "../screenTypes";
import { BoothOnly } from "./BoothOnly";
import { CameraPrimer } from "./Camera";
import { CameraProblem } from "./CameraProblem";
import { Consent, ContextCheck } from "./Consent";
import { AdultGate, DesktopGate, GuestWelcome, TalkToStaff } from "./Entry";
import { GuestStep } from "./GuestStep";
import { Instruction } from "./Instruction";
import { Intro, PrecheckNotice, SoundCheck } from "./Intro";
import { ArmCurlQuestion, LoadChoice } from "./Load";
import { PausedToday, Postponed } from "./Lock";
import { HelperBrief, Plan, Warnings } from "./Plan";
import { QuestionScreen } from "./Question";
import "./flow.css";

export const FLOW_SCREENS: Record<FlowScreenId, ScreenComponent> = {
  S04: DesktopGate,
  S05: GuestWelcome,
  S05a: AdultGate,
  S05b: BoothOnly,
  S06: GuestStep,
  S07: GuestStep,
  S08: GuestStep,
  S08b: GuestStep,
  S09: TalkToStaff,
  S10: GuestStep,
  S11: GuestStep,
  S12: Consent,
  S13: ContextCheck,
  S14: Intro,
  S14b: SoundCheck,
  S16: PrecheckNotice,
  S17: QuestionScreen,
  S18: QuestionScreen,
  S19: QuestionScreen,
  S20: QuestionScreen,
  S21: QuestionScreen,
  S22: QuestionScreen,
  S23: QuestionScreen,
  S24: QuestionScreen,
  S25: Warnings,
  S26: HelperBrief,
  S27: Plan,
  S28: Instruction,
  S29: ArmCurlQuestion,
  S30: LoadChoice,
  S31: CameraPrimer,
  S32: CameraProblem,
  S33: Postponed,
  S35: PausedToday,
};

/** The skip dialog of S28 (also opened from S34c and S34i). */
export { SkipDialog } from "./SkipDialog";
