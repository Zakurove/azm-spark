/**
 * S17 to S24: the pre-check question screens (UX spec S17 to S24, Q18 (2), Q7, O9, O11a to O11c).
 *
 * One question per screen, from visibleQuestions (both arms of pc_arm_function share one, C25); the text is the data's, in the form questionForm
 * picks (askFirstCheck, askDirect, the position form, the examples at home), with its tokens filled.
 *   yes_no, yes_no_unsure, single, the steadi items, a surgery area's clearance and pc_sci_ready:
 *     full width answers in data order, none preselected; a tap submits (Q18 (2)), and an answer
 *     counts only when the press starts and ends on the same button (O11a). A postponing answer
 *     commits like any other (O11a: no read back); emergency and AD answers route at once (O11c).
 *   the two 0 to 10 pain scales (S19, S20): select, then Next, with the readout «اخترت {value}» (O11b).
 *   the areas follow up (S24): chips, Next, at least one area.
 * Back returns to the previous visible question with its answer selected. A thin bar with no numbers
 * shows the way so far (C10): its total is every question that can still appear (O9), so it only moves
 * forward. The first question carries the one subtitle of the pre-check (C06): how to answer, or on a
 * resumed check the O6 line instead.
 *
 * Listen plays the question, the list and every answer, each captioned. At home in voice mode the
 * question plays by itself 800 ms after focus moves to it; at the booth only on a tap (4.9, B16).
 *
 * The start call (state `starting`) keeps the last question on screen with its busy line, or its
 * error with Try again and the answers kept.
 */
import { useId, useRef, useState, type ReactNode } from "react";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import type { AnswerValue } from "../../../medical/precheck";
import { backTarget, questionCounter, questionGroup, type FlowModel } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { AnswerButtons, MultiAnswerList, useNextWithHint } from "../shared/answers";
import { CheckShell, type ButtonSpec } from "../shared/CheckShell";
import { useCheckUi } from "../shared/CheckUi";
import { ErrorState, LoadingState } from "../shared/states";
import { firstAreaWithoutScore, groupView, questionView, type QuestionView } from "./copy";
import { AreaPicker, Emphasized, ListenButton, SamePress, ScaleGrid } from "./parts";
import { useEntryLines, useVoice } from "./voice";

/** The question id a state shows: the question, or the last one while the start call runs. */
export function questionIdOf(m: FlowModel): string | null {
  const s = m.state;
  if (s.kind === "question") return s.id;
  if (s.kind === "starting") return s.lastQuestion;
  return null;
}

export function QuestionScreen(props: ScreenProps) {
  const { lang } = useCheckUi();
  const id = questionIdOf(props.model);
  const env = props.model.data.env;
  if (!id || !env)
    return (
      <CheckShell>
        <h1 className="check-visually-hidden">{t(lang, "assessment.precheck.title")}</h1>
        <StartStatus {...props} />
      </CheckShell>
    );
  // C25: a question group (both arms of pc_arm_function) is one screen, a row per question.
  const group = questionGroup(props.model);
  if (group.length > 1) return <GroupBody key={group.join(" ")} ids={group} id={id} {...props} />;
  // A new question mounts afresh (its own selection, its own entry line).
  return <QuestionBody key={id} id={id} {...props} />;
}

/** The start call's busy line or its error (S27 start call, 0.7). */
function StartStatus({ model, dispatch }: ScreenProps) {
  const { lang, guest } = useCheckUi();
  const s = model.state;
  if (s.kind !== "starting") return null;
  if (s.error === null)
    return <LoadingState text={t(lang, "assessment.state.loading.check")} variant="card" />;
  return (
    <ErrorState
      title={t(lang, "assessment.state.error.titleStart")}
      body={t(
        lang,
        s.error === "offline" ? "assessment.state.offline.startBlocked" : "assessment.state.error.bodyStart",
      )}
      onRetry={() => dispatch({ type: "RETRY" })}
      secondary={
        guest
          ? undefined
          : { label: t(lang, "assessment.common.backToToday"), onClick: () => dispatch({ type: "EXIT" }) }
      }
    />
  );
}

