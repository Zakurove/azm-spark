/**
 * S43 check in, S44 "do you want to go on?" and S45 the no response alarm (UX spec S43 to S45, 2.6,
 * 4.4, 4.8; council O34-4, O34-5, O42, 7.2-1). Overlays over the camera states, the stop list and the
 * questions; each is a modal dialog with the stage behind it inert.
 *
 * S43  The stage turns cream with a static 8 px red frame (visible from 3 m, no flashing). The check in
 *      cue for this person is spoken and captioned (check_are_you_ok, or _noraise at the booth when a
 *      raised hand must not be asked for); its question is set at 56 px under its short form. Three
 *      answers as tap buttons, «أنا بخير» the largest (7.2-1): only that button counts as a tap for
 *      fine (O34-4); a camera fine (the raised hand) comes from the camera. At 7 s a soft chime and the
 *      cue again; at 15 s the alarm (S45). Initial focus on the question, never on a button.
 * S44  After "I am fine" from a test, or after the alarm (then 997 comes first, with the 64 px number):
 *      redo after a rest (only after an attempt in progress), skip this test, I need help (the alarm),
 *      and at the phone "I need to stop" (the stop list). Answers commit at once.
 * S45  A loud repeating tone at full element volume whatever the Sound setting, faded in over 3 s,
 *      vibration on Android; the heading is the first sentence of scr_no_response (help variant: "Get
 *      help now", O34-5); 997 first with the 64 px number; the body; the 120 px «أنا بخير» button, the
 *      only touch that silences it. Any other touch does nothing. 997 stops the tone and opens the
 *      dialer; the screen stays. At the booth the staff line shows; the tone is the staff alert.
 *
 * States: L, E, Er, Cam not applicable; Off works (all local, the alarm post is queued).
 */
import { useEffect, useId, useState } from "react";
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
import { playChime, useAlarmTone, useCountdown, useLatest, useSpeechSequence, useWakeLock } from "./hooks";
import {
  AnswerZones,
  BigNumber,
  CountdownRing,
  SentenceStack,
  StageCaption,
  StopButton,
  useFocusOnMount,
} from "./parts";
import { cueSpeech } from "./speech";
import { SAFETY_TIMING } from "./timing";

/** The top row of a stage overlay: the booth badge (every screen in booth mode, S57) and Sound. */
function StageTop() {
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

/* ------------------------------------------------------------------ S43 */

export function CheckIn({ model, dispatch }: ScreenProps) {
  const ui = useCheckUi();
  const { lang } = ui;
  const view = checkInView(model.data, lang);
  const titleId = useId();
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const seq = useSpeechSequence([cueSpeech(view.cue, lang, "safety")], { key: `S43:${lang}`, delayMs: 0 });
  useWakeLock(true);
  const left = useCountdown(SAFETY_TIMING.checkInAlarmMs);

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

  const noraise = view.cue === "check_are_you_ok_noraise";
  return (
    <div
      className="safety-stage is-alert"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-screen="S43"
    >
      <StageTop />
      <OfflineBanner compact />
      <div className="safety-stage-body">
        <p className="safety-short" aria-hidden="true">
          <CheckIcon name={noraise ? "people" : "hand-raise"} size={96} />
          <span>{bidiText(lang, view.short)}</span>
        </p>
        <h1 id={titleId} ref={heading} className="safety-stage-title">
          {bidiText(lang, view.question)}
        </h1>
        <AnswerZones
          labelledBy={titleId}
          options={[
            {
              value: "fine",
              label: t(lang, "assessment.checkin.fine"),
              icon: "hand-raise",
              commitAtOnce: true,
              large: true,
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
          onAnswer={(v) =>
            dispatch(
              v === "fine"
                ? { type: "FINE", via: "button" }
                : v === "stop"
                  ? { type: "WANT_STOP" }
                  : { type: "NEED_HELP" },
            )
          }
        />
        <StageCaption lang={lang} />
        <CountdownRing leftMs={left} totalMs={SAFETY_TIMING.checkInAlarmMs} size={72} />
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
  useWakeLock(true);
  const options = [
    ...(o?.canRedo
      ? [{ value: "redo", label: t(lang, "assessment.goOn.redo"), icon: "refresh", commitAtOnce: true }]
      : []),
    { value: "skip", label: t(lang, "assessment.goOn.skip"), icon: "arrow-forward", commitAtOnce: true },
    { value: "help", label: t(lang, "assessment.checkin.needHelp"), icon: "phone-call", commitAtOnce: true },
  ];
  return (
    <div
      className="safety-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-screen="S44"
    >
      <CheckShell exit={false} sound>
        {afterAlarm && (
          <div className="safety-call-first">
            <BigNumber />
            <CallLink number="997" label={emergencyCallButton(lang).label} />
          </div>
        )}
        <h1 id={titleId} className="safety-stage-question">
          {t(lang, "assessment.goOn.title")}
        </h1>
        <AnswerZones
          labelledBy={titleId}
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
          onClick={() => dispatch({ type: "WANT_STOP" })}
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
  return (
    <div
      className="safety-stage is-alarm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-screen="S45"
      data-alarm={tone.status}
      data-help={help || undefined}
    >
      <StageTop />
      <OfflineBanner compact />
      <div className="safety-stage-body">
        <h1 id={titleId} ref={heading} className="safety-stage-title">
          {bidiText(lang, view.heading)}
        </h1>
        <BigNumber />
        <div
          className="safety-call-first"
          onClickCapture={() => {
            // 997: the tone stops and the dialer opens; this screen stays with "I am fine".
            tone.stop();
            setCalled(true);
          }}
        >
          <CallLink number="997" label={emergencyCallButton(lang).label} />
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
          data-called={called || undefined}
          onClick={() => {
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
