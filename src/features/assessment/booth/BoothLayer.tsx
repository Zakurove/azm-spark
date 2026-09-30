/**
 * S57 Booth tools over the check (UX spec S57, council O15, Q19 (4)):
 *
 *   staff reset   a 1.5 s press on the booth badge, or the staff shortcut key (Alt Shift N), opens
 *                 "We will clear these results for the next visitor" from any screen, camera screens
 *                 included, so staff never go through STOP and a made up stop reason; it logs no stop.
 *   idle reset    booth guest check only: no touch for 3 minutes on S50 (the QR above stays visible
 *                 and scannable: the question is a sheet at the bottom with no scrim) or 5 minutes on
 *                 the other screens that allow it (tools.ts idleWaitMs). "Are you still here?" is
 *                 spoken with the phone's own voice and shown, with a 30 s countdown and a 64 px
 *                 "I am still here"; at 0 the next visitor starts without a confirm. Never on camera,
 *                 stop list or safety screens.
 *   new visitor   NewVisitorButton (S50) asks the same confirm.
 *
 * Starting for the next visitor (startNextVisitor): the flow clears everything of the visit
 * (STAFF_RESET), the check's session keys go (booth mode stays), speech stops, and while online the
 * page loads again with location.replace, so the camera, the cue queue and the page memory start
 * fresh and browser Back cannot reach the last visitor's screens. Offline the flow's own reset is
 * kept (a reload needs the network until booth phones get a service worker, O18).
 *
 * CheckApp mounts <BoothLayer model dispatch /> inside its root in booth mode (foundation request).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import type { FlowEvent, FlowModel } from "../flowMachine";
import { CheckDialog } from "../shared/CheckDialog";
import { useCheckUi } from "../shared/CheckUi";
import { clearSnapshot } from "../useCheckFlow";
import { speakLocal, stopSpeaking } from "./speech";
import {
  idleStep,
  idleWaitMs,
  isStaffShortcut,
  LONG_PRESS_MS,
  secondsLeft,
  IDLE_COUNTDOWN_MS,
  type IdlePhase,
} from "./tools";
import "./booth.css";

type Dispatch = (e: FlowEvent) => void;

/** The check's own session keys (the flow snapshot); the booth pass `azm.booth` stays. */
function clearVisitStorage(): void {
  clearSnapshot();
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("azm.check.")) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    /* no storage: nothing kept */
  }
}

export interface NextVisitorOptions {
  /** The guest check (the booth flow); a visitor's own phone just leaves the check. */
  guest: boolean;
  online: boolean;
  /** The fresh page load (location.replace of this page by default). */
  reload?: () => void;
}

/** Starts for the next visitor (S57): see the file comment. Logs no stop. */
export function startNextVisitor(dispatch: Dispatch, o: NextVisitorOptions): void {
  stopSpeaking();
  dispatch({ type: "STAFF_RESET" });
  clearVisitStorage();
  if (o.guest && o.online) (o.reload ?? (() => location.replace(location.href)))();
}

/* ------------------------------------------------------------------ the confirm */

/**
 * The S57 reset confirm. Its way back reads «تابع القياس» during a check, and «ارجع» · Go back on the
 * results (S50), where the check is over and "Stay in the check" would be untrue (R3C-31 (3)).
 */
export function ResetDialog({
  onConfirm,
  onStay,
  over = false,
}: {
  onConfirm(): void;
  onStay(): void;
  /** The check is over (the results). */
  over?: boolean;
}) {
  const { lang } = useCheckUi();
  const titleId = useId();
  return (
    <CheckDialog titleId={titleId} onClose={onStay} initialFocus="[data-stay]">
      <h2 id={titleId}>{t(lang, "assessment.booth.resetConfirm")}</h2>
      <div className="check-actions" data-reset-dialog="">
        <button type="button" className="cta" onClick={onConfirm}>
          {t(lang, "assessment.booth.resetYes")}
        </button>
        <button type="button" className="ghost" onClick={onStay} data-stay="">
          {t(lang, over ? "assessment.common.back" : "assessment.exit.stay")}
        </button>
      </div>
    </CheckDialog>
  );
}

