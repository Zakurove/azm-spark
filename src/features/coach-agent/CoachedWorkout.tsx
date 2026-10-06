/**
 * The live coach of a workout (product v7 contract 2.11 session host, C-5, C-6, C-15, C-16; D-025
 * CT-2; stream D, step D5). Workout.tsx mounts it once per workout, lazily and in v7 builds only, at
 * one place of its tree, so the workout owns one Live session per segment and never one per exercise.
 *
 *   - It runs with the person's switch, the live_coach consent, the coach available on the server and
 *     a network (C-5: off by default). A demo workout has no coach.
 *   - Before the first step one tap asks the pain now (CT-2): the answer is the session host's score
 *     before, a skip counts as 0, and the tap starts the coach's audio (D-18).
 *   - Each screen of the workout is a step of the session host with its C-16 kind. The coach runs as
 *     session:1, then as session:2 from the first step after its 9 minutes (C-6), then no more.
 *   - The camera sets hand their events to `push` (Session's coach prop).
 *   - The coach's pause holds the workout's timers, and «تابع» goes on from the screen; a camera set
 *     and a guided card keep their own controls (STOP and the card's pause).
 *   - The coach's stop opens the movement check's stop list with its reason preselected. The person's
 *     answer is routed by v1's rules: an emergency shows its screen and ends the workout, any other
 *     answer stops the running exercise and the workout goes on. A pain at or over the rule (C-15)
 *     stops the exercise at once; below it the screen shows the pain_ok line.
 *   - The coach's words show as a caption (voice and captions together).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Lang } from "../../app/i18n";
import type { Position } from "../../app/product";
import { CuePlayer } from "../../app/audio";
import { readPreferences } from "../../app/experience";
import type { CoachPush, CoachSegment } from "../../coach/types";
import type { Intake } from "../../medical/plan";
import type { SessionStep } from "../../medical/session";
import type { StopOptionId } from "../../movements/types";
import { localizeDigits, t } from "../../i18n";
import { tV7 } from "../../i18n/v7";
import { bidiText } from "../../i18n/rich";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import { useOnline } from "../assessment/shared/useOnline";
import { FaintAskScreen, SafetyScreen, StopListScreen } from "../focus/Screens";
import { Glass, Kicker, useModal } from "../focus/parts";
import { readIntake } from "../gait/api";
import { readCoachStatus, sendWorkoutStop, type CoachStatus } from "./api";
import { unlockCoachAudio } from "./audio/context";
import { CoachCaption } from "./CoachCaption";
import { liveCoachOn } from "./hosts";
import { CueVoice } from "./LocalVoice";
import { SessionHost, type SessionScreen } from "./sessionHost";
import { fakeCoachRun, useCoach } from "./useCoach";
import {
  WORKOUT_STEP_KIND,
  WorkoutCoachPlan,
  afterFaintAnswer,
  afterStopChoice,
  afterStopScreen,
  exerciseRuns,
  workoutInstructions,
  workoutStopEnv,
  workoutStopRoute,
  type WorkoutSafety,
  type WorkoutStage,
} from "./workoutCoach";
import "../focus/focus.css";
import "./coach.css";

const c = (lang: Lang, key: string) => tV7(lang, `coach.${key}` as never);

/** How long the pain_ok line stays (or until the next step). */
export const PAIN_OK_MS = 8000;
/** On the end card, the coach's time for its closing words before its segment ends. */
export const CLOSING_MS = 10_000;

export interface CoachedWorkoutProps {
  lang: Lang;
  workoutId: string;
  /** The person's switch (Preferences.liveCoach). */
  preference: boolean;
  stage: WorkoutStage;
  index: number;
  step: SessionStep | null;
  /** The camera part's position, for the stop routing (a fall from a seat has its own screen). */
  position: Position | null;
  /** The workout's timer is held by the coach. */
  paused: boolean;
  onPause(paused: boolean): void;
  /** Where the workout's camera sets hand their events (Session's coach prop reads it). */
  push: { current: CoachPush | null };
  /** The running exercise stops now: a camera set goes back to its opening screen, a card is skipped. */
  onStopExercise(): void;
  /** The coach's next_step on the end card. */
  onNext(): void;
  /** A stop that ends the workout, after its screen. */
  onExit(): void;
}

/** The step's name for the coach: the exercise of a camera set or a card, else the screen. */
function stepLabel(stage: WorkoutStage, step: SessionStep | null): string {
  if (stage === "set" && step?.kind === "camera") return step.prescription.exerciseId;
  if (stage === "card" && step?.kind === "card") return step.item.id;
  return stage;
}

