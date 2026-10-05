/**
 * The gait step of the focus check (product v7 contract 2.8.4, stream C, step C4): setup, the pad or
 * overground capture of each planned view, the static stance check, the upload of the analysis and
 * its provisional findings. Every pad safety step and the clear path step are confirm steps (C-16);
 * any pain answer ends the recording (C-15).
 *
 * Placeholder of step A5 (contract 1.3), replaced by C4: it renders nothing.
 */
import type { Lang } from "../../app/i18n";
import type { CoachPush } from "../../coach/types";
import type { GaitPlan } from "../../medical/gait-eligibility";
import type { GaitStoredView } from "../../medical/gait-types";

export interface GaitStepProps {
  plan: GaitPlan;
  checkId: string;
  lang: Lang;
  coach: CoachPush;
  /**
   * The walk's score before (C-15: a rise of 2 over it ends the recording): the highest pain now of
   * the regions a walk loads, from the day's answers and the re-asks of the range blocks (the
   * session's walkBefore); null when none was asked, which counts as 0. Contract gap W2-5.
   */
  painBefore?: number | null;
  /** The response of POST /api/focus/:id/gait (provisional until complete). */
  onDone(stored: GaitStoredView): void;
  onStop(): void;
}

export function GaitStep(_props: GaitStepProps): null {
  return null;
}
