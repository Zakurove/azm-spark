/**
 * Results screens S50 (guest), S51 (first check) and S52 (re-test), owned by the results stream: one
 * ResultsView whose variant follows the flow (screens.ts picks the id from the mode and check kind).
 */
import type { ResultsScreenId, ScreenComponent } from "../screenTypes";
import { ResultsScreen } from "./ResultsView";

export const RESULTS_SCREENS: Record<ResultsScreenId, ScreenComponent> = {
  S50: ResultsScreen,
  S51: ResultsScreen,
  S52: ResultsScreen,
};

export { ResultCards, ResultCard } from "./ResultCards";
export { resultsModel, storedCheckModel, type ResultsModel } from "./model";
