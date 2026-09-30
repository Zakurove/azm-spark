/**
 * S43 check in, S44 "do you want to go on?" and S45 the no response alarm (UX spec S43 to S45, 2.6,
 * 4.4, 4.8; council O34-4, O34-5, O42, 7.2-1). Overlays over the camera states, the stop list and the
 * questions; each is a modal dialog with the stage behind it inert.
 *
 * S43  The stage turns cream with a static 8 px red frame (visible from 3 m, no flashing). The check in
 *      cue for this person is spoken (check_are_you_ok, or _noraise at the booth when a raised hand
 *      must not be asked for; at home without the zones the fall watch forms, which name no box). The
 *      cue is split after its question: the caption card holds the 56 px short form with its pictogram
 *      and the instruction, the 56 px question is the heading. Three answers as tap buttons, «أنا بخير»
 *      the largest (7.2-1): only that button counts as a tap for fine (O34-4); a camera fine (the raised
 *      hand) comes from the camera. At 7 s a soft chime and the cue again; at 15 s the alarm (S45). The
 *      15 s ring sits in the top row. Initial focus on the question, never on a button.
 * S44  After "I am fine" from a test, or after the alarm (then 997 comes first, with the 64 px number):
 *      redo after a rest (only after an attempt in progress, never after sway or the alarm, R3C-02,
 *      R3C-04), skip this test, I need help (the alarm), and at the phone "I want to stop" (the stop
 *      list). Answers commit at once. One silent 30 s no answer timer after a camera fine (O34-1 (6))
 *      or after the alarm (R3C-01) runs the check in again over it; a 997 press ends it, and it pauses
 *      while the page is hidden.
 * S45  A loud repeating tone at full element volume whatever the Sound setting, faded in over 3 s,
 *      vibration on Android; the heading is the first sentence of scr_no_response (help variant: "Get
 *      help now", O34-5); 997 first with the 64 px number; the body; the 120 px «أنا بخير» button, the
 *      only touch that silences it, and only from a press that began 800 ms or more after the screen
 *      appeared (R3C-03), as on the «أنا بخير» of S43. Any other touch does nothing. 997 stops the tone and opens the dialer; the screen stays. At the
 *      booth the staff line shows; the tone is the staff alert.
 *
 * Every answer and STOP stays on screen without scrolling (useFoldFit): a person 2 m away cannot scroll.
 *
 * States: L, E, Er, Cam not applicable; Off works (all local, the alarm post is queued).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { emergencyCallButton } from "../../../movements/assessments";
import { cameraRunning } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { CallLink, CheckShell } from "../shared/CheckShell";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import { OfflineBanner } from "../shared/states";
import { alarmView, checkInView } from "./content";
import {
  playChime,
  useAlarmTone,
  useArmedPress,
  useCountdown,
  useFoldFit,
  useLatest,
  useNoAnswerTimer,
  useSpeechSequence,
  useWakeLock,
} from "./hooks";
import { AnswerZones, BigNumber, CountdownRing, SentenceStack, StopButton, useFocusOnMount } from "./parts";
import { copyLine, cueSpeech } from "./speech";
import { SAFETY_TIMING } from "./timing";

/**
 * The top row of a stage overlay: the booth badge (every screen in booth mode, S57), the check in's
 * 15 s ring (no numbers, aria-hidden) and Sound. The ring sits here so the answers stay on screen.
 */
