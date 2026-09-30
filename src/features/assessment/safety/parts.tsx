/**
 * Parts shared by the safety screens (UX spec 5.3, 5.6, 5.7): the sentence stack read one sentence at a
 * time, the 64 px ambulance number, STOP, the answer zones in their tap form, the countdown ring, the
 * stage caption and the heading icon. They use only the check tokens (safety.css).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { localizeDigits, t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import type { SpeechLine } from "./speech";
import { SAFETY_TIMING } from "./timing";

/**
 * The sentences of a safety text as plain paragraphs (no live region: the voice and the caption carry
 * it). The sentence being read has a 4 px purple bar and aria-current; it moves without animation.
 */
export function SentenceStack({
  block,
  sentences,
  current,
  size = 22,
  skipFirst = false,
}: {
  block: string;
  sentences: readonly string[];
  /** The mark of the sentence being read ("<block>:<index>"), or null. */
  current: string | null;
  size?: 18 | 22 | 26;
  /**
   * The first sentence is the heading's own words («لنتوقف هنا»): it is spoken but not printed again
   * under the heading (the marks keep their numbers).
   */
  skipFirst?: boolean;
}) {
  const { lang } = useCheckUi();
  return (
    <div className={`safety-sentences is-${size}`}>
      {sentences.map((s, i) => {
        if (skipFirst && i === 0) return null;
        const on = current === `${block}:${i}`;
        return (
          <p key={i} className={on ? "is-current" : undefined} aria-current={on ? "true" : undefined}>
            {bidiText(lang, s)}
          </p>
        );
      })}
    </div>
  );
}

/** A text with clock times kept whole: bidiText isolates a time as one left to right run (Q30). */
export function TextWithTimes({ text }: { text: string }) {
  const { lang } = useCheckUi();
  return <>{bidiText(lang, text)}</>;
}

/** The ambulance number as text of at least 64 px with its label (Q22), readable from the floor. */
export function BigNumber({ number = "997" }: { number?: "997" }) {
  const { lang } = useCheckUi();
  return (
    <p className="safety-number">
      <span className="safety-number-label">{t(lang, "assessment.safety.ambulanceNumber")}</span>
      <bdi className="safety-number-value">{localizeDigits(lang, number)}</bdi>
    </p>
  );
}

/**
 * STOP (principle 6, 4.2): full width, red, 72 px, a stop square and the word; its accessible name is
 * "Stop now". Never disabled. On the answer screens it sits in a sticky zone at the bottom.
 */
export function StopButton({ onPress, gap = false }: { onPress(): void; gap?: boolean }) {
  const { lang } = useCheckUi();
  return (
    <div className={`safety-stop-zone${gap ? " has-gap" : ""}`}>
      <button
        type="button"
        className="safety-stop"
        onClick={onPress}
        aria-label={t(lang, "assessment.stop.buttonLabel")}
      >
        <CheckIcon name="stop-square" size={28} />
        <span>{t(lang, "assessment.stop.button")}</span>
      </button>
    </div>
  );
}

export interface ZoneOption {
  value: string;
  label: string;
  icon: string;
  /** Safe answers commit at once, with no read back (4.7). */
  commitAtOnce?: boolean;
  /** What the voice says when the answer is read back (the data's vocalised answer). */
  speech?: SpeechLine;
  /** The largest zone (the fine zone of S43). */
  large?: boolean;
  /**
   * A press guard (useArmedPress): a press it refuses does nothing visible (the «أنا بخير» of S43,
   * R3C-03; the answers of S44 opened by a press).
   */
  guard?: (e: { detail: number; currentTarget: EventTarget | null }) => boolean;
}

/** Up to three words: the zone label at 40 px; longer data labels at 28 px, wrapping (4.7). */
export function zoneLabelSize(label: string): 40 | 28 {
  return label.trim().split(/\s+/).length <= 3 ? 40 : 28;
}

