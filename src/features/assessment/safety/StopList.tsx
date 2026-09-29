/**
 * S41, the stop list: "What made you stop?" (UX spec S41, map 2.6; council Q31 (2) (3), O43, C2).
 *
 * Opened by STOP on any camera screen and by «أريد التوقف» (the check in, S44), over the stage. The
 * data's options for this person, urgent group first (chest, stroke signs, AD signs only with sci_t6,
 * faint, breath, fall), then the other reasons (pain, tired, choice, something else); each row is at
 * least 64 px with an icon and routes with one tap (no Next): the flow's stopRoute sends it to S36,
 * S37, S38, S39, S40a, S47 or S42. There is no "pressed by mistake" row (O43).
 *
 * On a STOP from a test, check_stop_now plays, then check_stop_why once, captioned; at home the stay
 * put line follows (C2), at the booth the staff line. 30 s with no touch, scroll, key press or focus
 * change runs the check in (S43, no_answer). After "I am fine" the list comes back with "Take your
 * time" under the title.
 *
 * States: L, E, Er, Cam not applicable (all local); Off works (local routing, the stop is queued).
 */
import { useEffect, useId, useState } from "react";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { cameraRunning } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { CheckShell } from "../shared/CheckShell";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import { stopListView, type StopRow } from "./content";
import { useArmedPress, useNoAnswerTimer, useSpeechSequence, useWakeLock } from "./hooks";
import { copyLine, cueSpeech, type SpeechLine } from "./speech";
import { cameraFine, SAFETY_TIMING } from "./timing";

/**
 * The one extra 30 s timer after a camera fine on the stop list (O34-1 (6); after a tap no new timer
 * runs, O14). The list unmounts while the check in shows, so the flag lives here: reset when the list
 * opens fresh.
 */
let extraTimerUsed = false;

export function StopList({ model, dispatch }: ScreenProps) {
  const ui = useCheckUi();
  const { lang, booth } = ui;
  const o = model.overlay?.kind === "stopList" ? model.overlay : null;
  const takeYourTime = o?.takeYourTime === true;
  const view = stopListView(model.data, lang);
  const titleId = useId();
  const urgentId = useId();
  const otherId = useId();
  useWakeLock(true);

  // What is said on opening: check_stop_now when a test was running, then check_stop_why, then at
  // home the stay put line. Back after "I am fine": nothing.
  const opening: SpeechLine[] = [];
  if (!takeYourTime) {
    if (cameraRunning(model.state)) opening.push(cueSpeech("check_stop_now", lang, "safety"));
    opening.push(cueSpeech("check_stop_why", lang, "info"));
    if (!booth) opening.push(copyLine(lang, t(lang, "assessment.stop.stayPut")));
  }
  // The question is the council cue check_stop_why (same words, vocalised); the group headings and
  // the option labels have no vocalised form yet, so in Arabic they are captioned without a voice.
  const listen: SpeechLine[] = [
    cueSpeech("check_stop_why", lang, "info"),
    copyLine(lang, t(lang, "assessment.stop.groupUrgent")),
    ...view.urgent.map((r) => copyLine(lang, r.label)),
    copyLine(lang, t(lang, "assessment.stop.groupOther")),
    ...view.other.map((r) => copyLine(lang, r.label)),
  ];
  const seq = useSpeechSequence(opening, { key: `S41:${takeYourTime}:${lang}` });

  // The line at the top until the first touch: stay put at home, the staff line at the booth.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!takeYourTime) extraTimerUsed = false;
  }, [takeYourTime]);
  const timerOn = !takeYourTime || (cameraFine(o?.fineVia) && !extraTimerUsed);
  const timer = useNoAnswerTimer(
    SAFETY_TIMING.stopListNoAnswerMs,
    () => {
      if (takeYourTime) extraTimerUsed = true;
      dispatch({ type: "STOP_NO_INPUT" });
    },
    timerOn,
  );

  // A double tap on STOP must never pick a reason (the faint row can sit under the STOP point): a row
  // counts only for a new press that started after the list opened, and not in its first 600 ms when
  // a press opened it (useArmedPress).
  const armed = useArmedPress(SAFETY_TIMING.stopArmMs);
  const choose = (r: StopRow) => dispatch({ type: "STOP_OPTION", option: r.id });
  const rows = (list: StopRow[]) =>
    list.map((r) => (
      <button
        key={r.id}
        type="button"
        className="check-answer safety-stop-row"
        data-option={r.id}
        onClick={(e) => {
          if (armed(e)) choose(r);
        }}
      >
        <span className="safety-stop-row-icon" aria-hidden="true">
          <CheckIcon name={r.icon} size={28} />
        </span>
        <span className="check-answer-text">{bidiText(lang, r.label)}</span>
      </button>
    ));

  return (
    <div
      className="safety-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-screen="S41"
      // The line goes after the first touch has done its work: hiding it on pointerdown would move the
      // rows under the finger before the click lands, so a tap could choose the row below.
      onClickCapture={() => setTimeout(() => setTouched(true), 0)}
      onKeyDown={() => setTouched(true)}
      onScrollCapture={() => setTouched(true)}
    >
      <CheckShell
        exit={false}
        sound
        aboveCaption={
          !touched &&
          !takeYourTime && (
            <p className="safety-stay-put">
              {bidiText(lang, t(lang, booth ? "assessment.test.answerBooth" : "assessment.stop.stayPut"))}
            </p>
          )
        }
      >
        <h1 id={titleId} className="safety-list-title">
          {bidiText(lang, view.ask)}
        </h1>
        {takeYourTime && <p className="safety-take-time">{t(lang, "assessment.stop.takeYourTime")}</p>}
        <div className="safety-list-hint">
          <p className="check-meta">{t(lang, "assessment.stop.hint")}</p>
          <button
            type="button"
            className="ghost safety-listen is-inline"
            onClick={() => {
              timer.restart();
              seq.replay(listen);
            }}
          >
            <CheckIcon name="speaker" />
            {t(lang, "assessment.stop.listen")}
          </button>
        </div>
        <section className="safety-stop-group" role="group" aria-labelledby={urgentId}>
          <h2 id={urgentId}>{t(lang, "assessment.stop.groupUrgent")}</h2>
          <div className="check-answers">{rows(view.urgent)}</div>
        </section>
        <section className="safety-stop-group" role="group" aria-labelledby={otherId}>
          <h2 id={otherId}>{t(lang, "assessment.stop.groupOther")}</h2>
          <div className="check-answers">{rows(view.other)}</div>
        </section>
      </CheckShell>
      {/* STOP stays where it was, visible but inert while the list is open (spec S41): the bottom zone
          under the STOP point is never a row, so a second tap there lands on nothing. */}
      {cameraRunning(model.state) && (
        <div className="safety-stop-zone is-inert" aria-hidden="true">
          <span className="safety-stop">
            <CheckIcon name="stop-square" size={28} />
            <span>{t(lang, "assessment.stop.button")}</span>
          </span>
        </div>
      )}
    </div>
  );
}
