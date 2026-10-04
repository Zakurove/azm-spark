/**
 * The A to Z showcase entry (product v7 contract F1, stream F): the fictional persona's account on
 * staging, its seeded baseline, and the way into the retest on a booth pass, the findings, the
 * program and a coached exercise, within the 10 minute showcase (D-019).
 *
 * Placeholder of step A5 (contract 1.3), replaced by F1. src/app/App.tsx opens it at /?showcase=1,
 * signed in or not, in a VITE_V7=1 build only; each exit is a full page load, so the account the
 * entry signed in is read afresh.
 */
import type { Lang } from "../../app/i18n";

/** Where the showcase entry leaves to. */
export type ShowcaseExit = "landing" | "focus" | "findings" | "program";

export interface ShowcaseEntryProps {
  lang: Lang;
  onLanguage(): void;
  onExit(to: ShowcaseExit): void;
}

export default function ShowcaseEntry(_props: ShowcaseEntryProps): null {
  return null;
}
