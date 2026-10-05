/**
 * Parts of the focus check's screens (product v7 contract B3): the page with its light and its top
 * bar, the glass card, the buttons, the answer list, the 0 to 10 scale, the attempt dots and the
 * timer. The family of the landing and booth v2: a warm light stage, glass cards, gold for the one
 * action, purple for the person's own marks, Cairo, large numerals, no hard dark borders. Every
 * transition respects reduced motion (focus.css).
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Lang } from "../../app/i18n";
import { localizeDigits, t } from "../../i18n";
import { bidiText } from "../../i18n/rich";
import { tV7 } from "../../i18n/v7";
import CheckIcon from "../assessment/shared/CheckIcon";
import { CountdownRing } from "../assessment/safety/parts";
import { inertOutside } from "../assessment/shared/CheckDialog";
import { CHECK_DATA } from "../../movements/assessments";

export interface Action {
  label: string;
  onClick(): void;
  kind?: "primary" | "secondary" | "quiet";
  icon?: string;
  busy?: boolean;
  /** Not available yet (the camera's model probe of a block's card): shown, not tappable. */
  disabled?: boolean;
  /** A test hook (data-action). */
  name?: string;
}

export function Button({ a }: { a: Action }) {
  return (
    <button
      type="button"
      className={`fx-button is-${a.kind ?? "primary"}`}
      onClick={a.disabled ? undefined : a.onClick}
      aria-busy={a.busy || undefined}
      disabled={a.disabled || undefined}
      data-action={a.name}
    >
      {a.icon && <CheckIcon name={a.icon} size={22} />}
      <span>{a.label}</span>
    </button>
  );
}

/** The actions of a screen: the gold one last in reading order, at the end of the row. */
export function Actions({ items }: { items: (Action | null | false | undefined)[] }) {
  const list = items.filter((a): a is Action => !!a);
  if (!list.length) return null;
  return (
    <div className="fx-actions">
      {list.map((a, i) => (
        <Button key={i} a={a} />
      ))}
    </div>
  );
}

/** The page: the light of the stage, the top bar, the content column. */
export function Page({
  lang,
  top,
  children,
  wide = false,
  screen,
  step,
}: {
  lang: Lang;
  top: ReactNode;
  children: ReactNode;
  wide?: boolean;
  /** A test and screenshot hook (data-screen): it may name a phase that changes within a step. */
  screen: string;
  /**
   * The step the column belongs to (default the screen): a new step remounts the column, starts at its
   * top and plays the entrance; a phase change inside one step (a measurement's calibrating, attempts,
   * questions, rest, pause) keeps it, so nothing fades or slides and keyboard focus stays.
   */
  step?: string;
}) {
  const key = step ?? screen;
  // A new step starts at its top (a long card left scrolled never hides the next one's heading).
  useLayoutEffect(() => {
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  }, [key]);
  return (
    <div
      className={`fx-page${wide ? " is-wide" : ""}`}
      data-screen={screen}
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
    >
      <span className="fx-glow is-gold" aria-hidden="true" />
      <span className="fx-glow is-violet" aria-hidden="true" />
      {top}
      <main className="fx-main" key={key}>
        {children}
      </main>
    </div>
  );
}

/** Moves keyboard and screen reader focus to an element when it mounts (v1 useFocusOnMount). */
export function useFocusOnMount<T extends HTMLElement>(on = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    if (!el.hasAttribute("tabindex")) el.tabIndex = -1;
    el.focus({ preventScroll: true });
  }, [on]);
  return ref;
}

/**
 * A modal overlay (v1 CheckDialog's behaviour, in place): the page behind is inert while it is open,
 * focus moves to its heading, Tab stays inside, Escape calls `onClose` (none for a safety list), and
 * on close focus goes back to `returnFocus` or to what had it before.
 */
