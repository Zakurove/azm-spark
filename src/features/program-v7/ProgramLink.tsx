/**
 * The program link on the Program tab (product v7 contract 1.2 "Program page links", stream E, step
 * E3): the way to the program built from the findings (/?targets=1), and to the findings behind it.
 *
 * Placeholder of step A6 (contract 1.3, A5-12), replaced by E3: it renders nothing. src/app/App.tsx
 * renders it on the Program tab of a ready plan, before the plan card, in a VITE_V7=1 build only.
 */
import type { Lang } from "../../app/i18n";
import type { Plan } from "../../medical/plan";

export interface ProgramLinkProps {
  lang: Lang;
  /** The saved plan; `plan.weekly?.findings` is set when the week is built from the findings. */
  plan: Plan;
  /** Opens the program page (/?targets=1). */
  onOpenProgram(): void;
  /** Opens the findings page of the latest completed check. */
  onOpenFindings(): void;
}

export default function ProgramLink(_props: ProgramLinkProps): null {
  return null;
}
