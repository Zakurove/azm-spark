/**
 * Booth screens S55 to S58 (owned by the booth stream; UX spec S55 to S58, contract v3 I, council Q19,
 * Q21, O15, O17, O18, O47).
 *
 *   S55   BoothStaffPage       /?booth=1: the staff code, booth mode on, the visitor QR, offline, off
 *   S55b  VisitorTokenPage     /?boothToken=: redeem the one check token; TokenEndedCard after it ends
 *   S56   StaffVitals          pc_booth_vitals in the pre-check: staff code, two readings, the means
 *   S57   BoothLayer           staff reset (badge press, shortcut) and idle reset over every screen;
 *         NewVisitorButton     S50; StaffCountCorrection on S34h; startNextVisitor
 *   S58   SetupTipsView        the setup tips, opened in place (SetupTipsScreen in the registry);
 *         SetupTipsList        the same tips in the camera screen's sheet (S34c, S34i)
 *   5.9   QrCode, QrLink       QR codes drawn on the phone (S55 visitor token, S50 register code)
 *   5.10  useBoothMode         this tab's booth mode, its end, and the ended visitor token
 */
import type { BoothScreenId, ScreenComponent } from "../screenTypes";
import { NewVisitorScreen, StaffEntryScreen, TokenStatusScreen } from "./BoothScreens";
import { SetupTipsScreen } from "./SetupTips";
import { StaffVitals } from "./StaffVitals";

export const BOOTH_SCREENS: Record<BoothScreenId, ScreenComponent> = {
  S55: StaffEntryScreen,
  S55b: TokenStatusScreen,
  S56: StaffVitals,
  S57: NewVisitorScreen,
  S58: SetupTipsScreen,
};

export { BoothStaffPage, type BoothStaffPageProps } from "./BoothStaffPage";
export { VisitorTokenPage, TokenEndedCard, type VisitorTokenPageProps } from "./VisitorTokenPage";
export { StaffVitals } from "./StaffVitals";
export {
  BoothLayer,
  NewVisitorButton,
  ResetDialog,
  startNextVisitor,
  type BoothLayerProps,
} from "./BoothLayer";
export { StaffCountCorrection, type StaffCountCorrectionProps } from "./StaffCountCorrection";
export { SetupTipsList, SetupTipsView, SetupTipsScreen, tipOrder, usesWheelchair } from "./SetupTips";
export { QrCode, QrLink, type QrCodeProps, type QrLinkProps } from "../shared/QrCode";
export { useBoothMode, boothModeState, type BoothModeState } from "./useBoothMode";
