/**
 * The focus check (product v7 contract 1.2, stream B, step B3; D-032): the shell that runs a protocol
 * end to end: the day's one screen (D-032 item 2), the range blocks in C-13 order with the stop list and
 * sit before stand, the gait step (GaitStep, C) between the standing and lying blocks, and the complete
 * call, then the findings. It loads its own data (GET
 * /api/focus/context) and implements CoachHost for the range blocks (C-16) through its RomController.
 *
 * The logic is in session.ts (the flow, the calls, the controller) and romController.ts; this page
 * renders them, owns the one camera of the check (focusCameraSession, C-10, shared with the walk's
 * step through FocusCameraContext), feeds the frames to the controller, keeps the timers ticking,
 * plays the local lines when the voice is on (off by default) and passes the coach's events to the
 * coach (the live coach is off by default; stream D wires it, C-5).
 *
 * src/app/App.tsx opens it at /?focus=1 for a signed in person, in a VITE_V7=1 build only, and right
 * after the health form for a person whose program waits for the check (D-032 item 3, `onboarding`):
 * the end then plays the program's build and opens the program. On a VITE_E2E=1 build, ?e2ePerson=1
 * plays a simulated person instead of the camera (e2e/PersonSource.ts) and ?e2eFast=1 shortens the
 * rests.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Lang } from "../../app/i18n";
import { CuePlayer, isVoiceLine } from "../../app/audio";
import { readPreferences, savePreferences } from "../../app/experience";
import type { Frame } from "../../engine/types";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import { useCameraSession } from "../assessment/camera/session";
import { useOrientation, useWakeLock } from "../assessment/camera/hooks";
import type { Tilt } from "../../engine/quality";
import "../assessment/safety/safety.css";
import { fakeCoachRun, useCoach, useCoachStatus } from "../coach-agent/useCoach";
import { CueVoice } from "../coach-agent/LocalVoice";
import { CoachCaption } from "../coach-agent/CoachCaption";
import { COACH_ASK_LINES, liveCoachOn, romSegment } from "../coach-agent/hosts";
import { unlockCoachAudio } from "../coach-agent/audio/context";
import type { CoachMode, CoachSegment } from "../../coach/types";
import { useOnline } from "../assessment/shared/useOnline";
import { GaitStep } from "../gait/GaitStep";
import { focusCameraSession, FocusCameraContext, type FocusSourceFactory } from "./camera";
import { createFocusApi } from "./api";
import { FINDING_LABEL, voiceLineOf } from "./copy";
import { movementDef, romResultLine } from "../../movements/rom";
import { FocusSession } from "./session";
import { itemKey, type RomController } from "./romController";
import { Loading, TopBar, Page } from "./parts";
import { tV7 } from "../../i18n/v7";
import {
  BlockCard,
  MeasureScreen,
  PainStopScreen,
  ReaskScreen,
  ResultScreen,
  SetupCard,
  TimerScreen,
} from "./RangeScreens";
import {
  ClosedScreen,
  CompletingScreen,
  DoneScreen,
  FaintAskScreen,
  GaitSlot,
  IntroScreen,
  LeaveDialog,
  LoadErrorScreen,
  LoadingScreen,
  SafetyScreen,
  StartingScreen,
  StopListScreen,
  WalkPainScreen,
  WalkSkippedScreen,
} from "./Screens";
import { sciWarningOnce, type FocusExitTo } from "./flow";
import { Stage } from "./Stage";
import { t } from "../../i18n";
import "./focus.css";

/** Where the focus check leaves to (after a build, D-032 item 3: the program page or the Program tab). */
export type FocusExit = FocusExitTo;

/**
 * The program's build animation (D-032 item 3), its own lazy part: VITE_V7=1 builds only, the env
 * tested inline as for the v7 pages in App.tsx.
 */
const ProgramBuild =
  import.meta.env.VITE_V7 === "1" ? lazy(() => import("../onboarding/ProgramBuild")) : null;

