/**
 * What the program works on, on the findings page (product v7 contract 2.10, stream E, step E3): the
 * targets of a completed focus check with their why lines and a link to the program.
 *
 * Placeholder of step A5 (contract 1.3), replaced by E3: it renders nothing. The findings page (B4)
 * renders it in its targets slot.
 */
import type { Lang } from "../../app/i18n";

export interface TargetsSummaryProps {
  lang: Lang;
  /** The completed focus check whose findings the targets come from. */
  checkId: string;
  /** Opens the program page. */
  onOpenProgram(): void;
}

export function TargetsSummary(_props: TargetsSummaryProps): null {
  return null;
}