function QuestionBody({ id, model, dispatch, api, retryCamera, retrySave }: ScreenProps & { id: string }) {
  const { lang, booth } = useCheckUi();
  const voice = useVoice(model.data.soundMode);
  const env = model.data.env!;
  const view = questionView(env, model.data.answers, id, lang);
  const starting = model.state.kind === "starting";
  const counter = questionCounter(model);
  const titleId = useId();
  const back = !starting && backTarget(model) ? () => dispatch({ type: "BACK" }) : undefined;
  const autoplay = model.data.setting === "home" && !booth && model.data.soundMode === "voice";
  // The question and its answers are on the screen: spoken, never repeated in the caption strip.
  useEntryLines(voice, view.speech, autoplay, { onScreen: true });
  const answer = (value: AnswerValue) => dispatch({ type: "ANSWER", id, value });
  const listen = () => void voice.play(view.speech, { onScreen: true });
  const control = useControl(view, model.data.answers[id], answer);
  const first = !starting && counter?.n === 1;

  return (
    <CheckShell
      counter={counter ? { value: counter.n, max: counter.total } : undefined}
      onBack={back}
      sound
      footer={control.next ? { primary: control.next } : undefined}
    >
      <div className="flow-stack" data-screen={screenOfKind(view)} data-question={id}>
        {view.groupHeading && (
          <p className="check-meta flow-group-heading">{bidiText(lang, view.groupHeading)}</p>
        )}
        <h1 id={titleId} className={`check-question${view.question.length > 140 ? " is-long" : ""}`}>
          <Emphasized text={view.question} words={view.emphasis} />
        </h1>
        {first && <FirstLine resuming={model.data.resuming} />}
        {/* B16: at the booth nothing plays by itself; Listen comes first, above any list. On S22 at the
            booth it is the 64 px earphones button (staff offer the desk earphones to everyone). */}
        {booth && view.kind === "listConfirm" ? (
          <ListenButton
            label={t(lang, "assessment.precheck.listenEarphones")}
            onClick={listen}
            size="large"
          />
        ) : (
          <ListenButton label={t(lang, "assessment.precheck.listenQuestion")} onClick={listen} />
        )}
        {view.list && <QuestionList view={view} />}
        {control.render(titleId)}
        <StartStatus
          model={model}
          dispatch={dispatch}
          api={api}
          retryCamera={retryCamera}
          retrySave={retrySave}
        />
      </div>
    </CheckShell>
  );
}

/**
 * C25: both arms on one screen (S21). Each row selects one of the same three answers; Next sends both
 * answers in order (ANSWERS), as if each had its own screen. Without both, Next shows the hint and
 * moves focus to the first row with no answer.
 */
