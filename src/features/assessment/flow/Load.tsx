/**
 * The arm curl preparation at home (never at the booth, Q5; never for an arm set to arm_only, P2):
 *   S29 grip     the grip question per arm at the first check of a series, before S30
 *   S29 practice the practice check after the two practice bends, from the chair (large type, answer
 *                buttons laid out as the answer zones, STOP always there)
 *   S30 load     what the person holds, per arm: first check (the allowed loads, bottle sizes, a kg
 *                stepper), re-test (the same as last time), or lighter choices after a practice that
 *                was not easy (the step down)
 */
import { useState } from "react";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import type { LoadKind } from "../../../medical/assessment";
import { testDef } from "../../../movements/assessments";
import type { Side } from "../../../movements/types";
import { backTarget, testCounter } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { AnswerButtons } from "../shared/answers";
import { CheckShell } from "../shared/CheckShell";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import { kgRange, loadArms, loadChoices, loadSummary, sideLabel, stepDownChoices, type Load } from "./copy";
import { KgStepper, SamePress } from "./parts";
import { useEntryLines, useVoice } from "./voice";

function useCounter(model: ScreenProps["model"]) {
  const { lang } = useCheckUi();
  const c = testCounter(model);
  return c
    ? { text: t(lang, "assessment.common.testOf", { n: c.n, total: c.total }), value: c.n, max: c.total }
    : undefined;
}

/* ------------------------------------------------------------------ S29 grip */

export function ArmCurlQuestion(props: ScreenProps) {
  return props.model.state.kind === "test.practiceCheck" ? (
    <PracticeCheck {...props} />
  ) : (
    <GripQuestion {...props} />
  );
}

