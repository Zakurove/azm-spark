/**
 * S28 Instruction card (one per test): what the test shows, the steps with today's variant, the
 * safety notes (never collapsed), spoken on entry and on Listen again, and the last chance to skip
 * before the camera. warn_sci_t6 and warn_weak_shoulder come first; warn_sci_t6 leads with the 997
 * call control (Q22, 7.2-10). For the chair stand at home the card holds the chair gate (Q9) in place
 * of "Let's start", and from the second check the same chair question (su_same_chair).
 */
import { useState } from "react";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { CHECK_DATA, screenText, setupQuestion, testDef } from "../../../movements/assessments";
import type { Side, TestId } from "../../../movements/types";
import { sameChairAsked, testCounter } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { AnswerButtons } from "../shared/answers";
import { CallLink, CheckShell } from "../shared/CheckShell";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import {
  cardNotes,
  illustrationAlt,
  instructionSteps,
  sideLabel,
  summaryCues,
  testWarnings,
  type SpeechItem,
} from "./copy";
import { ListenButton, NoticeCard, SamePress, TestDrawing } from "./parts";
import { useEntryLines, useVoice } from "./voice";

export function Instruction({ model, dispatch }: ScreenProps) {
  const { lang, booth } = useCheckUi();
  const voice = useVoice(model.data.soundMode);
  const i = (model.state as { i?: number }).i ?? 0;
  const run = model.data.tests[i];
  const testId: TestId = run?.testId ?? "shoulder_abduction";
  const def = testDef(testId);
  const env = model.data.env;
  const position = env?.ctx.position ?? "chair";
  const main = run?.sides[0];
  const variant = main?.variant;
  const steps = instructionSteps(testId, variant, booth, lang);
  const safety = def.safety[lang];
  const notes = cardNotes(testId, variant, position, lang);
  const warnings = testWarnings(model.data.warnings, testId);
  const counter = testCounter(model);
  const home = model.data.setting === "home";

  // The arm curl arms that run without a weight (S30 not shown for them): one line each (P2, Q8).
  const armOnly =
    testId === "arm_curl_30s"
      ? (run?.sides ?? [])
          .filter((s) => s.variant === "arm_only" && s.side !== "none")
          .map((s) => s.side as Side)
      : [];
  const strokeWeaker =
    env?.ctx.conditions.includes("stroke") && (env.ctx.support === "left" || env.ctx.support === "right")
      ? env.ctx.support
      : null;
  const load = testDef("arm_curl_30s").load;

  // Spoken: the summary cues, the safety notes, the card notes, then the warnings (S28).
  const warningLine = (id: string): SpeechItem => {
    const data = CHECK_DATA.screens[id as keyof typeof CHECK_DATA.screens];
    return lang === "ar" ? { display: data.ar, speech: data.arTts } : { display: data.en };
  };
  const lines: SpeechItem[] = [
    ...summaryCues(testId, variant).map((cue) => ({ cue })),
    ...safety.map((s) => ({ display: s })),
    ...notes,
    ...warnings.map(warningLine),
  ];
  useEntryLines(voice, lines, true);

  // The chair gate (Q9) at home, and the same chair question from the second check (Q9 (3)).
  const gate = testId === "chair_stand_30s" && home && model.data.config.mode === "signedIn";
  const askSame = sameChairAsked(model.data, i);
  const [gateYes, setGateYes] = useState(false);
  const sameAnswered = model.data.sameChair[testId] !== undefined;
  const ready = (!gate || gateYes) && (!askSame || sameAnswered);

  return (
    <CheckShell
      counter={
        counter
          ? {
              text: t(lang, "assessment.common.testOf", { n: counter.n, total: counter.total }),
              value: counter.n,
              max: counter.total,
            }
          : undefined
      }
      sound
      footer={{
        primary: ready
          ? { label: t(lang, "assessment.test.ready"), onClick: () => dispatch({ type: "READY" }) }
          : undefined,
        secondary: {
          label: t(lang, "assessment.common.skipTest"),
          onClick: () => dispatch({ type: "SKIP" }),
        },
      }}
    >
      <div className="flow-stack" data-screen="S28" data-test={testId}>
        {warnings.map((id) =>
          id === "warn_sci_t6" ? (
            <NoticeCard
              key={id}
              tone="warn"
              lead={<CallLink number="997" label={CHECK_DATA.emergencyCall.button[lang]} />}
            >
              <p className="check-body">{bidiText(lang, screenText(id, lang))}</p>
            </NoticeCard>
          ) : (
            <NoticeCard key={id} tone="warn">
              <p className="check-body">{bidiText(lang, screenText(id, lang))}</p>
            </NoticeCard>
          ),
        )}
        <h1>{def.name[lang]}</h1>
        <p className="check-body">{bidiText(lang, def.purpose[lang])}</p>
        <TestDrawing
          alt={illustrationAlt(testId, position, variant, lang)}
          testId={testId}
          position={position}
        />
        {armOnly.map((side) => (
          <p key={side} className="flow-note">
            <CheckIcon name="info" size={20} />
            <span className="check-body">
              {t(lang, "assessment.plan.sideLine", {
                side: sideLabel(testId, side, lang),
                reason: strokeWeaker === side ? load.helpWeakerArm[lang] : t(lang, "assessment.load.armOnly"),
              })}
            </span>
          </p>
        ))}
        <section className="flow-section" aria-labelledby="flow-steps">
          <h2 id="flow-steps">{t(lang, "assessment.test.stepsHeading")}</h2>
          <ol className="check-steps flow-steps">
            {steps.map((s, k) => (
              <li key={k}>{bidiText(lang, s)}</li>
            ))}
          </ol>
        </section>
        <section className="flow-section" aria-labelledby="flow-safety">
          <h2 id="flow-safety" className="flow-with-icon">
            <CheckIcon name="shield" />
            {t(lang, "assessment.test.safetyHeading")}
          </h2>
          <ul className="flow-list flow-safety">
            {safety.map((s, k) => (
              <li key={k}>{bidiText(lang, s)}</li>
            ))}
            {notes.map((n, k) => (
              <li key={`n${k}`}>{bidiText(lang, n.display)}</li>
            ))}
          </ul>
        </section>
        <ListenButton onClick={() => void voice.play(lines)} />
        {gate && !gateYes && (
          <ChairGate onYes={() => setGateYes(true)} onNo={() => dispatch({ type: "CHAIR_GATE_NO" })} />
        )}
        {askSame && (!gate || gateYes) && (
          <SameChair
            value={model.data.sameChair[testId]}
            onAnswer={(value) => dispatch({ type: "SAME_CHAIR", value })}
          />
        )}
      </div>
    </CheckShell>
  );
}

