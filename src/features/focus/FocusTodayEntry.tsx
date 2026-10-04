/**
 * The focus check's entry on the Today page (product v7 contract 1.3, stream B): the way into a focus
 * check and to its findings from the signed in portal. It loads its own data (GET /api/focus/context
 * and GET /api/focus).
 *
 * Placeholder of step A6 (contract 1.3, A5-12), replaced by B: it renders nothing. src/app/App.tsx
 * renders it on the Today page after the movement check's slot, in a VITE_V7=1 build only.
 */
import type { Lang } from "../../app/i18n";
import type { Intake, Plan } from "../../medical/plan";

export interface FocusTodayEntryProps {
  lang: Lang;
  /** The signed in person's id: the owner of the check's waiting calls, as in the v1 check. */
  owner: string;
  /** The saved intake (its v7 fields tell whether the body questions are answered). */
  intake: Intake;
  /** The saved plan; the entry renders for a plan in review too (status review), as the v1 slot does. */
  plan: Plan;
  /** Opens the focus check (/?focus=1). */
  onStart(): void;
  /** Opens the findings of a completed check, or of the latest with null (/?findings=1). */
  onOpenFindings(checkId: string | null): void;
  /** Opens the My results tab. */
  onOpenResults(): void;
  /** Opens the health form to answer the body questions (409 INTAKE_UPDATE_REQUIRED). */
  onOpenHealth(): void;
}

export default function FocusTodayEntry(_props: FocusTodayEntryProps): null {
  return null;
}
