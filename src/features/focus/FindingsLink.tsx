/**
 * The findings link on the My results tab (product v7 contract 1.3, stream B): the completed focus
 * checks and the way to their findings page. It loads its own data (GET /api/focus).
 *
 * Placeholder of step A6 (contract 1.3, A5-12), replaced by B: it renders nothing. src/app/App.tsx
 * renders it at the top of My results, in a VITE_V7=1 build only.
 */
import type { Lang } from "../../app/i18n";

export interface FindingsLinkProps {
  lang: Lang;
  /** The signed in person's id: the owner of the check's waiting calls, as in the v1 check. */
  owner: string;
  /** Opens the findings of a completed check, or of the latest with null (/?findings=1). */
  onOpenFindings(checkId: string | null): void;
  /** Opens the focus check (/?focus=1). */
  onStart(): void;
}

export default function FindingsLink(_props: FindingsLinkProps): null {
  return null;
}
