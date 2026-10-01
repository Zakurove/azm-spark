/**
 * CheckShell (UX spec 3.0, 5.2): every non camera screen of the check.
 *
 *   top bar     Back, the step counter, the booth badge, Sound, Exit or a screen's own close control
 *               (S51, S52); the language switch only on the entry screens S05, S05b, S12, S14, S54, S55
 *   content     an optional line above the caption (S41), then the caption slot
 *   bar         6 px progress bar (role progressbar, labelled by the counter, aria-valuetext; the
 *               pre-check bar has no counter text and is only a picture, C10)
 *   banners     the sound off line, the offline banner (0.7)
 *   content     caption slot, optional wordmark header, the screen, 16 px gutters, 560 px column
 *   footer      call controls first, one gold primary, one secondary; sticky from 560 CSS px tall
 *
 * Fit at phone width (0.5): every top bar control keeps 48 x 48 px and never shrinks. Below 420 CSS px
 * wide the booth badge is an icon (its words stay its accessible name) and the counter moves from the
 * top bar to a meta line above the screen's h1 (the top bar keeps it for assistive technology). Below
 * 400 CSS px tall the top bar compacts to Back and Exit, and the badge and Sound move into the content.
 *
 * Focus is never hidden under a bar (WCAG 2.4.11): the shell measures the sticky top bar and footer
 * and sets them as scroll padding on the real scroller (the page, or the overlay layer).
 *
 * DOM order equals visual order. On every screen change focus moves to the h1 (tabindex -1), which is
 * described by the counter, so "Step 3 of 6" is read with the step.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Brand from "../../../app/Brand";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { CaptionBar } from "./CaptionBar";
import CheckIcon from "./CheckIcon";
import { useCheckUi } from "./CheckUi";
import { OfflineBanner } from "./states";

export interface ButtonSpec {
  label: string;
  onClick(): void;
  busy?: boolean;
  kind?: "primary" | "secondary" | "text";
  /** Shown next to a primary that cannot act yet (primaries are never disabled, 0.3). */
  why?: string;
}

export interface CallLinkProps {
  number: "997" | "937";
  label: string;
}

export interface StepCounterProps {
  /**
   * "Step n of 6", shown and read with the h1. None for the pre-check (C10): its bar has no numbers,
   * because the possible total only shrinks and a count would never be true.
   */
  text?: string;
  value: number;
  max: number;
}

export interface CheckShellProps {
  counter?: StepCounterProps;
  /** Undefined hides Back. */
  onBack?: () => void;
  /** False hides Exit (safety screens). Exit shows only where the flow offers leaving. */
  exit?: boolean;
  /** The full Azm wordmark in the content header (S05, S12, S14, S50 to S54). */
  brand?: boolean;
  /** The language switch: only on the entry screens (S05, S05b, S12, S14, S54, S55). */
  language?: boolean;
  /** The Sound control: only on screens that play a line (3.0). */
  sound?: boolean;
  /** `lead`: a line directly above the buttons (S05: the adult confirmation the start gives, C02). */
  footer?: { lead?: ReactNode; primary?: ButtonSpec; secondary?: ButtonSpec; call?: CallLinkProps[] };
  /** A notice at the top of the sticky header, above the top bar (S54: the example banner). */
  notice?: ReactNode;
  /** A line that sits above the caption strip (S41: the stay put line, as the spec draws it). */
  aboveCaption?: ReactNode;
  /**
   * A top bar close control (✕) with its own action and name, where the screen offers one that is not
   * leaving the check (S51, S52: Return to Today). It takes the Exit position.
   */
  close?: { label: string; onClick(): void };
  children: ReactNode;
}

/**
 * Measures the sticky top bar and footer and sets them as scroll padding on the element that scrolls:
 * the page (html) or the overlay layer (.check-overlay). The bottom padding applies only while the
 * footer is sticky (check.css, min-height 560 px).
 */
