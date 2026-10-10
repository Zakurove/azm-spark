/**
 * Coach settings (C40, D-016 items 2 and 5), per device: the voice pack picker once two packs are
 * installed (a tap plays the pack's welcome; Nasser tries and picks the voices himself, nothing is
 * generated here), the Live coach (v7), and the movement check's optional check in. D-038 item 3: the
 * recorded coach voice's switch (guidance and counts during a workout) is gone with the exercises'
 * voice clips. Gold for the one action, purple accents, every option 48 px or more.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { Lang } from "./i18n";
import { Preferences, ui } from "./experience";
import { CuePlayer } from "./audio";
import { installedPack, VOICE_PACKS } from "./voicePacks";
import Dialog from "./Dialog";
import Icon from "./Icon";

/**
 * The live coach «المدرّب المباشر» (product v7 D5): its switch, its consent and its pause, in a v7
 * build only (the env test written inline, so a default build drops the chunk, A2-1).
 */
const LiveCoachSetting =
  import.meta.env.VITE_V7 === "1" ? lazy(() => import("../features/coach-agent/LiveCoachSetting")) : null;

/** One setting as a switch: a title, one line under it and a toggle of fixed width. */
function SwitchRow({
  on,
  icon,
  title,
  note,
  setting,
  onChange,
}: {
  on: boolean;
  icon: string;
  title: string;
  note: string;
  setting: string;
  onChange(on: boolean): void;
}) {
  return (
    <button
      className={`setting-switch ${on ? "selected" : ""}`}
      role="switch"
      aria-checked={on}
      data-setting={setting}
      onClick={() => onChange(!on)}
    >
      <Icon name={icon} />
      <span className="setting-switch-text">
        <strong>{title}</strong>
        <small>{note}</small>
      </span>
      <span className="toggle" aria-hidden="true">
        <i />
      </span>
    </button>
  );
}

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
      <h2 id="coach-settings-title">{c.coachSettings}</h2>
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
                {p.name[lang]}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="voice-preview">
        <button className="ghost" disabled={playing} onClick={() => void sample(pack)}>
          <Icon name="play" size={17} />
          {c.preview}
        </button>
        <small>{c.voiceNote}</small>
        {blocked && <p role="status">{c.voiceBlocked}</p>}
      </div>
      {LiveCoachSetting && (
        <Suspense fallback={null}>
          <LiveCoachSetting lang={lang} value={value} onChange={onChange} />
        </Suspense>
      )}
      {/* The movement check's optional check in (D-016): per device, off by default. */}
      <SwitchRow
        on={value.safetyCheckIn}
        icon="shield"
        title={t(lang, "assessment.checkin.setting")}
        note={t(lang, "assessment.checkin.settingNote")}
        setting="safety-check-in"
        onChange={(on) => onChange({ ...value, safetyCheckIn: on })}
      />
      <div className="modal-actions">
        <button className="cta" onClick={onClose}>
          {c.close}
          <Icon name="check" size={17} />
        </button>
      </div>
    </Dialog>
  );
}
