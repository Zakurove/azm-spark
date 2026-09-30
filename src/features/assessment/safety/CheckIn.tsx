/**
 * S43, the optional check in (Nasser's decision D-016; UX spec S43, stopRouting.checkIn).
 *
 * With the setting on, a camera test pauses when the person leaves the picture for 5 s or does not
 * move for 10 s, and this calm screen asks «هل أنت بخير؟»: the question is spoken once (its cue),
 * «أنا بخير» goes on with the test (the flow repeats an attempt it paused, after its rest), and
 * «أريد التوقف» opens the stop list (S41). If nobody answers within 30 s, one gentle chime plays (it
 * follows the Sound setting) and a line asks the person to call someone nearby, in the place of the
 * instruction, so the whole screen still fits a small phone. There is no alarm, no escalation, and
 * nothing is sent. Offline shows as one word in the top row.
 *
 * Initial focus is on the question, never on a button, so a screen reader double tap cannot answer
 * by accident; the only press rule is the guard against a double tap (useArmedPress).
 *
 * States: L, E, Er, Cam not applicable; Off works (all local).
 */
import { useEffect, useId, useState } from "react";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import type { ScreenProps } from "../screenTypes";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import { OfflineBanner } from "../shared/states";
import { checkInView } from "./content";
import { playChime, useArmedPress, useLatest, useSpeechSequence, useWakeLock } from "./hooks";
import { useFocusOnMount } from "./parts";
import { cueSpeech } from "./speech";
import { SAFETY_TIMING } from "./timing";

export function CheckIn({ dispatch }: ScreenProps) {
  const ui = useCheckUi();
  const { lang } = ui;
  const view = checkInView(lang);
  const titleId = useId();
  const heading = useFocusOnMount<HTMLHeadingElement>();
  useSpeechSequence([cueSpeech(view.cue, lang, "safety")], { key: `S43:${lang}`, delayMs: 0 });
  useWakeLock(true);
  const armed = useArmedPress(SAFETY_TIMING.stopArmMs);

  // 30 s with no answer: one gentle chime, and the line to call someone nearby. Nothing repeats.
  const [unanswered, setUnanswered] = useState(false);
  const soundRef = useLatest(ui.sound.on);
  useEffect(() => {
    const timer = setTimeout(() => {
      playChime(soundRef.current);
      setUnanswered(true);
    }, SAFETY_TIMING.checkInNoAnswerMs);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className="safety-stage is-checkin"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-screen="S43"
      data-unanswered={unanswered || undefined}
    >
      <div className="safety-stage-top">
        <span className="check-topbar-spacer" />
        <OfflineBanner compact pill />
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
      <div className="safety-stage-body">
        <h1 id={titleId} ref={heading} className="safety-stage-title">
          {bidiText(lang, view.question)}
        </h1>
        {/* After 30 s with no answer the line to call someone nearby takes the instruction's place. */}
        <p className="check-body safety-checkin-line" role="status" data-help={unanswered || undefined}>
          {bidiText(lang, unanswered ? view.noAnswer : view.instruction)}
        </p>
        <button
          type="button"
          className="cta safety-fine"
          onClick={(e) => {
            if (armed(e)) dispatch({ type: "FINE" });
          }}
        >
          {t(lang, "assessment.checkin.fine")}
        </button>
        <button
          type="button"
          className="ghost safety-want-stop"
          onClick={(e) => {
            if (armed(e)) dispatch({ type: "WANT_STOP" });
          }}
        >
          <CheckIcon name="stop-square" />
          {t(lang, "assessment.checkin.wantStop")}
        </button>
      </div>
    </div>
  );
}
