/**
 * What every check screen reads from the check around it (CheckApp provides it): the language, booth
 * mode, the online state, the sound setting, the caption line that plays now and the leave control.
 * Screens and shells take `lang` from here, so no screen needs its own prop plumbing.
 */
import { createContext, useContext } from "react";
import type { Lang } from "../../../app/i18n";

export type CaptionSeverity = "info" | "warn" | "safety";

export interface Caption {
  /** The exact display text of the line being spoken. */
  text: string;
  severity: CaptionSeverity;
  /** True while the audio of this line plays (the hidden announcer stays silent, 9.5). */
  speaking: boolean;
  /** Plays the line's audio again (the caption's tap, 3.0); without it the text shows again. */
  replay?: () => void;
}

export interface CheckUi {
  lang: Lang;
  booth: boolean;
  guest: boolean;
  online: boolean;
  backOnline: boolean;
  /** A signed in check with results waiting in the queue (offline.savedLater). */
  savedLater: boolean;
  /** The session ended while results wait: results screens show the save error with sign in (0.7). */
  saveAuth: boolean;
  sound: { on: boolean; toggle(): void };
  caption: Caption | null;
  /** Shows the line being spoken; `replay` plays it again when the caption is tapped. */
  showCaption(text: string, severity?: CaptionSeverity, speaking?: boolean, replay?: () => void): void;
  clearCaption(): void;
  /** The caption's tap: replays the line's audio (its `replay`), or shows the text again. */
  replayCaption(): void;
  onLanguage(): void;
  /** Opens the leave dialog (S15); undefined where leaving is not offered. */
  requestLeave?: () => void;
  /** Changes with every screen change: the shell moves focus to the h1 (3.0). */
  screenKey: string;
}

const noop = () => undefined;

/** Defaults for a screen rendered outside CheckApp (tests, the progress pages). */
export const DEFAULT_UI: CheckUi = {
  lang: "ar",
  booth: false,
  guest: false,
  online: true,
  backOnline: false,
  savedLater: false,
  saveAuth: false,
  sound: { on: true, toggle: noop },
  caption: null,
  showCaption: noop,
  clearCaption: noop,
  replayCaption: noop,
  onLanguage: noop,
  screenKey: "",
};

export const CheckUiContext = createContext<CheckUi>(DEFAULT_UI);

export function useCheckUi(): CheckUi {
  return useContext(CheckUiContext);
}

/**
 * The single hidden live region is fed a caption only when no audio plays it, so a screen reader
 * never hears a line twice while the voice speaks it (UX spec 5.2 HiddenAnnouncer, audit 9.5).
 */
export function announcementFor(caption: Caption | null, soundOn: boolean): string | null {
  if (!caption) return null;
  if (soundOn && caption.speaking) return null;
  return caption.text;
}
