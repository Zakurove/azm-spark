/**
 * The focus check (product v7 contract 1.2, stream B, step B3): the shell that runs a protocol end
 * to end: the v1 pre-check through the bridge, the today questions with rf_region, the range blocks
 * in C-13 order with the stop list and sit before stand, the gait step (GaitStep, C) and the
 * complete call, then the findings. It loads its own data (GET /api/focus/context) and implements
 * CoachHost for the range blocks (C-16).
 *
 * Placeholder of step A5 (contract 1.3), replaced by B3. src/app/App.tsx opens it at /?focus=1 for a
 * signed in person, in a VITE_V7=1 build only.
 */
import type { Lang } from "../../app/i18n";

/** Where the focus check leaves to. */
export type FocusExit = "today" | "findings" | "health";

export interface FocusAppProps {
  lang: Lang;
  onLanguage(): void;
  /** The signed in person's id: the owner of the check's waiting calls, as in the v1 check. */
  owner: string;
  /**
   * Leaves the focus check: "findings" after a completed check, "health" to answer the v7 intake
   * questions (409 INTAKE_UPDATE_REQUIRED), else "today".
   */
  onExit(to: FocusExit): void;
}

export default function FocusApp(_props: FocusAppProps): null {
  return null;
}
