/**
 * The program page of v7 (product v7 contract 2.10, stream E, step E3): the weekly plan built from
 * the findings (POST /api/program/targets), each exercise linked to the finding behind it with its
 * why line.
 *
 * Placeholder of step A5 (contract 1.3), replaced by E3. src/app/App.tsx opens it at /?targets=1
 * for a signed in person, in a VITE_V7=1 build only.
 */
import type { Lang } from "../../app/i18n";

/** Where the program page leaves to: the portal's Today or Program tab, or the findings page. */
export type ProgramExit = "today" | "program" | "findings";

export interface ProgramPageProps {
  lang: Lang;
  onLanguage(): void;
  onExit(to: ProgramExit): void;
}

export default function ProgramPage(_props: ProgramPageProps): null {
  return null;
}
