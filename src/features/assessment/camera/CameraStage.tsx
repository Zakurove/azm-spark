/**
 * CameraStage (UX spec 3.0, 4.2, 5.6): the frame of every camera screen, read from 2 to 3 m.
 *
 *   top bar      test counter and name, booth badge, Sound; the tap for sound and offline pills on a
 *                row of their own under it
 *   caption card one line close to the front camera lens (C29): the short form at 56 px while the voice
 *                says the sentence, or the sentence itself, large, when no voice is heard and where
 *                the sentence carries a safety limit; a severity bar and icon, never truncated
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
import type { CheckCueId } from "../../../movements/types";
import { showsSentence, type CueSeverity } from "./cues";
import "./camera.css";

export interface StageCaption {
  short?: string;
  text: string;
  severity: CueSeverity;
  /** The cue of the line. */
  cue?: CheckCueId;
  /** Changes with every line, so a repeated line is drawn again. */
  n?: number;
}

export interface CameraStageProps {
  /** The test counter and the test name ("Test 1 of 3", "Arm raise to the side"), drawn apart. */
  title: string[];
  helperChip: boolean;
  /**
   * The staff readout of the arm raise (booth staff settings, council F-1), in the helper row above
   * the picture, so it never covers the caption, the card or STOP. A helper chip is home only and the
   * readout booth only, so the two never share the row.
   */
  staff?: ReactNode;
  sound: { blocked: boolean; onUnblock(): void };
  /** Large captions: no voice is heard, so the caption is the sentence itself, large (C29). */
  large: boolean;
  caption: StageCaption | null;
  onReplay(): void;
  /** The video with its overlays, or null (loading, errors, the phone held sideways). */
  video: ReactNode;
  /**
   * full: the video fills the space between the cards; thumb: a small picture (Large captions,
   * measuring); strip: a screen too short for everything, the video takes only the space left, down
   * to nothing (the video shrinks first, 4.2); none: no picture on a short screen while the person is
   * measured, resting or reading the retry card (the camera keeps running under it).
   */
  videoMode: "full" | "thumb" | "strip" | "none";
  card: ReactNode;
  /** Buttons at the phone under the card (tips, skip), stacked 16 px apart. */
  actions?: ReactNode;
  compact: boolean;
  /** How far the stage has stepped down to fit a short screen (0: not at all; CameraView). */
  fit?: number;
  /** Scales the 2 m sizes up on taller screens, never down (4.1). */
  scale: number;
  /** A test kind class for the value card sizes (range, timed, lean, setup, rest). */
  kind: string;
  onStop(): void;
  stopRef?: Ref<HTMLButtonElement>;
  /** A sheet is open over the stage (S58 tips): everything but STOP is inert under it. */
  inertBehind?: boolean;
  /**
   * Called when the stage content does not fit the screen: the view then steps down one fit level
   * (the compact sizes of 4.2 and the video strip, then no picture while measuring). Captions and
   * STOP never shrink.
   */
  onOverflow?(): void;
}

export function CameraStage(p: CameraStageProps) {
  const ui = useCheckUi();
  const { lang } = ui;
  const c = p.caption;
  const large = p.large;
  // A blocked voice says nothing until a tap: the sentence takes the short form's place (C29).
  const sentence = !!c && showsSentence(c, large || p.sound.blocked);
  const stageRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLElement>(null);
  const helperRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    for (const el of [topRef.current, helperRef.current, mainRef.current]) {
      if (!el) continue;
      if (p.inertBehind) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    }
  }, [p.inertBehind]);
  const onOverflow = p.onOverflow;
  useLayoutEffect(() => {
    if (!onOverflow) return;
    const main = mainRef.current;
    const stage = stageRef.current;
    const over = (el: HTMLElement | null) => !!el && el.scrollHeight > el.clientHeight + 1;
    if (over(main) || over(stage)) onOverflow();
  });
  // The web font changes every height once it has loaded: measure again then.
  const [, setFonts] = useState(0);
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => live && setFonts((n) => n + 1));
    return () => {
      live = false;
    };
  }, []);
  return (
    <div
      ref={stageRef}
      className={`s34-stage${p.compact ? " is-compact" : ""}${large ? " is-large" : ""} is-${p.kind}`}
      style={{ ["--s34-scale" as string]: String(p.scale) }}
      data-s34-kind={p.kind}
      data-fit={p.fit ?? 0}
    >
      {/* STOP first in the DOM: the first focusable element (principle 6); the grid draws it last. */}
      <div className="s34-stop-zone">
        <button type="button" className="check-stop s34-stop" data-stop="" onClick={p.onStop} ref={p.stopRef}>
          <CheckIcon name="stop-square" size={28} />
          <span aria-hidden="true">{t(lang, "assessment.stop.button")}</span>
          <span className="check-visually-hidden">{t(lang, "assessment.stop.buttonLabel")}</span>
        </button>
      </div>

      <header className="s34-top" ref={topRef}>
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
          <button
            type="button"
            className="check-icon-button"
            onClick={ui.sound.toggle}
            aria-pressed={ui.sound.on}
            aria-label={t(lang, "assessment.common.sound")}
          >
            <CheckIcon name={ui.sound.on ? "speaker" : "speaker-off"} />
          </button>
        </div>
        {/* The tap for sound and offline pills: a row of their own under the title, so the title row
            keeps to one line at 375 px in Arabic. */}
        {((p.sound.blocked && ui.sound.on) || !ui.online) && (
          <p className="s34-top-note">
            {p.sound.blocked && ui.sound.on && (
              <button type="button" className="s34-pill is-button" onClick={p.sound.onUnblock}>
                <CheckIcon name="speaker" size={20} />
                <span>{t(lang, "assessment.hud.tapForSound")}</span>
              </button>
            )}
            {!ui.online && (
              <span className="s34-pill is-offline" role="status">
                <CheckIcon name="wifi-off" size={20} />
                <span>{t(lang, "assessment.state.offline.pill")}</span>
              </span>
            )}
          </p>
        )}
      </header>

      {p.staff}
      {p.helperChip && (
        <p className="s34-helper" ref={helperRef}>
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
            // A sentence in the short form's place is longer: fit level 3 makes room for it.
            data-long={sentence && c.short ? "" : undefined}
            onClick={p.onReplay}
            aria-label={`${c.text} ${t(lang, "assessment.hud.replay")}`}
          >
            <span className="s34-caption-lines" aria-hidden="true">
              {sentence ? (
                <span className="s34-caption-text">
                  <span className="s34-caption-icon">
                    <CheckIcon name={SEVERITY_ICON[c.severity]} size={30} />
                  </span>
                  {bidiText(lang, c.text)}
                </span>
              ) : (
                <span className="s34-caption-short">
                  <span className="s34-caption-icon">
                    <CheckIcon name={SEVERITY_ICON[c.severity]} size={36} />
                  </span>
                  {bidiText(lang, c.short!)}
                </span>
              )}
            </span>
          </button>
        )}
        <div className={`s34-video-area is-${p.videoMode}`}>{p.video}</div>
        <section className="s34-card">{p.card}</section>
        {p.actions && <div className="s34-actions">{p.actions}</div>}
      </div>
    </div>
  );
}