export interface FocusAppProps {
  lang: Lang;
  onLanguage(): void;
  /** The signed in person's id: the owner of the check's waiting calls, as in the v1 check. */
  owner: string;
  /**
   * The person's program waits for the check (D-032 item 3): the end builds it, and «لا أستطيع
   * استخدام الكاميرا» builds it from the history.
   */
  onboarding?: boolean;
  /**
   * Leaves the focus check: "findings" after a completed check, "health" to answer the v7 intake
   * questions (409 INTAKE_UPDATE_REQUIRED), else "today".
   */
  onExit(to: FocusExit): void;
}

/** Coarse device facts for the start call (no model, no version: the server keeps the rest). */
export function focusDevice(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent) {
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "other";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "other";
  return { os, browser };
}

/** The E2E options of a VITE_E2E=1 build (read once): the simulated person and the fast rests. */
function e2eOptions(): { person: boolean; fast: boolean; reach: number } {
  if (import.meta.env.VITE_E2E !== "1" || typeof location === "undefined")
    return { person: false, fast: false, reach: 1 };
  const qs = new URLSearchParams(location.search);
  const reach = Number(qs.get("e2eReach") ?? "1");
  return {
    person: qs.get("e2ePerson") === "1",
    fast: qs.get("e2eFast") === "1",
    reach: Number.isFinite(reach) && reach > 0 && reach <= 1.5 ? reach : 1,
  };
}

const clock = () => performance.now();

/**
 * Whether a block's card waits for the camera's model probe (C-10): from the card's first frame until
 * the probe of this block ends; the camera still starting counts as waiting (its first frame starts the
 * probe), a camera that failed or stopped does not (there is nothing to probe).
 */
export function blockWaitsForProbe(
  blockKey: string | null,
  camStatus: "idle" | "model" | "camera" | "running" | "error",
  probe: { key: string; done: boolean } | null,
): boolean {
  if (blockKey === null || camStatus === "error" || camStatus === "idle") return false;
  return !(probe?.key === blockKey && probe.done);
}

