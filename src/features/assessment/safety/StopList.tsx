/**
 * S41, the stop list: "What made you stop?" (UX spec S41, map 2.6; council Q31 (2) (3), O43, C2).
 *
 * Opened by STOP on any camera screen and by «أريد التوقف» (the check in, S43), over the stage. The
 * data's options for this person, urgent group first (chest, stroke signs, AD signs only with sci_t6,
 * faint, breath, fall), then the other reasons (pain, tired, choice, something else); each row is at
 * least 64 px with an icon and routes with one tap (no Next): the flow's stopRoute sends it to S36,
 * S37, S38, S39, S40a, S47 or S42. There is no "pressed by mistake" row (O43).
 *
 * On a STOP from a test, check_stop_now plays, then check_stop_why once, and at home the stay put line
 * (C2). C16: none of them is a banner over the list: the calm line sits at the top (until the first
 * touch), the question is the heading, then the options; at the booth the small staff line sits under
 * the heading (C15). The list stays until it is answered (D-016).
 *
 * States: L, E, Er, Cam not applicable (all local); Off works (local routing, the stop is queued).
 */
import { useId, useState } from "react";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { cameraRunning } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { CheckShell } from "../shared/CheckShell";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import { stopListView, type StopRow } from "./content";
import { useArmedPress, useSpeechSequence, useWakeLock } from "./hooks";
import { StaffLine } from "./Questions";
import { copyLine, cueSpeech, type SpeechLine } from "./speech";
import { SAFETY_TIMING } from "./timing";

export function StopList({ model, dispatch }: ScreenProps) {
  const ui = useCheckUi();
  const { lang, booth } = ui;
  const view = stopListView(model.data, lang);
  const titleId = useId();
  const urgentId = useId();
  const otherId = useId();
  useWakeLock(true);

  // What is said on opening: check_stop_now when a test was running, then check_stop_why, then at
  // home the stay put line.
  // C16: spoken, never a caption banner: the person has already stopped, the question is the heading
  // and the calm line is on the screen.
  const opening: SpeechLine[] = [];
  if (cameraRunning(model.state))
    opening.push({ ...cueSpeech("check_stop_now", lang, "safety"), onScreen: true });
  opening.push({ ...cueSpeech("check_stop_why", lang, "info"), onScreen: true });
  if (!booth) opening.push({ ...copyLine(lang, t(lang, "assessment.stop.stayPut")), onScreen: true });
  // The question is the council cue check_stop_why (same words, vocalised); the group headings and
  // the option labels have no vocalised form yet, so in Arabic they are captioned without a voice.
  const listen: SpeechLine[] = [
    cueSpeech("check_stop_why", lang, "info"),
    copyLine(lang, t(lang, "assessment.stop.groupUrgent")),
    ...view.urgent.map((r) => copyLine(lang, r.label)),
    copyLine(lang, t(lang, "assessment.stop.groupOther")),
    ...view.other.map((r) => copyLine(lang, r.label)),
  ];
  const seq = useSpeechSequence(opening, { key: `S41:${lang}` });

  // The calm line at the top until the first touch (C16: word for word, everywhere).
  const [touched, setTouched] = useState(false);

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
          !touched && <p className="safety-stay-put">{bidiText(lang, t(lang, "assessment.stop.stayPut"))}</p>
        }
      >
        <h1 id={titleId} className="safety-list-title">
          {bidiText(lang, view.ask)}
        </h1>
        <StaffLine />
        <div className="safety-list-hint">
          <p className="check-meta">{t(lang, "assessment.stop.hint")}</p>
          <button type="button" className="ghost safety-listen is-inline" onClick={() => seq.replay(listen)}>
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
