/**
 * CheckShell (UX spec 3.0, 5.2): every non camera screen of the check.
 *
 *   top bar     Back, the step counter, the booth badge, Sound, the language switch, Exit
 *   bar         6 px progress bar (role progressbar, aria-valuetext = the visible counter)
 *   banners     the sound off line, the offline banner (0.7)
 *   content     caption slot, optional wordmark header, the screen, 16 px gutters, 560 px column
 *   footer      call controls first, one gold primary, one secondary; sticky from 560 CSS px tall
 *
 * DOM order equals visual order. On every screen change focus moves to the h1 (tabindex -1), which is
 * described by the counter, so "Question 3 of 9" is read with the question.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Brand from "../../../app/Brand";
import { t } from "../../../i18n";
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
  text: string;
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
  /** Hides the language switch (it stays on every screen by default). */
  language?: boolean;
  /** The Sound control, on every screen that plays a line (3.0); false where nothing plays. */
  sound?: boolean;
  footer?: { primary?: ButtonSpec; secondary?: ButtonSpec; call?: CallLinkProps[] };
  children: ReactNode;
}

export function CheckShell({
  counter,
  onBack,
  exit = true,
  brand,
  language = true,
  sound = true,
  footer,
  children,
}: CheckShellProps) {
  const ui = useCheckUi();
  const { lang } = ui;
  const counterId = useId();
  const mainRef = useRef<HTMLElement>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Focus moves to the h1 on every screen change (3.0, definition of done).
  useEffect(() => {
    const h1 = mainRef.current?.querySelector<HTMLElement>("h1");
    if (!h1) return;
    h1.tabIndex = -1;
    if (counter) h1.setAttribute("aria-describedby", counterId);
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

  return (
    <div className="check-page-inner">
      <header className="check-topbar">
        <div className="check-topbar-row">
          {onBack && (
            <button
              type="button"
              className="check-icon-button"
              onClick={onBack}
              aria-label={t(lang, "assessment.common.back")}
            >
              <CheckIcon name="arrow-back" />
            </button>
          )}
          {counter ? (
            <span id={counterId} className="check-topbar-counter is-compactable">
              {counter.text}
            </span>
          ) : (
            <span className="check-topbar-spacer" />
          )}
          {ui.booth && (
            <span className="check-booth-badge">
              <CheckIcon name="badge" size={18} />
              {t(lang, "assessment.guest.boothBadge")}
            </span>
          )}
          {sound && (
            <button
              type="button"
              className="check-icon-button"
              onClick={toggleSound}
              aria-pressed={ui.sound.on}
              aria-label={t(lang, "assessment.common.sound")}
            >
              <CheckIcon name={ui.sound.on ? "speaker" : "speaker-off"} />
            </button>
          )}
          {language && (
            <button type="button" className="check-language" onClick={ui.onLanguage} lang={other}>
              {t(lang, "assessment.common.language")}
            </button>
          )}
          {exit && ui.requestLeave && (
            <button
              type="button"
              className="check-icon-button"
              onClick={ui.requestLeave}
              aria-label={t(lang, "assessment.common.exit")}
            >
              <CheckIcon name="close" />
            </button>
          )}
        </div>
        {counter && (
          <div
            className="check-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={counter.max}
            aria-valuenow={counter.value}
            aria-valuetext={counter.text}
            aria-label={counter.text}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
        {!ui.sound.on && <p className="check-sound-note">{t(lang, "assessment.common.alertStillSounds")}</p>}
      </header>
      <OfflineBanner />
      <main className="check-main" ref={mainRef}>
        <div className="check-content check-enter" key={ui.screenKey}>
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
        <footer className="check-footer">
          <div className="check-footer-inner">
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

/** A tel: call control, 64 px, 997 red fill or 937 purple outline, digits read one by one (Q22). */
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
      <span>{label}</span>
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
