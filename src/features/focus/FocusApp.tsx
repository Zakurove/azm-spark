/**
 * The focus check (product v7 contract 1.2, stream B, step B3): the shell that runs a protocol end to
 * end: the v1 pre-check through the bridge, the today questions with rf_region, the range blocks in
 * C-13 order with the stop list and sit before stand, the gait step (GaitStep, C) between the standing
 * and lying blocks, and the complete call, then the findings. It loads its own data (GET
 * /api/focus/context) and implements CoachHost for the range blocks (C-16) through its RomController.
 *
 * The logic is in session.ts (the flow, the calls, the controller) and romController.ts; this page
 * renders them, owns the one camera of the check (focusCameraSession, C-10, shared with the walk's
 * step through FocusCameraContext), feeds the frames to the controller, keeps the timers ticking,
 * plays the local lines when the voice is on (off by default) and passes the coach's events to the
 * coach (the live coach is off by default; stream D wires it, C-5).
 *
 * src/app/App.tsx opens it at /?focus=1 for a signed in person, in a VITE_V7=1 build only. On a
 * VITE_E2E=1 build, ?e2ePerson=1 plays a simulated person instead of the camera (e2e/PersonSource.ts)
 * and ?e2eFast=1 shortens the rests.
 */
import {
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
import { useWakeLock } from "../assessment/camera/hooks";
import "../assessment/safety/safety.css";
import { useCoach } from "../coach-agent/useCoach";
import { GaitStep } from "../gait/GaitStep";
import { focusCameraSession, FocusCameraContext, type FocusSourceFactory } from "./camera";
import { createFocusApi } from "./api";
import { FINDING_LABEL, voiceLineOf } from "./copy";
import { romResultLine } from "../../movements/rom";
import { FocusSession } from "./session";
import { itemKey, type RomController } from "./romController";
import { TopBar, Page } from "./parts";
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
  ConsentScreen,
  DoneScreen,
  FaintAskScreen,
  GaitSlot,
  IntroScreen,
  LeaveDialog,
  LoadErrorScreen,
  LoadingScreen,
  QuestionScreen,
  SafetyScreen,
  StartingScreen,
  StopListScreen,
  TodayScreen,
} from "./Screens";
import { Stage } from "./Stage";
import { t } from "../../i18n";
import { tV7 } from "../../i18n/v7";
import "./focus.css";

/** Where the focus check leaves to. */
export type FocusExit = "today" | "findings" | "health";