function GripQuestion({ model, dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const i = (model.state as { i?: number }).i ?? 0;
  const arms = loadArms(model.data.tests[i]?.sides ?? []);
  const [at, setAt] = useState(0);
  const side = arms[at] ?? "right";
  const counter = useCounter(model);
  const q = testDef("arm_curl_30s").load.gripAsk;
  const grip = model.data.armCurl.grip[side];
  const titleId = `flow-grip-${side}`;
  const onBack =
    at > 0 ? () => setAt(at - 1) : backTarget(model) ? () => dispatch({ type: "BACK" }) : undefined;
  return (
    <CheckShell counter={counter} onBack={onBack} sound>
      <div className="flow-stack" data-screen="S29" data-variant="grip" key={side}>
        <p className="check-meta">{sideLabel("arm_curl_30s", side, lang)}</p>
        <h1 id={titleId} className="check-question">
          {bidiText(lang, q[lang])}
        </h1>
        <SamePress>
          <AnswerButtons
            labelledBy={titleId}
            options={[
              { value: "yes", label: t(lang, "assessment.common.yes") },
              { value: "no", label: t(lang, "assessment.common.no") },
            ]}
            value={grip === undefined ? null : grip ? "yes" : "no"}
            onSubmit={(v) => {
              dispatch({ type: "GRIP_ANSWER", side, yes: v === "yes" });
              if (at + 1 < arms.length) setAt(at + 1);
              else dispatch({ type: "PREP_NEXT" });
            }}
          />
        </SamePress>
      </div>
    </CheckShell>
  );
}

/* ------------------------------------------------------------------ S29 practice check */

/**
 * The practice check (Q5 wording), asked where the person sits: spoken from its arTts line, shown at
 * 40 px, answered by a tap (the booth build answers by tap; the zones come with phase 2, Q31 (5)).
 * STOP stays at the bottom, first in the focus order, as on every camera state.
 */
function PracticeCheck({ model, dispatch }: ScreenProps) {
  const { lang, booth } = useCheckUi();
  const voice = useVoice(model.data.soundMode);
  const s = model.state as { i: number; side: number };
  const item = model.data.tests[s.i]?.sides[s.side];
  const side = (item?.side === "left" || item?.side === "right" ? item.side : "right") as Side;
  const q = testDef("arm_curl_30s").load.practiceCheck;
  // At home the answer zones need the camera (AnswerZones, 4.7), which this screen does not run, so
  // the zone line (check_answer_zone) is not shown: the answers are taps. At the booth staff tap the
  // spoken answer (7.2-1), though the booth never asks this question (Q5).
  const zoneLine = booth ? t(lang, "assessment.test.answerBooth") : null;
  useEntryLines(voice, [lang === "ar" ? { display: q.ar, speech: q.arTts } : { display: q.en }], true);
  const counter = useCounter(model);
  return (
    <div className="flow-practice" data-screen="S29" data-variant="practice">
      <button
        type="button"
        className="check-stop flow-practice-stop"
        data-stop=""
        aria-label={t(lang, "assessment.stop.buttonLabel")}
        onClick={() => dispatch({ type: "STOP" })}
      >
        <CheckIcon name="stop-square" />
        {t(lang, "assessment.stop.button")}
      </button>
      <div className="flow-practice-top">
        {counter && <p className="check-meta">{bidiText(lang, counter.text)}</p>}
        <p className="check-meta">{sideLabel("arm_curl_30s", side, lang)}</p>
      </div>
      <h1 id="flow-practice-q" className="flow-practice-question">
        {bidiText(lang, q[lang])}
      </h1>
      {zoneLine && <p className="flow-practice-line">{bidiText(lang, zoneLine)}</p>}
      <div className="flow-practice-zones" role="group" aria-labelledby="flow-practice-q">
        <button type="button" className="flow-zone" onClick={() => dispatch({ type: "PRACTICE_OK" })}>
          <span className="flow-zone-n" aria-hidden="true">
            {bidiText(lang, "1")}
          </span>
          {t(lang, "assessment.common.yes")}
        </button>
        <button type="button" className="flow-zone" onClick={() => dispatch({ type: "PRACTICE_HEAVY" })}>
          <span className="flow-zone-n" aria-hidden="true">
            {bidiText(lang, "2")}
          </span>
          {t(lang, "assessment.common.no")}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ S30 load */

/**
 * The load of an arm at its last home check (Q5, from the context; or the heavier one chosen, Q26),
 * for the re-test form ("Do you have the same one as last time?"); the first check has none.
 */
function previousLoad(model: ScreenProps["model"], side: Side): Load | undefined {
  const si = model.data.signedIn;
  if (!si || si.firstCheck || model.data.setting !== "home") return undefined;
  const load = si.lastLoads?.[side];
  return load ? ({ ...load } as Load) : undefined;
}

export function LoadChoice({ model, dispatch }: ScreenProps) {
  const s = model.state as { i: number; stepDown?: boolean; arm?: Side };
  const run = model.data.tests[s.i];
  const prep = model.data.armCurl;
  const stepDown = s.stepDown === true;
  // The step down names the arm of the practice that was too heavy (the flow keeps it, S30).
  const arms = stepDown ? [s.arm ?? loadArms(run?.sides ?? [])[0] ?? "right"] : loadArms(run?.sides ?? []);
  const [at, setAt] = useState(0);
  const side = (arms[at] ?? "right") as Side;
  const item = run?.sides.find((x) => x.side === side);
  const previous = previousLoad(model, side);
  const counter = useCounter(model);
  const onBack =
    at > 0
      ? () => setAt(at - 1)
      : !stepDown && backTarget(model)
        ? () => dispatch({ type: "BACK" })
        : undefined;
  const done = (load: Load) => {
    dispatch({ type: "LOAD_CHOSEN", side, load });
    if (at + 1 < arms.length) setAt(at + 1);
    else dispatch({ type: "PREP_NEXT" });
  };
  const env = model.data.env;
  const allowed: LoadKind[] = env
    ? loadChoices({
        ctx: env.ctx,
        setting: model.data.setting,
        variant: item?.variant,
        gripYes: prep.grip[side],
      })
    : ["none"];
  return (
    <LoadPicker
      key={`${side}:${stepDown}`}
      side={side}
      allowed={allowed}
      stepDownFrom={stepDown ? prep.load[side] : undefined}
      // The same as last time only when that load is still allowed today (Q5).
      previous={stepDown || !previous || !allowed.includes(previous.kind) ? undefined : previous}
      onDone={done}
      shell={{ counter, onBack }}
    />
  );
}

/**
 * The load of one arm (S30), inside its own shell so the primary sits in the sticky footer: the same
 * as last time (re-test), or the allowed loads with their detail (bottle size, kilograms). The rows
 * keep select, then Next, because a row holds detail controls (S30).
 */
function LoadPicker({
  side,
  allowed,
  stepDownFrom,
  previous,
  onDone,
  shell,
}: {
  side: Side;
  allowed: LoadKind[];
  stepDownFrom?: Load;
  previous?: Load;
  onDone(l: Load): void;
  shell: { counter?: { text: string; value: number; max: number }; onBack?: () => void };
}) {
  const { lang } = useCheckUi();
  const load = testDef("arm_curl_30s").load;
  const [same, setSame] = useState<boolean | null>(previous ? null : false);
  const lighter = stepDownFrom !== undefined || (same === false && previous !== undefined);
  const down = lighter ? stepDownChoices(stepDownFrom ?? previous) : null;
  const kinds = down ? allowed.filter((k) => down.kinds.includes(k)) : allowed;
  const [kind, setKind] = useState<LoadKind | null>(null);
  const [kg, setKg] = useState<number>(1);
  const [liters, setLiters] = useState<0.5 | 1 | 1.5 | null>(null);
  const [tried, setTried] = useState(false);
  const titleId = `flow-load-${side}`;

  // Re-test: the same as last time (Q5 locked load).
  if (previous && same === null)
    return (
      <CheckShell
        {...shell}
        footer={{
          primary: { label: t(lang, "assessment.load.sameYes"), onClick: () => onDone(previous) },
          secondary: { label: t(lang, "assessment.load.sameNo"), onClick: () => setSame(false) },
        }}
      >
        <div className="flow-stack" data-screen="S30" data-variant="same">
          <p className="check-meta">{sideLabel("arm_curl_30s", side, lang)}</p>
          <h1 className="check-question">{t(lang, "assessment.load.sameTitle")}</h1>
          <p className="check-card flow-load-summary">{bidiText(lang, loadSummary(previous, lang))}</p>
        </div>
      </CheckShell>
    );

  const bottleSizes = load.bottleSizes.filter((b) => !down?.bottles || down.bottles.includes(b.value));
  const complete = kind !== null && (kind !== "bottle" || liters !== null);
  const result = (): Load =>
    kind === "bottle"
      ? { kind, liters: liters ?? 1 }
      : kind === "dumbbell" || kind === "cuff"
        ? { kind, kg }
        : { kind: "none" };
  const submit = () => {
    if (!complete) {
      setTried(true);
      return;
    }
    onDone(result());
  };
  const pick = (k: LoadKind) => {
    setKind(k);
    setTried(false);
    if (k === "dumbbell" || k === "cuff") {
      const r = kgRange(k);
      setKg(Math.min(r.start, down?.maxKg ?? r.max));
    }
  };
  const label = (k: LoadKind) => load.options.find((o) => o.value === k)?.label[lang] ?? k;
  return (
    <CheckShell
      {...shell}
      footer={{ primary: { label: t(lang, "assessment.common.next"), onClick: submit } }}
    >
      <div className="flow-stack" data-screen="S30" data-variant={lighter ? "stepDown" : "first"}>
        <p className="check-meta">{sideLabel("arm_curl_30s", side, lang)}</p>
        <h1 id={titleId} className="check-question">
          {bidiText(lang, load.ask[lang])}
        </h1>
        <p className="check-body">{bidiText(lang, (stepDownFrom ? load.stepDown : load.help)[lang])}</p>
        {previous && same === false && <p className="check-meta">{t(lang, "assessment.load.newLine")}</p>}
        {tried && !complete && (
          <p className="check-field-error">{t(lang, "assessment.common.chooseToContinue")}</p>
        )}
        <div className="check-answers" role="group" aria-labelledby={titleId}>
          {kinds.map((k) => {
            const on = kind === k;
            return (
              <div key={k} className={`flow-load-row${on ? " is-on" : ""}`}>
                <button type="button" className="check-answer" aria-pressed={on} onClick={() => pick(k)}>
                  <span className="check-answer-mark" aria-hidden="true">
                    <CheckIcon name="check" size={18} />
                  </span>
                  <span className="check-answer-text">{bidiText(lang, label(k))}</span>
                </button>
                {on && k === "bottle" && (
                  <div className="flow-load-detail">
                    <p id={`${titleId}-bottle`} className="check-label">
                      {t(lang, "assessment.load.bottleSize")}
                    </p>
                    <div className="flow-segments" role="radiogroup" aria-labelledby={`${titleId}-bottle`}>
                      {bottleSizes.map((b) => (
                        <button
                          key={b.value}
                          type="button"
                          role="radio"
                          aria-checked={liters === b.value}
                          className="flow-segment"
                          onClick={() => setLiters(b.value)}
                        >
                          {capitalFirst(lang, b.label[lang])}
                        </button>
                      ))}
                    </div>
                    <p className="check-meta">{t(lang, "assessment.load.bottleHint")}</p>
                  </div>
                )}
                {on && (k === "dumbbell" || k === "cuff") && (
                  <div className="flow-load-detail">
                    <KgStepper kind={k} value={kg} max={down?.maxKg} onChange={setKg} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="check-meta">{bidiText(lang, testDef("arm_curl_30s").safety[lang][1])}</p>
      </div>
    </CheckShell>
  );
}

/** The UI capitalises the first letter of a bottle size in English (S30 table). */
function capitalFirst(lang: "ar" | "en", text: string): string {
  return lang === "en" ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
