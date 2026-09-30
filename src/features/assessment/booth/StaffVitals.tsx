/**
 * S56 Staff vitals (pc_booth_vitals; council Q21, O47; UX spec S56).
 *
 * Before a booth chair stand for a visitor whose clearance is no or not sure, a licensed practitioner
 * takes the resting blood pressure and pulse with a validated automated upper arm cuff. The screen:
 *   1. a line for the visitor, readable from the side desk: ask a staff member to come to the phone;
 *   2. "Staff only": the staff part opens after the staff code (PIN protected staff mode, Q21 (5));
 *   3. the staff line read to the visitor (data: pc_booth_vitals.staffLine), the method and the arm
 *      rule, two readings (pulse, systolic, diastolic), their means (read only), the cuff's irregular
 *      heartbeat flag, "These values are not stored", Continue;
 *   4. always: "No validated cuff or licensed practitioner now" (the chair stand is then not offered
 *      to this visitor, reason clearance_booth, O47 (4)).
 * The means go to the pre-check as the answer (evaluatePrecheck applies the Q21 limits and the O47
 * rows); the screen never shows a threshold and never says why a test is skipped (S27 says it, in
 * neutral words). The usual systolic field is not rendered at the booth (O47 (2)). Values live in this
 * screen's memory only: they are gone when it closes, and the flow drops the raw answers when the
 * check is frozen and before the next visitor.
 *
 * On a visitor's own phone (a signed in visitor with a one check token) the staff code is never typed:
 * it is typed only on staff devices (S55, 7.2-11). There only "No validated cuff or licensed
 * practitioner now" can be chosen, so the chair stand is not offered.
 *
 * States: error (validation, the staff code); loading (the code check, the start call on a signed in
 * booth check); offline: the code cannot be checked, "unavailable" stays; empty and camera do not apply.
 */
// R3C-32 (s56-visitor-phone, confirmed 2026-09-30). S56 asks for the staff code on "the booth phone"; a signed in visitor's
// own phone is not one, so the staff code is not asked there and the chair stand is not offered.
// R3C-32 (s56-offline-gate, confirmed 2026-09-30). Offline the staff code cannot be checked (the server holds the daily
// code); staff then choose "unavailable", the safe side, so the chair stand is not offered.
import { useId, useRef, useState } from "react";
import { fmtNum, type Lang } from "../../../app/i18n";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import type { AnswerValue } from "../../../medical/precheck";
import { precheckItem } from "../../../movements/assessments";
import { readBoothPass } from "../boothMode";
import { backTarget, questionCounter, RETRYABLE_START_ERRORS } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { AnswerButtons } from "../shared/answers";
import CheckIcon from "../shared/CheckIcon";
import { CheckShell } from "../shared/CheckShell";
import { useCheckUi } from "../shared/CheckUi";
import { ErrorState, LoadingState } from "../shared/states";
import { BoothCodeForm } from "./CodeForm";
import {
  checkVitals,
  cleanTyped,
  EMPTY_VITALS,
  kindOf,
  meansOf,
  parseVital,
  VITAL_RANGES,
  type VitalField,
  type VitalKind,
  type VitalsInput,
} from "./vitals";
import "./booth.css";

const QUESTION = "pc_booth_vitals";

export function StaffVitals(props: ScreenProps) {
  return <StaffVitalsView {...props} />;
}