export default function CoachedWorkout(props: CoachedWorkoutProps) {
  const { lang } = props;
  const latest = useRef(props);
  latest.current = props;

  // Whether this workout is coached: the server's answer, the switch and a network.
  const [status, setStatus] = useState<CoachStatus | null>(null);
  useEffect(() => {
    let live = true;
    void readCoachStatus().then((s) => {
      if (live) setStatus(s);
    });
    return () => {
      live = false;
    };
  }, []);
  const { online } = useOnline();
  const on =
    !!status &&
    (status.available || fakeCoachRun()) &&
    liveCoachOn({ preference: props.preference, consent: status.consent, online });

  // The stop list's context: the person's intake, read once the coach is on.
  const [intake, setIntake] = useState<Intake | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    void readIntake().then((i) => {
      if (live) setIntake(i);
    });
    return () => {
      live = false;
    };
  }, [on]);
  const env = useMemo(() => workoutStopEnv(intake, props.position), [intake, props.position]);

  const [safety, setSafety] = useState<WorkoutSafety | null>(null);
  const [painOk, setPainOk] = useState(false);
  // The running exercise was stopped for the stop list that is open (a pain at or over the rule).
  const exerciseStopped = useRef(false);

  // What the session host asks of the screen, through the latest props.
  const screen = useMemo<SessionScreen>(
    () => ({
      pause: () => latest.current.onPause(true),
      resume: () => latest.current.onPause(false),
      next: () => latest.current.onNext(),
      instructions: () => workoutInstructions(latest.current.stage, latest.current.step, latest.current.lang),
      openStopList: (reason) => setSafety({ kind: "list", preselect: reason }),
      stopExercise: () => {
        if (exerciseStopped.current || !exerciseRuns(latest.current.stage)) return;
        exerciseStopped.current = true;
        latest.current.onStopExercise();
      },
      painOk: () => setPainOk(true),
      canPause: () => !exerciseRuns(latest.current.stage),
    }),
    [],
  );

  // The pain question (CT-2), then the session host and the segments.
  const plan = useMemo(() => new WorkoutCoachPlan(), []);
  const [host, setHost] = useState<SessionHost | null>(null);
  const [segment, setSegment] = useState<CoachSegment | null>(null);
  const answer = (level: number | null) => {
    // D-18: the coach's audio starts inside a tap.
    unlockCoachAudio();
    plan.answerPain(level);
    setHost(new SessionHost(screen, plan.painBefore ?? null));
  };

  // The local voice (the voice pack, muted with it), through which the bridge says its stop line.
  const player = useMemo(() => new CuePlayer(lang), []);
  const voice = useMemo(() => new CueVoice(player), [player]);
  useEffect(() => player.setLang(lang), [lang, player]);
  useEffect(() => {
    player.muted = readPreferences().voice === "off";
    return () => player.stop();
  }, [player]);

  const coach = useCoach(
    on && host && segment
      ? { block: "session", segment, lang, ref: { workoutId: props.workoutId }, host, local: voice }
      : null,
  );
  const pushRef = useRef(coach.push);
  pushRef.current = coach.push;
  // E2E builds only: the review runs and the smoke run read the coach's mode and both sides' captions.
  useEffect(() => {
    if (import.meta.env.VITE_E2E !== "1") return;
    (window as unknown as { azmCoach?: unknown }).azmCoach = { mode: coach.mode, captions: coach.captions };
  }, [coach.mode, coach.captions]);
  const coachOn = coach.mode !== "off";
  useEffect(() => {
    const target = props.push;
    target.current = coachOn ? (e) => pushRef.current(e) : null;
    return () => {
      target.current = null;
    };
  }, [coachOn, props.push]);

  // Each screen is a step: its kind (the stop list's while it is open), a new part at a step, and the
  // coach hears the step's start.
  const label = stepLabel(props.stage, props.step);
  const stepKey = `${props.index}:${props.stage}`;
  const lastKey = useRef<string | null>(null);
  const listOpen = safety !== null;
  useEffect(() => {
    if (!host) return;
    host.setStep(listOpen ? "safety" : WORKOUT_STEP_KIND[props.stage], listOpen ? "stop_list" : label);
    if (lastKey.current === stepKey) return;
    lastKey.current = stepKey;
    setPainOk(false);
    // A new step is never held (the host's setStep ended its pause too).
    if (latest.current.paused) latest.current.onPause(false);
    const now = performance.now();
    setSegment(plan.boundary(now));
    pushRef.current({ p: 3, type: "step_start", label, t: now });
  }, [host, stepKey, listOpen, label, plan, props.stage]);

  // The workout is over: the segment ends once the coach had time for its closing words, so the
  // microphone does not stay open on the end card (leaving earlier ends it as the person's).
  const endRef = useRef(coach.end);
  endRef.current = coach.end;
  useEffect(() => {
    if (props.stage !== "done") return;
    const id = setTimeout(() => endRef.current("done"), CLOSING_MS);
    return () => clearTimeout(id);
  }, [props.stage]);

  useEffect(() => {
    if (!painOk) return;
    const id = setTimeout(() => setPainOk(false), PAIN_OK_MS);
    return () => clearTimeout(id);
  }, [painOk]);

  /** The person's stop list answer: the P0 first, then its screen, or the workout goes on. */
  const choose = (option: StopOptionId) => {
    if (safety?.kind !== "list") return;
    const route = workoutStopRoute(option, env);
    const t0 = performance.now();
    host?.safetyStop();
    const next = afterStopChoice(route);
    setSafety(next);
    // Every answer stops the running exercise (once: a pain stop has stopped it already).
    screen.stopExercise();
    exerciseStopped.current = false;
    pushRef.current({ p: 0, type: "safety_stop", reason: "stop_list", t: t0 });
    // Bridge rule 1: the app shows the screen first, then the coach hears the red flag.
    if (route.screen) pushRef.current({ p: 0, type: "red_flag", screen: route.screen, t: t0 });
    // The server sets the stop's next day lock as a check's stop does (D-030 D5-7), and counts it.
    void sendWorkoutStop(latest.current.workoutId, option);
    if (!next) {
      host?.clearStop();
      coach.reopen();
    }
  };
  const afterScreen = (route: Extract<WorkoutSafety, { kind: "screen" }>["route"]) => {
    const next = afterStopScreen(route);
    if (next === "leave") latest.current.onExit();
    else setSafety(next);
  };

  // Before the pain question the coach needs everything above; once the workout is coached, its
  // stop list, a stop's screen and a held timer stay on the screen whatever the network does.
  if (!on && !host) return null;
  const asking = !host;
  return (
    <CheckRoot ui={{ lang }} page={false} className="fx coach-workout">
      {/* The coach's mode for the specs and the review shots (the caption shows only its words). */}
      <span hidden data-coach-mode={coach.mode} />
      {asking && <PainQuestion lang={lang} onAnswer={answer} />}
      {!asking && !safety && <CoachCaption coach={coach} lang={lang} />}
      {!asking && !safety && props.paused && (
        <div className="coach-paused" role="status">
          <span>{c(lang, "workout.paused")}</span>
          <button
            type="button"
            className="coach-paused-go"
            onClick={() => {
              host?.screenPaused(false);
              latest.current.onPause(false);
            }}
          >
            {c(lang, "workout.goOn")}
          </button>
        </div>
      )}
      {!asking && !safety && painOk && (
        <p className="coach-note" role="status">
          {bidiText(lang, c(lang, "workout.painOk"))}
        </p>
      )}
      {safety?.kind === "list" && (
        <StopListScreen
          lang={lang}
          env={env}
          preselect={safety.preselect}
          stopShown={false}
          onChoose={choose}
        />
      )}
      {safety?.kind === "screen" && (
        <SafetyOverlay>
          <SafetyScreen
            lang={lang}
            screen={safety.route.screen}
            alsoShow={safety.route.alsoShow}
            now={Date.now()}
            next={
              safety.route.then === "sf_faint_loc"
                ? {
                    label: t(lang, "assessment.common.continue"),
                    name: "continue",
                    onClick: () => afterScreen(safety.route),
                  }
                : {
                    label: t(lang, "assessment.common.backToToday"),
                    name: "today",
                    onClick: () => afterScreen(safety.route),
                  }
            }
          />
        </SafetyOverlay>
      )}
      {safety?.kind === "faint_ask" && (
        <SafetyOverlay>
          <FaintAskScreen
            lang={lang}
            back={safety.route.screen}
            onAnswer={(value) => setSafety(afterFaintAnswer(safety.route, value, env, Date.now()))}
          />
        </SafetyOverlay>
      )}
    </CheckRoot>
  );
}

