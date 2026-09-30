/**
 * CheckApp: the movement check entry (contract v3 J). It owns the flow (useCheckFlow), the shell
 * context every screen reads (language, booth mode, online state, sound, captions, the leave control)
 * and renders the screen of the current state from the registry (screens.ts), with its overlay.
 *
 *   guest      /?check=1: booth mode only (contract v3 I); nothing stored, no network
 *   signedIn   from the Today card (S01) or the offer after the intake (S02)
 *
 * Browser history (principle 5, S57): a signed in check at home pushes one entry when it opens, so
 * the system Back (the Android edge swipe, the browser button) asks to leave (S15) instead of leaving
 * at once; the entry is removed when the flow ends. In booth mode and for guests nothing is pushed,
 * exits replace the page, and a page restored from the back and forward cache reloads, so Back never
 * shows a previous visitor.
 *
 * It never forks Session.tsx and changes nothing outside its .azm-check root.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { readPreferences } from "../../app/experience";
import type { Lang } from "../../app/i18n";
import { t } from "../../i18n";
import { BoothLayer } from "./booth";
import { isDefault, readBoothSettings, type BoothSettings } from "./booth/settings";
import { reloadWaits } from "./booth/tools";
import { boothPassHolds, clearBoothPass, isBoothMode, readBoothPass, watchVisitorHidden } from "./boothMode";
import {
  canLeave,
  cameraRunning,
  type CheckSession,
  type ExitTarget,
  type FlowConfig,
  type FlowModel,
  type FlowState,
  type ResumeCheck,
} from "./flowMachine";
import { OVERLAYS, overlayFor, SCREENS, screenFor } from "./screens";
import { LeaveDialog } from "./shared/CheckDialog";
import { CheckRoot } from "./shared/CheckRoot";
import { CheckShell } from "./shared/CheckShell";
import { useCheckUi, type Caption, type CaptionSeverity, type CheckUi } from "./shared/CheckUi";
import { ErrorState, LoadingState } from "./shared/states";
import { useOnline } from "./shared/useOnline";
import { useCheckFlow } from "./useCheckFlow";

export interface CheckAppProps {
  lang: Lang;
  onLanguage(): void;
  mode: "guest" | "signedIn";
  /** Where the person goes when the flow ends or they leave it. */
  onExit(to: ExitTarget): void;
  /** Booth device mode; by default read from this tab's session (boothMode.ts). */
  booth?: boolean;
  /** No touch and wider than 1024 px (S04); by default detected. */
  desktop?: boolean;
  /** An open check to continue (S01 resume, O6): build it with api.resumeCheckOf. */
  resume?: ResumeCheck | null;
  /** The side lean only session (S01 leanRepeat, Q12 (2)); a full check by default. */
  session?: CheckSession;
  /**
   * The care team release of a lock (S01 locked, releasable): once the paused screen shows, the
   * pre-check opens at pc_change_cleared (the RELEASE of S35).
   */
  release?: boolean;
  /** The signed in account's user id: the outbox sends only this account's calls. */
  owner?: string;
}

/** A device without touch and wider than 1024 px gets the phone interstitial first (S04). */
export function isDesktopDevice(): boolean {
  if (typeof window === "undefined") return false;
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || "ontouchstart" in window;
  return !touch && window.innerWidth > 1024;
}

/**
 * Changes when the screen changes (not when the same screen re-renders, and not when an overlay opens
 * over it, so the screen keeps what the person selected): focus moves to its h1. Overlays focus their
 * own heading when they mount.
 */
export function screenKeyOf(m: FlowModel): string {
  const s = m.state as FlowState & { id?: string; i?: number; side?: number; step?: number; safety?: string };
  return [s.kind, s.id, s.i, s.side, s.step, s.safety].filter((x) => x !== undefined).join(":");
}

/**
 * The flow's configuration, fixed for the life of the check: guest or signed in, booth mode, the
 * desktop interstitial, the session (the side lean only session from S01 leanRepeat, Q12 (2)), the
 * person's check in setting (D-016), which the booth never uses, and the booth staff settings of this
 * device (D-016 item 4), which only the booth uses. Home checks count as closed until the context says
 * otherwise (contract v3 I).
 */
export function checkConfig(o: {
  mode: FlowConfig["mode"];
  booth: boolean;
  desktop: boolean;
  session?: CheckSession;
  checkIn?: boolean;
  boothSettings?: BoothSettings;
}): FlowConfig {
  return {
    mode: o.mode,
    booth: o.booth,
    homeOpen: false,
    desktop: o.desktop,
    ...(o.session && o.session !== "full" ? { session: o.session } : {}),
    ...(o.checkIn && !o.booth && o.mode === "signedIn" ? { checkIn: true } : {}),
    ...(o.booth && o.boothSettings && !isDefault(o.boothSettings) ? { boothSettings: o.boothSettings } : {}),
  };
}

