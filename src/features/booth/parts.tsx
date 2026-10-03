/**
 * Shared parts of the booth screens: the step heading (focused when a step opens, so a screen reader
 * hears the new step), the action row (Back and the one gold action, 56 px and more), and the
 * progress dots.
 */
import { useEffect, useRef, type ReactNode } from "react";
import type { Lang } from "../../app/i18n";
import { formatNumber } from "../../i18n";
import BoothIcon from "./BoothIcon";
import { boothCopy } from "./copy";

export function StepHead({
  kicker,
  title,
  body,
  center,
}: {
  kicker?: ReactNode;
  title: string;
  body?: ReactNode;
  center?: boolean;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <div className={`bx-head${center ? " center" : ""}`}>
      {kicker && <p className="bx-kicker">{kicker}</p>}
      <h1 ref={ref} tabIndex={-1}>
        {title}
      </h1>
      {body && <p className="bx-lead">{body}</p>}
    </div>
  );
}

/** «الخطوة ٢ · محرك عزم الطبي» */
export function stepKicker(lang: Lang, dot: number) {
  const k = boothCopy(lang);
  return (
    <>
      <span className="bx-kicker-n">{k.stepOf(dot + 1)}</span>
      <span className="bx-kicker-dot" aria-hidden="true" />
      <span>{k.steps[dot]}</span>
    </>
  );
}

export interface Action {
  label: string;
  onClick(): void;
  disabled?: boolean;
  busy?: boolean;
  icon?: string;
  name?: string;
}

/** Back (a quiet round button) and the step's one gold action; an optional quiet second action. */
export function Actions({
  lang,
  onBack,
  primary,
  secondary,
  center,
}: {
  lang: Lang;
  onBack?: () => void;
  primary?: Action;
  secondary?: Action;
  /** A card docked between Back and the actions on a tablet or a computer (the register code). */
  center?: ReactNode;
}) {
  const k = boothCopy(lang);
  return (
    <div className="bx-actions">
      {onBack ? (
        <button type="button" className="bx-back" onClick={onBack} aria-label={k.back} data-action="back">
          <BoothIcon name="back" size={24} />
        </button>
      ) : (
        <span />
      )}
      {center && <div className="bx-actions-center">{center}</div>}
      <div className="bx-actions-end">
        {secondary && (
          <button
            type="button"
            className="bx-quiet"
            onClick={secondary.onClick}
            disabled={secondary.disabled}
            data-action={secondary.name}
          >
            {secondary.icon && <BoothIcon name={secondary.icon} />}
            {secondary.label}
          </button>
        )}
        {primary && (
          <button
            type="button"
            className="bx-go"
            onClick={primary.onClick}
            disabled={primary.disabled || primary.busy}
            aria-busy={primary.busy || undefined}
            data-action={primary.name ?? "next"}
          >
            {primary.busy && <span className="bx-spin" aria-hidden="true" />}
            {primary.label}
            {!primary.busy && <BoothIcon name={primary.icon ?? "arrow"} size={22} />}
          </button>
        )}
      </div>
    </div>
  );
}

/** The six steps as dots: the current one a gold pill, the done ones gold, the rest soft. */
export function Dots({ lang, dot }: { lang: Lang; dot: number }) {
  const k = boothCopy(lang);
  return (
    <div className="bx-dots" role="img" aria-label={`${k.stepOf(dot + 1)}: ${k.steps[dot]}`}>
      {k.steps.map((label, i) => (
        <i key={label} className={i < dot ? "done" : i === dot ? "now" : undefined} />
      ))}
    </div>
  );
}

/** A number in the page's digits. */
export const n = (lang: Lang, v: number) => formatNumber(lang, v);
