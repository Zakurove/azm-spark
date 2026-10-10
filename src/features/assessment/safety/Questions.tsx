/**
 * The questions asked where the person sits (UX spec 4.7, S38b, S47, S48, S49; council 7.2-1, O42):
 *
 *   S38b  the faint follow up after a faint or a fall stop (sf_faint_loc)
 *   S47   pain compared with before this test (bt_pain_after)
 *   S48   after test questions: armrest contact (side lean), pushed with the hands (chair stand), and
 *         the count check (a timed test with 10 to 20% unscored)
 *   S49   the end of check symptom question (ec_symptoms), general or side form
 *
 * Each is spoken and captioned on arrival and answered by tap on big answer buttons in data order
 * (AnswerZones), and at the booth staff tap the answer the person says (the booth line under them). A
 * chosen answer is read back for 3 s and then commits; the safe answers commit at once (much more
 * pain, yes or not sure on S38b, yes on S49). On S47 and S48 the test is still running, so STOP stays
 * at the bottom.
 *
 * States: L, E, Er not applicable (all local); Off works (answers are routed on the phone and posted
 * later); Cam not applicable.
 */
import { useEffect, useId, useRef, useState } from "react";
import { localizeDigits, t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { CHECK_DATA, precheckItem, screenText, stopFollowUp, testDef } from "../../../movements/assessments";
import type { ScreenId } from "../../../movements/types";
import { cameraRunning, outcomeKey } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { CheckShell } from "../shared/CheckShell";
import { CountStepper, parseCount } from "../shared/CountStepper";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import { EMPHASIS, emphasise, endQuestionView, sideOfState, sideWords } from "./content";
import { playChime, useFoldFit, useSpeechSequence, useWakeLock } from "./hooks";
import { AnswerZones, StopButton, type ZoneOption } from "./parts";
import { copyLine, cueSpeech, dataLine, screenLines, splitSentences, type SpeechLine } from "./speech";

/**
 * C15: at the booth, one small line under the question: our staff tap the answer the person says. The
 * question stays the heading and the biggest text on the screen.
 */
export function StaffLine() {
  const { lang, booth } = useCheckUi();
  if (!booth) return null;
  return <p className="check-meta safety-staff-line">{t(lang, "assessment.test.answerBooth")}</p>;
}

/** The line under the answers after STOP at home: stay put (4.3). */
function ZoneLine({ afterStop }: { afterStop?: boolean }) {
  const { lang, booth } = useCheckUi();
  if (afterStop && !booth) return <p className="safety-zone-line">{t(lang, "assessment.stop.stayPut")}</p>;
  return null;
}

/** The yes and no answers the data leaves unlabelled (0.1: common.yes and common.no). */
function yesNo(lang: "ar" | "en", yesAtOnce = false): ZoneOption[] {
  return [
    { value: "yes", label: t(lang, "assessment.common.yes"), icon: "check", commitAtOnce: yesAtOnce },
    { value: "no", label: t(lang, "assessment.common.no"), icon: "close" },
  ];
}

/* ------------------------------------------------------------------ S38b */

/**
 * S38b, the faint follow up (Q33 (3), O42): «هل فقدت الوعي، ولو للحظة؟», spoken as check_faint_loc.
 * Yes or Not sure open S36 at once; No returns to the stop's screen with its lock. It waits for the
 * answer: there is no timer (D-016), and at the booth staff tap the answer the person says. There is
 * no call control here: 997 is on the emergency screens only (D-016), and a yes opens S36.
 */
export function FaintAsk({ model, dispatch }: ScreenProps) {
  const { lang, booth } = useCheckUi();
  const s = model.state.kind === "faintAsk" ? model.state : null;
  const q = stopFollowUp("sf_faint_loc");
  const back: ScreenId = s?.back?.screen ?? "scr_faint";
  const headingId = useId();
  const seq = useSpeechSequence([{ ...cueSpeech("check_faint_loc", lang, "info"), onScreen: true }], {
    key: `S38b:${lang}`,
  });
  useWakeLock(true);
  const root = useRef<HTMLDivElement>(null);
  const fit = useFoldFit(root, 5, `S38b:${lang}:${booth}`);

  const options: ZoneOption[] = q.options.map((o) => ({
    value: o.value as string,
    label: o.label[lang],
    icon: o.value === "yes" ? "check" : o.value === "no" ? "close" : "help",
    commitAtOnce: o.value !== "no",
  }));
  // The collapsed S38 text keeps its first sentence visible, and for SCI the scr_faint_sci sentence
  // too (sit upright instead with a pounding headache, the AD rule): never collapsed away (R3C-07 (4)).
  const intro = splitSentences(screenText(back, lang))[0] ?? "";
  const sci = s?.back?.alsoShow.includes("scr_faint_sci") ? screenText("scr_faint_sci", lang) : null;
  const listen: SpeechLine[] = [
    cueSpeech("check_faint_loc", lang),
    ...screenLines(back, lang, { block: back }),
  ];
  return (
    <CheckShell exit={false} sound>
      <div className="safety-question is-stage" data-screen="S38b" ref={root} data-fit={fit}>
        <h1 id={headingId} className="safety-stage-question">
          {bidiText(lang, q.ask[lang])}
        </h1>
        <StaffLine />
        <AnswerZones
          labelledBy={headingId}
          fold
          options={options}
          say={(line) => seq.replay([line])}
          onAnswer={(v) => dispatch({ type: "FAINT_ANSWER", value: v as "yes" | "no" | "unsure" })}
        />
        <p className="check-body safety-intro">{bidiText(lang, intro)}</p>
        {sci && <p className="check-body safety-intro">{bidiText(lang, sci)}</p>}
        <button type="button" className="ghost safety-listen" onClick={() => seq.replay(listen)}>
          <CheckIcon name="speaker" />
          {t(lang, "assessment.common.listen")}
        </button>
      </div>
    </CheckShell>
  );
}

/* ------------------------------------------------------------------ S47 */

/**
 * S47, pain compared with before this test (bt_pain_after): after each side of the arm tests and once
 * after the side lean and the chair stand, and after a pain stop. A soft chime, then the question
 * spoken from its arTts. "Much more, or a sudden sharp pain" commits at once (the safe error).
 */
export function Between({ model, dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const s = model.state.kind === "between" ? model.state : null;
  const q = precheckItem("bt_pain_after");
  const headingId = useId();
  const seq = useSpeechSequence([{ ...dataLine(q.ask, lang), onScreen: true }], { key: `S47:${lang}` });
  const ui = useCheckUi();
  const root = useRef<HTMLDivElement>(null);
  const fit = useFoldFit(root, 5, `S47:${lang}:${ui.booth}:${s?.scope}:${s?.via}`);
  useEffect(() => playChime(ui.sound.on), []);
  const at = sideOfState(model);
  const side =
    s && s.scope === "side" && at && at.side !== "none" ? sideWords(at.testId, at.side, lang) : null;
  const options: ZoneOption[] = q.options.map((o) => ({
    value: o.value,
    label: o.label[lang],
    icon: o.value === "same" ? "equals" : o.value === "more" ? "arrow-up" : "alert-triangle",
    commitAtOnce: o.value === "much",
    speech: dataLine(o.label, lang),
  }));
  return (
    <>
      <CheckShell sound>
        <div className="safety-question is-stage" data-screen="S47" ref={root} data-fit={fit}>
          {side && (
            <p className="safety-kicker">
              {bidiText(lang, t(lang, "assessment.between.sideDone", { side }))}
            </p>
          )}
          <h1 id={headingId} className="safety-stage-question">
            {bidiText(lang, q.ask[lang])}
          </h1>
          <StaffLine />
          <AnswerZones
            labelledBy={headingId}
            fold
            options={options}
            say={(line) => seq.replay([line])}
            onAnswer={(v) => dispatch({ type: "BETWEEN_ANSWER", value: v as "same" | "more" | "much" })}
          />
          <ZoneLine afterStop={s?.via === "stop"} />
        </div>
      </CheckShell>
      {cameraRunning(model.state) && <StopButton onPress={() => dispatch({ type: "STOP" })} />}
    </>
  );
}

/* ------------------------------------------------------------------ S48 */

/**
 * S48, after test questions: armrest contact after each side of the side lean (heading: the side),
 * pushed with the hands after a chair stand stopped for arm use, and the count check. Yes and No are
 * read back for 3 s. A different count is typed at the phone (0 to 60, Arabic Indic and Persian digits
 * accepted).
 */
export function AfterTest({ model, dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const kind = model.state.kind;
  const headingId = useId();
  const at = sideOfState(model);
  const [typing, setTyping] = useState(false);
  let ask: { ar: string; en: string; arTts?: string };
  let group: string | null = null;
  if (kind === "after.contact") {
    ask = testDef("trunk_control_seated").metric.contactAsk;
    if (at && at.side !== "none") group = sideWords(at.testId, at.side, lang);
  } else if (kind === "after.pushed") ask = testDef("chair_stand_30s").pushedAsk;
  else ask = { ar: t("ar", "assessment.count.ask"), en: t("en", "assessment.count.ask") };
  const seq = useSpeechSequence(
    [{ ...(kind === "after.count" ? copyLine(lang, ask[lang]) : dataLine(ask, lang)), onScreen: true }],
    { key: `S48:${kind}:${lang}` },
  );
  const { booth } = useCheckUi();
  const root = useRef<HTMLDivElement>(null);
  const fit = useFoldFit(root, 5, `S48:${kind}:${lang}:${booth}:${typing}`);
  const count = at ? model.data.outcomes[outcomeKey(at.testId, at.side)]?.value : undefined;
  const options: ZoneOption[] =
    kind === "after.count"
      ? [
          { value: "yes", label: t(lang, "assessment.count.yes"), icon: "check" },
          { value: "no", label: t(lang, "assessment.count.no"), icon: "close" },
        ]
      : yesNo(lang);
  return (
    <>
      <CheckShell sound>
        <div
          className="safety-question is-stage"
          data-screen="S48"
          data-kind={kind}
          ref={root}
          data-fit={fit}
        >
          {group && <p className="safety-kicker">{group}</p>}
          <h1 id={headingId} className="safety-stage-question">
            {bidiText(lang, ask[lang])}
          </h1>
          {!typing && <StaffLine />}
          {kind === "after.count" && typeof count === "number" && (
            <p className="safety-count">
              <bdi>{bidiText(lang, String(count))}</bdi>
            </p>
          )}
          {typing ? (
            <CountInput
              initial={typeof count === "number" ? count : 0}
              onDone={(n) => dispatch({ type: "AFTER_ANSWER", value: n })}
            />
          ) : (
            <AnswerZones
              labelledBy={headingId}
              fold
              options={options}
              say={(line) => seq.replay([line])}
              onAnswer={(v) => {
                if (kind === "after.count" && v === "no") return setTyping(true);
                if (kind === "after.count")
                  return dispatch({ type: "AFTER_ANSWER", value: typeof count === "number" ? count : true });
                dispatch({ type: "AFTER_ANSWER", value: v === "yes" });
              }}
            />
          )}
        </div>
      </CheckShell>
      {cameraRunning(model.state) && <StopButton onPress={() => dispatch({ type: "STOP" })} />}
    </>
  );
}

const COUNT_MIN = 0;
const COUNT_MAX = 60;

/**
 * The count at the phone (S48 count check), 0 to 60, with the S30 stepper look (CountStepper): minus
 * and plus, or typed with Arabic Indic and Persian digits read as numbers, shown back in Western
 * digits (D-036 item 3). The flow stores it with countSource 'self' (O22).
 */
export function CountInput({ initial, onDone }: { initial: number; onDone(n: number): void }) {
  const { lang } = useCheckUi();
  const [text, setText] = useState(localDigits(lang, initial));
  const [error, setError] = useState(false);
  const value = parseCount(text, COUNT_MIN, COUNT_MAX);
  // The answer that opened this field unmounts with the zones: focus moves to the field, so keyboard,
  // switch and screen reader users keep their place (it is labelled «كم عددت؟»).
  const inputId = useId();
  useEffect(() => {
    document.getElementById(inputId)?.focus();
  }, []);
  return (
    <div className="safety-count-input">
      <CountStepper
        inputId={inputId}
        label={t(lang, "assessment.count.howMany")}
        text={text}
        onText={(v) => {
          setText(v);
          setError(false);
        }}
        min={COUNT_MIN}
        max={COUNT_MAX}
        invalid={error}
      />
      <p className="check-hint">{t(lang, "assessment.count.note")}</p>
      <button type="button" className="cta" onClick={() => (value !== null ? onDone(value) : setError(true))}>
        {t(lang, "assessment.common.continue")}
      </button>
    </div>
  );
}

/** A number as the page shows it: Western digits in both languages (D-036 item 3). */
function localDigits(lang: "ar" | "en", n: number): string {
  return localizeDigits(lang, String(n));
}

/* ------------------------------------------------------------------ S49 */

/**
 * S49, the end of check question (Q23 (7), O37): one question for everyone before any result, the
 * side form when the server names a side. Yes opens S36 at once; No is read back, then the results.
 * The meaning words are bold (0.2). The chronic note (O37) is not shown: its data status holds it until
 * the Q18 (6) cognitive testing is complete.
 */
export function EndQuestion({ model, dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const s = model.state.kind === "endQuestion" ? model.state : null;
  const view = endQuestionView(s?.side ?? null, lang);
  const headingId = useId();
  // C18: the lead, then each sign, all on screen (so never in the caption strip).
  const line = dataLine({ ar: view.text, en: view.text, arTts: view.arTts ?? undefined }, lang);
  const signs = view.list.map((text, k) => ({
    ...dataLine({ ar: text, en: text, arTts: view.listTts?.[k] }, lang),
    display: text,
    onScreen: true,
  }));
  const seq = useSpeechSequence([{ ...line, display: view.text, onScreen: true }, ...signs], {
    key: `S49:${s?.side ?? ""}:${lang}`,
  });
  const { booth } = useCheckUi();
  const root = useRef<HTMLDivElement>(null);
  const fit = useFoldFit(root, 5, `S49:${s?.side ?? ""}:${lang}:${booth}`);
  const options: ZoneOption[] = CHECK_DATA.endOfCheck[0].options.map((o) => ({
    value: o.value,
    label: o.label[lang],
    icon: o.value === "yes" ? "check" : "close",
    commitAtOnce: o.value === "yes",
  }));
  return (
    <CheckShell sound>
      <div className="safety-question" data-screen="S49" ref={root} data-fit={fit}>
        <p className="safety-kicker">{t(lang, "assessment.symptom.kicker")}</p>
        <h1 id={headingId} className="check-question">
          {emphasise(view.text, EMPHASIS.ec_symptoms[lang]).map((p, i) =>
            p.strong ? (
              <strong key={i}>{bidiText(lang, p.text)}</strong>
            ) : (
              <span key={i}>{bidiText(lang, p.text)}</span>
            ),
          )}
        </h1>
        <StaffLine />
        <ul className="check-card is-cream check-list safety-signs">
          {view.list.map((sign) => (
            <li key={sign}>{bidiText(lang, sign)}</li>
          ))}
        </ul>
        <AnswerZones
          labelledBy={headingId}
          fold
          options={options}
          say={(l) => seq.replay([l])}
          onAnswer={(v) => dispatch({ type: "END_ANSWER", yes: v === "yes" })}
        />
        {/* Listen again after the answers, so the answers stay on screen with the long question. */}
        <button type="button" className="ghost safety-listen" onClick={() => seq.replay()}>
          <CheckIcon name="speaker" />
          {t(lang, "assessment.precheck.listenQuestion")}
        </button>
      </div>
    </CheckShell>
  );
}
