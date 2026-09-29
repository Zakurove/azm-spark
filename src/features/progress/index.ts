/**
 * Progress stream screens for App.tsx (owned by the results and progress stream): the Today slot (S01
 * with S03), the offer after the intake (S02), the results page S53 (nav "My results") and the example
 * S54. App.tsx imports only this file; the props are the slot contract.
 */
export {
  AfterIntakeOffer,
  EntryCard,
  NextDayQuestion,
  TodayCheckSlot,
  type AfterIntakeOfferProps,
  type CheckStartOptions,
  type NextDayQuestionProps,
  type TodayCheckSlotProps,
} from "./EntryCards";
export { ResultsPage, type ResultsPageProps } from "./ResultsPage";
export { ExampleProgress, type ExampleProgressProps } from "./ExamplePage";
