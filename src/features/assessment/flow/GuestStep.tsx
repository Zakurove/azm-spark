/**
 * S06 to S11: the six guest setup steps at the booth (UX spec S06 to S11, Q19), one question each,
 * answered at the side desk with the phone in hand. "Step n of 6". Single choice steps submit on tap
 * (Q18 (2)); multiple choice steps use Next, with "None" exclusive (first on the conditions step).
 * Back returns one step with the answer kept. Listen reads the question and every option, and plays
 * only when tapped at the booth (privacy, section 4.9). The chosen conditions are never repeated or
 * spoken by the app anywhere else.
 */
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { backTarget, type GuestAnswers } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { AnswerButtons, MultiAnswerList, useNextWithHint } from "../shared/answers";
import { CheckShell } from "../shared/CheckShell";
import { useCheckUi } from "../shared/CheckUi";
import { guestStepView, localLabels, type GuestStepNo } from "./copy";
import { ListenButton, SamePress } from "./parts";
import { useVoice } from "./voice";

const KEYS: Record<GuestStepNo, keyof GuestAnswers> = {
  1: "position",
  2: "support",
  3: "conditions",
  4: "clearance",
  5: "pain",
  6: "restrictions",
};

export function GuestStep({ model, dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const voice = useVoice(model.data.soundMode);
  const step = (model.state.kind === "guestSetup" ? model.state.step : 1) as GuestStepNo;
  const raw0 = guestStepView(lang, step);
  const view = { ...raw0, options: localLabels(lang, raw0.options) };
  const raw = model.data.guest[KEYS[step]];
  const values = Array.isArray(raw) ? raw : [];
  const single = typeof raw === "string" ? raw : null;
  const next = useNextWithHint(values.length > 0, () => dispatch({ type: "GUEST_NEXT" }));
  const back = backTarget(model) ? () => dispatch({ type: "BACK" }) : undefined;
  const titleId = `flow-guest-step-${step}`;
  const listen = () =>
    void voice.play([
      { display: view.question },
      ...(view.hint ? [{ display: view.hint }] : []),
      ...view.options.map((o) => ({ display: o.label })),
    ]);
  return (
    <CheckShell
      counter={{ text: t(lang, "assessment.common.stepOf", { n: step, total: 6 }), value: step, max: 6 }}
      onBack={back}
      sound
      footer={view.multiple ? { primary: next.primary } : undefined}
    >
      <div className="flow-stack" data-screen={view.screen}>
        <h1 id={titleId} className="check-question">
          {bidiText(lang, view.question)}
        </h1>
        {view.hint && <p className="check-meta">{bidiText(lang, view.hint)}</p>}
        {view.multiple && next.hint}
        <ListenButton label={t(lang, "assessment.precheck.listenQuestion")} onClick={listen} />
        {view.multiple ? (
          <MultiAnswerList
            labelledBy={titleId}
            options={view.options}
            value={values}
            exclusive={view.exclusive}
            exclusiveFirst={view.exclusiveFirst}
            onChange={(v) => dispatch({ type: "GUEST_ANSWER", step, value: v })}
            describedBy={next.describedBy}
            groupRef={next.groupRef}
          />
        ) : (
          <SamePress>
            <AnswerButtons
              labelledBy={titleId}
              options={view.options}
              value={single}
              onSubmit={(v) => dispatch({ type: "GUEST_ANSWER", step, value: v })}
            />
          </SamePress>
        )}
      </div>
    </CheckShell>
  );
}