export default function FocusApp({ lang, onLanguage, onExit, onboarding = false }: FocusAppProps) {
  const e2e = useMemo(e2eOptions, []);
  const sessionRef = useRef<FocusSession | null>(null);
  const focus = useMemo(() => {
    let createSource: FocusSourceFactory | undefined;
    if (import.meta.env.VITE_E2E === "1" && e2e.person) {
      createSource = async () => {
        const { PersonSource } = await import("./e2e/PersonSource");
        return new PersonSource(() => sessionRef.current?.ctl ?? null, { reach: e2e.reach });
      };
    }
    return focusCameraSession(createSource ? { createSource } : {});
  }, [e2e.person]);
  const session = useMemo(() => {
    const s = new FocusSession(createFocusApi(), {
      lang,
      now: clock,
      device: focusDevice(),
      onboarding,
      poseModel: () => focus.model,
      ...(e2e.fast ? { restSec: 1, sitSeconds: 8, stopRestSeconds: 6 } : {}),
    });
    sessionRef.current = s;
    return s;
  }, []);
  useEffect(() => session.setLang(lang), [lang, session]);

  // Every change of the session renders the page (a version counter).
  const version = useRef(0);
  const subscribe = useCallback(
    (fn: () => void) =>
      session.subscribe(() => {
        version.current++;
        fn();
      }),
    [session],
  );
  useSyncExternalStore(subscribe, () => version.current);
  useEffect(() => {
    void session.load();
  }, [session]);

  const m = session.model;
  const s = m.state;
  const ctl = session.ctl;
  const part = s.kind === "part" ? m.data.parts[s.index] : null;
  const rangeStep = part?.kind === "range" && ctl ? ctl.current : null;

  // The local lines: the voice pack when the voice is on (off by default), the caption always.
  const [soundOn, setSoundOn] = useState(() => readPreferences().voice === "full");
  const player = useMemo(() => new CuePlayer(lang), []);
  useEffect(() => player.setLang(lang), [lang, player]);
  useEffect(() => {
    player.muted = !soundOn;
  }, [soundOn, player]);
  // Step D5: while the live coach runs, the lines go through its local voice (the mic gate sees each
  // one) and the range questions are the coach's to ask (bridge rule 2, D-12).
  const voice = useMemo(() => new CueVoice(player), [player]);
  const coachMode = useRef<CoachMode>("off");
  useEffect(
    () =>
      session.onLine((l) => {
        const id = voiceLineOf(l.line);
        if (!soundOn || !isVoiceLine(id)) return;
        const severity = l.severity === "safety" ? "safety" : l.severity === "warn" ? "warn" : "info";
        if (coachMode.current === "off") void player.line(id, severity);
        else if (!COACH_ASK_LINES.has(id)) voice.say(id, severity);
      }),
    [session, soundOn, player, voice],
  );
  const toggleSound = () => {
    const on = !soundOn;
    setSoundOn(on);
    if (on) CuePlayer.unlock();
    savePreferences({ ...readPreferences(), voice: on ? "full" : "off" });
  };

  // The coach is an enhancement, never a dependency (C-5): off by default. With the person's switch,
  // the live_coach consent and a network (step D5), each range block is a coach segment (C-6:
  // rom:<block>:1, then :2 after its fifth movement) with the RomController as its host; the walk's
  // segment is GaitStep's own.
  const { online } = useOnline();
  const coachWanted = readPreferences().liveCoach && m.data.context?.consent.live_coach === true;
  // D-030 D5-12: the server says it can run the coach now (the e2e fake coach needs no key).
  const coachStatus = useCoachStatus(coachWanted);
  const coachOn = liveCoachOn({
    preference: readPreferences().liveCoach,
    consent: m.data.context?.consent.live_coach === true,
    online,
    available: coachStatus?.available === true || fakeCoachRun(),
  });
  const lastSegment = useRef<CoachSegment | null>(null);
  let romSeg: CoachSegment | null = null;
  if (part?.kind === "range" && ctl && m.data.check) {
    const step = ctl.current;
    const item = "item" in step ? step.item : null;
    const kept = lastSegment.current?.startsWith(`rom:${part.block}:`) ? lastSegment.current : null;
    romSeg = item || !kept ? romSegment(m.data.check.protocol, part.block, item) : kept;
    lastSegment.current = romSeg;
  }
  const coach = useCoach(
    coachOn && romSeg && ctl && m.data.check
      ? { block: "rom", segment: romSeg, lang, ref: { checkId: m.data.check.id }, host: ctl, local: voice }
      : null,
  );
  coachMode.current = coach.mode;
  useEffect(() => session.onBridge((e) => coach.push(e)), [session, coach]);

  // The phone's orientation (v1's camera screens' hook): the picture's roll for the true vertical
  // movements and the gravity reference, and the tilt for the setup's level check. iOS asks for it
  // inside the intro's start tap (the gesture it needs); without a reading the roll is unknown (null).
  const orientation = useOrientation();
  const tilt = useRef<Tilt | null>(null);
  tilt.current = orientation.tilt;

  // The camera: on through a range part (the preview on the block's card, the measurement).
  const frame = useRef<Frame | null>(null);
  const cameraOn =
    !!rangeStep && rangeStep.kind !== "end" && rangeStep.kind !== "ended" && rangeStep.kind !== "sit";
  const cam = useCameraSession(
    (f) => {
      frame.current = f;
      session.ctl?.feed(f, { rollDeg: tilt.current?.rollDeg ?? null, tilt: tilt.current });
    },
    cameraOn,
    focus.session,
  );
  useWakeLock();

  // The model: preloaded on the intro, probed at each block's card (C-10), and the card's «جاهز»
  // waits for the probe, so the model is chosen before the block measures and never swapped mid
  // attempt (a probe that switches to Lite rebuilds the pose source); a camera that cannot run has
  // nothing to probe and does not hold the card.
  useEffect(() => {
    if (s.kind === "intro") focus.preload("rom");
  }, [s.kind, focus]);
  const blockKey = rangeStep?.kind === "block" && s.kind === "part" ? `${s.index}` : null;
  const [probe, setProbe] = useState<{ key: string; done: boolean } | null>(null);
  useEffect(() => {
    if (blockKey === null || cam.status !== "running" || probe?.key === blockKey) return;
    setProbe({ key: blockKey, done: false });
    void focus
      .probe("rom")
      .catch(() => null)
      .finally(() => setProbe((p) => (p?.key === blockKey ? { key: blockKey, done: true } : p)));
  }, [blockKey, cam.status, focus, probe?.key]);
  const blockWaiting = blockWaitsForProbe(blockKey, cam.status, probe);

  // Timers: the rests and the minute tick on without frames; the countdown is redrawn.
  const [now, setNow] = useState(clock);
  useEffect(() => {
    if (!part || part.kind !== "range") return;
    const id = setInterval(() => {
      const tNow = clock();
      session.ctl?.tick(tNow);
      setNow(tNow);
    }, 250);
    return () => clearInterval(id);
  }, [part, session]);

  // The system Back asks before leaving mid check (v1 S15): one pushed history entry.
  const [leaving, setLeaving] = useState(false);
  // What of the walk's slot shows, as the walk says (D-030 C4-7); its first card shows both.
  const [walkChrome, setWalkChrome] = useState({ hero: true, skip: true });
  // The build animation ended (its Continue or Skip): the shell's page comes back (D-032 item 3).
  const [buildPlayed, setBuildPlayed] = useState(false);
  // Leaving asks first only once the check runs; the day's screen leaves at once, nothing is lost
  // there (D-032 item 2: no extra confirmation that is not about stopping).
  const midCheck = s.kind === "part" || s.kind === "walk_pain" || s.kind === "walk_skipped";
  const midRef = useRef(midCheck);
  midRef.current = midCheck;
  useLayoutEffect(() => {
    window.history.pushState({ azmFocus: 1 }, "");
    const onPop = () => {
      if (midRef.current) {
        setLeaving(true);
        window.history.pushState({ azmFocus: 1 }, "");
      } else onExit("today");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Leaving: the exit states and the findings.
  useEffect(() => {
    if (s.kind === "exit") onExit(s.to);
  }, [s, onExit]);

  // E2E builds only: the review screenshots and the specs read the session.
  useEffect(() => {
    if (import.meta.env.VITE_E2E !== "1") return;
    (window as unknown as { azmFocus?: FocusSession }).azmFocus = session;
  }, [session]);

  const today = () => session.dispatch({ type: "EXIT", to: "today" });
  const parts = m.data.parts;
  const progress =
    s.kind === "part" || s.kind === "walk_pain" || s.kind === "walk_skipped"
      ? { done: s.index, total: parts.length }
      : s.kind === "completing" || s.kind === "done" || s.kind === "build"
        ? { done: parts.length, total: parts.length }
        : null;
  const entry = s.kind === "loading" || s.kind === "intro" || s.kind === "closed" || s.kind === "load_error";
  const top = (
    <TopBar
      lang={lang}
      progress={progress}
      sound={{ on: soundOn, toggle: toggleSound }}
      onLanguage={entry ? onLanguage : null}
      onLeave={s.kind === "done" || s.kind === "build" ? null : midCheck ? () => setLeaving(true) : today}
    />
  );
  const env = m.data.context?.env ?? null;
  const stopOpen = session.stopListOpen;

  const content = (() => {
    switch (s.kind) {
      case "loading":
        return { screen: "loading", node: <LoadingScreen lang={lang} /> };
      case "load_error":
        return {
          screen: "load_error",
          node: (
            <LoadErrorScreen
              lang={lang}
              onRetry={() => session.dispatch({ type: "RETRY" })}
              onToday={today}
            />
          ),
        };
      case "closed":
        return {
          screen: `closed_${s.why}`,
          node: (
            <ClosedScreen
              lang={lang}
              why={s.why}
              until={s.until ?? null}
              lock={s.lock ?? null}
              now={Date.now()}
              onToday={today}
              onHealth={() => session.dispatch({ type: "EXIT", to: "health" })}
            />
          ),
        };
      case "intro":
        return {
          screen: "intro",
          node: (
            <IntroScreen
              lang={lang}
              protocol={m.data.context!.protocol!}
              gait={m.data.context!.gait}
              setting={m.data.context!.setting}
              sciWarning={sciWarningOnce(m.data.context!.env)}
              onNoCamera={onboarding ? () => session.dispatch({ type: "BUILD", from: "history" }) : undefined}
              wheelchair={m.data.intake?.mobility === "wheelchair"}
              onStart={() => {
                CuePlayer.unlock();
                if (coachOn) unlockCoachAudio();
                // iOS: the motion permission is asked inside a tap (v1's camera primer does the same).
                orientation.askAgain();
                session.dispatch({ type: "BEGIN" });
              }}
            />
          ),
        };
      case "starting":
        return {
          screen: "starting",
          node: (
            <StartingScreen
              lang={lang}
              error={s.error}
              onRetry={() => session.dispatch({ type: "RETRY" })}
              onToday={today}
            />
          ),
        };
      case "postponed":
        return {
          screen: `postponed_${s.status}`,
          node: (
            <SafetyScreen
              lang={lang}
              screen={s.screen}
              alsoShow={s.alsoShow}
              lock={s.lock}
              now={Date.now()}
              next={{ label: t(lang, "assessment.common.backToToday"), onClick: today, name: "today" }}
            />
          ),
        };
      case "walk_pain":
        return {
          screen: "walk_pain",
          node: (
            <WalkPainScreen
              key={`${s.index}:${s.k}`}
              lang={lang}
              region={s.regions[s.k]}
              onAnswer={(value) => session.answerWalkPain(value)}
            />
          ),
        };
      case "walk_skipped":
        return {
          screen: "walk_skipped",
          node: <WalkSkippedScreen lang={lang} onContinue={() => session.dispatch({ type: "SEEN" })} />,
        };
      case "stop_screen":
        return {
          screen: "stop_screen",
          node: (
            <SafetyScreen
              lang={lang}
              screen={s.route.screen}
              alsoShow={s.route.alsoShow}
              now={Date.now()}
              next={
                s.route.then === "sf_faint_loc"
                  ? {
                      label: t(lang, "assessment.common.continue"),
                      onClick: () => session.dispatch({ type: "SEEN" }),
                      name: "continue",
                    }
                  : {
                      label: t(lang, "assessment.common.backToToday"),
                      onClick: () => session.dispatch({ type: "SEEN" }),
                      name: "today",
                    }
              }
            />
          ),
        };
      case "faint_ask":
        return {
          screen: "faint_ask",
          node: (
            <FaintAskScreen
              lang={lang}
              back={s.route.screen}
              onAnswer={(value) => session.dispatch({ type: "FAINT_ANSWER", value, now: Date.now() })}
            />
          ),
        };
      case "part":
        if (part?.kind === "gait")
          return {
            screen: "gait",
            node: (
              <GaitSlot
                lang={lang}
                onSkip={() => session.gaitDone()}
                hero={walkChrome.hero}
                skip={walkChrome.skip}
              >
                <GaitStep
                  plan={m.data.check!.gait!}
                  checkId={m.data.check!.id}
                  lang={lang}
                  painBefore={session.walkBefore}
                  coach={(e) => coach.push(e)}
                  coachOn={coachOn}
                  onDone={() => session.gaitDone()}
                  onStop={(preselect) => session.requestStop(preselect ?? null)}
                  onSkip={() => session.gaitDone()}
                  onChrome={setWalkChrome}
                />
              </GaitSlot>
            ),
          };
        return rangeContent(ctl!, now);
      case "completing":
        return {
          screen: "completing",
          node: (
            <CompletingScreen
              lang={lang}
              error={s.error}
              onRetry={() => session.dispatch({ type: "RETRY" })}
            />
          ),
        };
      case "done":
        return {
          screen: "done",
          node: (
            <DoneScreen
              lang={lang}
              measured={m.data
                .check!.protocol.items.filter((i) => !i.skipped)
                .map((item) => {
                  const result = ctl?.resultOf(item) ?? null;
                  const finding = result
                    ? (session.grades.get(itemKey(item))?.grade.finding ?? ctl!.findingOf(result))
                    : null;
                  const key = finding ? FINDING_LABEL[finding] : undefined;
                  return {
                    item,
                    value: result?.status === "not_measured" ? null : (result?.value ?? null),
                    label: key ? romResultLine(key)[lang] : null,
                    lack: movementDef(item.movementId).kind === "lack",
                  };
                })}
              onFindings={() => session.dispatch({ type: "EXIT", to: "findings" })}
            />
          ),
        };
      case "build": {
        // The animation is a whole screen of its own (its wordmark and Skip), so it plays outside the
        // shell's page; the page comes back for a quiet line if the build still runs when it ends.
        const summary = session.build?.summary;
        if (ProgramBuild && !buildPlayed)
          return {
            screen: `build_${s.from}`,
            bare: true,
            node: (
              <Suspense fallback={null}>
                <ProgramBuild
                  lang={lang}
                  onDone={() => setBuildPlayed(true)}
                  {...(summary ? { summary } : {})}
                />
              </Suspense>
            ),
          };
        return {
          screen: `build_${s.from}`,
          node: (
            <BuildWait
              lang={lang}
              done={session.build?.done === true}
              onBuilt={() => session.dispatch({ type: "BUILT" })}
            />
          ),
        };
      }
      case "exit":
        return { screen: "exit", node: <LoadingScreen lang={lang} /> };
    }
  })();

  function rangeContent(
    c: RomController,
    tNow: number,
  ): { screen: string; node: React.ReactNode; step?: string } {
    const step = c.current;
    const runs = m.data.check!.protocol.items.filter((i) => !i.skipped);
    const indexOf = (i: { movementId: string; side: string }) =>
      runs.findIndex((x) => itemKey(x) === itemKey(i as never)) + 1;
    switch (step.kind) {
      case "block":
        return {
          screen: `block_${step.block}`,
          node: (
            <BlockCard
              lang={lang}
              block={step.block}
              items={step.items}
              helper={step.helper}
              stage={<Stage video={cam.video} frame={frame} highlight={[]} compact />}
              waiting={blockWaiting}
              cameraError={cam.status === "error"}
              onNoCamera={onboarding ? () => session.dispatch({ type: "BUILD", from: "history" }) : undefined}
              onReady={() => {
                if (coachOn) unlockCoachAudio();
                if (!blockWaiting) c.ready(clock());
              }}
              onStop={() => session.requestStop()}
            />
          ),
        };
      case "reask":
        return {
          screen: "reask",
          node: (
            <ReaskScreen
              key={itemKey(step.item)}
              lang={lang}
              item={step.item}
              onAnswer={(n) => c.answerReask(n, clock())}
              onStop={() => session.requestStop()}
            />
          ),
        };
      case "setup":
        return {
          screen: "setup",
          node: (
            <SetupCard
              key={itemKey(step.item)}
              lang={lang}
              item={step.item}
              n={indexOf(step.item)}
              total={runs.length}
              turnSide={step.turnSide}
              wheelchair={m.data.intake?.mobility === "wheelchair"}
              onReady={() => c.ready(clock())}
              onStop={() => session.requestStop()}
            />
          ),
        };
      case "measure":
        return {
          // data-screen names the phase; the column stays mounted for the whole movement (no replayed
          // entrance or lost focus at each phase).
          screen: `measure_${c.phase ?? "idle"}`,
          step: `measure:${itemKey(step.item)}`,
          node: (
            <MeasureScreen
              lang={lang}
              ctl={c}
              item={step.item}
              n={indexOf(step.item)}
              total={runs.length}
              video={cam.video}
              frame={frame}
              clock={clock}
              now={tNow}
              onStop={() => session.requestStop()}
            />
          ),
        };
      case "pain_stop":
        return {
          screen: "pain_stop",
          node: (
            <PainStopScreen
              lang={lang}
              item={step.item}
              onContinue={() => {
                c.acknowledge(clock());
                coach.reopen();
              }}
              onStop={() => session.requestStop()}
            />
          ),
        };
      case "result": {
        const last = runs[runs.length - 1];
        return {
          screen: `result_${step.result.status}`,
          node: (
            <ResultScreen
              key={itemKey(step.item)}
              lang={lang}
              ctl={c}
              item={step.item}
              result={step.result}
              saved={session.grades.get(itemKey(step.item)) ?? null}
              intake={m.data.intake}
              last={!!last && itemKey(last) === itemKey(step.item)}
              onNext={() => c.next(clock())}
              onStop={() => session.requestStop()}
            />
          ),
        };
      }
      case "rest":
      case "sit":
        return {
          screen: step.kind === "sit" ? "sit" : "stop_rest",
          node: (
            <TimerScreen
              lang={lang}
              kind={step.kind}
              leftMs={c.timerLeft(tNow)}
              totalMs={step.total}
              {...(step.kind === "sit" && step.last ? { last: step.last } : {})}
              standing={step.kind === "sit" && step.standing !== undefined}
              onNext={() => c.next(clock())}
              onStop={() => session.requestStop()}
            />
          ),
        };
      default:
        return { screen: "range_wait", node: <LoadingScreen lang={lang} /> };
    }
  }

  return (
    <FocusCameraContext.Provider value={focus}>
      <CheckRoot
        ui={{ lang, booth: m.data.context?.setting === "booth", sound: { on: soundOn, toggle: toggleSound } }}
        page={false}
        className="fx"
      >
        {"bare" in content ? (
          <div className="fx-bare" data-screen={content.screen}>
            {content.node}
          </div>
        ) : (
          <Page
            lang={lang}
            top={top}
            screen={content.screen}
            step={"step" in content ? content.step : undefined}
            wide={!!rangeStep && rangeStep.kind === "measure"}
          >
            {content.node}
          </Page>
        )}
        {/* The live coach's words while it speaks (voice and captions together, step D5). */}
        {!stopOpen && <CoachCaption coach={coach} lang={lang} />}
        {stopOpen && env && (
          <StopListScreen
            lang={lang}
            env={env}
            preselect={session.stopOutside?.preselect ?? ctl?.stopList?.preselect ?? null}
            onChoose={(option) =>
              void session.chooseStop(option).then((r) => {
                if (r && !r.endsCheck) coach.reopen();
              })
            }
          />
        )}
        {leaving && (
          <LeaveDialog
            lang={lang}
            lying={part?.kind === "range" && part.block === "lying"}
            onStay={() => setLeaving(false)}
            onLeave={() => {
              setLeaving(false);
              today();
            }}
          />
        )}
      </CheckRoot>
    </FocusCameraContext.Provider>
  );
}

/**
 * The program's build (D-032 item 3) once its animation has ended, or with no animation to play: the
 * program opens as soon as the build call is done. Until then (the weekly AI can take longer than the
 * animation) a quiet line says the program is opening, which the animation's «برنامجك جاهز» leads to.
 */
function BuildWait({ lang, done, onBuilt }: { lang: Lang; done: boolean; onBuilt(): void }) {
  const built = useRef(false);
  useEffect(() => {
    if (!done || built.current) return;
    built.current = true;
    onBuilt();
  }, [done, onBuilt]);
  return done ? null : <Loading text={tV7(lang, "rom.onboarding.opening")} />;
}