/** The history entry a signed in check pushes, so the system Back asks before leaving (S15). */
const SENTINEL = { azmCheck: 1 };
const isSentinel = (state: unknown) =>
  !!state && typeof state === "object" && (state as { azmCheck?: number }).azmCheck === 1;

export default function CheckApp({
  lang,
  onLanguage,
  mode,
  onExit,
  booth,
  desktop,
  resume,
  session,
  release,
  owner,
}: CheckAppProps) {
  const inBooth = booth ?? isBoothMode();
  const config = useMemo(
    () =>
      checkConfig({
        mode,
        booth: inBooth,
        desktop: desktop ?? isDesktopDevice(),
        session,
        checkIn: readPreferences().safetyCheckIn,
        ...(inBooth ? { boothSettings: readBoothSettings() } : {}),
      }),
    // The configuration is fixed for the life of the check.
    [],
  );
  const { online, backOnline } = useOnline();
  const { model, dispatch, api, status, retryCamera, retrySave } = useCheckFlow({
    config,
    online,
    resume: resume ?? null,
    ...(owner ? { owner } : {}),
  });

  const [soundOn, setSoundOn] = useState(true);
  const [caption, setCaption] = useState<Caption | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  // The system Back (home, signed in): one pushed entry turns it into the leave request (S15).
  const guardBack = !config.booth && mode === "signedIn";
  const pushed = useRef(false);
  const leaving = useRef(false);
  // A layout effect: the entry is there before the first paint, so even a Back pressed the moment the
  // check shows asks to leave.
  useLayoutEffect(() => {
    if (!guardBack) return;
    if (!isSentinel(window.history.state)) window.history.pushState(SENTINEL, "");
    pushed.current = true;
    const onPop = () => {
      if (leaving.current) return;
      // The pushed entry was popped: ask to leave where leaving is offered (camera and safety screens
      // stay put), and push the entry again so the next Back is caught too. On S33 and S35 Back does
      // what Return to Today does, the lock kept: never a pre-check question, never S15 (R3C-17 (3)).
      const m = modelRef.current;
      if (!m.overlay && (m.state.kind === "postponed" || m.state.kind === "paused")) {
        dispatch({ type: "EXIT" });
        return;
      }
      if (canLeave(m)) dispatch({ type: "LEAVE" });
      window.history.pushState(SENTINEL, "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [guardBack, dispatch]);

  // The booth pass is checked again whenever the guest check opens online: a pass the server refuses
  // (closing time, a used or ended visitor token) leaves booth mode and the page shows S05b; a
  // network error keeps it, so a booth phone works offline (O18).
  useEffect(() => {
    if (mode !== "guest" || !config.booth || !online) return;
    void boothPassHolds(api).then((holds) => {
      if (holds) return;
      clearBoothPass();
      location.replace(location.href);
    });
  }, []);

  // S55b: a visitor's token ends when the results show and after the tab stays hidden for 10 minutes;
  // the page then leaves booth mode, so a home check never runs under booth rules.
  const atResults = model.state.kind === "results";
  useEffect(() => {
    if (atResults && readBoothPass()?.kind === "visitor") clearBoothPass();
  }, [atResults]);
  // Never over a safety screen, S33 or the stop list: the pass is cleared, and the page reloads once
  // the person has left that screen (R3C-35).
  const reloadPending = useRef(false);
  useEffect(() => {
    if (!config.booth) return;
    return watchVisitorHidden(() => {
      if (reloadWaits(modelRef.current)) reloadPending.current = true;
      else location.replace(location.href);
    });
  }, []);
  useEffect(() => {
    if (!reloadPending.current || reloadWaits(model)) return;
    reloadPending.current = false;
    location.replace(location.href);
  }, [model]);

  // Guests and booth mode: a page restored from the back and forward cache starts again (S57).
  useEffect(() => {
    if (!config.booth && mode !== "guest") return;
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // S01 "the care team cleared me": the release is asked once, when the lock's paused screen shows.
  const released = useRef(false);
  useEffect(() => {
    const s = model.state;
    if (!release || released.current || s.kind !== "paused" || !s.releasable) return;
    released.current = true;
    dispatch({ type: "RELEASE" });
  }, [release, model.state, dispatch]);

  // Leaving the flow: the pushed entry goes first (it is the current one), then the exit.
  useEffect(() => {
    if (model.state.kind !== "exit") return;
    const to = model.state.to;
    if (pushed.current && isSentinel(window.history.state)) {
      leaving.current = true;
      pushed.current = false;
      window.history.back();
    }
    onExit(to);
  }, [model.state, onExit]);

  const screenKey = screenKeyOf(model);
  // A caption belongs to its screen.
  useEffect(() => setCaption(null), [screenKey]);

  const showCaption = useCallback(
    (text: string, severity: CaptionSeverity = "info", speaking = false, replay?: () => void) =>
      setCaption({ text, severity, speaking, ...(replay ? { replay } : {}) }),
    [],
  );
  const ui: CheckUi = {
    lang,
    booth: config.booth,
    guest: mode === "guest",
    online,
    backOnline,
    savedLater: status.waiting > 0,
    saveAuth: status.auth,
    sound: { on: soundOn, toggle: () => setSoundOn((v) => !v) },
    caption,
    showCaption,
    clearCaption: () => setCaption(null),
    // The caption's tap plays the line again (its audio), else shows the text again.
    replayCaption: () => {
      if (!caption) return;
      if (caption.replay) caption.replay();
      else setCaption({ ...caption });
    },
    onLanguage,
    requestLeave: canLeave(model) ? () => dispatch({ type: "LEAVE" }) : undefined,
    screenKey,
  };

  const screenId = screenFor(model);
  const overlayId = overlayFor(model);
  const Screen = screenId ? SCREENS[screenId] : null;
  const Overlay = overlayId && overlayId !== "S15" ? OVERLAYS[overlayId] : null;
  const props = { model, dispatch, api, retryCamera, retrySave };

  // The page behind an overlay is inert (5.6: "the stage content is inert"). A layout effect, declared
  // before the focus return below, so the base is live again before focus moves into it.
  const baseRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = baseRef.current;
    if (!el) return;
    if (overlayId && overlayId !== "S15" && overlayId !== "skipDialog") el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [overlayId]);

  // An overlay layer (S41, S43) that closes onto the same screen gives focus back to it
  // (5.6, 5.7): STOP on camera screens, else the screen's h1. A new screen moves focus itself
  // (CheckShell); the dialogs (S15, the skip dialog) return focus themselves (CheckDialog).
  const layered = overlayId && overlayId !== "S15" && overlayId !== "skipDialog" ? overlayId : null;
  const lastOverlay = useRef<{ id: string | null; key: string }>({ id: layered, key: screenKey });
  useLayoutEffect(() => {
    const before = lastOverlay.current;
    lastOverlay.current = { id: layered, key: screenKey };
    if (!before.id || overlayId || before.key !== screenKey) return;
    const base = baseRef.current;
    const target =
      (cameraRunning(model.state) ? base?.querySelector<HTMLElement>("[data-stop], .check-stop") : null) ??
      base?.querySelector<HTMLElement>("h1");
    if (!target) return;
    if (target.tagName === "H1") target.tabIndex = -1;
    target.focus();
  }, [overlayId, screenKey]);

  // E2E builds only (contract v3 K): the Playwright specs drive the flow where a stub has no control
  // yet. VITE_E2E is replaced at build time, so a production bundle has none of this.
  useEffect(() => {
    if (import.meta.env.VITE_E2E !== "1") return;
    const w = window as unknown as { e2eDispatch?: typeof dispatch };
    w.e2eDispatch = dispatch;
    return () => {
      delete w.e2eDispatch;
    };
  }, [dispatch]);

  return (
    <CheckRoot ui={ui}>
      <div ref={baseRef} className="check-base" data-state={model.state.kind}>
        {model.state.kind === "entry" ? (
          <EntryState
            model={model}
            onRetry={() => dispatch({ type: "RETRY" })}
            onExit={() => onExit(mode === "guest" ? "landing" : "today")}
          />
        ) : Screen ? (
          <Screen {...props} />
        ) : null}
      </div>
      {Overlay && overlayId === "skipDialog" && <Overlay {...props} />}
      {Overlay && overlayId !== "skipDialog" && (
        <div className="check-overlay" data-overlay={overlayId}>
          <Overlay {...props} />
        </div>
      )}
      {/* S57: the staff reset and the idle reset over every screen, in booth mode only. */}
      {config.booth && <BoothLayer model={model} dispatch={dispatch} />}
      {overlayId === "S15" && (
        <LeaveDialog
          variant={mode === "guest" ? "guest" : model.data.checkId ? "during" : "before"}
          onStay={() => dispatch({ type: "LEAVE_STAY" })}
          onLeave={() => dispatch({ type: "LEAVE_CONFIRM" })}
        />
      )}
    </CheckRoot>
  );
}

/** The entry state: loading the context (signed in), or its error with Try again. */
function EntryState({ model, onRetry, onExit }: { model: FlowModel; onRetry(): void; onExit(): void }) {
  const { lang, guest } = useCheckUi();
  const failed = model.state.kind === "entry" && model.state.error === "context";
  return (
    <CheckShell exit={false}>
      {failed ? (
        <ErrorState
          level={1}
          title={t(lang, "assessment.state.error.title")}
          body={t(lang, "assessment.entry.error")}
          onRetry={onRetry}
          secondary={guest ? undefined : { label: t(lang, "assessment.common.backToToday"), onClick: onExit }}
        />
      ) : (
        <>
          <h1 className="check-visually-hidden">{t(lang, "assessment.name")}</h1>
          <LoadingState text={t(lang, "assessment.state.loading.check")} />
        </>
      )}
    </CheckShell>
  );
}