function GroupBody({
  ids,
  id,
  model,
  dispatch,
  api,
  retryCamera,
  retrySave,
}: ScreenProps & { ids: string[]; id: string }) {
  const { lang, booth } = useCheckUi();
  const voice = useVoice(model.data.soundMode);
  const view = groupView(ids, lang);
  const starting = model.state.kind === "starting";
  const counter = questionCounter(model);
  const titleId = useId();
  const back = !starting && backTarget(model) ? () => dispatch({ type: "BACK" }) : undefined;
  const autoplay = model.data.setting === "home" && !booth && model.data.soundMode === "voice";
  useEntryLines(voice, view.speech, autoplay, { onScreen: true });
  const given = model.data.answers;
  const [chosen, setChosen] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(ids.map((q) => [q, typeof given[q] === "string" ? (given[q] as string) : null])),
  );
  const missing = ids.find((q) => !chosen[q]);
  const next = useNextWithHint(!missing, () =>
    dispatch({ type: "ANSWERS", answers: ids.map((q) => ({ id: q, value: chosen[q]! })) }),
  );
  return (
    <CheckShell
      counter={counter ? { value: counter.n, max: counter.total } : undefined}
      onBack={back}
      sound
      footer={starting ? undefined : { primary: next.primary }}
    >
      <div className="flow-stack" data-screen="S21" data-question={id} data-group={ids.join(" ")}>
        <h1 id={titleId} className="check-question">
          {view.question}
        </h1>
        <ListenButton
          label={t(lang, "assessment.precheck.listenQuestion")}
          onClick={() => void voice.play(view.speech, { onScreen: true })}
        />
        {next.hint}
        {view.rows.map((row) => (
          <section key={row.id} className="flow-stack flow-group-row" aria-labelledby={`${titleId}${row.id}`}>
            <h2 id={`${titleId}${row.id}`} className="check-h2">
              {row.label}
            </h2>
            <AnswerButtons
              labelledBy={`${titleId}${row.id}`}
              options={view.options}
              value={chosen[row.id] ?? null}
              mode="select"
              onSubmit={(v) => setChosen((c) => ({ ...c, [row.id]: v }))}
              describedBy={row.id === missing ? next.describedBy : undefined}
              groupRef={row.id === missing ? next.groupRef : undefined}
            />
          </section>
        ))}
        <StartStatus
          model={model}
          dispatch={dispatch}
          api={api}
          retryCamera={retryCamera}
          retrySave={retrySave}
        />
      </div>
    </CheckShell>
  );
}

/**
 * The pre-check's one subtitle, on its first question (C06): S16 is gone. No notice on what is kept
 * (D-017 item 2): the consent (S12) states it before the check.
 */
function FirstLine({ resuming }: { resuming: boolean }) {
  const { lang } = useCheckUi();
  return (
    <p className="check-body">
      {t(lang, resuming ? "assessment.resume.notice" : "assessment.precheck.howToAnswer")}
    </p>
  );
}

function screenOfKind(v: QuestionView): string {
  switch (v.kind) {
    case "yes_no":
      return "S17";
    case "yes_no_unsure":
      return "S18";
    case "scale":
      return "S19";
    case "areaScale":
      return "S20";
    case "single":
      return "S21";
    case "listConfirm":
      return "S22";
    case "subYesNo":
      return "S23";
    case "areaChips":
    case "areaClear":
      return "S24";
  }
}