/**
 * Answer zones in their tap form (the booth build and every build until answerZones ships, 7.2-1):
 * up to three buttons of at least 120 px, in data order, each with its number, icon and label. A tap
 * selects at once; the answer is read back for 3 s ("You chose ...") and then commits, and a tap on
 * another zone within those 3 s replaces it. Safe answers commit at once (4.7).
 */
export function AnswerZones({
  labelledBy,
  options,
  onAnswer,
  say,
  fold = false,
}: {
  labelledBy: string;
  options: readonly ZoneOption[];
  onAnswer(value: string): void;
  /** Reads a line with its caption (the screen's speech sequence). */
  say?: (line: SpeechLine) => void;
  /** The zones must end above the fold (useFoldFit): answered from the chair, never scrolled to. */
  fold?: boolean;
}) {
  const { lang } = useCheckUi();
  const [chosen, setChosen] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const committed = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pick = (o: ZoneOption, e: { detail: number; currentTarget: EventTarget | null }) => {
    if (committed.current) return;
    if (o.guard && !o.guard(e)) return;
    clearTimeout(timer.current);
    if (o.commitAtOnce) {
      committed.current = true;
      setChosen(o.value);
      onAnswer(o.value);
      return;
    }
    setChosen(o.value);
    const confirm = t(lang, "assessment.zones.confirm", { answer: o.label });
    say?.({ display: confirm, speech: o.speech?.speech ?? null, severity: "info" });
    timer.current = setTimeout(() => {
      committed.current = true;
      onAnswer(o.value);
    }, SAFETY_TIMING.readBackMs);
  };

  return (
    <div className="safety-zones" role="group" aria-labelledby={labelledBy} data-fold={fold ? "" : undefined}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          className={`safety-zone${o.large ? " is-large" : ""}`}
          aria-pressed={chosen === o.value}
          data-value={o.value}
          onClick={(e) => pick(o, e)}
        >
          <span className="safety-zone-mark" aria-hidden="true">
            <span className="safety-zone-number">{localizeDigits(lang, String(i + 1))}</span>
            <CheckIcon name={o.icon} size={40} />
          </span>
          <span className={`safety-zone-label is-${zoneLabelSize(o.label)}`}>{bidiText(lang, o.label)}</span>
        </button>
      ))}
    </div>
  );
}

/** A ring that empties over `total` ms, with no number (S43) or with the seconds inside (S42). */
export function CountdownRing({
  leftMs,
  totalMs,
  size = 96,
  label,
}: {
  leftMs: number;
  totalMs: number;
  size?: number;
  /** Shown inside the ring (the seconds of a rest); none on S43, where time pressure is not shown. */
  label?: ReactNode;
}) {
  const r = 42;
  const c = 2 * Math.PI * r;
  // Stepped once a second (the ring never animates by itself: reduced motion safe).
  const shown = Math.ceil(leftMs / 1000) / Math.ceil(totalMs / 1000);
  return (
    <span className="safety-ring" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <circle cx="50" cy="50" r={r} className="safety-ring-track" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className="safety-ring-fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, shown)))}
        />
      </svg>
      {label !== undefined && <span className="safety-ring-label">{label}</span>}
    </span>
  );
}

/** The heading of a safety screen: an icon and the words (never colour alone, principle 10). */
export function SafetyHeading({ id, icon, text }: { id?: string; icon: string; text: string }) {
  const { lang } = useCheckUi();
  return (
    <h1 id={id} className="check-safety-heading safety-heading">
      <span className="safety-heading-icon" aria-hidden="true">
        <CheckIcon name={icon} size={40} />
      </span>
      <span>{bidiText(lang, text)}</span>
    </h1>
  );
}

/**
 * Focuses the element once when it mounts (the heading of an overlay: 5.7, O34-4 (2)). The heading is
 * at the top of its dialog, so focus never scrolls the layer (a scroll there would hide the top rows
 * while the answers are fitted to the screen, useFoldFit).
 */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.tabIndex = -1;
    el.focus({ preventScroll: true });
  }, []);
  return ref;
}
