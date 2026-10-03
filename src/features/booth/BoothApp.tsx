/**
 * The booth v2 journey (contract C), /?booth=1 on the staff tablet or phone.
 *
 *   code     the staff code (the existing BoothCodeForm and POST /api/booth/verify); the server's
 *            pass of the booth day is kept for this tab only and ends at closing time
 *   journey  the booth home with its two doors, then the six steps (journey.ts), the camera screen
 *            in variant "booth", a small staff menu (new visitor, language, the coach voice) and the
 *            staff shortcut (Alt Shift N); steps 5 and 6 go back to the doors after 90 s idle
 *
 * The parked movement check is not linked from here (D-018). Nothing is stored: the visitor's
 * answers, the report, the result and the plan live in this page's memory until the next reset.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Brand from "../../app/Brand";
import type { Lang } from "../../app/i18n";
import { primeAudio } from "../../app/audio";
import { readPreferences, savePreferences, type Preferences } from "../../app/experience";
import { preloadPoseAssets } from "../../app/poseSource";
import type { SessionSummary } from "../../engine/types";
import { t } from "../../i18n";
import { createCheckApi } from "../assessment/api";
import { BoothCodeForm } from "../assessment/booth/CodeForm";
import { isStaffShortcut } from "../assessment/booth/tools";
import { clearBoothPass, readBoothPass, saveStaffSession, type BoothPass } from "../assessment/boothMode";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import BoothIcon from "./BoothIcon";
import { boothCopy } from "./copy";
import { EngineStep, GoalStep } from "./Engine";
import Home from "./Home";
import {
  BOOTH_EXERCISE,
  BOOTH_REPS,
  IDLE_MS,
  IDLE_NOTE_MS,
  START,
  cameraSetup,
  dotOf,
  idleResets,
  journeyPlan,
  journeyReducer,
} from "./journey";
import { Dots } from "./parts";
import { ProgramStep } from "./Program";
import { AboutStep, ReportStep } from "./Report";
import { ResultsStep } from "./Results";
import { SafetyStep, StopStep } from "./Safety";
import "./booth.css";

const loadSession = () => import("../../app/Session");
const Session = lazy(loadSession);

export interface BoothAppProps {
  lang: Lang;
  onLanguage(): void;
}

export default function BoothApp({ lang, onLanguage }: BoothAppProps) {
  const [pass, setPass] = useState<BoothPass | null>(() => readBoothPass());
  // The staff session ends at closing time: the page turns back to the code by itself.
  useEffect(() => {
    if (!pass || pass.kind === "e2e") return;
    const timer = setTimeout(() => setPass(readBoothPass()), Math.max(0, pass.expires - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [pass]);
  if (!pass) return <CodeGate lang={lang} onLanguage={onLanguage} onPass={() => setPass(readBoothPass())} />;
  return (
    <Journey
      lang={lang}
      onLanguage={onLanguage}
      session={pass.kind === "staff" ? pass.session : ""}
      onOff={() => {
        clearBoothPass();
        setPass(null);
      }}
    />
  );
}

/* ------------------------------------------------------------------ the staff code */

function CodeGate({ lang, onLanguage, onPass }: { lang: Lang; onLanguage(): void; onPass(): void }) {
  const k = boothCopy(lang);
  const api = useMemo(() => createCheckApi(), []);
  return (
    <div className="bx bx-gate" data-screen="code">
      <Glows />
      <header className="bx-top">
        <Brand />
        <span />
        <button type="button" className="bx-lang" onClick={onLanguage}>
          <BoothIcon name="globe" size={18} />
          {k.staffLanguage}
        </button>
      </header>
      <main className="bx-main">
        <section className="bx-gate-card">
          <span className="bx-gate-icon" aria-hidden="true">
            <BoothIcon name="shield" size={30} />
          </span>
          <h1>{t(lang, "assessment.booth.title")}</h1>
          <p className="bx-lead">{k.codeBody}</p>
          <CheckRoot ui={{ lang }} page={false} className="bx-code">
            <BoothCodeForm
              api={api}
              onVerified={(session, expires) => {
                saveStaffSession(session, expires);
                onPass();
              }}
            />
          </CheckRoot>
        </section>
      </main>
    </div>
  );
}

function Glows() {
  return (
    <>
      <span className="bx-glow gold" aria-hidden="true" />
      <span className="bx-glow violet" aria-hidden="true" />
    </>
  );
}

/* ------------------------------------------------------------------ the journey */