/** The list under a question: the pc_urgent signs, the examples at home, the pc_sci_ready items. */
function QuestionList({ view }: { view: QuestionView }) {
  const { lang } = useCheckUi();
  const readAloud = view.kind === "listConfirm";
  return (
    <div className="flow-question-list">
      {readAloud && <p className="check-meta">{t(lang, "assessment.precheck.checklist.hint")}</p>}
      {view.listHeading && (
        <p className="check-label flow-list-heading">{bidiText(lang, view.listHeading)}</p>
      )}
      <ul className={`check-card check-list flow-bullets${readAloud ? " is-read" : " is-cream"}`}>
        {view.list!.map((item, i) => (
          <li key={i}>
            <Emphasized text={item} words={view.emphasis} />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ControlState {
  /** The footer Next of the select, then Next controls; none for a tap to submit question. */
  next?: ButtonSpec;
  render(titleId: string): ReactNode;
}

/**
 * The answer control of a question and its footer Next. The pain scales (O11b) and the areas follow
 * up keep select, then Next; everything else submits on tap.
 */
function useControl(
  view: QuestionView,
  given: AnswerValue | undefined,
  onAnswer: (v: AnswerValue) => void,
): ControlState {
  const { lang } = useCheckUi();
  // S19: the 0 to 10 scale.
  const [scale, setScale] = useState<number | null>(typeof given === "number" ? given : null);
  const scaleNext = useNextWithHint(scale !== null, () => scale !== null && onAnswer(scale));
  // S20: the area scales.
  const initialAreas =
    given && typeof given === "object" && !Array.isArray(given) ? (given as Record<string, number>) : null;
  const [areas, setAreas] = useState<Record<string, number | null>>(initialAreas ?? {});
  const [none, setNone] = useState(initialAreas !== null && Object.keys(initialAreas).length === 0);
  const [problem, setProblem] = useState<null | "choose" | "rate">(null);
  // S24: the areas follow up.
  const [chips, setChips] = useState<string[]>(Array.isArray(given) ? given : []);
  const [chipsTried, setChipsTried] = useState(false);
  const hintId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const nextLabel = t(lang, "assessment.common.next");

  switch (view.kind) {
    case "scale":
      return {
        next: scaleNext.primary,
        render: (titleId) => (
          <div className="flow-stack">
            {scaleNext.hint}
            <div ref={scaleNext.groupRef} aria-describedby={scaleNext.describedBy}>
              <ScaleGrid labelledBy={titleId} value={scale} onChange={setScale} />
            </div>
            <p className="flow-readout" role="status">
              {scale !== null
                ? bidiText(lang, t(lang, "assessment.precheck.scale.chosen", { value: scale }))
                : ""}
            </p>
          </div>
        ),
      };
    case "areaScale": {
      const submit = () => {
        if (none) return onAnswer({});
        const keys = Object.keys(areas);
        if (keys.length === 0) {
          setProblem("choose");
          groupRef.current?.querySelector<HTMLElement>("button")?.focus();
          return;
        }
        const missing = firstAreaWithoutScore(areas);
        if (missing) {
          setProblem("rate");
          const idx = keys.indexOf(missing);
          groupRef.current
            ?.querySelectorAll<HTMLElement>(".flow-area.is-on")
            [idx]?.querySelector<HTMLElement>(".flow-scale-cell")
            ?.focus();
          return;
        }
        onAnswer(areas as Record<string, number>);
      };
      return {
        next: { label: nextLabel, onClick: submit },
        render: (titleId) => (
          <div className="flow-stack">
            <p className="check-meta">{t(lang, "assessment.precheck.areas.hint")}</p>
            {problem && (
              <p id={hintId} className="check-field-error">
                {t(
                  lang,
                  problem === "choose"
                    ? "assessment.precheck.areas.pickOne"
                    : "assessment.common.chooseToContinue",
                )}
              </p>
            )}
            <AreaPicker
              labelledBy={titleId}
              areas={view.areas ?? []}
              value={none ? {} : areas}
              scale
              noneLabel={t(lang, "assessment.precheck.areas.none")}
              none={none}
              onNone={() => {
                setNone(true);
                setAreas({});
                setProblem(null);
              }}
              onChange={(v) => {
                setNone(false);
                setAreas(v);
                setProblem(null);
              }}
              describedBy={problem ? hintId : undefined}
              groupRef={groupRef}
            />
          </div>
        ),
      };
    }
    case "areaChips": {
      const missing = chipsTried && chips.length === 0;
      return {
        next: {
          label: nextLabel,
          onClick: () => {
            if (chips.length === 0) {
              setChipsTried(true);
              groupRef.current?.querySelector<HTMLElement>("button")?.focus();
              return;
            }
            onAnswer(chips);
          },
        },
        render: (titleId) => (
          <div className="flow-stack">
            {missing && (
              <p id={hintId} className="check-field-error">
                {t(lang, "assessment.precheck.areas.pickOne")}
              </p>
            )}
            <MultiAnswerList
              labelledBy={titleId}
              options={(view.areas ?? []).map((a) => ({ value: a.id, label: a.label }))}
              value={chips}
              onChange={setChips}
              describedBy={missing ? hintId : undefined}
              groupRef={groupRef}
            />
          </div>
        ),
      };
    }
    default:
      return {
        render: (titleId) => (
          <SamePress>
            <AnswerButtons
              labelledBy={titleId}
              options={view.options}
              value={typeof given === "string" ? given : null}
              onSubmit={(v) => onAnswer(v)}
            />
          </SamePress>
        ),
      };
  }
}
