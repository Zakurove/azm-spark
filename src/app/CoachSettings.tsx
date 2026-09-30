import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { Lang } from "./i18n";
import { Preferences, ui } from "./experience";
import { CuePlayer } from "./audio";
import { installedPack, VOICE_PACKS } from "./voicePacks";
import Dialog from "./Dialog";
import Icon from "./Icon";
export default function CoachSettings({
  lang,
  value,
  onChange,
  onClose,
}: {
  lang: Lang;
  value: Preferences;
  onChange: (p: Preferences) => void;
  onClose: () => void;
}) {
  const c = ui(lang),
    player = useMemo(() => new CuePlayer(lang), [lang]);
  const [blocked, setBlocked] = useState(false),
    [playing, setPlaying] = useState(false);
  const pack = installedPack(value.voicePack),
    sampleRun = useRef(0);
  /** Plays a pack's welcome; a newer sample (another voice tapped) takes over the status. */
  const sample = async (id: string) => {
    const run = ++sampleRun.current;
    player.stop();
    player.voicePack = id;
    setPlaying(true);
    const ok = await player.line("preview");
    if (run !== sampleRun.current) return;
    setBlocked(!ok);
    setPlaying(false);
  };
  useEffect(() => () => player.stop(), [player]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  useEffect(() => {
    player.pace = value.pace;
  }, [player, value.pace]);
  return (
    <Dialog titleId="coach-settings-title">
      <div className="settings-top">
        <span className="result-symbol">
          <Icon name="sound" size={28} />
        </span>
        <button className="icon-button" onClick={onClose} aria-label={c.close}>
          <Icon name="close" />
        </button>
      </div>
      <p className="eyebrow">AZM COACH</p>
      <h2 id="coach-settings-title">{c.coachSettings}</h2>
      <p>{c.settingsIntro}</p>
      {/* D-016 item 5: the installed voice packs, per device; choosing one plays its welcome. */}
      {VOICE_PACKS.length > 1 && (
        <fieldset className="settings-field voice-packs" data-setting="voice-pack">
          <legend>{c.voiceChoice}</legend>
          <div className="segmented">
            {VOICE_PACKS.map((p) => (
              <button
                key={p.id}
                aria-pressed={pack === p.id}
                className={pack === p.id ? "selected" : ""}
                onClick={() => {
                  onChange({ ...value, voicePack: p.id });
                  void sample(p.id);
                }}
              >
                <bdi>{p.label}</bdi>
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="voice-preview">
        <div className={`voice-wave ${playing ? "playing" : ""}`} aria-hidden="true">
          {Array.from({ length: 17 }, (_, i) => (
            <i
              key={i}
              style={{ height: `${12 + (Math.sin(i * 1.7) + 1) * 15}px`, animationDelay: `${i * 0.07}s` }}
            />
          ))}
        </div>
        <button className="ghost" disabled={playing} onClick={() => void sample(pack)}>
          <Icon name="play" size={17} />
          {c.preview}
        </button>
        <small>{c.voiceNote}</small>
        {blocked && <p role="status">{c.voiceBlocked}</p>}
      </div>
      <div className="settings-field">
        <div className="segmented">
          {(["full", "essential", "off"] as const).map((mode) => (
            <button
              key={mode}
              aria-pressed={value.voice === mode}
              className={value.voice === mode ? "selected" : ""}
              onClick={() => onChange({ ...value, voice: mode })}
            >
              {c[mode]}
            </button>
          ))}
        </div>
      </div>
      <fieldset className="settings-field">
        <legend>{c.pace}</legend>
        <div className="segmented">
          {[0.85, 1, 1.15].map((pace, i) => (
            <button
              key={pace}
              aria-pressed={value.pace === pace}
              className={value.pace === pace ? "selected" : ""}
              onClick={() => onChange({ ...value, pace })}
            >
              {[c.slow, c.normal, c.quick][i]}
            </button>
          ))}
        </div>
      </fieldset>
      <button
        className={`focus-option ${value.focus ? "selected" : ""}`}
        aria-pressed={value.focus}
        onClick={() => onChange({ ...value, focus: !value.focus })}
      >
        <Icon name="focus" />
        <span>
          <strong>{c.focus}</strong>
          <small>{c.focusNote}</small>
        </span>
        <span className="toggle">
          <i />
        </span>
      </button>
      {/* The movement check's optional check in (D-016): per device, off by default. */}
      <button
        className={`focus-option ${value.safetyCheckIn ? "selected" : ""}`}
        aria-pressed={value.safetyCheckIn}
        data-setting="safety-check-in"
        onClick={() => onChange({ ...value, safetyCheckIn: !value.safetyCheckIn })}
      >
        <Icon name="shield" />
        <span>
          <strong>{t(lang, "assessment.checkin.setting")}</strong>
          <small>{t(lang, "assessment.checkin.settingNote")}</small>
        </span>
        <span className="toggle">
          <i />
        </span>
      </button>
      <div className="modal-actions">
        <button className="cta" onClick={onClose}>
          {c.close}
          <Icon name="check" size={17} />
        </button>
      </div>
    </Dialog>
  );
}
