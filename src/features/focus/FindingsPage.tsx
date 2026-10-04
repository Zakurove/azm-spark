/**
 * The findings page (product v7 contract 1.2, stream B, step B4): the range results against normal
 * for the person's sex and age, the body map summary, the gait card slot (GaitFindingsCard, C) and
 * the targets slot (TargetsSummary, E), with the changes since the first check. It loads its own data
 * (GET /api/focus/profile).
 *
 * Placeholder of step A5 (contract 1.3), replaced by B4. src/app/App.tsx opens it at /?findings=1
 * (with &check=<id> for one check) for a signed in person, in a VITE_V7=1 build only.
 */
import type { Lang } from "../../app/i18n";

/** Where the findings page leaves to. */
export type FindingsExit = "today" | "results" | "program" | "focus";

export interface FindingsPageProps {
  lang: Lang;
  onLanguage(): void;
  /** The completed focus check to show; null shows the latest one. */
  checkId: string | null;
  /** "program" opens the program page (ProgramPage, E); "focus" starts a focus check. */
  onExit(to: FindingsExit): void;
}

export default function FindingsPage(_props: FindingsPageProps): null {
  return null;
}