function useScrollPadding(top: React.RefObject<HTMLElement>, bottom: React.RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const bar = top.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const scroller = (bar.closest(".check-overlay") as HTMLElement | null) ?? document.documentElement;
    const set = () => {
      scroller.style.setProperty("--check-topbar-h", `${Math.ceil(bar.getBoundingClientRect().height)}px`);
      const foot = bottom.current;
      scroller.style.setProperty(
        "--check-footer-h",
        `${foot ? Math.ceil(foot.getBoundingClientRect().height) : 0}px`,
      );
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    if (bottom.current) ro.observe(bottom.current);
    return () => {
      ro.disconnect();
      scroller.style.removeProperty("--check-topbar-h");
      scroller.style.removeProperty("--check-footer-h");
    };
  });
}

export function CheckShell({
  counter,
  onBack,
  exit = true,
  brand,
  language = false,
  sound = false,
  footer,
  notice,
  aboveCaption,
  close,
  children,
}: CheckShellProps) {
  const ui = useCheckUi();
  const { lang } = ui;
  const counterId = useId();
  const mainRef = useRef<HTMLElement>(null);
  const topRef = useRef<HTMLElement>(null);
  const footRef = useRef<HTMLElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  useScrollPadding(topRef, footRef);

  // Focus moves to the h1 on every screen change (3.0, definition of done).
  useEffect(() => {
    const h1 = mainRef.current?.querySelector<HTMLElement>("h1");
    if (!h1) return;
    h1.tabIndex = -1;
    if (counter?.text) {
      const own = (h1.getAttribute("aria-describedby") ?? "").split(" ").filter((x) => x && x !== counterId);
      h1.setAttribute("aria-describedby", [counterId, ...own].join(" "));
    }
    h1.focus({ preventScroll: false });
    // Only a new screen moves focus; a re-render of the same screen never does.
  }, [ui.screenKey]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  const toggleSound = () => {
    const next = !ui.sound.on;
    ui.sound.toggle();
    setToast(t(lang, next ? "assessment.common.soundOn" : "assessment.common.soundOff"));
  };
  const other = lang === "ar" ? "en" : "ar";
  const pct = counter && counter.max > 0 ? Math.min(100, Math.round((counter.value / counter.max) * 100)) : 0;
  const soundButton = (where: "top" | "inline") => (
    <button
      type="button"
      className={`check-icon-button check-sound-${where}`}
      onClick={toggleSound}
      aria-pressed={ui.sound.on}
      aria-label={t(lang, "assessment.common.sound")}
    >
      <CheckIcon name={ui.sound.on ? "speaker" : "speaker-off"} />
    </button>
  );
  const badge = (where: "top" | "inline") => (
    <span className={`check-booth-badge check-badge-${where}`}>
      <CheckIcon name="badge" size={18} />
      <span className="check-booth-badge-text">{t(lang, "assessment.guest.boothBadge")}</span>
      <span className="check-visually-hidden">{` ${t(lang, "assessment.booth.badgeHint")}`}</span>
    </span>
  );

  return (
    <div className="check-page-inner">
      <header className="check-topbar" ref={topRef}>
        {notice}
        <div className="check-topbar-row">
          {onBack && (
            <button
              type="button"
              className="check-icon-button check-back"
              onClick={onBack}
              aria-label={t(lang, "assessment.common.back")}
            >
              <CheckIcon name="arrow-back" />
            </button>
          )}
          {counter?.text ? (
            <span id={counterId} className="check-topbar-counter">
              {bidiText(lang, counter.text)}
            </span>
          ) : null}
          <span className="check-topbar-spacer" />
          {ui.booth && badge("top")}
          {sound && soundButton("top")}
          {language && (
            <button type="button" className="check-language" onClick={ui.onLanguage} lang={other}>
              {t(lang, "assessment.common.language")}
            </button>
          )}
          {close ? (
            <button
              type="button"
              className="check-icon-button check-exit check-close"
              onClick={close.onClick}
              aria-label={close.label}
            >
              <CheckIcon name="close" />
            </button>
          ) : (
            exit &&
            ui.requestLeave && (
              <button
                type="button"
                className="check-icon-button check-exit"
                onClick={ui.requestLeave}
                aria-label={t(lang, "assessment.common.exit")}
              >
                <CheckIcon name="close" />
              </button>
            )
          )}
        </div>
        {counter &&
          (counter.text ? (
            <div
              className="check-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={counter.max}
              aria-valuenow={counter.value}
              aria-valuetext={counter.text}
              aria-labelledby={counterId}
            >
              <span style={{ width: `${pct}%` }} />
            </div>
          ) : (
            // A bar with no numbers is only a picture of the way so far (C10).
            <div className="check-progress" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </div>
          ))}
      </header>
      <OfflineBanner />
      <main className="check-main" ref={mainRef}>
        <div className="check-content check-enter" key={ui.screenKey}>
          {(counter?.text || ui.booth || sound) && (
            // The narrow and short screen forms of the top bar parts (check.css): the counter above the
            // h1 (read with it through aria-describedby, so hidden here), the badge and Sound.
            <div className="check-inline-bar">
              {counter?.text && (
                <p className="check-meta check-inline-counter" aria-hidden="true">
                  {bidiText(lang, counter.text)}
                </p>
              )}
              {ui.booth && badge("inline")}
              {sound && soundButton("inline")}
            </div>
          )}
          {aboveCaption}
          {ui.caption && (
            <CaptionBar text={ui.caption.text} severity={ui.caption.severity} onReplay={ui.replayCaption} />
          )}
          {brand && (
            <div className="check-header-brand">
              <Brand />
            </div>
          )}
          {children}
        </div>
      </main>
      {footer && (footer.primary || footer.secondary || footer.call?.length) && (
        <footer className="check-footer" ref={footRef}>
          <div className="check-footer-inner">
            {footer.lead}
            {footer.call?.map((c) => (
              <CallLink key={c.number} {...c} />
            ))}
            {footer.primary && <ShellButton spec={footer.primary} kind={footer.primary.kind ?? "primary"} />}
            {footer.primary?.why && (
              <p className="check-field-error" role="alert">
                {footer.primary.why}
              </p>
            )}
            {footer.secondary && (
              <ShellButton spec={footer.secondary} kind={footer.secondary.kind ?? "secondary"} />
            )}
          </div>
        </footer>
      )}
      {toast && (
        <p className="check-toast" role="status">
          {toast}
        </p>
      )}
    </div>
  );
}

function ShellButton({ spec, kind }: { spec: ButtonSpec; kind: "primary" | "secondary" | "text" }) {
  const cls = kind === "primary" ? "cta" : kind === "secondary" ? "ghost" : "check-text-button";
  return (
    <button type="button" className={cls} onClick={spec.onClick} aria-busy={spec.busy || undefined}>
      {spec.label}
    </button>
  );
}

/**
 * A tel: call control, 64 px, 997 red fill or 937 purple outline. The label shows the number in the
 * page's digits (٩٩٧ in Arabic, Q30); only the href stays ASCII. The accessible name reads the
 * digits one by one (Q22).
 */
export function CallLink({ number, label }: CallLinkProps) {
  const { lang } = useCheckUi();
  const digits = number.split("").join(" ");
  return (
    <a
      className={`check-call is-${number}`}
      href={`tel:${number}`}
      aria-label={t(lang, "assessment.common.callAria", {
        digits: lang === "ar" ? toArabicDigits(digits) : digits,
      })}
    >
      <CheckIcon name="phone-call" />
      <span>{bidiText(lang, label)}</span>
    </a>
  );
}

/** Arabic Indic digits for a digit string (the spaced call number in Arabic, Q22 and Q30). */
export function toArabicDigits(s: string): string {
  return s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

/** The shell's h1 for a screen: plain h1, focused by the shell on every screen change. */
export function CheckHeading({ children, className }: { children: ReactNode; className?: string }) {
  return <h1 className={className}>{children}</h1>;
}
