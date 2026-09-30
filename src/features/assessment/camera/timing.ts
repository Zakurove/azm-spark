/**
 * Timing of the camera sequence (UX spec S34, 2.10, 4.3): the parts the camera screen times itself
 * (saved, the retry restart, the rests the runner does not run, the setup hold), and the runner
 * options the check passes to src/engine/modes.
 *
 * E2E builds only (contract v3 K): `?e2eCamFast=1` shortens the rests so the Playwright specs run a
 * whole attempt in seconds. A production build never reads it: VITE_E2E is replaced at build time.
 */
import { testDef } from "../../../movements/assessments";
import type { TestId } from "../../../movements/types";
import type { RunnerOptions } from "../../../engine/modes";

export interface CamTiming {
  /** S34c: every check passes for this long before the test starts (principle 8). */
  setupHoldSec: number;
  /** S34c: the setup check reads the last second of frames. */
  setupWindowSec: number;
  /** S34c and S34i: the cue of an issue that stays is replayed at most this often. */
  cueRepeatSec: number;
  /** S34c: "Good" shows this long after an issue clears. */
  fixedSec: number;
  /** S34c: the tips link after this long with any issue, and the skip button after skipAfterSec. */
  tipsAfterSec: number;
  skipAfterSec: number;
  /** S34c: no_person this long shows setup.stillNoOne. */
  stillNoOneSec: number;
  /** S34h: the saved state. */
  savedSec: number;
  /** S34i: the retry panel returns to the setup check after this long. */
  retrySec: number;
  /** S34j rests the screen times itself (the runner times the others). */
  sideChangeSec: Partial<Record<TestId, number>>;
  seatedSec: number;
  /** The rest before an attempt the check in paused runs again (D-016). */
  redoSec: Record<"range" | "timed", number>;
  /** 4.8: the check in's no movement count starts this long after a cue ends. */
  cueGraceSec: number;
  /** The runner options of every test (rests and the countdown). */
  runner: Pick<RunnerOptions, "restSec" | "practiceRestSec" | "repeatRestSec" | "countdownSec">;
}

/** The clinical timing of the check data and the UX spec. */
export function camTiming(fast = false): CamTiming {
  const abd = testDef("shoulder_abduction");
  const curl = testDef("arm_curl_30s");
  const stand = testDef("chair_stand_30s");
  if (fast) {
    return {
      setupHoldSec: 2,
      setupWindowSec: 1,
      cueRepeatSec: 6,
      fixedSec: 1.5,
      // The at the phone offers of a long setup come after seconds instead of minutes.
      tipsAfterSec: 4,
      skipAfterSec: 6,
      stillNoOneSec: 5,
      savedSec: 1.5,
      retrySec: 6,
      sideChangeSec: { shoulder_abduction: 2, arm_curl_30s: 2 },
      seatedSec: 2,
      redoSec: { range: 2, timed: 2 },
      cueGraceSec: 3,
      runner: { restSec: 1, practiceRestSec: 1, repeatRestSec: 2 },
    };
  }
  return {
    setupHoldSec: 2,
    setupWindowSec: 1,
    cueRepeatSec: 6,
    fixedSec: 1.5,
    tipsAfterSec: 60,
    skipAfterSec: 90,
    stillNoOneSec: 60,
    savedSec: 1.5,
    retrySec: 6,
    sideChangeSec: {
      shoulder_abduction: abd.restSec.betweenSides,
      arm_curl_30s: curl.restSec.betweenSidesMin,
    },
    seatedSec: stand.restSec.seatedAfterTest,
    // The rest before a redo is 60 s for the arm raise and the side lean (S34j), and 120 s for the
    // timed tests, their repeat rest (spec 4.2).
    redoSec: { range: 60, timed: 120 },
    cueGraceSec: 3,
    runner: {},
  };
}

/** E2E builds only: the fast timing of the Playwright specs (?e2eCamFast=1). */
export function e2eFastTiming(): boolean {
  if (import.meta.env.VITE_E2E !== "1" || typeof location === "undefined") return false;
  return new URLSearchParams(location.search).get("e2eCamFast") === "1";
}
