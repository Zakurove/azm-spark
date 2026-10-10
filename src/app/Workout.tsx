import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { CoachPush } from "../coach/types";
import type { WorkoutButton } from "../features/coach-agent/workoutCoach";
import { Plan } from "../medical/plan";
import { libraryById } from "../medical/pool";
import { planRest, sessionSteps, type CardSlot, type SessionDay, type SessionStep } from "../medical/session";
import { Lang, fmtNum } from "./i18n";
import { labels } from "./platform-copy";
import { camCopy } from "./camera-copy";
import { guidedCopy } from "./guided-copy";
import { Preferences, RepMoment } from "./experience";
import { SessionSummary } from "../engine/types";
import { EXERCISES } from "../exercises/defs";
import Session from "./Session";
import GuidedCard, { type CardResult } from "./GuidedCard";
import Brand from "./Brand";
import Icon from "./Icon";
import { api } from "./api";
import { primeAudio } from "./audio";
import PlacementGuide from "./PlacementGuide";
import { doseText } from "./weekly-dose";

/**
 * Step D5: the live coach of a workout, a lazy part of v7 builds only (the default build keeps none of
 * it). Mounted once per workout at one place of the tree, it owns the workout's Live sessions (one per
 * segment, C-6, not one per exercise) and takes each camera set's events.
 */
const WorkoutCoach =
  import.meta.env.VITE_V7 === "1" ? lazy(() => import("../features/coach-agent/CoachedWorkout")) : null;
/** D-030 E3-3: the wheelchair setup line, once before the first seated item (v7 builds only). */
const WheelchairSetupLine =
  import.meta.env.VITE_V7 === "1" ? lazy(() => import("../features/coach-agent/WheelchairSetupLine")) : null;

export interface WorkoutRun {
  id: string;
  demo: boolean;
  plan: Plan;
  nextIndex?: number;
  /** The cards of the day the session falls on (booth v2, D); absent for a workout started before. */
  today?: SessionDay;
}
type Stage = "setup" | "warmup" | "intro" | "set" | "rest" | "card" | "cooldown" | "done";

/** One row of the session list: a card, or a camera movement with its sets (steps from..to). */
interface Row {
  group: CardSlot | "camera";
  from: number;
  to: number;
  name: string;
  dose: string;
}

/**
 * C48 and booth v2 (D): setup (placement and the one line attestation, no timer), then the steps of
 * the session: the warm up cards, the camera sets with a rest between them (opened by one screen that
 * starts the camera), the day's exercises and the cool down cards, then done. Every weekly plan item is
 * a guided card; the camera movements keep the camera. A workout started before the cards (no day)
 * keeps its warm up and cool down timers around the camera sets. A demo starts on the first step.
 */
