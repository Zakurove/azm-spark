/**
 * E2E builds only (contract v3 K): every part and state of S34 drawn from a fixed snapshot, for the
 * review screenshots (e2e/camera-shots.spec.ts) at `/?check=1&e2eCamPreview=<name>` over a seeded
 * guest check at a camera state. It renders the same CameraView as the live screen; only the camera,
 * the runner and the timers are replaced by the fixed values below. The camera picture is drawn as a
 * light person figure from a fixture frame, since an E2E build has no camera.
 *
 * CameraScreen imports this module lazily inside an `import.meta.env.VITE_E2E === "1"` branch, which
 * the production build removes.
 */
import { useMemo, useState } from "react";
import type { Lang } from "../../../../app/i18n";
import type { Frame } from "../../../../engine/types";
import { t } from "../../../../i18n";
import { testDef } from "../../../../movements/assessments";
import type { FlowModel, FlowState } from "../../flowMachine";
import type { ScreenProps } from "../../screenTypes";
import { useCheckUi } from "../../shared/CheckUi";
import { CameraView } from "../CameraScreen";
import { camTestOf, type CamSnapshot, type SetupView } from "../controller";
import { captionOf } from "../cues";
import { useViewport } from "../hooks";
import { setupChips, type AttemptDot, type ScreenSetupIssue } from "../view";
import { camFixtureFrames } from "./fixtures";
import { PREVIEWS, type Caption, type Preview } from "./previews";

function snapshotOf(p: Preview, state: FlowState): CamSnapshot {
  const def = testDef(p.test);
  const issues = (p.snap?.setup?.issues ?? []) as ScreenSetupIssue[];
  const setupView: SetupView = {
    issues,
    chips: setupChips(issues, null),
    ok: false,
    hold: 0,
    waitedSec: 5,
    helperSeen: false,
    justFixed: false,
    noPersonSec: 0,
    ...p.snap?.setup,
  };
  const { setup: _setup, ...rest } = p.snap ?? {};
  void _setup;
  return {
    kind: state.kind as CamSnapshot["kind"],
    part: "setup",
    runnerPhase: null,
    setup: setupView,
    calibrateHold: 0,
    calibrationOffer: false,
    live: null,
    hold: 0,
    holdDone: false,
    phaseWord: null,
    count: 0,
    trialRemaining: null,
    countdown: null,
    timeUp: false,
    leanDirection: "right",
    dots: Array.from({ length: def.attempts }, () => "pending" as AttemptDot),
    attemptN: 1,
    practice: false,
    paused: null,
    rest: null,
    retry: null,
    practiceFix: null,
    ...rest,
  };
}

/**
 * The preview's caption. `?e2eHeard=1` draws it as the voice says it (R3C-16: at fit level 3 its
 * sentence may then give way); without it, as when no voice is heard (the sentence always stays).
 */
function captionText(c: Caption | undefined, lang: Lang) {
  if (!c) return null;
  const heard = new URLSearchParams(location.search).get("e2eHeard") === "1";
  if ("cue" in c) return { ...captionOf(c.cue, lang), heard };
  return { text: t(lang, c.key), severity: c.severity, heard };
}

/** One frame of the preview's fixture script, in the page's shape (at < 0: nobody). */
function frameOf(p: Preview, wide: boolean): Frame | null {
  if (p.at < 0) return null;
  const { frames } = camFixtureFrames(`${p.fixture}-${wide ? "16x9" : "9x16"}`);
  const f = frames.find((x) => x.t >= p.at * 1000) ?? frames[frames.length - 1];
  return f ?? null;
}

const BONES: readonly [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];

/** The stand in for the camera picture: every person of the frame as a light figure. */
function PreviewPicture({ frame }: { frame: Frame | null }) {
  if (!frame) return null;
  const a = frame.aspect ?? 9 / 16;
  const w = a * 100;
  const people = frame.poses ?? [frame.lm];
  return (
    <svg
      className="s34-preview-picture"
      viewBox={`0 0 ${w} 100`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {people.map((lm, k) => (
        <g key={k}>
          {BONES.map(([i, j]) =>
            (lm[i]?.visibility ?? 0) > 0.3 && (lm[j]?.visibility ?? 0) > 0.3 ? (
              <line
                key={`${i}-${j}`}
                x1={lm[i].x * w}
                y1={lm[i].y * 100}
                x2={lm[j].x * w}
                y2={lm[j].y * 100}
              />
            ) : null,
          )}
          {(lm[0]?.visibility ?? 0) > 0.3 && <circle cx={lm[0].x * w} cy={lm[0].y * 100} r={4.2} />}
        </g>
      ))}
    </svg>
  );
}

const noop = () => undefined;

export default function CameraPreview({ name, model, dispatch }: ScreenProps & { name: string }) {
  const ui = useCheckUi();
  const viewport = useViewport();
  const p = PREVIEWS[name] ?? PREVIEWS["setup-none"];
  const [tips, setTips] = useState(!!p.tips);
  const i = model.data.tests.findIndex((x) => x.testId === p.test);
  const side = Math.min(p.side ?? 0, (model.data.tests[i]?.sides.length ?? 1) - 1);
  const state = p.state(Math.max(0, i), side);
  const m: FlowModel = {
    ...model,
    state,
    data: {
      ...model.data,
      run: { ...model.data.run, retriesUsed: p.retriesUsed ?? 0 },
      helperRequired: p.helper ? [p.test] : [],
    },
  };
  const found = camTestOf(m);
  if (!found) return null;
  const test = p.position ? { ...found, position: p.position } : found;
  const wide = typeof window !== "undefined" && window.innerWidth > window.innerHeight;
  const frame = useMemo(() => frameOf(p, wide), [name, wide]);
  const snap = snapshotOf(p, state);
  const caption = captionText(p.caption, ui.lang);
  return (
    <CameraView
      model={m}
      dispatch={dispatch}
      snap={snap}
      test={test}
      timed={p.test === "arm_curl_30s" || p.test === "chair_stand_30s"}
      session={{
        status: p.session?.status ?? "running",
        error: p.session?.error ?? null,
        video: null,
        hasPicture: false,
      }}
      device={{
        phoneLandscape: !!p.landscape,
        compact: viewport.compact,
        scale: viewport.scale,
        reduced: false,
      }}
      caption={caption}
      blocked={false}
      timing={{ tipsAfterSec: 60, skipAfterSec: 90 }}
      tips={tips}
      onTips={setTips}
      video={{ frame: { current: frame }, subject: () => (p.at < 0 ? null : (frame?.poses?.[0] ?? null)) }}
      picture={<PreviewPicture frame={frame} />}
      motion={p.motion ? { onAllow: noop } : null}
      practiceSkippable
      on={{
        stop: () => dispatch({ type: "STOP" }),
        replay: noop,
        unblock: noop,
        skipPractice: noop,
        practiceFixNow: noop,
        retryModel: noop,
      }}
      {...(p.large ? { largeCaptions: true } : {})}
    />
  );
}