/** The chair gate question (Q9, su_chair_gate) with its two answers, in place of "Let's start". */
function ChairGate({ onYes, onNo }: { onYes(): void; onNo(): void }) {
  const { lang } = useCheckUi();
  const q = setupQuestion("su_chair_gate");
  return (
    <section className="flow-section flow-gate" aria-labelledby="flow-chair-gate">
      <p id="flow-chair-gate" className="check-question">
        {bidiText(lang, q.ask[lang])}
      </p>
      <SamePress>
        <AnswerButtons
          labelledBy="flow-chair-gate"
          options={q.options.map((o) => ({ value: String(o.value), label: o.label[lang] }))}
          value={null}
          onSubmit={(v) => (v === "yes" ? onYes() : onNo())}
        />
      </SamePress>
    </section>
  );
}

/** The same chair question (su_same_chair); not sure is kept as no. */
function SameChair({
  value,
  onAnswer,
}: {
  value: boolean | undefined;
  onAnswer(v: "yes" | "no" | "unsure"): void;
}) {
  const { lang } = useCheckUi();
  const q = setupQuestion("su_same_chair");
  const [picked, setPicked] = useState<string | null>(value === undefined ? null : value ? "yes" : null);
  return (
    <section className="flow-section flow-gate" aria-labelledby="flow-same-chair">
      <p id="flow-same-chair" className="check-question">
        {bidiText(lang, q.ask[lang])}
      </p>
      <SamePress>
        <AnswerButtons
          labelledBy="flow-same-chair"
          options={q.options.map((o) => ({ value: String(o.value), label: o.label[lang] }))}
          value={picked}
          onSubmit={(v) => {
            setPicked(v);
            onAnswer(v as "yes" | "no" | "unsure");
          }}
        />
      </SamePress>
    </section>
  );
}