export default function Workout({
  run,
  lang,
  firstSession = false,
  preferences,
  onPreferences,
  onExit,
}: {
  run: WorkoutRun;
  lang: Lang;
  /** No saved session yet: the placement guide shows in full. */
  firstSession?: boolean;
  preferences: Preferences;
  onPreferences: (p: Preferences) => void;
  onExit: () => void;
}) {
  const c = labels(lang),
    g = guidedCopy(lang);
  const steps = useMemo(() => sessionSteps(run.plan, run.today), [run.plan, run.today]);
  const today = run.today;
  const warmCards = !!today?.warmup.length,
    coolCards = !!today?.cooldown.length;
  /** The screen that opens step `i`, and the time its timer starts from. */
  const opening = (i: number): { stage: Stage; remaining: number } => {
    if (i >= steps.length)
      return coolCards
        ? { stage: "done", remaining: 0 }
        : { stage: "cooldown", remaining: run.plan.coolDownMinutes * 60 };
    const step = steps[i],
      before = steps[i - 1];
    if (step.kind === "card") return { stage: "card", remaining: 0 };
    if (before?.kind === "camera") return { stage: "rest", remaining: before.prescription.restSeconds };
    return warmCards
      ? { stage: "intro", remaining: 0 }
      : { stage: "warmup", remaining: run.plan.warmUpMinutes * 60 };
  };
  const first = run.nextIndex ? opening(run.nextIndex) : run.demo ? opening(0) : null;
  const [index, setIndex] = useState(run.nextIndex ?? 0),
    [stage, setStage] = useState<Stage>(first?.stage ?? "setup");
  const [remaining, setRemaining] = useState(first?.remaining ?? 0),
    [effort, setEffort] = useState<number | null>(null),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState(false),
    [placement, setPlacement] = useState(firstSession);
  // Step D5: the coach may hold a timer; the camera sets hand their events to the coach.
  const [paused, setPaused] = useState(false);
  const coachPush = useRef<CoachPush | null>(null);
  // D-036 item 2: a camera set's button the coach may press on the person's words (its Continue program).
  const [setButton, setSetButton] = useState<WorkoutButton | null>(null);
  const toCoach = useMemo<CoachPush>(() => (e) => coachPush.current?.(e), []);
  useEffect(() => {
    if (paused || (stage !== "warmup" && stage !== "rest" && stage !== "cooldown")) return;
    const end = Date.now() + remaining * 1000;
    const timer = setInterval(() => setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [stage, index, paused]); // timer does not restart on every tick
  const enter = (i: number) => {
    const o = opening(i);
    setIndex(i);
    setRemaining(o.remaining);
    setSaveError(false);
    setPaused(false);
    setStage(o.stage);
  };
  const next = () => {
    if (effort !== null && effort >= 8) {
      setStage("done");
      return;
    }
    enter(index + 1);
  };
  const save = async (summary: SessionSummary, moments: RepMoment[]) => {
    if (saving) return;
    setSaving(true);
    try {
      await api(`/workouts/${run.id}/sets`, { index, summary, moments });
      setEffort(summary.rpe ?? null);
    } finally {
      setSaving(false);
    }
  };
  /** A card done (kept, it counts) or skipped (moves on): the server follows the same steps. */
  const saveCard = async (result: CardResult | null) => {
    const step = steps[index];
    if (saving || step?.kind !== "card") return;
    setSaving(true);
    setSaveError(false);
    try {
      await api(
        `/workouts/${run.id}/cards`,
        result ? { index, id: step.item.id, ...result } : { index, id: step.item.id, skipped: true },
      );
      if (result?.rpe != null && result.rpe >= 8) {
        setEffort(result.rpe);
        setStage("done");
      } else enter(index + 1);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const rows = useMemo(() => queueRows(steps, lang), [steps, lang]);
  const rowOf = (i: number) => rows.findIndex((r) => i >= r.from && i < r.to);

  /**
   * The coach's stop ended the running exercise (after the person's answer, or a pain over the rule):
   * a guided card is skipped; a camera set opens again, unsaved, after its rest or at its own screen.
   */
  const stopExercise = () => {
    if (stage === "card") return void saveCard(null);
    const o = opening(index);
    setRemaining(o.remaining);
    setPaused(false);
    setStage(o.stage === "warmup" ? "intro" : o.stage);
  };
  /** The interval screen's main button (and the coach's press of it, D-036 item 2). */
  const press = () => {
    if (stage === "done") return onExit();
    if (stage === "cooldown") return setStage("done");
    if (stage === "setup") return enter(0);
    if (!run.demo && preferences.voice !== "off") primeAudio(lang);
    setStage("set");
  };
  // Beside every screen below at the same place, so the coach stays mounted from step to step.
  const coach = WorkoutCoach && !run.demo && (
    <Suspense fallback={null}>
      <WorkoutCoach
        lang={lang}
        workoutId={run.id}
        preference={preferences.liveCoach}
        stage={stage}
        index={index}
        step={steps[index] ?? null}
        position={steps.find((s) => s.kind === "camera")?.prescription.setup.position ?? null}
        paused={paused}
        onPause={setPaused}
        push={coachPush}
        onStopExercise={stopExercise}
        remaining={remaining}
        press={press}
        setButton={setButton}
        onExit={onExit}
      />
    </Suspense>
  );
  const withCoach = (screen: JSX.Element) => (
    <>
      {screen}
      {coach}
    </>
  );

  if (stage === "set") {
    const step = steps[index] as Extract<SessionStep, { kind: "camera" }>;
    const p = step.prescription;
    return withCoach(
      <Session
        key={`${run.id}-${index}`}
        lang={lang}
        setup={p.setup}
        exerciseId={p.exerciseId}
        targetReps={p.reps}
        setNumber={step.setNumber}
        demo={run.demo}
        variant="workout"
        preferences={preferences}
        onPreferences={onPreferences}
        onExit={onExit}
        onRestart={() => setStage("rest")}
        onDemo={onExit}
        onSave={save}
        onContinue={next}
        coach={WorkoutCoach ? toCoach : undefined}
        onCoachButton={WorkoutCoach ? setSetButton : undefined}
      />,
    );
  }
  if (stage === "card") {
    const step = steps[index] as Extract<SessionStep, { kind: "card" }>;
    return withCoach(
      <GuidedCard
        key={`${run.id}-${index}`}
        lang={lang}
        item={step.item}
        slot={step.slot}
        position={rowOf(index) + 1}
        total={rows.length}
        restSeconds={today?.restSeconds ?? planRest(run.plan)}
        saving={saving}
        error={saveError}
        onDone={(r) => void saveCard(r)}
        onSkip={() => void saveCard(null)}
        onExit={onExit}
      />,
    );
  }
  const k = camCopy(lang);
  const camera = steps[index]?.kind === "camera" ? steps[index].prescription : null;
  const cameraName = camera && EXERCISES.find((x) => x.id === camera.exerciseId)?.name[lang];
  const title = {
    setup: k.placeReminder,
    warmup: c.warmup,
    intro: cameraName ?? g.cameraKicker,
    rest: c.restTitle,
    cooldown: c.cooldown,
    done: c.done,
  }[stage];
  const body = {
    setup: null,
    warmup: c.warmupBody,
    intro: g.cameraBody,
    rest: c.restBody,
    cooldown: c.cooldownBody,
    done: run.demo ? c.demoDone : c.doneBody,
  }[stage];
  const action = {
    setup: c.ready,
    warmup: c.startTraining,
    intro: c.startTraining,
    rest: c.nextSet,
    cooldown: c.finish,
    done: c.exit,
  }[stage];
  const position = steps.find((s) => s.kind === "camera")?.prescription.setup.position ?? "chair";
  const hasCamera = steps.some((s) => s.kind === "camera");
  const cameraSets = steps.filter((s) => s.kind === "camera").length;
  const cameraOrdinal = steps.slice(0, index + 1).filter((s) => s.kind === "camera").length;
  const finished = stage === "cooldown" || stage === "done";
  return withCoach(
    <div className="workout-shell">
      <header className="portal-header">
        <Brand />
        <span>{run.demo ? c.preview : c.program}</span>
        <button className="text-button" onClick={onExit}>
          {c.exit}
        </button>
      </header>
      <main className="interval-page">
        <div className="interval-main">
          {stage === "rest" && (
            <p className="section-kicker">
              {c.set} {fmtNum(Math.min(cameraOrdinal, cameraSets), lang)} / {fmtNum(cameraSets, lang)}
            </p>
          )}
          {stage === "intro" && (
            <p className="section-kicker workout-camera-kicker">
              <Icon name="camera" size={15} />
              {g.cameraKicker}
            </p>
          )}
          <h1>{title}</h1>
          {stage === "intro" && camera && (
            <p className="workout-camera-dose">
              {g.cameraDose(camera.sets, camera.reps, (v) => fmtNum(v, lang))}
            </p>
          )}
          {body && <p>{body}</p>}
          {/* The phone's placement is for the camera part; a session of cards alone has none. */}
          {stage === "setup" &&
            hasCamera &&
            (placement ? (
              <PlacementGuide lang={lang} position={position} compact={!firstSession} />
            ) : (
              <p className="workout-place-line">
                {k.placeTitle}{" "}
                <button type="button" className="text-button" onClick={() => setPlacement(true)}>
                  {c.showSteps}
                </button>
              </p>
            ))}
          {stage === "setup" && WheelchairSetupLine && !run.demo && (
            <Suspense fallback={null}>
              <WheelchairSetupLine lang={lang} />
            </Suspense>
          )}
          {stage === "setup" && (
            <p className="workout-attest" id="workout-attest">
              {c.attest}
            </p>
          )}
          {(stage === "warmup" || stage === "rest" || stage === "cooldown") && (
            <div className="interval-clock" role="timer" aria-label={title}>
              <bdi>
                {fmtNum(Math.floor(remaining / 60), lang)}:
                {fmtNum(remaining % 60, lang).padStart(2, lang === "ar" ? "٠" : "0")}
              </bdi>
              <span>{stage === "rest" ? c.rest : c.minutes}</span>
            </div>
          )}
          {effort !== null && effort >= 8 && <p className="form-error">{c.highEffort}</p>}
          <button
            className="cta"
            disabled={stage === "rest" && remaining > 0}
            aria-describedby={stage === "setup" ? "workout-attest" : undefined}
            onClick={press}
          >
            {action}
            <Icon name="arrow" size={18} />
          </button>
        </div>
        <aside className="workout-queue">
          <h2>{c.program}</h2>
          {rows.map((r, i) => {
            const done = index >= r.to || finished;
            const now = !done && index >= r.from && index < r.to;
            const heading = today && r.group !== rows[i - 1]?.group;
            return [
              heading && (
                <h3 key={`h${i}`} className="workout-queue-group">
                  {r.group === "camera" ? g.cameraKicker : g.slot[r.group]}
                </h3>
              ),
              <div key={i} className={now ? "current" : done ? "done" : ""} data-group={r.group}>
                <span>{done ? <Icon name="check" size={16} /> : fmtNum(i + 1, lang)}</span>
                <strong>
                  {/* In Arabic a middle dot beside a number reads as its zero: the Arabic comma. */}
                  {lang === "ar" ? `${r.name}، ` : `${r.name} `}
                  <span className="workout-dose">{lang === "ar" ? r.dose : `· ${r.dose}`}</span>
                </strong>
              </div>,
            ];
          })}
        </aside>
      </main>
    </div>,
  );
}

/** The session list: each card once, and each camera movement once with its sets. */
function queueRows(steps: SessionStep[], lang: Lang): Row[] {
  const rows: Row[] = [];
  const num = (v: number) => fmtNum(v, lang);
  steps.forEach((s, i) => {
    if (s.kind === "camera") {
      const last = rows[rows.length - 1];
      if (last?.group === "camera" && steps[last.from].kind === "camera") {
        const p = (steps[last.from] as Extract<SessionStep, { kind: "camera" }>).prescription;
        if (p === s.prescription) {
          last.to = i + 1;
          return;
        }
      }
      const p = s.prescription;
      rows.push({
        group: "camera",
        from: i,
        to: i + 1,
        name: EXERCISES.find((x) => x.id === p.exerciseId)?.name[lang] ?? p.exerciseId,
        dose: `${num(p.sets)} × ${num(p.reps)}`,
      });
      return;
    }
    const item = s.item;
    rows.push({
      group: s.slot,
      from: i,
      to: i + 1,
      name: libraryById(item.id)?.name[lang] ?? item.id,
      // The week's and the Program page's words for a card's dose (D-030 E3-6).
      dose: doseText(item, lang),
    });
  });
  return rows;
}