/** S50 "Start for a new visitor", with the S57 confirm. */
export function NewVisitorButton({ onReset }: { onReset(): void }) {
  const { lang } = useCheckUi();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ghost" onClick={() => setOpen(true)} data-new-visitor="">
        {t(lang, "assessment.guest.newVisitor")}
      </button>
      {open && (
        <ResetDialog
          onConfirm={() => {
            setOpen(false);
            onReset();
          }}
          onStay={() => setOpen(false)}
          over
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ "Are you still here?" */

/** The portal host of the idle sheet carries the check scope so the check tokens apply. */
const sheetHostClass = "azm-check booth-sheet-host";

export function IdleSheet({ seconds, onStillHere }: { seconds: number; onStillHere(): void }) {
  const { lang } = useCheckUi();
  const titleId = useId();
  const bodyId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [host] = useState(() => (typeof document === "undefined" ? null : document.createElement("div")));

  useLayoutEffect(() => {
    if (!host) return;
    host.className = sheetHostClass;
    host.lang = lang;
    host.dir = lang === "ar" ? "rtl" : "ltr";
    if (!host.isConnected) document.body.appendChild(host);
  }, [host, lang]);
  useEffect(() => () => host?.remove(), [host]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    buttonRef.current?.focus();
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  if (!host) return null;
  return createPortal(
    <div
      className="booth-sheet"
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onStillHere();
        }
      }}
      data-idle-sheet=""
    >
      <h2 id={titleId}>{t(lang, "assessment.booth.idleTitle")}</h2>
      <p id={bodyId} className="check-body" data-seconds={seconds}>
        {bidiText(lang, t(lang, "assessment.booth.idleBody", { s: seconds, unit: "sec" }))}
      </p>
      <button ref={buttonRef} type="button" className="cta booth-still" onClick={onStillHere}>
        {t(lang, "assessment.booth.stillHere")}
      </button>
    </div>,
    host,
  );
}

/* ------------------------------------------------------------------ the layer */

export interface BoothLayerProps {
  model: FlowModel;
  dispatch: Dispatch;
  /** The fresh page load after a reset (tests replace it). */
  reload?: () => void;
  /** The clock (tests replace it). */
  now?: () => number;
  /** The camera sees someone now (keeps the booth awake; S57). */
  personSeen?: boolean;
}

export function BoothLayer({ model, dispatch, reload, now = Date.now, personSeen = false }: BoothLayerProps) {
  const ui = useCheckUi();
  const guest = model.data.config.mode === "guest";
  const waitMs = idleWaitMs(model);
  const [confirm, setConfirm] = useState(false);
  const [phase, setPhase] = useState<IdlePhase>(() => ({ kind: "watching", since: now() }));
  const [clock, setClock] = useState(() => now());
  const last = useRef(now());
  const onlineRef = useRef(ui.online);
  onlineRef.current = ui.online;

  const next = useCallback(() => {
    setConfirm(false);
    setPhase({ kind: "watching", since: now() });
    last.current = now();
    startNextVisitor(dispatch, { guest, online: onlineRef.current, reload });
  }, [dispatch, guest, reload, now]);

  // Staff reset: a press and hold on the badge, or the shortcut key (S57).
  useEffect(() => {
    if (!ui.booth) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pressed: Element | null = null;
    const release = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pressed?.classList.remove("booth-pressing");
      pressed = null;
    };
    const down = (e: PointerEvent) => {
      const badge = (e.target as Element | null)?.closest?.(".check-booth-badge") ?? null;
      if (!badge) return;
      release();
      pressed = badge;
      badge.classList.add("booth-pressing");
      timer = setTimeout(() => {
        release();
        setConfirm(true);
      }, LONG_PRESS_MS);
    };
    const move = (e: PointerEvent) => {
      if (!pressed) return;
      const over = (document.elementFromPoint?.(e.clientX, e.clientY) ?? null)?.closest?.(
        ".check-booth-badge",
      );
      if (over !== pressed) release();
    };
    const key = (e: KeyboardEvent) => {
      if (!isStaffShortcut(e)) return;
      e.preventDefault();
      setConfirm(true);
    };
    const menu = (e: Event) => {
      if ((e.target as Element | null)?.closest?.(".check-booth-badge")) e.preventDefault();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("contextmenu", menu, true);
    return () => {
      release();
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("contextmenu", menu, true);
    };
  }, [ui.booth]);

  // Idle: a touch, a key or a scroll wheel is activity; a new screen counts as activity too.
  useEffect(() => {
    const mark = () => {
      last.current = now();
      setPhase((p) => (p.kind === "asking" ? { kind: "watching", since: now() } : p));
    };
    const opts = { capture: true, passive: true } as const;
    for (const type of ["pointerdown", "keydown", "wheel", "touchstart"] as const)
      document.addEventListener(type, mark, opts);
    return () => {
      for (const type of ["pointerdown", "keydown", "wheel", "touchstart"] as const)
        document.removeEventListener(type, mark, opts);
    };
  }, []);
  useEffect(() => {
    last.current = now();
    setPhase({ kind: "watching", since: now() });
  }, [ui.screenKey]);

  // The timer: once a second while the idle reset may run (never while the staff confirm is open).
  const active = waitMs !== null && !confirm;
  useEffect(() => {
    if (!active) {
      setPhase((p) => (p.kind === "watching" ? p : { kind: "watching", since: now() }));
      return;
    }
    const tick = () => {
      const at = now();
      setClock(at);
      setPhase((p) => idleStep(p, { now: at, last: last.current, waitMs, personSeen }));
    };
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [active, waitMs, personSeen]);

  // At 0 the next visitor starts without a confirm (S57).
  useEffect(() => {
    if (phase.kind === "reset") next();
  }, [phase.kind]);

  // The question is spoken (the phone's own voice) when the sound is on, and always shown.
  const asking = phase.kind === "asking" && active;
  useEffect(() => {
    if (!asking) return;
    if (ui.sound.on) {
      const s = Math.round(IDLE_COUNTDOWN_MS / 1000);
      speakLocal(
        `${t(ui.lang, "assessment.booth.idleTitle")} ${t(ui.lang, "assessment.booth.idleBody", { s, unit: "sec" })}`,
        ui.lang,
      );
    }
    return () => stopSpeaking();
  }, [asking]);

  if (!ui.booth) return null;
  return (
    <>
      {asking && phase.kind === "asking" && (
        <IdleSheet
          seconds={secondsLeft(phase.deadline, clock)}
          onStillHere={() => {
            last.current = now();
            setPhase({ kind: "watching", since: now() });
          }}
        />
      )}
      {confirm && (
        <ResetDialog
          onConfirm={next}
          onStay={() => setConfirm(false)}
          over={model.state.kind === "results"}
        />
      )}
    </>
  );
}
