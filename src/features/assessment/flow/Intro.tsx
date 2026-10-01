/**
 * S14 Intro (home) and S14b Sound check (the first check on a device). The booth has neither: staff
 * set the chair and the phone and play the test sound when they turn booth mode on (C04, C05).
 *
 * S14 (C38) plays check_intro, check_stop_any_time and the how to stop line on entry, 800 ms after
 * focus moves to the h1, each captioned. It shows the title, the boundary paragraph, the needs of
 * this person's tests (the equipment the instruction cards no longer list, C12), one stop line and
 * "not for medical purposes". The time shows on S01 and S27 only (C11); the tests on S27; the check in
 * switch lives in the coach settings only (C39).
 *
 * S14b plays check_sound on entry and on replay (Q31 (1)). No shows scr_sound_off and asks again; a
 * second No shows scr_sound_still_off with Try again and Continue without sound (captionsOnly). "I use
 * a screen reader" continues in screen reader mode. A yes and the screen reader mode are kept on this
 * device, so later checks skip S14b; no sound is asked again next time.
 */
import { useRef, useState } from "react";
import { readPreferences, savePreferences } from "../../../app/experience";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import type { CheckContext } from "../../../medical/assessment";
import { CHECK_DATA, screenText, testDef } from "../../../movements/assessments";
import type { CheckPosition, TestId } from "../../../movements/types";
import { backTarget, type FlowModel, type SoundMode } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { AnswerButtons } from "../shared/answers";
import { CheckShell } from "../shared/CheckShell";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import { localLabels, introHelperTests, introNeeds, joinAnd, type SpeechItem } from "./copy";
import { IntroDrawing, SamePress } from "./parts";
import { unlockAudio, useEntryLines, useVoice } from "./voice";

/** The context and the base tests the intro is about (the signed in context). */
export function introFacts(m: FlowModel): {
  ctx: CheckContext | null;
  tests: TestId[];
  position: CheckPosition;
} {
  const ctx = m.data.env?.ctx ?? m.data.signedIn?.ctx ?? null;
  const tests = [...new Set(m.data.base.filter((b) => !b.excluded).map((b) => b.testId))] as TestId[];
  return { ctx, tests, position: ctx?.position ?? "chair" };
}

