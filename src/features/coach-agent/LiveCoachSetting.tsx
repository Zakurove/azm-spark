/**
 * The live coach's switch in the coach settings (product v7 contract D5, C-5, C-8, C-12; D-022 S0-5;
 * D-026 item 3): «المدرّب المباشر» / "Live coach", off by default, per device. Turning it on the first
 * time opens the live_coach consent in place: what is sent to Google, exactly the C-12 list, what is
 * never sent, that the movement names and sides show which side of the body is worked on, and one
 * plain line on Google's short retention. With the coach on, the person picks how long it waits when
 * they stop talking (5.1 silenceMs). Loaded only in a v7 build (CoachSettings.tsx imports it lazily).
 */
import { useEffect, useId, useState } from "react";
import type { Lang } from "../../app/i18n";
import type { Preferences } from "../../app/experience";
import { tV7 } from "../../i18n/v7";
import { giveCoachConsent, readCoachStatus, type CoachStatus } from "./api";
import "./coach.css";

const t = (lang: Lang, key: string) => tV7(lang, `coach.${key}` as never);

/** The consent's points, in order: what is sent (C-12), then the sides, what is never sent, the retention. */
export const CONSENT_POINTS = [
  "sentPart",
  "sentRange",
  "sentWalk",
  "sentWorkout",
  "sentEvents",
  "sides",
  "never",
  "retention",
  "off",
] as const;

export function LiveCoachConsent({
  lang,
  saving,
  error,
  onAgree,
  onLater,
}: {
  lang: Lang;
  saving: boolean;
  error: boolean;
  onAgree(): void;
  onLater(): void;
}) {
  const title = useId();
  return (
    <section className="live-coach-consent" aria-labelledby={title} data-consent="live_coach">
      <h3 id={title}>{t(lang, "consent.title")}</h3>
      <p>{t(lang, "consent.intro")}</p>
      <ul>
        {CONSENT_POINTS.map((k) => (
          <li key={k} data-point={k}>
            {t(lang, `consent.${k}`)}
          </li>
        ))}
      </ul>
      {error && (
        <p className="form-error" role="alert">
          {t(lang, "consent.error")}
        </p>
      )}
      <div className="live-coach-consent-actions">
        <button type="button" className="ghost" onClick={onLater} disabled={saving}>
          {t(lang, "consent.notNow")}
        </button>
        <button type="button" className="cta" onClick={onAgree} disabled={saving} data-action="agree">
          {t(lang, "consent.agree")}
        </button>
      </div>
    </section>
  );
}

const PAUSES: Preferences["coachPause"][] = [800, 1200, 1600];
const PAUSE_KEYS = { 800: "pauseShort", 1200: "pauseMedium", 1600: "pauseLong" } as const;

export default function LiveCoachSetting({
  lang,
  value,
  onChange,
  status: given,
}: {
  lang: Lang;
  value: Preferences;
  onChange(p: Preferences): void;
  /** The coach's status (tests); read from the server by default. */
  status?: CoachStatus | null;
}) {
  const [status, setStatus] = useState<CoachStatus | null | undefined>(given);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (given !== undefined) return;
    let live = true;
    void readCoachStatus().then((s) => {
      if (live) setStatus(s);
    });
    return () => {
      live = false;
    };
  }, [given]);
  if (status === undefined) return null;
  const available = status?.available === true;
  const on = available && value.liveCoach;
  const flip = (next: boolean) => {
    if (!next) {
      setAsking(false);
      onChange({ ...value, liveCoach: false });
    } else if (status?.consent) onChange({ ...value, liveCoach: true });
    else setAsking(true);
  };
  const agree = async () => {
    setSaving(true);
    setError(false);
    const ok = await giveCoachConsent();
    setSaving(false);
    if (!ok) return setError(true);
    setStatus({ available: true, consent: true });
    setAsking(false);
    onChange({ ...value, liveCoach: true });
  };
  return (
    <div className="live-coach-setting" data-setting="live-coach">
      <button
        className={`setting-switch ${on ? "selected" : ""}`}
        role="switch"
        aria-checked={on}
        disabled={!available}
        onClick={() => flip(!on)}
      >
        <svg
          className="icon"
          width={22}
          height={22}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
        </svg>
        <span className="setting-switch-text">
          <strong>{t(lang, "name")}</strong>
          <small>{available ? t(lang, "setting.note") : t(lang, "setting.unavailable")}</small>
        </span>
        <span className="toggle" aria-hidden="true">
          <i />
        </span>
      </button>
      {asking && (
        <LiveCoachConsent
          lang={lang}
          saving={saving}
          error={error}
          onAgree={() => void agree()}
          onLater={() => setAsking(false)}
        />
      )}
      {on && (
        <fieldset className="settings-field" data-setting="coach-pause">
          <legend>{t(lang, "setting.pause")}</legend>
          <div className="segmented">
            {PAUSES.map((ms) => (
              <button
                key={ms}
                aria-pressed={value.coachPause === ms}
                className={value.coachPause === ms ? "selected" : ""}
                onClick={() => onChange({ ...value, coachPause: ms })}
              >
                {t(lang, `setting.${PAUSE_KEYS[ms]}`)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
