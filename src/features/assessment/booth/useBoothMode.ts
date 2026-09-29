/**
 * useBoothMode (UX spec 5.10): this tab's booth mode as the screens read it.
 *
 *   booth       a staff device session (S55) or a visitor's one check token (S55b) holds now
 *   kind        which pass it is (the E2E override only in VITE_E2E builds)
 *   expires     when the pass ends (closing time, or 45 minutes for a visitor token)
 *   tokenEnded  this tab redeemed a visitor token and it has ended since: start actions show
 *               booth.tokenEnded instead (S55b), so a home check never runs under booth rules
 *   setting     booth or home
 *
 * It reads again when the pass ends and when the tab is shown again, so the badge and the start
 * actions never outlive the pass. Booth mode itself is only ever turned on by a pass the server
 * issued (boothMode.ts), never by this hook.
 */
import { useEffect, useState } from "react";
import { readBoothPass, type BoothPass } from "../boothMode";
import { wasVisitorPhone } from "./passes";

export interface BoothModeState {
  booth: boolean;
  kind: BoothPass["kind"] | null;
  expires: number | null;
  tokenEnded: boolean;
  setting: "booth" | "home";
}

export function boothModeState(now = Date.now()): BoothModeState {
  const pass = readBoothPass(now);
  const expires = pass && pass.kind !== "e2e" ? pass.expires : null;
  return {
    booth: pass !== null,
    kind: pass?.kind ?? null,
    expires,
    tokenEnded: pass === null && wasVisitorPhone(),
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
