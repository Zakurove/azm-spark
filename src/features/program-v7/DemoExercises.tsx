/**
 * The demo exercises (D-037 item 6): «نبني مكتبة التمارين، وهذه مجموعة منها», then each exercise the
 * camera follows now (demoCatalog.ts) as a card with its picture, its name, the body area, how to sit
 * to the camera and Start. Start runs it on the camera workout's own screen (src/app/Session.tsx: the
 * outline, the start position, the two measuring reps, then the counted set with its feedback), and the
 * screen's ways out come back to this list.
 *
 * Nothing of a demo run is recorded: no workout is started, the screen gets no onSave, and it says the
 * exercise is not saved (demoSessionProps). Opened from the program page and the Program tab by
 * src/app/App.tsx, VITE_V7=1 builds only (a lazy chunk of its own). The focus check's family: a warm
 * light stage, glass cards, Cairo, gold for Start, purple for the person's marks. Phone first.
 *
 * D-038 item 3: the Live coach runs a demo as it runs a workout's camera set (CoachedWorkout, segment
 * demo, no workout id): it says the setup, counts, says the form cues and encourages, and goes back to
 * the list or repeats on the person's words. No recorded voice plays; without the coach the screen is
 * silent with its captions. The speaker button is the checks' sound switch (azm.sound, on by default
 * in a v7 build), and Start's tap starts the coach's audio (iOS).
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../../app/i18n";
import type { Preferences } from "../../app/experience";
import { preloadPoseAssets } from "../../app/poseSource";
import Session from "../../app/Session";
import type { CoachPush } from "../../coach/types";
import { unlockCoachAudio } from "../coach-agent/audio/context";
import { readSound, saveSound } from "../coach-agent/sound";
import type { WorkoutButton } from "../coach-agent/workoutCoach";
import { tV7 } from "../../i18n/v7";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import CheckIcon from "../assessment/shared/CheckIcon";
import { Actions, Body, Glass, Kicker, Page, Title, TopBar } from "../focus/parts";
import {
  DEMO_EXERCISES,
  demoCoachStep,
  demoExercise,
  demoName,
  demoSessionProps,
  newDemoRunId,
  type DemoExercise,
  type DemoRun,
} from "./demoCatalog";

/** The Live coach of a demo run, as a workout's (its own lazy chunk, as Workout.tsx loads it). */
const DemoCoach = lazy(() => import("../coach-agent/CoachedWorkout"));
import "../focus/focus.css";
import "./program.css";

export interface DemoExercisesProps {
  lang: Lang;
  onLanguage(): void;
  preferences: Preferences;
  onPreferences(p: Preferences): void;
  /** Back to where the list was opened: the program page or the Program tab. */
  onBack(): void;
}

export default function DemoExercises({
  lang,
  onLanguage,
  preferences,
  onPreferences,
  onBack,
}: DemoExercisesProps) {
  const [run, setRun] = useState<DemoRun | null>(null);
  // The pose model downloads while the person reads the list, so Start opens the camera quickly.
  useEffect(() => preloadPoseAssets(), []);
  if (run && demoExercise(run.id))
    return (
      <DemoRunScreen
        lang={lang}
        run={run}
        preferences={preferences}
        onPreferences={onPreferences}
        onRun={setRun}
      />
    );
  return (
    <DemoList
      lang={lang}
      onLanguage={onLanguage}
      onBack={onBack}
      onStart={(id) => {
        // Inside the tap: iOS lets the coach's voice play later only if a tap started its audio.
        if (readSound()) unlockCoachAudio();
        setRun({ id, simulated: false, n: 0 });
      }}
    />
  );
}

/**
 * A demo run: the camera workout's own screen for the exercise, with the props of demoSessionProps
 * only (nothing that records), and the Live coach as a workout's camera set has it (D-038 item 3). Its
 * ways out set the next run: null back to the list, the same exercise again, or its mannequin when the
 * camera cannot open.
 */
