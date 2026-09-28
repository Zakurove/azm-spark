/**
 * CheckApp: the movement check entry (contract v3 J). It owns the flow (useCheckFlow), the shell
 * context every screen reads (language, booth mode, online state, sound, captions, the leave control)
 * and renders the screen of the current state from the registry (screens.ts), with its overlay.
 *
 *   guest      /?check=1: booth mode only (contract v3 I); nothing stored, no network
 *   signedIn   from the Today card (S01) or the offer after the intake (S02)
 *
 * It never forks Session.tsx and changes nothing outside its .azm-check root.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../../app/i18n";
import { t } from "../../i18n";
import { isBoothMode, readBoothCode } from "./boothMode";
import { canLeave, type ExitTarget, type FlowModel, type FlowState } from "./flowMachine";
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

export default function CheckApp({ lang, onLanguage, mode, onExit, booth, desktop }: CheckAppProps) {
  const inBooth = booth ?? isBoothMode();
  const config = useMemo(
    () => ({ mode, booth: inBooth, homeOpen: false, desktop: desktop ?? isDesktopDevice() }),
    // The configuration is fixed for the life of the check.
    [],
  );
  const { online, backOnline } = useOnline();
  const { model, dispatch, api, queue, retryCamera } = useCheckFlow({
    config,
    boothCode: inBooth ? readBoothCode() : null,
    online,
  });

  const [soundOn, setSoundOn] = useState(true);
  const [caption, setCaption] = useState<Caption | null>(null);
  const [waiting, setWaiting] = useState(0);
  useEffect(() => queue.onChange(setWaiting), [queue]);

  // Leaving the flow.
  useEffect(() => {
    if (model.state.kind === "exit") onExit(model.state.to);
  }, [model.state, onExit]);

  const screenKey = screenKeyOf(model);
  // A caption belongs to its screen.
  useEffect(() => setCaption(null), [screenKey]);

  const showCaption = useCallback(
    (text: string, severity: CaptionSeverity = "info", speaking = false) =>
      setCaption({ text, severity, speaking }),
    [],
  );
  const ui: CheckUi = {
    lang,
    booth: config.booth,
    guest: mode === "guest",
    online,
    backOnline,
    savedLater: waiting > 0,
    sound: { on: soundOn, toggle: () => setSoundOn((v) => !v) },
    caption,
    showCaption,
    clearCaption: () => setCaption(null),
    replayCaption: () => caption && setCaption({ ...caption }),
    onLanguage,
    requestLeave: canLeave(model) ? () => dispatch({ type: "LEAVE" }) : undefined,
    screenKey,
  };

  const screenId = screenFor(model);
  const overlayId = overlayFor(model);
  const Screen = screenId ? SCREENS[screenId] : null;
  const Overlay = overlayId && overlayId !== "S15" ? OVERLAYS[overlayId] : null;
  const props = { model, dispatch, api, retryCamera };

  // The page behind an overlay is inert (5.6: "the stage content is inert").
  const baseRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = baseRef.current;
    if (!el) return;
    if (overlayId && overlayId !== "S15" && overlayId !== "skipDialog") el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [overlayId]);

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
