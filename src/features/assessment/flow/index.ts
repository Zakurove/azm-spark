/**
 * Flow screens S04 to S33 and S35 (owned by the flow stream). Replace a stub by pointing its id at
 * the real component; screens.ts reads only this record.
 */
import type { FlowScreenId, ScreenComponent } from "../screenTypes";
import { BoothOnly } from "./BoothOnly";
import { CameraProblem } from "./CameraProblem";
import * as S from "./stubs";

export const FLOW_SCREENS: Record<FlowScreenId, ScreenComponent> = {
  S04: S.S04,
  S05: S.S05,
  S05a: S.S05a,
  S05b: BoothOnly,
  S06: S.S06,
  S07: S.S07,
  S08: S.S08,
  S08b: S.S08b,
  S09: S.S09,
  S10: S.S10,
  S11: S.S11,
  S12: S.S12,
  S13: S.S13,
  S14: S.S14,
  S14b: S.S14b,
  S16: S.S16,
  S17: S.S17,
  S18: S.S18,
  S19: S.S19,
  S20: S.S20,
  S21: S.S21,
  S22: S.S22,
  S23: S.S23,
  S24: S.S24,
  S25: S.S25,
  S26: S.S26,
  S27: S.S27,
  S28: S.S28,
  S29: S.S29,
  S30: S.S30,
  S31: S.S31,
  S32: CameraProblem,
  S33: S.S33,
  S35: S.S35,
};

/** The skip dialog of S28 (also opened from S34c and S34i). */
export { SkipDialogStub as SkipDialog } from "./SkipDialog";