function Journey({
  lang,
  onLanguage,
  session,
  onOff,
}: {
  lang: Lang;
  onLanguage(): void;
  session: string;
  onOff(): void;
}) {
  const k = boothCopy(lang);
  const [j, dispatch] = useReducer(journeyReducer, START);
  const [prefs, setPrefs] = useState<Preferences>(readPreferences);
  const [menu, setMenu] = useState(false);
  // The camera's demo (a synthetic person) when the camera cannot start: its result is tagged Example.
  const [demoCam, setDemoCam] = useState(false);
  // The set is done: a calm "well done" over the camera, then the results slide in.
  const [done, setDone] = useState<SessionSummary | null>(null);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(
      () => {
        dispatch({ type: "CAMERA_DONE", summary: done });
        setDone(null);
      },
      reducedMotion() ? 600 : DONE_MS,
    );
    return () => clearTimeout(timer);
  }, [done]);
  const updatePrefs = useCallback((p: Preferences) => {
    setPrefs(p);
    savePreferences(p);
  }, []);
  const reset = useCallback(() => {
    setMenu(false);
    setDemoCam(false);
    setDone(null);
    dispatch({ type: "RESET" });
  }, []);

  const planned = useMemo(
    () => (j.door ? journeyPlan(j) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [j.door, j.self, j.reading, j.goal, j.sport],
  );

  // Who moves in front of the camera: one setup per journey, so the camera screen's profile holds.
  const setup = useMemo(
    () => cameraSetup(j),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [j.door, j.self.position, j.self.side],
  );

  // Staff reset at any time, the camera included: Alt Shift N (the booth's staff shortcut, S57).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isStaffShortcut(e)) {
        e.preventDefault();
        reset();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [reset]);

  // The camera's code and model come ahead, while the goal is chosen.
  useEffect(() => {
    if (j.step === "goal" || j.step === "safety") {
      void loadSession().catch(() => undefined);
      preloadPoseAssets();
    }
  }, [j.step]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [j.step, j.tap]);

  const idle = useIdle(idleResets(j.step), reset);

  if (j.step === "camera")
    return (
      <Suspense fallback={<div className="bx bx-loading" />}>
        {done && <WellDone lang={lang} summary={done} />}
        <Session
          key={j.attempt}
          lang={lang}
          setup={setup}
          exerciseId={BOOTH_EXERCISE}
          targetReps={BOOTH_REPS}
          demo={demoCam}
          variant="booth"
          preferences={prefs}
          onPreferences={updatePrefs}
          onExit={() => dispatch({ type: "CAMERA_EXIT" })}
          onRestart={() => undefined}
          onDemo={() => setDemoCam(true)}
          onComplete={(summary) => setDone(summary)}
        />
      </Suspense>
    );

  const dot = dotOf(j.step);
  let screen: React.ReactNode = null;
  switch (j.step) {
    case "home":
      screen = <Home lang={lang} onOpen={(door) => dispatch({ type: "OPEN", door })} />;
      break;
    case "report":
      screen = (
        <ReportStep
          lang={lang}
          session={session}
          reading={j.reading}
          onRead={(extraction, source) => dispatch({ type: "READ", extraction, source })}
          onBack={() => dispatch({ type: "BACK" })}
          onNext={() => dispatch({ type: "NEXT" })}
        />
      );
      break;
    case "about":
      screen = (
        <AboutStep
          lang={lang}
          session={session}
          journey={j}
          onTap={(answers) => dispatch({ type: "TAP", answers })}
          onRead={(extraction) => dispatch({ type: "READ", extraction, source: "live" })}
          onBack={() => dispatch({ type: "BACK" })}
          onNext={() => dispatch({ type: "NEXT" })}
        />
      );
      break;
    case "engine":
      screen = planned && (
        <EngineStep
          lang={lang}
          door={j.door!}
          intake={planned.intake}
          plan={planned.plan}
          onBack={() => dispatch({ type: "BACK" })}
          onNext={() => dispatch({ type: "NEXT" })}
        />
      );
      break;
    case "goal":
      screen = (
        <GoalStep
          lang={lang}
          door={j.door!}
          position={planned?.intake.mobility ?? "seated"}
          goal={j.goal}
          sport={j.sport}
          onGoal={(goal) => dispatch({ type: "GOAL", goal })}
          onSport={(sport) => dispatch({ type: "SPORT", sport })}
          onBack={() => dispatch({ type: "BACK" })}
          onNext={() => dispatch({ type: "NEXT" })}
        />
      );
      break;
    case "safety":
      screen = (
        <SafetyStep
          lang={lang}
          onBack={() => dispatch({ type: "BACK" })}
          onAnswer={(unwell) => {
            // Inside the tap: iOS lets the coach's voice play later only if a tap started the audio.
            if (!unwell && prefs.voice !== "off") primeAudio(lang);
            setDemoCam(false);
            dispatch({ type: "SAFETY", unwell });
          }}
        />
      );
      break;
    case "stop":
      screen = <StopStep lang={lang} onReset={reset} />;
      break;
    case "results":
      screen = j.summary && (
        <ResultsStep
          lang={lang}
          summary={j.summary}
          demo={demoCam}
          onRetry={() => {
            setDemoCam(false);
            dispatch({ type: "RETRY" });
          }}
          onNext={() => dispatch({ type: "NEXT" })}
        />
      );
      break;
    case "program":
      screen = planned && (
        <ProgramStep
          lang={lang}
          door={j.door!}
          session={session}
          intake={planned.intake}
          plan={planned.plan}
          onBack={() => dispatch({ type: "BACK" })}
          onReset={reset}
        />
      );
      break;
  }

  return (
    <div className="bx" data-step={j.step} data-door={j.door ?? ""}>
      <Glows />
      <header className="bx-top">
        <Brand />
        {dot >= 0 ? <Dots lang={lang} dot={dot} /> : <span />}
        <button
          type="button"
          className={`bx-menu-button${menu ? " open" : ""}`}
          aria-label={k.staff}
          aria-expanded={menu}
          onClick={() => setMenu((m) => !m)}
          data-action="staff"
        >
          <BoothIcon name="menu" size={24} />
        </button>
      </header>
      <main className="bx-main">
        <div className="bx-step" key={`${j.step}:${j.tap}:${j.attempt}`} data-dir={j.dir}>
          {screen}
        </div>
      </main>
      {menu && (
        <StaffMenu
          lang={lang}
          voice={prefs.voice === "full"}
          onVoice={(on) => updatePrefs({ ...prefs, voice: on ? "full" : "off" })}
          onLanguage={onLanguage}
          onReset={reset}
          onOff={onOff}
          onClose={() => setMenu(false)}
        />
      )}
      {idle.warn && (
        <div className="bx-idle" role="status" data-idle="">
          <BoothIcon name="reset" size={22} />
          <span>{k.idleTitle}</span>
          <button type="button" className="bx-quiet" onClick={idle.stay}>
            {k.idleStay}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the end of the set */

/** How long the "well done" moment stays over the camera before the results. */
const DONE_MS = 1700;

function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function WellDone({ lang, summary }: { lang: Lang; summary: SessionSummary }) {
  const k = boothCopy(lang);
  const reps = summary.reps.valid + summary.reps.compensated;
  return (
    <div className="bx-done" role="status" data-done="">
      <div className="bx-done-card">
        <span className="bx-done-check" aria-hidden="true">
          <BoothIcon name="check" size={40} />
        </span>
        <b>{reps > 0 ? k.wellDone : k.setEnded}</b>
        {reps > 0 && <span>{k.repsDone(reps)}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ staff menu */

function StaffMenu({
  lang,
  voice,
  onVoice,
  onLanguage,
  onReset,
  onOff,
  onClose,
}: {
  lang: Lang;
  voice: boolean;
  onVoice(on: boolean): void;
  onLanguage(): void;
  onReset(): void;
  onOff(): void;
  onClose(): void;
}) {
  const k = boothCopy(lang);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <button type="button" className="bx-scrim" aria-label={k.close} onClick={onClose} tabIndex={-1} />
      <div className="bx-menu" role="dialog" aria-label={k.staff} data-staff-menu="">
        <p className="bx-menu-title">{k.staff}</p>
        <button
          ref={first}
          type="button"
          className="bx-menu-item primary"
          onClick={onReset}
          data-action="reset"
        >
          <BoothIcon name="reset" />
          {k.staffReset}
        </button>
        <button
          type="button"
          className="bx-menu-item"
          onClick={() => {
            onLanguage();
            onClose();
          }}
          data-action="language"
        >
          <BoothIcon name="globe" />
          {k.staffLanguage}
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={voice}
          className={`bx-menu-item switch${voice ? " on" : ""}`}
          onClick={() => onVoice(!voice)}
          data-action="voice"
        >
          <BoothIcon name="sound" />
          <span>{k.staffVoice}</span>
          <span className="bx-switch" aria-hidden="true">
            <i />
          </span>
          <small>{voice ? k.voiceOn : k.voiceOff}</small>
        </button>
        <button type="button" className="bx-menu-item quiet" onClick={onOff} data-action="off">
          <BoothIcon name="power" />
          {k.staffOff}
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ idle */

/**
 * Contract C9: on steps 5 and 6, 90 s without a touch, a key or a scroll go back to the doors; a calm
 * note shows shortly before (no countdown numbers), and any touch keeps the visitor's screen.
 */
function useIdle(active: boolean, onReset: () => void) {
  const [warn, setWarn] = useState(false);
  const last = useRef(Date.now());
  const stay = useCallback(() => {
    last.current = Date.now();
    setWarn(false);
  }, []);
  useEffect(() => {
    setWarn(false);
    if (!active) return;
    last.current = Date.now();
    const bump = () => {
      last.current = Date.now();
      setWarn(false);
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    const timer = setInterval(() => {
      const quiet = Date.now() - last.current;
      if (quiet >= IDLE_MS) onReset();
      else setWarn(quiet >= IDLE_MS - IDLE_NOTE_MS);
    }, 500);
    return () => {
      clearInterval(timer);
      for (const e of events) window.removeEventListener(e, bump);
    };
  }, [active, onReset]);
  return { warn, stay };
}