function StageTop({ ring, camera }: { ring?: ReactNode; camera: boolean }) {
  const ui = useCheckUi();
  const { lang } = ui;
  return (
    <div className="safety-stage-top">
      {ui.booth && (
        <span className="check-booth-badge">
          <CheckIcon name="badge" size={18} />
          <span>{t(lang, "assessment.guest.boothBadge")}</span>
        </span>
      )}
      <span className="check-topbar-spacer" />
      {ring}
      {/* The camera keeps watching for a raised hand under S43 and S45: say it is on (principle 13). */}
      {camera && (
        <span className="safety-camera-icon" role="img" aria-label={t(lang, "assessment.hud.cameraOn")}>
          <CheckIcon name="camera" size={24} />
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
  );
}

/** The camera runs under the overlay: a camera state, S47, S48, or the faint question (O30). */
const watching = (s: ScreenProps["model"]["state"]) => cameraRunning(s) || s.kind === "faintAsk";

/* ------------------------------------------------------------------ S43 */

export function CheckIn({ model, dispatch }: ScreenProps) {
  const ui = useCheckUi();
  const { lang } = ui;
  const view = checkInView(model.data, lang);
  const titleId = useId();
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const stage = useRef<HTMLDivElement>(null);
  const fit = useFoldFit(stage, 5, `S43:${lang}:${view.cue}:${ui.booth}:${ui.online}`);
  const seq = useSpeechSequence([cueSpeech(view.cue, lang, "safety")], { key: `S43:${lang}`, delayMs: 0 });
  useWakeLock(true);
  const left = useCountdown(SAFETY_TIMING.checkInAlarmMs);
  // «أنا بخير» counts only from a press that began 800 ms or more after S43 appeared, whatever opened
  // it: a check in can appear under a finger already moving toward a control of S34 (R3C-03).
  const armed = useArmedPress(SAFETY_TIMING.fineArmMs, { always: true });

  // 7 s: a soft chime (Sound setting) and the cue again; 15 s: the alarm (S45), 4.8.
  const seqRef = useLatest(seq);
  const soundRef = useLatest(ui.sound.on);
  useEffect(() => {
    const repeat = setTimeout(() => {
      playChime(soundRef.current);
      seqRef.current.replay();
    }, SAFETY_TIMING.checkInRepeatMs);
    const alarm = setTimeout(() => dispatch({ type: "CHECKIN_TIMEOUT" }), SAFETY_TIMING.checkInAlarmMs);
    return () => {
      clearTimeout(repeat);
      clearTimeout(alarm);
    };
  }, []);

  const noraise = view.cue === "check_are_you_ok_noraise" || view.cue === "check_are_you_ok_fall_noraise";
  return (
    <div
      ref={stage}
      className="safety-stage is-alert"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-screen="S43"
      data-fit={fit}
    >
      <StageTop
        camera={watching(model.state)}
        ring={<CountdownRing leftMs={left} totalMs={SAFETY_TIMING.checkInAlarmMs} size={48} />}
      />
      <OfflineBanner compact />
      <div className="safety-stage-body">
        {/* The caption card near the lens (4.3, spec S43): the short form at 56 px with its pictogram,
            then the instruction that follows the question; the question itself is the heading below,
            never repeated here. Static: it does not wait for the voice. */}
        <div className="check-caption is-safety safety-stage-caption safety-checkin-cue" aria-hidden="true">
          <p className="safety-short">
            <CheckIcon name={noraise ? "people" : "hand-raise"} size={96} />
            <span>{bidiText(lang, view.short)}</span>
          </p>
          {view.instruction && (
            <p className="check-caption-text safety-checkin-instruction">
              {bidiText(lang, view.instruction)}
            </p>
          )}
        </div>
        <h1 id={titleId} ref={heading} className="safety-stage-title">
          {bidiText(lang, view.question)}
        </h1>
        <AnswerZones
          labelledBy={titleId}
          fold
          options={[
            {
              value: "fine",
              label: t(lang, "assessment.checkin.fine"),
              icon: "hand-raise",
              commitAtOnce: true,
              large: true,
              guard: armed,
            },
            {
              value: "stop",
              label: t(lang, "assessment.checkin.wantStop"),
              icon: "stop-square",
              commitAtOnce: true,
            },
            {
              value: "help",
              label: t(lang, "assessment.checkin.needHelp"),
              icon: "phone-call",
              commitAtOnce: true,
            },
          ]}
          onAnswer={(v) => {
            dispatch(
              v === "fine"
                ? { type: "FINE", via: "button" }
                : v === "stop"
                  ? { type: "WANT_STOP" }
                  : { type: "NEED_HELP" },
            );
          }}
        />
      </div>
      {cameraRunning(model.state) && <StopButton gap onPress={() => dispatch({ type: "STOP" })} />}
    </div>
  );
}

/* ------------------------------------------------------------------ S44 */

export function GoOn({ model, dispatch }: ScreenProps) {
  const ui = useCheckUi();
  const { lang } = ui;
  const o = model.overlay?.kind === "goOn" ? model.overlay : null;
  const afterAlarm = o?.afterAlarm === true;
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const fit = useFoldFit(root, 5, `S44:${lang}:${afterAlarm}:${o?.canRedo}:${ui.online}`);
  // Opened by a fine tap on S43 or S45: a press within 600 ms is ignored, as on S41 (R3C-03 (6)).
  const armed = useArmedPress(SAFETY_TIMING.stopArmMs);
  useWakeLock(true);
  // The question is captioned, and said where it has a voice, as every question asked where the person
  // sits (principle 4). It is the heading, so the caption strip does not repeat it.
  useSpeechSequence([{ ...copyLine(lang, t(lang, "assessment.goOn.title")), onScreen: true }], {
    key: `S44:${lang}`,
  });
  // O34-1 (6), R3C-01: one extra 30 s no answer timer after a camera fine and after the alarm (the flow
  // sets `timer`, once per episode). When it runs out the check in runs again over S44, which the flow
  // gives back after "I am fine" with no further timer. It restarts on any input, pauses while the page
  // is hidden, shows no ring and announces nothing; a press on 997 ends it (O30: no alarm over a call).
  const [called, setCalled] = useState(false);
  useNoAnswerTimer(
    SAFETY_TIMING.stopListNoAnswerMs,
    () => dispatch({ type: "TRIGGER", trigger: "no_answer" }),
    o?.timer === true && !called,
    { pauseHidden: true },
  );
  const options = [
    ...(o?.canRedo
      ? [
          {
            value: "redo",
            label: t(lang, "assessment.goOn.redo"),
            icon: "refresh",
            commitAtOnce: true,
            guard: armed,
          },
        ]
      : []),
    {
      value: "skip",
      label: t(lang, "assessment.goOn.skip"),
      icon: "arrow-forward",
      commitAtOnce: true,
      guard: armed,
    },
    {
      value: "help",
      label: t(lang, "assessment.checkin.needHelp"),
      icon: "phone-call",
      commitAtOnce: true,
      guard: armed,
    },
  ];
  return (
    <div
      ref={root}
      className="safety-overlay safety-go-on"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-screen="S44"
      data-fit={fit}
    >
      <CheckShell exit={false} sound>
        {afterAlarm && (
          <div className="safety-call-first" onClickCapture={() => setCalled(true)}>
            <BigNumber />
            <CallLink number="997" label={emergencyCallButton(lang).label} />
          </div>
        )}
        <h1 id={titleId} className="safety-stage-question">
          {t(lang, "assessment.goOn.title")}
        </h1>
        <AnswerZones
          labelledBy={titleId}
          fold
          options={options}
          onAnswer={(v) =>
            dispatch(
              v === "redo" ? { type: "REDO" } : v === "skip" ? { type: "SKIP_TEST" } : { type: "NEED_HELP" },
            )
          }
        />
        <button
          type="button"
          className="check-text-button safety-need-stop"
          onClick={(e) => {
            if (armed(e)) dispatch({ type: "WANT_STOP" });
          }}
        >
          {t(lang, "assessment.goOn.stop")}
        </button>
      </CheckShell>
      {cameraRunning(model.state) && <StopButton gap onPress={() => dispatch({ type: "STOP" })} />}
    </div>
  );
}

/* ------------------------------------------------------------------ S45 */

export function Alarm({ model, dispatch }: ScreenProps) {
  const ui = useCheckUi();
  const { lang } = ui;
  const o = model.overlay?.kind === "alarm" ? model.overlay : null;
  const help = o?.help === true;
  const view = alarmView(help, lang);
  const titleId = useId();
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const tone = useAlarmTone(true);
  const seq = useSpeechSequence(view.speech, { key: `S45:${help}:${lang}`, delayMs: 0 });
  useWakeLock(true);
  const [called, setCalled] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const fit = useFoldFit(stage, 5, `S45:${lang}:${help}:${ui.booth}:${ui.sound.on}:${ui.online}`);
  // A double tap on «أحتاج مساعدة» (S43) must never count as fine here, nor a press that was already
  // on its way when the alarm appeared: «أنا بخير» counts only from a press that began 800 ms or more
  // after S45 appeared, anywhere on the button, whatever opened it (R3C-03; the DoD).
  const armed = useArmedPress(SAFETY_TIMING.fineArmMs, { always: true });
  return (
    <div
      ref={stage}
      className="safety-stage is-alarm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-screen="S45"
      data-alarm={tone.status}
      data-help={help || undefined}
      data-fit={fit}
    >
      <StageTop camera={watching(model.state)} />
      <OfflineBanner compact />
      <div className="safety-stage-body">
        <h1 id={titleId} ref={heading} className="safety-stage-title">
          {bidiText(lang, view.heading)}
        </h1>
        <div className="safety-call-first">
          <BigNumber />
          <div
            className="safety-call-wrap"
            onClickCapture={() => {
              // 997: the tone stops and the dialer opens; this screen stays with "I am fine".
              tone.stop();
              setCalled(true);
            }}
          >
            <CallLink number="997" label={emergencyCallButton(lang).label} />
          </div>
        </div>
        <SentenceStack
          block="alarm"
          sentences={view.body.map((l) => l.display)}
          current={seq.mark}
          size={26}
        />
        <button
          type="button"
          className="cta safety-fine"
          data-fold=""
          data-called={called || undefined}
          onClick={(e) => {
            if (!armed(e)) return;
            tone.stop();
            dispatch({ type: "FINE", via: "button" });
          }}
        >
          {t(lang, "assessment.alarm.fine")}
        </button>
        {ui.booth && <p className="safety-staff">{t(lang, "assessment.alarm.staff")}</p>}
        {!ui.sound.on && (
          <p className="check-meta safety-still">{t(lang, "assessment.common.alertStillSounds")}</p>
        )}
      </div>
    </div>
  );
}
