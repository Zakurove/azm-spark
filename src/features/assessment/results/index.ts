/** Results screens S50 (guest), S51 (first check) and S52 (re-test), owned by the results stream. */
import { t } from "../../../i18n";
import type { ResultsScreenId, ScreenComponent } from "../screenTypes";
import { stub } from "../shared/ScreenStub";

export const RESULTS_SCREENS: Record<ResultsScreenId, ScreenComponent> = {
  S50: stub("S50", (l) => t(l, "assessment.guest.resultsTitle"), { brand: true }),
  S51: stub("S51", (l) => t(l, "assessment.results.startTitle"), { brand: true }),
  S52: stub("S52", (l) => t(l, "assessment.results.nowTitle"), { brand: true }),
};