/** A stop's screen over the workout: the page behind is inert, focus on its heading, no way around it. */
function SafetyOverlay({ children }: { children: ReactNode }) {
  const modal = useModal();
  return (
    <div ref={modal.ref} onKeyDown={modal.onKeyDown} className="fx-overlay" role="dialog" aria-modal="true">
      {children}
    </div>
  );
}

/**
 * CT-2: the pain now, before a coached workout. One tap on a number answers (0 no pain, 10 the worst
 * pain the person can imagine); «تخطَّ هذا السؤال» counts as 0 in the rule.
 */
export function PainQuestion({ lang, onAnswer }: { lang: Lang; onAnswer(level: number | null): void }) {
  const modal = useModal();
  return (
    <div
      ref={modal.ref}
      onKeyDown={modal.onKeyDown}
      className="fx-overlay is-dim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="coach-pain-title"
      data-screen="coach_pain"
    >
      <Glass className="fx-card fx-question coach-pain">
        <Kicker>{c(lang, "name")}</Kicker>
        <h1 id="coach-pain-title" className="fx-title is-question" tabIndex={-1}>
          {bidiText(lang, c(lang, "workout.painTitle"))}
        </h1>
        <p className="fx-body is-muted">{bidiText(lang, c(lang, "workout.painHint"))}</p>
        <div className="fx-scale coach-pain-scale" role="group" aria-labelledby="coach-pain-title">
          {Array.from({ length: 11 }, (_, n) => (
            <button
              key={n}
              type="button"
              className={`fx-scale-cell is-${n <= 3 ? "low" : n <= 5 ? "mid" : "high"}`}
              data-value={n}
              onClick={() => onAnswer(n)}
            >
              {localizeDigits(lang, String(n))}
            </button>
          ))}
        </div>
        <button type="button" className="coach-pain-skip" data-action="skip" onClick={() => onAnswer(null)}>
          {c(lang, "workout.painSkip")}
        </button>
      </Glass>
    </div>
  );
}
