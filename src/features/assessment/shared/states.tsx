/**
 * The five states, defined once (UX spec 0.6, 0.7, 3.0 camera problem card):
 *   LoadingState       skeleton (weekly plan shimmer, static under reduced motion) or spinner card
 *   EmptyState         icon, title, one sentence, one gold action (History pattern)
 *   ErrorState         cream card, info icon, title, body, gold Try again, a secondary way out
 *   OfflineBanner      purple tint under the top bar, wifi off icon, polite live region
 *   CameraProblemCard  denied, no camera, busy or stopped, with the steps for this browser
 * Every screen composes these; none invents its own.
 */
import { useEffect, useRef } from "react";
import type { Lang } from "../../../app/i18n";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import type { ButtonSpec } from "./CheckShell";
import CheckIcon from "./CheckIcon";
import { useCheckUi } from "./CheckUi";

export interface LoadingStateProps {
  text: string;
  variant?: "card" | "camera" | "skeleton";
  lines?: number;
}

export function LoadingState({ text, variant = "skeleton", lines = 3 }: LoadingStateProps) {
  return (
    <div className="check-card" role="status" aria-live="polite">
      {variant === "skeleton" ? (
        <div className="check-skeleton" aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      ) : (
        <div className="check-spinner" aria-hidden="true" />
      )}
      <p className="check-body">{text}</p>
    </div>
  );
}

export interface EmptyStateProps {
  icon: string;
  title: string;
  body: string;
  action?: ButtonSpec;
  /** Heading level: 1 when the empty state is the whole screen. */
  level?: 1 | 2;
}

export function EmptyState({ icon, title, body, action, level = 2 }: EmptyStateProps) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <section className="check-card">
      <span className="check-card-icon">
        <CheckIcon name={icon} />
      </span>
      <Heading className="check-h2">{title}</Heading>
      <p className="check-body">{body}</p>
      {action && (
        <button type="button" className="cta" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </section>
  );
}

export interface ErrorStateProps {
  title: string;
  body: string;
  onRetry(): void;
  secondary?: ButtonSpec;
  level?: 1 | 2;
}

export function ErrorState({ title, body, onRetry, secondary, level = 2 }: ErrorStateProps) {
  const { lang } = useCheckUi();
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <section className="check-card is-cream" role="alert">
      <span className="check-card-icon">
        <CheckIcon name="info" />
      </span>
      <Heading className="check-h2">{title}</Heading>
      <p className="check-body">{body}</p>
      <div className="check-actions">
        <button type="button" className="cta" onClick={onRetry}>
          <CheckIcon name="refresh" />
          {t(lang, "assessment.common.retry")}
        </button>
        {secondary && (
          <button type="button" className="ghost" onClick={secondary.onClick}>
            {secondary.label}
          </button>
        )}
      </div>
    </section>
  );
}

export interface OfflineBannerProps {
  /** Pill form in the camera top bar. */
  compact?: boolean;
  /** Forces the banner (screenshots, tests); by default it follows the online state. */
  show?: boolean;
  /** The one word form («غير متصل» · Offline), where a screen has no room for the sentence (S43). */
  pill?: boolean;
}

/**
 * Offline banner (0.7): a polite region that is always present (and kept live under a dialog), filled
 * while offline. Back online, a short visible toast says so for about 3 s (useOnline.backOnline), so
 * nobody is left wondering whether their results will now save.
 */
export function OfflineBanner({ compact, show, pill }: OfflineBannerProps) {
  const ui = useCheckUi();
  const offline = show ?? !ui.online;
  return (
    <div
      className={offline ? "check-offline-wrap" : undefined}
      role="status"
      aria-live="polite"
      data-keep-live=""
    >
      {offline ? (
        <p className={`check-offline${compact ? " is-compact" : ""}`}>
          <CheckIcon name="wifi-off" />
          <span>
            {pill ? (
              t(ui.lang, "assessment.state.offline.pill")
            ) : (
              <>
                {t(ui.lang, "assessment.state.offline.banner")}
                {ui.savedLater && !ui.guest ? ` ${t(ui.lang, "assessment.state.offline.savedLater")}` : ""}
              </>
            )}
          </span>
        </p>
      ) : ui.backOnline ? (
        <p className="check-toast check-online-toast">
          <CheckIcon name="check" size={20} />
          <span>{t(ui.lang, "assessment.state.offline.back")}</span>
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ camera problems */

export type Platform = "ios" | "android" | "samsung" | "other";

/**
 * The browser family for the permission steps (3.0): every browser on iOS uses WebKit, but only
 * Safari gets the Safari steps; Samsung Internet before Chrome, since its user agent names Chrome.
 */
export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (iOS) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "other" : "ios";
  if (/SamsungBrowser/.test(ua)) return "samsung";
  if (/Android/.test(ua) && /Chrome\//.test(ua) && !/EdgA|OPR|Firefox/.test(ua)) return "android";
  return "other";
}

export interface CameraProblemCardProps {
  kind: "denied" | "none" | "busy" | "stopped";
  platform: Platform;
  /** denied: save the flow and reload (iOS asks again only then); none, busy, stopped: ask again. */
  onRetry(): void;
  onLater(): void;
  onDemo?: () => void;
  level?: 1 | 2;
}

/**
 * The permission steps for one browser as one step per line (S32): the copy's sentences in order.
 */
// SPEC-GAP: camera-steps-array. The copy holds each platform's steps as one text; until the copy owner
// ships camera.denied.<platform>.steps[], the steps are its sentences, one per list item.
export function cameraSteps(lang: Lang, platform: Platform): string[] {
  return t(lang, `assessment.camera.denied.${platform}`)
    .split(/(?<=[.؟?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** S32 and every camera screen whose stream ends: ink on cream, no red, never "Live". */
export function CameraProblemCard({
  kind,
  platform,
  onRetry,
  onLater,
  onDemo,
  level = 1,
}: CameraProblemCardProps) {
  const { lang } = useCheckUi();
  const Heading = level === 1 ? "h1" : "h2";
  // Announced once when it first shows (not again on a re-render or a language change).
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
  }, []);
  return (
    <section className="check-card is-cream" role={first.current ? "alert" : undefined}>
      <span className="check-card-icon">
        <CheckIcon name="camera" />
      </span>
      <Heading className="check-h1">{t(lang, `assessment.camera.${kind}.title`)}</Heading>
      <p className="check-body">{bidiText(lang, t(lang, `assessment.camera.${kind}.body`))}</p>
      {kind === "denied" && (
        <>
          <ol className="check-steps">
            {cameraSteps(lang, platform).map((step, i) => (
              <li key={i}>{bidiText(lang, step)}</li>
            ))}
          </ol>
          <p className="check-meta">{t(lang, "assessment.camera.denied.askHelp")}</p>
        </>
      )}
      <div className="check-actions">
        <button type="button" className="cta" onClick={onRetry}>
          <CheckIcon name="refresh" />
          {t(lang, "assessment.common.retry")}
        </button>
        <button type="button" className="ghost" onClick={onLater}>
          {t(lang, "assessment.camera.later")}
        </button>
        {onDemo && (
          <button type="button" className="check-text-button" onClick={onDemo}>
            {t(lang, "assessment.camera.demo")}
          </button>
        )}
      </div>
    </section>
  );
}
