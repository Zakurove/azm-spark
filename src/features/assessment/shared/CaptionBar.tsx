/**
 * The caption slot (UX spec 3.0, principle 4): the exact display text of the line being spoken, shown
 * from the start of the line to its end. It is a button (tapping replays the line) and deliberately
 * NOT a live region: the single HiddenAnnouncer speaks captions to screen readers, and only when the
 * voice is not already saying them (5.2), so nothing is announced twice.
 */
import { t } from "../../../i18n";
import CheckIcon from "./CheckIcon";
import { announcementFor, useCheckUi, type CaptionSeverity } from "./CheckUi";

export interface CaptionBarProps {
  text: string;
  severity: CaptionSeverity;
  onReplay(): void;
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
      <CheckIcon name="captions" />
      <span>{text}</span>
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
  return (
    <div className="check-visually-hidden" aria-live="polite" aria-atomic="true">
      {text ?? ""}
    </div>
  );
}
