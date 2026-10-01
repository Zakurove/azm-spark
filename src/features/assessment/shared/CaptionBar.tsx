/**
 * The caption slot (UX spec 3.0, principle 4): the exact display text of the line being spoken, shown
 * from the start of the line to its end. It is a button (tapping replays the line) and deliberately
 * NOT a live region: the single HiddenAnnouncer speaks captions to screen readers, and only when the
 * voice is not already saying them (5.2), so nothing is announced twice.
 */
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import CheckIcon from "./CheckIcon";
import { announcementFor, useCheckUi, type CaptionSeverity } from "./CheckUi";
import { sameWords } from "./format";

export interface CaptionBarProps {
  text: string;
  severity: CaptionSeverity;
  onReplay(): void;
}

/**
 * The icon of each severity (4.3, principle 10): the bar colour is never the only signal.
 * info: the info circle in purple; warn: a triangle in warn ink; safety: a stop square, with the
 * caption text itself in red (5.6:1 on cream).
 */
export const SEVERITY_ICON: Record<CaptionSeverity, string> = {
  info: "info",
  warn: "alert-triangle",
  safety: "stop-square",
};

/**
 * Whether a caption may show (C14): a line belongs to the screen that asked for it, so a line from a
 * screen that is gone (the camera's last cue after the flow moved to S47) never shows over the next
 * one; and a line that is already the screen's heading is not repeated above it.
 */
export function captionAllowed(
  owner: string,
  current: string,
  text: string,
  heading: string | null,
): boolean {
  if (owner !== current) return false;
  return !heading || !sameWords(text, heading);
}

export function CaptionBar({ text, severity, onReplay }: CaptionBarProps) {
  const { lang } = useCheckUi();
  return (
    <button
      type="button"
      className={`check-caption is-${severity}`}
      onClick={onReplay}
      aria-label={`${text} ${t(lang, "assessment.hud.replay")}`}
    >
      <span className="check-caption-icon" data-severity={severity}>
        <CheckIcon name={SEVERITY_ICON[severity]} />
      </span>
      <span className="check-caption-text">{bidiText(lang, text)}</span>
    </button>
  );
}

/**
 * The one aria-live="polite" element of the check (5.2 HiddenAnnouncer). CheckApp renders it once;
 * it is fed the caption only while no audio plays it (announcementFor).
 */
export function HiddenAnnouncer() {
  const ui = useCheckUi();
  const text = announcementFor(ui.caption, ui.sound.on);
  // data-keep-live: a modal dialog never makes the one live region inert (CheckDialog).
  return (
    <div className="check-visually-hidden" aria-live="polite" aria-atomic="true" data-keep-live="">
      {text ?? ""}
    </div>
  );
}