export function useModal(onClose?: () => void, returnFocus?: () => HTMLElement | null) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof document === "undefined") return;
    const previous = document.activeElement as HTMLElement | null;
    const changed = inertOutside(el);
    const heading = el.querySelector<HTMLElement>("h1");
    if (heading && !heading.hasAttribute("tabindex")) heading.tabIndex = -1;
    (heading ?? el).focus({ preventScroll: true });
    return () => {
      for (const c of changed) c.removeAttribute("inert");
      const back = returnRef.current?.() ?? (previous && document.contains(previous) ? previous : null);
      back?.focus({ preventScroll: true });
    };
  }, []);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && closeRef.current) {
      e.preventDefault();
      closeRef.current();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const els = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !ref.current.contains(active) || active === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };
  return { ref, onKeyDown };
}

const FOCUSABLE =
  "button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea,[tabindex='0']";

/** The top bar: the brand, the way through the check, sound and leave. */
export function TopBar({
  lang,
  progress,
  sound,
  onLanguage,
  onLeave,
  leaveLabel,
}: {
  lang: Lang;
  /** The parts of the check: done, now, to come. */
  progress?: { done: number; total: number } | null;
  sound?: { on: boolean; toggle(): void } | null;
  onLanguage?: (() => void) | null;
  onLeave?: (() => void) | null;
  /** The close control's name; leaving the check by default. */
  leaveLabel?: string;
}) {
  return (
    <header className="fx-top">
      <img className="fx-logo" src="/brand/azm-logo.webp" alt={tV7(lang, "rom.shell.brand")} />
      {progress ? (
        <div
          className="fx-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-label={tV7(lang, "rom.shell.progress", {
            n: Math.min(progress.done + 1, progress.total),
            total: progress.total,
          })}
        >
          {Array.from({ length: progress.total }, (_, i) => (
            <i
              key={i}
              className={i < progress.done ? "is-done" : i === progress.done ? "is-now" : undefined}
            />
          ))}
        </div>
      ) : (
        <span />
      )}
      <div className="fx-top-end">
        {onLanguage && (
          <button type="button" className="fx-chip" onClick={onLanguage} lang={lang === "ar" ? "en" : "ar"}>
            {t(lang, "assessment.common.language")}
          </button>
        )}
        {sound && (
          <button
            type="button"
            className="fx-chip is-icon"
            onClick={sound.toggle}
            aria-pressed={sound.on}
            aria-label={t(lang, "assessment.common.sound")}
          >
            <CheckIcon name={sound.on ? "speaker" : "speaker-off"} size={22} />
          </button>
        )}
        {onLeave && (
          <button
            type="button"
            className="fx-chip is-icon"
            onClick={onLeave}
            aria-label={leaveLabel ?? tV7(lang, "rom.shell.leave")}
            data-action="leave"
          >
            <CheckIcon name="close" size={22} />
          </button>
        )}
      </div>
    </header>
  );
}

/** A glass card. */
export function Glass({
  children,
  className,
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: "gold" | "rose" | "violet";
}) {
  return (
    <section className={`fx-glass${tone ? ` is-${tone}` : ""}${className ? ` ${className}` : ""}`}>
      {children}
    </section>
  );
}

/** The small line above a title. */
export function Kicker({ children }: { children: ReactNode }) {
  return <p className="fx-kicker">{children}</p>;
}

/** The screen's title: focus moves to it when the screen opens (one h1 per screen). */
export function Title({ children, size }: { children: ReactNode; size?: "question" }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const h = ref.current;
    if (!h) return;
    h.tabIndex = -1;
    h.focus({ preventScroll: true });
  }, []);
  return (
    <h1 ref={ref} className={`fx-title${size === "question" ? " is-question" : ""}`}>
      {children}
    </h1>
  );
}

export function Body({ lang, text, muted }: { lang: Lang; text: string; muted?: boolean }) {
  return <p className={`fx-body${muted ? " is-muted" : ""}`}>{bidiText(lang, text)}</p>;
}

export interface Choice {
  value: string;
  label: string;
  icon?: string;
  tone?: "gold" | "rose" | "plain";
}

