/**
 * useBoothMode (UX spec 5.10): this tab's booth mode as the screens read it.
 *
 *   booth       a staff device session (S55) holds now (staff phones only, C34)
 *   kind        which pass it is (the E2E override only in VITE_E2E builds)
 *   expires     when the pass ends (closing time)
 *   setting     booth or home
 *
 * It reads again when the pass ends and when the tab is shown again, so the badge and the start
 * actions never outlive the pass. Booth mode itself is only ever turned on by a pass the server
 * issued (boothMode.ts), never by this hook.
 */
import { useEffect, useState } from "react";
import { readBoothPass, type BoothPass } from "../boothMode";

export interface BoothModeState {
  booth: boolean;
  kind: BoothPass["kind"] | null;
  expires: number | null;
  setting: "booth" | "home";
}

export function boothModeState(now = Date.now()): BoothModeState {
  const pass = readBoothPass(now);
  const expires = pass && pass.kind !== "e2e" ? pass.expires : null;
  return {
    booth: pass !== null,
    kind: pass?.kind ?? null,
    expires,
    setting: pass ? "booth" : "home",
  };
}

/** Timers longer than about 24.8 days overflow; a pass never lasts that long, but stay safe. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export function useBoothMode(): BoothModeState {
  const [state, setState] = useState(() => boothModeState());
  useEffect(() => {
    const refresh = () => setState(boothModeState());
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", refresh);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (state.expires !== null) {
      timer = setTimeout(refresh, Math.min(MAX_TIMER_MS, Math.max(0, state.expires - Date.now()) + 50));
    }
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pageshow", refresh);
      if (timer) clearTimeout(timer);
    };
  }, [state.expires, state.booth]);
  return state;
}
