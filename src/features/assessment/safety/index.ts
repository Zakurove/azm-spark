/**
 * Safety screens and questions S36 to S49 (owned by the safety stream), and the overlays over the
 * camera states: the stop list S41, the check in S43, "go on" S44 and the no response alarm S45.
 * Safety screens have no Back and no Exit (noExit); their only way out is their own footer.
 */
import { t } from "../../../i18n";
import { CHECK_DATA, cueLine, precheckItem, screenText } from "../../../movements/assessments";
import type { SafetyScreenId, ScreenComponent } from "../screenTypes";
import { stub } from "../shared/ScreenStub";

const safe = { noExit: true };

export const SAFETY_SCREENS: Record<SafetyScreenId, ScreenComponent> = {
  S36: stub("S36", (l) => t(l, "assessment.safety.emergency.title"), safe),
  S37: stub("S37", (l) => t(l, "assessment.safety.ad.title"), safe),
  S38: stub("S38", (l) => t(l, "assessment.safety.faint.title"), safe),
  S38b: stub("S38b", (l) => t(l, "assessment.safety.faint.title"), safe),
  S39: stub("S39", (l) => t(l, "assessment.safety.fall.title"), safe),
  S40a: stub("S40a", (l) => t(l, "assessment.safety.seekCare.title"), safe),
  S40b: stub("S40b", (l) => t(l, "assessment.safety.pain.title"), safe),
  S41: stub("S41", (l) => CHECK_DATA.stopRouting.ask[l], safe),
  S42: stub("S42", (l) => t(l, "assessment.stopDone.title")),
  S43: stub("S43", (l) => cueLine("check_are_you_ok")[l], safe),
  S44: stub("S44", (l) => t(l, "assessment.goOn.title"), safe),
  S45: stub("S45", (l) => screenText("scr_no_response", l), safe),
  S46: stub("S46", (l) => t(l, "assessment.stopDone.title")),
  S46b: stub("S46b", (l) => t(l, "assessment.guest.afterTest.title")),
  S47: stub("S47", (l) => precheckItem("bt_pain_after").ask[l]),
  S48: stub("S48", (l) => t(l, "assessment.count.ask")),
  S49: stub("S49", (l) => t(l, "assessment.symptom.kicker")),
};