/** Big answers, one tap each (the answer is the person's: no default, no preselection). */
export function Choices({
  lang,
  choices,
  onPick,
  labelledBy,
  chosen,
  layout = "column",
}: {
  lang: Lang;
  choices: Choice[];
  onPick(value: string): void;
  labelledBy?: string;
  chosen?: string | null;
  layout?: "column" | "row";
}) {
  return (
    <div className={`fx-choices is-${layout}`} role="group" aria-labelledby={labelledBy}>
      {choices.map((c) => (
        <button
          key={c.value}
          type="button"
          className={`fx-choice is-${c.tone ?? "plain"}`}
          aria-pressed={chosen === c.value}
          data-value={c.value}
          onClick={() => onPick(c.value)}
        >
          {c.icon && (
            <span className="fx-choice-icon" aria-hidden="true">
              <CheckIcon name={c.icon} size={26} />
            </span>
          )}
          <span className="fx-choice-label">{bidiText(lang, c.label)}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The 0 to 10 scale: select, then Next (v1 O11b), the chosen number large. The ends name what 0 and
 * 10 mean.
 */
export function PainScale({
  lang,
  labelledBy,
  onDone,
  nextLabel,
  readout = true,
}: {
  lang: Lang;
  labelledBy: string;
  onDone(level: number): void;
  nextLabel: string;
  /** The chosen number large above the scale (off where the room is short: on the measurement). */
  readout?: boolean;
}) {
  const [value, setValue] = useState<number | null>(null);
  const [tried, setTried] = useState(false);
  const hint = useId();
  return (
    <div className="fx-scale-block">
      {readout && (
        <div className="fx-scale-readout" aria-live="polite">
          {value === null ? (
            <i className="fx-dial-wait" aria-hidden="true" />
          ) : (
            <b>{localizeDigits(lang, String(value))}</b>
          )}
          <span>{tV7(lang, "rom.pain.outOf")}</span>
        </div>
      )}
      <div
        className="fx-scale"
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-describedby={tried ? hint : undefined}
      >
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            className={`fx-scale-cell is-${n <= 3 ? "low" : n <= 5 ? "mid" : "high"}`}
            data-value={n}
            onClick={() => {
              setValue(n);
              setTried(false);
            }}
          >
            {localizeDigits(lang, String(n))}
          </button>
        ))}
      </div>
      <div className="fx-scale-ends" aria-hidden="true">
        <span>{CHECK_DATA.painScale.anchors.zero[lang]}</span>
        <span>{CHECK_DATA.painScale.anchors.ten[lang]}</span>
      </div>
      {tried && value === null && (
        <p id={hint} className="fx-hint">
          {t(lang, "assessment.common.chooseToContinue")}
        </p>
      )}
      <Actions
        items={[
          {
            label: nextLabel,
            name: "next",
            onClick: () => (value === null ? setTried(true) : onDone(value)),
          },
        ]}
      />
    </div>
  );
}

/** The attempts of a movement: the practice, then the scored tries. */
export function Dots({
  lang,
  total,
  index,
  valid,
}: {
  lang: Lang;
  total: number;
  index: number;
  valid: number;
}) {
  return (
    <div className="fx-dots" role="img" aria-label={tV7(lang, "rom.measure.tries", { n: valid, total })}>
      <i className={index === 0 ? "is-now is-practice" : "is-done is-practice"} />
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < valid ? "is-done" : i + 1 === index ? "is-now" : undefined} />
      ))}
    </div>
  );
}

/**
 * The timers (the rest between attempts, the rest after a stop, the sit before stand minute): the v1
 * ring (CountdownRing, contract section 7), stepped once a second, the seconds inside.
 */
export function Timer({
  lang,
  leftMs,
  totalMs,
  size = 168,
}: {
  lang: Lang;
  leftMs: number;
  totalMs: number;
  size?: number;
}) {
  return (
    <div className="fx-timer">
      <CountdownRing
        leftMs={leftMs}
        totalMs={totalMs}
        size={size}
        label={<b>{localizeDigits(lang, String(Math.ceil(leftMs / 1000)))}</b>}
      />
    </div>
  );
}

/** A loading line in a glass card. */
export function Loading({ text }: { text: string }) {
  return (
    <Glass className="fx-loading">
      <span className="fx-spinner" aria-hidden="true" />
      <p role="status">{text}</p>
    </Glass>
  );
}
