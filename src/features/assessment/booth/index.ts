/**
 * Booth screens S55 to S58 (owned by the booth stream). S55 staff mode is its own page (/?booth=1,
 * rendered by App.tsx); S56 (the staff vitals entry, pc_booth_vitals), S55b, S57 and S58 are reached
 * from the flow.
 */
import { t } from "../../../i18n";
import type { BoothScreenId, ScreenComponent } from "../screenTypes";
import { stub } from "../shared/ScreenStub";

export const BOOTH_SCREENS: Record<BoothScreenId, ScreenComponent> = {
  S55: stub("S55", (l) => t(l, "assessment.booth.title")),
  S55b: stub("S55b", (l) => t(l, "assessment.booth.tokenOn")),
  S56: stub("S56", (l) => t(l, "assessment.vitals.title")),
  S57: stub("S57", (l) => t(l, "assessment.booth.idleTitle")),
  S58: stub("S58", (l) => t(l, "assessment.tips.title")),
};

export { BoothStaffPage, type BoothStaffPageProps } from "./BoothStaffPage";