/** S56 with its staff part already open (tests; the screen itself always starts locked). */
export function StaffVitalsView({
  model,
  dispatch,
  api,
  initialUnlocked = false,
}: Omit<ScreenProps, "retryCamera" | "retrySave"> & { initialUnlocked?: boolean }) {
  const { lang } = useCheckUi();
  const s = model.state;
  const questionId = s.kind === "question" ? s.id : QUESTION;
  // A visitor's own phone never takes the staff code (S55, 7.2-11).
  const [visitorPhone] = useState(() => readBoothPass()?.kind === "visitor");
  const [staffSession] = useState(() => {
    const pass = readBoothPass();
    return pass?.kind === "staff" ? pass.session : undefined;
  });
  const [unlocked, setUnlocked] = useState(initialUnlocked);
  const [input, setInput] = useState<VitalsInput>(EMPTY_VITALS);
  const [shown, setShown] = useState<Set<VitalField>>(new Set());
  const [irregular, setIrregular] = useState<boolean | null>(null);
  const [irregularHint, setIrregularHint] = useState(false);
  const refs = useRef<Partial<Record<VitalField, HTMLInputElement | null>>>({});
  const answersRef = useRef<HTMLDivElement>(null);
  const handoffId = useId();
  const irregularId = useId();
  const hintId = useId();

  const counter = questionCounter(model);
  const back = backTarget(model) ? () => dispatch({ type: "BACK" }) : undefined;
  const answer = (value: AnswerValue) => dispatch({ type: "ANSWER", id: questionId, value });
  const unavailable = () => dispatch({ type: "ANSWER", id: questionId, value: "unavailable" });

  const submit = () => {
    const c = checkVitals(input, irregular);
    if (c.answer) return answer({ ...c.answer });
    setShown(new Set(c.invalid));
    setIrregularHint(c.irregularMissing);
    const first = c.invalid[0];
    if (first) refs.current[first]?.focus();
    else answersRef.current?.querySelector<HTMLElement>("button")?.focus();
  };

  // A signed in booth check starts on the phone's last answer: busy, then the start call's error.
  if (s.kind === "starting") {
    const retry = s.error !== null && RETRYABLE_START_ERRORS.includes(s.error);
    return (
      <CheckShell counter={counterSpec(lang, counter)}>
        <div className="booth-screen" data-screen="S56">
          {s.error === null ? (
            <>
              <h1>{t(lang, "assessment.vitals.title")}</h1>
              <LoadingState text={t(lang, "assessment.state.loading.check")} />
            </>
          ) : (
            <ErrorState
              level={1}
              title={t(lang, "assessment.state.error.titleStart")}
              body={t(
                lang,
                s.error === "offline"
                  ? "assessment.state.offline.startBlocked"
                  : "assessment.state.error.bodyStart",
              )}
              onRetry={() => dispatch({ type: retry ? "RETRY" : "EXIT" })}
              secondary={{
                label: t(lang, "assessment.camera.later"),
                onClick: () => dispatch({ type: "EXIT" }),
              }}
            />
          )}
        </div>
      </CheckShell>
    );
  }

  const staffLine = precheckItem(QUESTION).staffLine;
  const means = meansOf(input);
  const meanRows = (["sys", "dia", "hr"] as const).filter((k) => means[k] !== null);

  const setField = (f: VitalField, raw: string) => {
    setInput((v) => ({ ...v, [f]: cleanTyped(raw) }));
    if (shown.has(f)) {
      const next = new Set(shown);
      next.delete(f);
      setShown(next);
    }
  };
  // On leaving a field: a valid value is shown back in the page's digits (0.2); a value outside its
  // range shows the range under the field.
  const blurField = (f: VitalField) => {
    const p = parseVital(f, input[f]);
    if (p.ok) setInput((v) => ({ ...v, [f]: fmtNum(p.value, lang) }));
    else if (p.error === "range") setShown((x) => new Set(x).add(f));
  };

  return (
    <CheckShell
      counter={counterSpec(lang, counter)}
      onBack={back}
      footer={{
        ...(unlocked ? { primary: { label: t(lang, "assessment.common.continue"), onClick: submit } } : {}),
        secondary: { label: t(lang, "assessment.vitals.unavailable"), onClick: unavailable },
      }}
    >
      <div className="booth-screen" data-screen="S56" data-unlocked={unlocked ? "yes" : "no"}>
        <p id={handoffId} className="booth-handoff">
          <CheckIcon name="people" />
          <span>{t(lang, "assessment.vitals.handoff")}</span>
        </p>
        <h1 className="booth-pill-heading" aria-describedby={handoffId}>
          <span className="booth-pill">
            <CheckIcon name="shield" size={20} />
            {t(lang, "assessment.vitals.staffOnly")}
          </span>
        </h1>
        <h2>{t(lang, "assessment.vitals.title")}</h2>

        {!unlocked && !visitorPhone && (
          <BoothCodeForm
            // On a booth phone the device's staff session goes with the code, so the unlocks of
            // the phones behind one venue address never share a limit.
            api={{ boothVerify: (code) => api.boothVerify(code, staffSession) }}
            submitLabel={t(lang, "assessment.common.continue")}
            onVerified={() => setUnlocked(true)}
          />
        )}

        {unlocked && (
          <>
            {staffLine && (
              <p className="check-card is-info check-body" data-staff-line="">
                {bidiText(lang, staffLine[lang])}
              </p>
            )}
            <p className="booth-note">{t(lang, "assessment.vitals.method")}</p>
            <p className="booth-note">{t(lang, "assessment.vitals.arm")}</p>

            {([1, 2] as const).map((n) => (
              <fieldset key={n} className="booth-reading">
                <legend>
                  {t(lang, n === 1 ? "assessment.vitals.reading1" : "assessment.vitals.reading2")}
                </legend>
                {(["hr", "sys", "dia"] as const).map((k) => {
                  const f = `${k}${n}` as VitalField;
                  return (
                    <VitalInput
                      key={f}
                      field={f}
                      value={input[f]}
                      invalid={shown.has(f)}
                      inputRef={(el) => {
                        refs.current[f] = el;
                      }}
                      onChange={(v) => setField(f, v)}
                      onBlur={() => blurField(f)}
                    />
                  );
                })}
              </fieldset>
            ))}

            {meanRows.length > 0 && (
              <section className="booth-means" aria-label={t(lang, "assessment.vitals.mean")} data-means="">
                <h3 className="check-label">{t(lang, "assessment.vitals.mean")}</h3>
                <dl className="booth-section">
                  {meanRows.map((k) => (
                    <div key={k} className="booth-means-row">
                      <dt>{t(lang, `assessment.vitals.${k}`)}</dt>
                      <dd data-mean={k}>{bidiText(lang, fmtNum(means[k]!, lang))}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <div className="booth-section">
              <p id={irregularId} className="booth-field-label">
                {t(lang, "assessment.vitals.irregular")}
              </p>
              {irregularHint && irregular === null && (
                <p id={hintId} className="check-field-error">
                  {t(lang, "assessment.common.chooseToContinue")}
                </p>
              )}
              <div ref={answersRef}>
                <AnswerButtons
                  labelledBy={irregularId}
                  describedBy={irregularHint && irregular === null ? hintId : undefined}
                  mode="select"
                  options={[
                    { value: "yes", label: t(lang, "assessment.common.yes") },
                    { value: "no", label: t(lang, "assessment.common.no") },
                  ]}
                  value={irregular === null ? null : irregular ? "yes" : "no"}
                  onSubmit={(v) => {
                    setIrregular(v === "yes");
                    setIrregularHint(false);
                  }}
                />
              </div>
            </div>
            <p className="booth-note">{t(lang, "assessment.vitals.notStored")}</p>
          </>
        )}
      </div>
    </CheckShell>
  );
}

function counterSpec(lang: Lang, c: { n: number; total: number } | null) {
  return c ? { text: t(lang, "assessment.common.questionOf", c), value: c.n, max: c.total } : undefined;
}

function VitalInput({
  field,
  value,
  invalid,
  inputRef,
  onChange,
  onBlur,
}: {
  field: VitalField;
  value: string;
  invalid: boolean;
  inputRef(el: HTMLInputElement | null): void;
  onChange(v: string): void;
  onBlur(): void;
}) {
  const { lang } = useCheckUi();
  const id = useId();
  const errorId = useId();
  const kind: VitalKind = kindOf(field);
  const [min, max] = VITAL_RANGES[kind];
  return (
    <div className="booth-vital-row">
      <label className="booth-field-label" htmlFor={id}>
        {t(lang, `assessment.vitals.${kind}`)}
      </label>
      <input
        ref={inputRef}
        id={id}
        className="booth-input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        data-field={field}
      />
      {invalid && (
        <p id={errorId} className="booth-alert">
          {bidiText(lang, t(lang, "assessment.vitals.range", { min, max }))}
        </p>
      )}
    </div>
  );
}