export function DemoRunScreen({
  lang,
  run,
  preferences,
  onPreferences,
  onRun,
}: {
  lang: Lang;
  run: DemoRun;
  preferences: Preferences;
  onPreferences(p: Preferences): void;
  onRun(next: DemoRun | null): void;
}) {
  const d = demoExercise(run.id);
  // The coach of this run: its events, the summary's buttons it may press, and the sound switch.
  const push = useRef<CoachPush | null>(null);
  const toCoach = useMemo<CoachPush>(() => (e) => push.current?.(e), []);
  const [button, setButton] = useState<WorkoutButton | null>(null);
  const [over, setOver] = useState(false);
  const [sound, setSound] = useState(() => readSound());
  // A new run (Repeat) is a new coach segment with its own id.
  const runId = useMemo(() => newDemoRunId(), [run.id, run.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setOver(false), [runId]);
  if (!d) return null;
  const ways = {
    back: () => onRun(null),
    again: () => onRun({ ...run, n: run.n + 1 }),
    simulate: () => onRun({ ...run, simulated: true, n: run.n + 1 }),
  };
  const toggle = () => {
    const on = !sound;
    setSound(on);
    saveSound(on);
    if (on) unlockCoachAudio();
  };
  return (
    <>
      <Session
        key={`${run.id}-${run.n}`}
        lang={lang}
        preferences={preferences}
        onPreferences={onPreferences}
        {...demoSessionProps(d, run, ways)}
        coach={run.simulated ? undefined : toCoach}
        onCoachButton={setButton}
        sound={run.simulated ? undefined : { on: sound, toggle }}
        onComplete={() => setOver(true)}
      />
      {!run.simulated && (
        <Suspense fallback={null}>
          <DemoCoach
            key={runId}
            lang={lang}
            of={{ demo: d.id, run: runId }}
            preference={sound}
            stage="set"
            index={0}
            step={demoCoachStep(d)}
            position={d.setup.position}
            paused={false}
            onPause={() => undefined}
            push={push}
            onStopExercise={ways.back}
            remaining={0}
            press={ways.back}
            setButton={button}
            onExit={ways.back}
            over={over}
          />
        </Suspense>
      )}
    </>
  );
}

/** The list itself: pure, so it renders the same from a test. */
export function DemoList({
  lang,
  onLanguage,
  onBack,
  onStart,
}: {
  lang: Lang;
  onLanguage(): void;
  onBack(): void;
  onStart(id: string): void;
}) {
  const back = tV7(lang, "targets.program.back");
  return (
    <CheckRoot ui={{ lang }} page={false} className="fx">
      <Page
        lang={lang}
        top={<TopBar lang={lang} onLanguage={onLanguage} onLeave={onBack} leaveLabel={back} />}
        screen="demo_exercises"
      >
        <div className="pv7-program pv7-demos">
          <Glass className="fx-card pv7-hero">
            <Kicker>{tV7(lang, "targets.demo.kicker")}</Kicker>
            <Title>{tV7(lang, "targets.demo.title")}</Title>
            <Body lang={lang} text={tV7(lang, "targets.demo.intro")} />
            <Body lang={lang} text={tV7(lang, "targets.demo.note")} muted />
          </Glass>
          <ul className="pv7-demo-list" aria-label={tV7(lang, "targets.demo.listLabel")}>
            {DEMO_EXERCISES.map((d) => (
              <DemoCard key={d.id} lang={lang} d={d} onStart={() => onStart(d.id)} />
            ))}
          </ul>
          <Actions items={[{ label: back, onClick: onBack, name: "program", kind: "secondary" }]} />
        </div>
      </Page>
    </CheckRoot>
  );
}

/** One exercise: its picture, name, body area and how to sit to the camera, and Start. */
function DemoCard({ lang, d, onStart }: { lang: Lang; d: DemoExercise; onStart(): void }) {
  const name = demoName(d, lang);
  return (
    <li className="pv7-demo" data-exercise={d.id}>
      <Glass className="pv7-demo-card">
        <span className="pv7-demo-pic">
          <img src={d.picture} alt="" loading="lazy" decoding="async" />
        </span>
        <div className="pv7-demo-text">
          <h2 className="pv7-name">{name}</h2>
          <span className="pv7-demo-area">{tV7(lang, `targets.demo.area.${d.area}`)}</span>
          <p className="pv7-demo-view">
            <CheckIcon name="camera" size={18} />
            <span>{tV7(lang, `targets.demo.view.${d.view}`)}</span>
          </p>
        </div>
        <button
          type="button"
          className="fx-button is-primary pv7-demo-start"
          onClick={onStart}
          data-action="demo_start"
          aria-label={tV7(lang, "targets.demo.startName", { name })}
        >
          <CheckIcon name="play" size={20} />
          <span>{tV7(lang, "targets.demo.start")}</span>
        </button>
      </Glass>
    </li>
  );
}