export function Intro({ model, dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const voice = useVoice(model.data.soundMode);
  const { ctx, tests, position } = introFacts(model);
  const setting = model.data.setting;
  const retest = !!model.data.signedIn && !model.data.signedIn.firstCheck;
  const helperTests = ctx ? introHelperTests(tests, ctx, setting) : [];
  const loadPossible = !!ctx && ctx.clearance === "yes" && !ctx.restrictions.includes("no_resistance");
  const needs = introNeeds({ tests, position, setting, retest, helperTests, loadPossible });
  const howToStop = t(lang, "assessment.intro.howToStop");
  const lines: SpeechItem[] = [
    { cue: "check_intro" },
    { cue: "check_stop_any_time" },
    { display: howToStop },
  ];
  useEntryLines(voice, lines, true);
  const back = backTarget(model) ? () => dispatch({ type: "BACK" }) : undefined;
  return (
    <CheckShell
      brand
      language
      sound
      onBack={back}
      footer={{
        primary: {
          label: t(lang, "assessment.common.continue"),
          onClick: () => {
            // The tap that leads to the sound check unlocks audio (4.6).
            unlockAudio();
            dispatch({ type: "CONTINUE" });
          },
        },
      }}
    >
      <div className="flow-stack" data-screen="S14">
        <h1>{t(lang, "assessment.name")}</h1>
        <p className="check-body">{bidiText(lang, CHECK_DATA.boundary.line[lang])}</p>
        <IntroDrawing alt={t(lang, "assessment.intro.illustrationAlt")} position={position} />
        <section className="flow-section" aria-labelledby="flow-intro-need">
          <h2 id="flow-intro-need">{t(lang, "assessment.intro.need.heading")}</h2>
          <ul className="flow-list">
            {needs.map((n) => (
              <li key={n}>
                {n === "helper"
                  ? bidiText(
                      lang,
                      t(lang, "assessment.intro.need.helper", {
                        tests: joinAnd(
                          lang,
                          helperTests.map((id) => testDef(id).name[lang]),
                        ),
                      }),
                    )
                  : t(lang, `assessment.intro.need.${n}`)}
              </li>
            ))}
          </ul>
        </section>
        <p className="flow-note is-stop">
          <CheckIcon name="stop-square" size={22} />
          <span className="check-body">{howToStop}</span>
        </p>
        <p className="check-label">{bidiText(lang, CHECK_DATA.boundary.notMedical[lang])}</p>
      </div>
    </CheckShell>
  );
}

/** Keeps a sound answer on this device (C05): a yes or the screen reader; no sound asks again. */
function keepSound(mode: SoundMode): void {
  if (mode === "captionsOnly") return;
  savePreferences({ ...readPreferences(), checkSound: mode });
}

/* ------------------------------------------------------------------ S14b */

export function SoundCheck({ model, dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const voice = useVoice(null);
  const [noes, setNoes] = useState(0);
  const titleId = "flow-sound-title";
  const questionId = "flow-sound-question";
  const noteRef = useRef<HTMLDivElement>(null);
  const playSound = () => void voice.play([{ cue: "check_sound" }]);
  useEntryLines(voice, [{ cue: "check_sound" }], true);
  const options = localLabels(
    lang,
    CHECK_DATA.engine.soundCheck.options.map((o) => ({ value: o.value, label: o.label[lang] })),
  );
  const back = backTarget(model) ? () => dispatch({ type: "BACK" }) : undefined;
  const question = CHECK_DATA.cues.find((c) => c.id === "check_sound");
  const result = (mode: SoundMode) => {
    keepSound(mode);
    dispatch({ type: "SOUND_RESULT", mode });
  };
  const onAnswer = (v: string) => {
    if (v === "yes") return result("voice");
    setNoes((n) => n + 1);
    // The fix line, then the question again (Q31 (1)); focus moves to the fix so it is read first.
    setTimeout(() => noteRef.current?.focus(), 0);
    if (noes === 0) playSound();
  };
  return (
    <CheckShell
      sound
      onBack={back}
      footer={
        noes >= 2
          ? {
              primary: { label: t(lang, "assessment.common.retry"), onClick: playSound },
              secondary: {
                label: t(lang, "assessment.soundCheck.continueWithout"),
                onClick: () => result("captionsOnly"),
              },
            }
          : undefined
      }
    >
      <div className="flow-stack" data-screen="S14b">
        <h1 id={titleId}>{t(lang, "assessment.soundCheck.title")}</h1>
        {noes > 0 && (
          <div
            ref={noteRef}
            tabIndex={-1}
            className={`check-card ${noes >= 2 ? "is-cream" : "is-info"}`}
            data-note={noes >= 2 ? "stillOff" : "off"}
          >
            <p className="check-body">
              {bidiText(lang, screenText(noes >= 2 ? "scr_sound_still_off" : "scr_sound_off", lang))}
            </p>
          </div>
        )}
        <p id={questionId} className="check-question">
          {question ? (lang === "ar" ? question.ar : question.en) : ""}
        </p>
        <button type="button" className="ghost flow-listen" onClick={playSound}>
          <CheckIcon name="play" />
          {t(lang, "assessment.soundCheck.play")}
        </button>
        <SamePress>
          <AnswerButtons labelledBy={questionId} options={options} value={null} onSubmit={onAnswer} />
        </SamePress>
        <button type="button" className="check-text-button" onClick={() => result("screenReader")}>
          {t(lang, "assessment.soundCheck.screenReader")}
        </button>
      </div>
    </CheckShell>
  );
}
