/**
 * The gait step of the focus check (product v7 contract 2.8.4, stream C, step C4): setup, the pad or
 * overground capture of each planned view, the static stance check, the upload of the analysis and
 * its provisional findings. Every pad safety step and the clear path step are confirm steps (C-16);
 * any pain answer ends the recording (C-15).
 *
 * The screens and the gait engine load lazily (GaitCapture.tsx), so the focus check's first chunk
 * never carries them (section 9: the focus chunk and the gait engine have their own budgets).
 */
import { lazy, Suspense } from "react";
import type { Lang } from "../../app/i18n";
import type { CoachPush, CoachStopReason } from "../../coach/types";
import type { GaitPlan } from "../../medical/gait-eligibility";
import type { GaitStoredView } from "../../medical/gait-types";
import { Loading } from "../focus/parts";
import { tV7 } from "../../i18n/v7";

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
  /**
   * STOP, the coach's stop or a pain stop: the shell's stop list. `preselect` is the coach's reason or
   * pain (contract gap C4-4: 2.8.4 gives onStop no argument; a caller that ignores it still works).
   */
  onStop(preselect?: CoachStopReason | null): void;
  /** The walk ended with nothing to save, every part left out (contract gap C4-4; without it, onStop). */
  onSkip?(): void;
  /**
   * D-034 item 4: there is no red STOP on the walk's screens. The walk puts its own stop here (the
   * GaitController's, which keeps the partial walk and opens the stop list through onStop), for the
   * shell's X and its «توقّف الآن».
   */
  stopRef?: { current: (() => void) | null };
  /**
   * The live coach for the walk's segment (D5): on when the person turned it on and consented
   * (contract gap C4-4). Absent or false: the coach is off and the walk runs on its own voice.
   */
  coachOn?: boolean;
  /**
   * D-034 item 3: the shell's one sound switch. On: the walk's lines are spoken (the live coach's when
   * it runs, else the phone's own speech); off or absent: silent, the captions stay.
   */
  sound?: boolean;
  /** What of B's slot shows now (D-030 C4-7): its title card and its skip (walkChrome). */
  onChrome?(chrome: { hero: boolean; skip: boolean }): void;
}

const GaitCapture = lazy(() => import("./GaitCapture"));

export function GaitStep(props: GaitStepProps) {
  return (
    <Suspense fallback={<Loading text={tV7(props.lang, "gait.kicker")} />}>
      <GaitCapture {...props} />
    </Suspense>
  );
}
