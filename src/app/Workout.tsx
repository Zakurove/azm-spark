import { useEffect, useState } from "react";
import { Plan } from "../medical/plan";
import { Lang, fmtNum } from "./i18n";
import { labels } from "./platform-copy";
import { camCopy } from "./camera-copy";
import { Preferences, RepMoment } from "./experience";
import { SessionSummary } from "../engine/types";
import { EXERCISES } from "../exercises/defs";
import Session from "./Session";
import Brand from "./Brand";
import Icon from "./Icon";
import { api } from "./api";
import { primeAudio } from "./audio";
import PlacementGuide from "./PlacementGuide";
export interface WorkoutRun {
  id: string;
  demo: boolean;
  plan: Plan;
  nextIndex?: number;
}
type Stage = "setup" | "warmup" | "set" | "rest" | "cooldown" | "done";
/**
 * C48: setup (placement and the one line attestation, no timer) → warm up (its own timer) → the sets
 * with a rest between them → cool down → done. A demo starts on the warm up.
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
    sets = run.plan.exercises.flatMap((e) =>
      Array.from({ length: e.sets }, (_, i) => ({ ...e, setNumber: i + 1 })),
    );
  const [index, setIndex] = useState(run.nextIndex ?? 0),
    [stage, setStage] = useState<Stage>(run.nextIndex ? "rest" : run.demo ? "warmup" : "setup");
  const [remaining, setRemaining] = useState(
      run.nextIndex ? sets[Math.max(0, run.nextIndex - 1)].restSeconds : run.plan.warmUpMinutes * 60,
    ),
    [effort, setEffort] = useState<number | null>(null),
    [saving, setSaving] = useState(false),
    [steps, setSteps] = useState(firstSession);
  useEffect(() => {
    if (stage === "setup" || stage === "set" || stage === "done") return;
    const end = Date.now() + remaining * 1000;
    const timer = setInterval(() => setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [stage]); // timer does not restart on every tick
  const next = () => {
    if (effort !== null && effort >= 8) {
      setStage("done");
      return;
    }
    if (index + 1 >= sets.length) {
      setRemaining(run.plan.coolDownMinutes * 60);
      setStage("cooldown");
    } else {
      setRemaining(sets[index].restSeconds);
      setIndex((i) => i + 1);
      setStage("rest");
    }
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
  if (stage === "set") {
    const p = sets[index];
    return (
      <Session
        key={`${run.id}-${index}`}
        lang={lang}
        setup={p.setup}
        exerciseId={p.exerciseId}
        targetReps={p.reps}
        setNumber={p.setNumber}
        demo={run.demo}
        variant="workout"
        preferences={preferences}
        onPreferences={onPreferences}
        onExit={onExit}
        onRestart={() => setStage("rest")}
        onDemo={onExit}
        onSave={save}
        onContinue={next}
      />
    );
  }
  const k = camCopy(lang);
  const title = {
    setup: k.placeReminder,
    warmup: c.warmup,
    rest: c.restTitle,
    cooldown: c.cooldown,
    done: c.done,
  }[stage];
  const body = {
    setup: null,
    warmup: c.warmupBody,
    rest: c.restBody,
    cooldown: c.cooldownBody,
    done: run.demo ? c.demoDone : c.doneBody,
  }[stage];
  const action = {
    setup: c.ready,
    warmup: c.startTraining,
    rest: c.nextSet,
    cooldown: c.finish,
    done: c.exit,
  }[stage];
  const press = () => {
    if (stage === "done") return onExit();
    if (stage === "cooldown") return setStage("done");
    if (stage === "setup") return setStage("warmup");
    if (!run.demo && preferences.voice !== "off") primeAudio(lang);
    setStage("set");
  };
  const position = sets[0]?.setup.position ?? "chair";
  let first = 0;
  const queue = run.plan.exercises.map((e) => {
    const from = first;
    first += e.sets;
    return { e, from, to: first };
  });
  return (
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
              {c.set} {fmtNum(Math.min(index + 1, sets.length), lang)} / {fmtNum(sets.length, lang)}
            </p>
          )}
          <h1>{title}</h1>
          {body && <p>{body}</p>}
          {stage === "setup" &&
            (steps ? (
              <PlacementGuide lang={lang} position={position} compact={!firstSession} />
            ) : (
              <p className="workout-place-line">
                {k.placeTitle}{" "}
                <button type="button" className="text-button" onClick={() => setSteps(true)}>
                  {c.showSteps}
                </button>
              </p>
            ))}
          {stage === "setup" && (
            <p className="workout-attest" id="workout-attest">
              {c.attest}
            </p>
          )}
          {stage !== "setup" && stage !== "done" && (
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
          {queue.map(({ e, from, to }, i) => {
            const done = index >= to || stage === "cooldown" || stage === "done";
            const now = !done && index >= from && index < to;
            const name = EXERCISES.find((x) => x.id === e.exerciseId)?.name[lang];
            return (
              <div key={i} className={now ? "current" : done ? "done" : ""}>
                <span>{done ? <Icon name="check" size={16} /> : fmtNum(i + 1, lang)}</span>
                <strong>
                  {name}{" "}
                  <span className="workout-dose">{`· ${fmtNum(e.sets, lang)} × ${fmtNum(e.reps, lang)}`}</span>
                </strong>
              </div>
            );
          })}
        </aside>
      </main>
    </div>
  );
}