export interface FocusAppProps {
  lang: Lang;
  onLanguage(): void;
  /** The signed in person's id: the owner of the check's waiting calls, as in the v1 check. */
  owner: string;
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

export default function FocusApp({ lang, onLanguage, onExit }: FocusAppProps) {
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
  useEffect(
    () =>
      session.onLine((l) => {
        const id = voiceLineOf(l.line);
        if (soundOn && isVoiceLine(id))
          void player.line(id, l.severity === "safety" ? "safety" : l.severity === "warn" ? "warn" : "info");
      }),
    [session, soundOn, player],
  );
  const toggleSound = () => {
    const on = !soundOn;
    setSoundOn(on);
    if (on) CuePlayer.unlock();
    savePreferences({ ...readPreferences(), voice: on ? "full" : "off" });
  };

  // The coach is an enhancement, never a dependency (C-5): off by default; stream D gives it the
  // options (the segment, the host, the local voice) when the person turned it on and consented.
  const coach = useCoach(null);
  useEffect(() => session.onBridge((e) => coach.push(e)), [session, coach]);

  // The camera: on through a range part (the preview on the block's card, the measurement).
  const frame = useRef<Frame | null>(null);
  const cameraOn =
    !!rangeStep && rangeStep.kind !== "end" && rangeStep.kind !== "ended" && rangeStep.kind !== "sit";
  const cam = useCameraSession(
    (f) => {
      frame.current = f;
      session.ctl?.feed(f, {});
    },
    cameraOn,
    focus.session,
  );
  useWakeLock();

  // The model: preloaded on the intro, probed at each block's card (C-10).
  useEffect(() => {
    if (s.kind === "intro") focus.preload("rom");
  }, [s.kind, focus]);
  const probedBlock = useRef<string>("");
  useEffect(() => {
    if (rangeStep?.kind !== "block" || cam.status !== "running") return;
    const key = `${s.kind === "part" ? s.index : ""}`;
    if (probedBlock.current === key) return;
    probedBlock.current = key;
    void focus.probe("rom");
  }, [rangeStep?.kind, cam.status, focus, s]);

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
  const midCheck = s.kind === "part" || s.kind === "question" || s.kind === "today";
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
    s.kind === "part"
      ? { done: s.index, total: parts.length }
      : s.kind === "completing" || s.kind === "done"
        ? { done: parts.length, total: parts.length }
        : null;
  const entry =
    s.kind === "loading" ||
    s.kind === "consent" ||
    s.kind === "intro" ||
    s.kind === "closed" ||
    s.kind === "load_error";
  const top = (
    <TopBar
      lang={lang}
      progress={progress}
      sound={{ on: soundOn, toggle: toggleSound }}
      onLanguage={entry ? onLanguage : null}
      onLeave={s.kind === "done" ? null : midCheck ? () => setLeaving(true) : today}
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
      case "consent":
        return {
          screen: "consent",
          node: (
            <ConsentScreen
              lang={lang}
              saving={s.saving}
              error={s.error}
              onAgree={() => void session.consent()}
              onLater={today}
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
              onStart={() => {
                CuePlayer.unlock();
                session.dispatch({ type: "BEGIN" });
              }}
            />
          ),
        };
      case "question":
        return {
          screen: "question",
          node: (
            <QuestionScreen
              key={s.id}
              lang={lang}
              env={env!}
              answers={m.data.answers}
              id={s.id}
              onAnswer={(value) => session.dispatch({ type: "ANSWER", id: s.id, value, now: Date.now() })}
            />
          ),
        };
      case "today":
        return {
          screen: `today_${m.data.todayQs[s.index].kind}`,
          node: (
            <TodayScreen
              key={s.index}
              lang={lang}
              q={m.data.todayQs[s.index]}
              onAnswer={(value) => session.dispatch({ type: "TODAY", value })}
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
      case "seek_care":
        return {
          screen: "seek_care",
          node: (
            <SafetyScreen
              lang={lang}
              screen="scr_stop_seek_care"
              now={Date.now()}
              next={{
                label:
                  s.then === "parts"
                    ? tV7(lang, "rom.seekCare.continue")
                    : t(lang, "assessment.common.continue"),
                onClick: () => session.dispatch({ type: "SEEN" }),
                name: "continue",
              }}
            />
          ),
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
              <GaitSlot lang={lang} onSkip={() => session.gaitDone()}>
                <GaitStep
                  plan={m.data.check!.gait!}
                  checkId={m.data.check!.id}
                  lang={lang}
                  coach={(e) => coach.push(e)}
                  onDone={() => session.gaitDone()}
                  onStop={() => session.requestStop()}
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
                  };
                })}
              onFindings={() => session.dispatch({ type: "EXIT", to: "findings" })}
            />
          ),
        };
      case "exit":
        return { screen: "exit", node: <LoadingScreen lang={lang} /> };
    }
  })();

  function rangeContent(c: RomController, tNow: number): { screen: string; node: React.ReactNode } {
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
              onReady={() => c.ready(clock())}
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
              onReady={() => c.ready(clock())}
            />
          ),
        };
      case "measure":
        return {
          screen: `measure_${c.phase ?? "idle"}`,
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
          node: <PainStopScreen lang={lang} onContinue={() => c.acknowledge(clock())} />,
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
        <Page
          lang={lang}
          top={top}
          screen={content.screen}
          wide={!!rangeStep && rangeStep.kind === "measure"}
        >
          {content.node}
        </Page>
        {stopOpen && env && (
          <StopListScreen
            lang={lang}
            env={env}
            preselect={session.stopOutside?.preselect ?? ctl?.stopList?.preselect ?? null}
            onChoose={(option) => void session.chooseStop(option)}
          />
        )}
        {leaving && (
          <LeaveDialog
            lang={lang}
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
