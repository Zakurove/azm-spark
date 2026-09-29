/**
 * CameraStage (UX spec 3.0, 4.2, 5.6): the frame of every camera screen, read from 2 to 3 m.
 *
 *   top bar      test and side, helper chip, booth badge, offline pill, camera on, sound controls
 *   caption card the short form at 56 px with its icon, the full sentence at 34 px (56 in Large
 *                captions), close to the front camera lens; a severity bar and icon, never truncated
 *   video        object-fit contain, mirrored, the skeleton and the framing guide on top (forced LTR)
 *   value card   the part's panel (setup, calibrate, HUD, saved, retry, rest), over the video bottom
 *   STOP         72 px, red, always visible; first in the focus order (principle 6)
 *
 * No Back and no Exit: STOP is the exit. The caption card has no live region; the one hidden
 * announcer of the check (CheckRoot) hears a line only when no voice says it (4.3).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { SEVERITY_ICON } from "../shared/CaptionBar";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import type { CueSeverity } from "./cues";
import "./camera.css";

export interface StageCaption {
  short?: string;
  text: string;
  severity: CueSeverity;
  /** Changes with every line, so a repeated line is drawn again. */
  n?: number;
}

export interface CameraStageProps {
  /** The test counter and the test name ("Test 1 of 3", "Arm raise to the side"), drawn apart. */
  title: string[];
  helperChip: boolean;
  sound: { blocked: boolean; onUnblock(): void };
  largeCaptions: { on: boolean; onToggle(): void };
  caption: StageCaption | null;
  onReplay(): void;
  /** The video with its overlays, or null (loading, errors, the phone held sideways). */
  video: ReactNode;
  /**
   * full: the video fills the space between the cards; thumb: a small picture (Large captions,
   * measuring); strip: measuring on a screen too short for everything, the video takes only the
   * space left, down to nothing (the video shrinks first, 4.2).
   */
  videoMode: "full" | "thumb" | "strip";
  card: ReactNode;
  /** Buttons at the phone under the card (tips, skip), stacked 16 px apart. */
  actions?: ReactNode;
  compact: boolean;
  /** Scales the 2 m sizes up on taller screens, never down (4.1). */
  scale: number;
  /** A test kind class for the value card sizes (range, timed, lean, setup, rest). */
  kind: string;
  onStop(): void;
  stopRef?: Ref<HTMLButtonElement>;
  /**
   * Called when the stage content does not fit the screen: the view then switches to the compact
   * sizes of 4.2 (the video has already shrunk to its strip). Captions and STOP never shrink.
   */
  onOverflow?(): void;
}

export function CameraStage(p: CameraStageProps) {
  const ui = useCheckUi();
  const { lang } = ui;
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);
  const toggleSound = () => {
    const next = !ui.sound.on;
    ui.sound.toggle();
    setToast(t(lang, next ? "assessment.common.soundOn" : "assessment.common.soundOff"));
  };
  const c = p.caption;
  const large = p.largeCaptions.on;
  const stageRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const onOverflow = p.onOverflow;
  useLayoutEffect(() => {
    if (!onOverflow || p.compact) return;
    const main = mainRef.current;
    const stage = stageRef.current;
    const over = (el: HTMLElement | null) => !!el && el.scrollHeight > el.clientHeight + 1;
    if (over(main) || over(stage)) onOverflow();
  });
  return (
    <div
      ref={stageRef}
      className={`s34-stage${p.compact ? " is-compact" : ""}${large ? " is-large" : ""} is-${p.kind}`}
      style={{ ["--s34-scale" as string]: String(p.scale) }}
      data-s34-kind={p.kind}
    >
      {/* STOP first in the DOM: the first focusable element (principle 6); the grid draws it last. */}
      <div className="s34-stop-zone">
        <button type="button" className="check-stop s34-stop" data-stop="" onClick={p.onStop} ref={p.stopRef}>
          <CheckIcon name="stop-square" size={28} />
          <span aria-hidden="true">{t(lang, "assessment.stop.button")}</span>
          <span className="check-visually-hidden">{t(lang, "assessment.stop.buttonLabel")}</span>
        </button>
      </div>

      <header className="s34-top">
        <p className="s34-title">
          {p.title.map((part, k) => (
            <span key={k} className="s34-title-part">
              {k > 0 && <span className="check-visually-hidden">{lang === "ar" ? "، " : ", "}</span>}
              {bidiText(lang, part)}
            </span>
          ))}
        </p>
        <div className="s34-top-tools">
          {ui.booth && (
            <span className="check-booth-badge s34-badge">
              <CheckIcon name="badge" size={18} />
              <span className="check-booth-badge-text">{t(lang, "assessment.guest.boothBadge")}</span>
            </span>
          )}
          {!ui.online && (
            <span className="s34-pill is-offline" role="status">
              <CheckIcon name="wifi-off" size={20} />
              <span>{t(lang, "assessment.state.offline.pill")}</span>
            </span>
          )}
          <span className="s34-camera-on" role="img" aria-label={t(lang, "assessment.hud.cameraOn")}>
            <CheckIcon name="camera" size={24} />
          </span>
          {p.sound.blocked && ui.sound.on && (
            <button type="button" className="s34-pill is-button" onClick={p.sound.onUnblock}>
              <CheckIcon name="speaker" size={20} />
              <span>{t(lang, "assessment.hud.tapForSound")}</span>
            </button>
          )}
          <button
            type="button"
            className="check-icon-button s34-tool"
            onClick={toggleSound}
            aria-pressed={ui.sound.on}
            aria-label={t(lang, "assessment.common.sound")}
          >
            <CheckIcon name={ui.sound.on ? "speaker" : "speaker-off"} />
          </button>
          <button
            type="button"
            className="check-icon-button s34-tool"
            onClick={p.largeCaptions.onToggle}
            aria-pressed={large}
            aria-label={t(lang, "assessment.hud.largeCaptions")}
          >
            <CheckIcon name="captions" />
          </button>
        </div>
        {!ui.sound.on && (
          <p className="check-sound-note s34-sound-note">{t(lang, "assessment.common.alertStillSounds")}</p>
        )}
      </header>

      {p.helperChip && (
        <p className="s34-helper">
          <CheckIcon name="people" size={22} />
          <span>{t(lang, "assessment.hud.helperChip")}</span>
        </p>
      )}
      <div className="s34-main" ref={mainRef}>
        {c && (
          <button
            type="button"
            key={c.n}
            className={`s34-caption is-${c.severity}`}
            onClick={p.onReplay}
            aria-label={`${c.text} ${t(lang, "assessment.hud.replay")}`}
          >
            <span className="s34-caption-lines" aria-hidden="true">
              {c.short ? (
                <>
                  <span className="s34-caption-short">
                    <span className="s34-caption-icon">
                      <CheckIcon name={SEVERITY_ICON[c.severity]} size={36} />
                    </span>
                    {bidiText(lang, c.short)}
                  </span>
                  <span className="s34-caption-text">{bidiText(lang, c.text)}</span>
                </>
              ) : (
                <span className="s34-caption-text">
                  <span className="s34-caption-icon">
                    <CheckIcon name={SEVERITY_ICON[c.severity]} size={30} />
                  </span>
                  {bidiText(lang, c.text)}
                </span>
              )}
            </span>
          </button>
        )}
        <div className={`s34-video-area is-${p.videoMode}`}>{p.video}</div>
        <section className="s34-card">{p.card}</section>
        {p.actions && <div className="s34-actions">{p.actions}</div>}
      </div>
      {toast && (
        <p className="s34-toast" role="status">
          {toast}
        </p>
      )}
    </div>
  );
}
