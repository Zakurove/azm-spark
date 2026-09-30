/**
 * S14 Intro, S14b Sound check and S16 Pre-check notice (with the O6 resume line).
 *
 * S14 plays check_intro, check_stop_any_time and the how to stop line on entry, 800 ms after focus
 * moves to the h1, each captioned. The time, the needs and "you can skip any test" come from
 * boundary.intro filled with this person's computed range (estimateMinutes, O40), since the data
 * carries {min} and {max}; the need list below it is personal. At home, under the sound line, the
 * switch of the optional check in (D-016), the same per device setting as the coach settings.
 *
 * S14b plays check_sound on entry and on replay (Q31 (1)). No shows scr_sound_off and asks again; a
 * second No shows scr_sound_still_off with Try again and Continue without sound (captionsOnly). "I use
 * a screen reader" continues in screen reader mode. The mode is kept for this check only.
 */
import { useRef, useState } from "react";
import { readPreferences, savePreferences } from "../../../app/experience";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { estimateMinutes, type CheckContext } from "../../../medical/assessment";
import { CHECK_DATA, screenText, testDef } from "../../../movements/assessments";
import type { CheckPosition, TestId } from "../../../movements/types";
import { backTarget, type FlowModel } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { AnswerButtons } from "../shared/answers";
import { CheckShell } from "../shared/CheckShell";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import {
  allSeated,
  introBoundary,
  localLabels,
  introHelperTests,
  introNeeds,
  joinAnd,
  type SpeechItem,
} from "./copy";
import { IntroDrawing, SamePress } from "./parts";
import { unlockAudio, useEntryLines, useVoice } from "./voice";

/**
 * S16's notice. A guest at the booth keeps nothing (S05, S50): the data's first sentence, then the
 * guest line of the data (its second sentence: answers stay on this device for this try only), never
 * the retention sentence, which names comparisons a guest never gets.
 */
export function precheckNotice(lang: "ar" | "en", guest: boolean): string {
  const full = CHECK_DATA.boundary.precheckNotice[lang];
  if (!guest) return full;
  const sentences = (x: string) => x.split(/(?<=[.!?؟])\s+/u);
  const guestLine = sentences(CHECK_DATA.selection.guestBooth.conditionsStep.helper[lang])[1] ?? "";
  return `${sentences(full)[0]} ${guestLine}`.trim();
}

/** The context and the base tests the intro is about (guest steps or the signed in context). */
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
  const { lang, booth, guest } = useCheckUi();
  const voice = useVoice(model.data.soundMode);
  const { ctx, tests, position } = introFacts(model);
  const setting = model.data.setting;
  const retest = !!model.data.signedIn && !model.data.signedIn.firstCheck;
  const minutes = estimateMinutes(tests, ctx, setting, guest);
  const helperTests = ctx ? introHelperTests(tests, ctx, setting) : [];
  const loadPossible = !!ctx && ctx.clearance === "yes" && !ctx.restrictions.includes("no_resistance");
  const needs = introNeeds({ tests, position, setting, retest, helperTests, loadPossible });
  // B2: the booth line names the team; the home line says how to answer from where you are.
  const howToStop = t(lang, booth ? "assessment.intro.howToStopBooth" : "assessment.intro.howToStop");
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
        <p className="check-body">
          {retest ? t(lang, "assessment.intro.welcomeBack") : bidiText(lang, CHECK_DATA.boundary.line[lang])}
        </p>
        <IntroDrawing alt={t(lang, "assessment.intro.illustrationAlt")} position={position} />
        <p className="check-body" data-part="duration">
          {/* At the booth the chair, the stand and the space are ready: only the time is said. */}
          {bidiText(
            lang,
            booth
              ? t(lang, "assessment.intro.duration", {
                  minutesFrom: minutes[0],
                  minutesTo: minutes[1],
                  unit: "min",
                })
              : introBoundary(lang, minutes),
          )}
        </p>
        {tests.length > 0 && (
          <section className="flow-section" aria-labelledby="flow-intro-tests">
            <h2 id="flow-intro-tests">{t(lang, "assessment.intro.testsHeading")}</h2>
            <ul className="flow-list">
              {tests.map((id) => (
                <li key={id}>{bidiText(lang, testDef(id).name[lang])}</li>
              ))}
            </ul>
            {allSeated(position) && <p className="check-body">{t(lang, "assessment.intro.allSeated")}</p>}
          </section>
        )}
        <section className="flow-section" aria-labelledby="flow-intro-need">
          <h2 id="flow-intro-need">{t(lang, "assessment.intro.need.heading")}</h2>
          {booth ? (
            <p className="check-body">{t(lang, "assessment.intro.need.booth")}</p>
          ) : (
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
          )}
        </section>
        <p className="flow-note is-stop">
          <CheckIcon name="stop-square" size={22} />
          <span className="check-body">{howToStop}</span>
        </p>
        {/* At the booth the phone and its sound are the team's, and howToStopBooth covers stopping. */}
        {!booth && <p className="check-meta">{t(lang, "assessment.intro.stop")}</p>}
        {!booth && (
          <p className="flow-note">
            <CheckIcon name="speaker" size={20} />
            <span className="check-meta">{t(lang, "assessment.intro.sound")}</span>
          </p>
        )}
        {!booth && (
          <CheckInSwitch
            on={model.data.checkIn}
            onChange={(on) => {
              savePreferences({ ...readPreferences(), safetyCheckIn: on });
              dispatch({ type: "CHECKIN_SETTING", on });
            }}
          />
        )}
        <p className="check-label">{bidiText(lang, CHECK_DATA.boundary.notMedical[lang])}</p>
      </div>
    </CheckShell>
  );
}

/** The optional check in (D-016): a switch with its line, stored on this device. */
function CheckInSwitch({ on, onChange }: { on: boolean; onChange(on: boolean): void }) {
  const { lang } = useCheckUi();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="flow-switch"
      data-setting="safety-check-in"
      onClick={() => onChange(!on)}
    >
      <CheckIcon name="shield" size={24} />
      <span className="flow-switch-text">
        <span className="flow-strong">{t(lang, "assessment.checkin.setting")}</span>
        <span className="check-meta">{t(lang, "assessment.checkin.settingNote")}</span>
      </span>
      <span className="flow-switch-track" aria-hidden="true">
        <span />
      </span>
    </button>
  );
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
  const onAnswer = (v: string) => {
    if (v === "yes") return dispatch({ type: "SOUND_RESULT", mode: "voice" });
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
                onClick: () => dispatch({ type: "SOUND_RESULT", mode: "captionsOnly" }),
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
        <button
          type="button"
          className="check-text-button"
          onClick={() => dispatch({ type: "SOUND_RESULT", mode: "screenReader" })}
        >
          {t(lang, "assessment.soundCheck.screenReader")}
        </button>
      </div>
    </CheckShell>
  );
}

/* ------------------------------------------------------------------ S16 */

export function PrecheckNotice({ model, dispatch }: ScreenProps) {
  const { lang, booth, guest } = useCheckUi();
  const resume = model.state.kind === "resumeNotice";
  const back = backTarget(model) ? () => dispatch({ type: "BACK" }) : undefined;
  const home = model.data.setting === "home";
  if (resume)
    return (
      <CheckShell
        sound
        footer={{
          primary: {
            label: t(lang, "assessment.common.continue"),
            onClick: () => dispatch({ type: "CONTINUE" }),
          },
        }}
      >
        <div className="flow-stack" data-screen="S16" data-variant="resume">
          <h1>{t(lang, "assessment.precheck.title")}</h1>
          <section className="check-card is-info">
            <span className="check-card-icon">
              <CheckIcon name="info" />
            </span>
            <p className="check-body">{t(lang, "assessment.resume.notice")}</p>
          </section>
        </div>
      </CheckShell>
    );
  return (
    <CheckShell
      sound
      onBack={back}
      footer={{
        primary: {
          label: t(lang, "assessment.intro.start"),
          onClick: () => dispatch({ type: "PRECHECK_START" }),
        },
      }}
    >
      <div className="flow-stack" data-screen="S16">
        <h1>{t(lang, "assessment.precheck.title")}</h1>
        <section className="check-card is-info">
          <span className="check-card-icon">
            <CheckIcon name="shield" />
          </span>
          <p className="check-body">{bidiText(lang, precheckNotice(lang, guest))}</p>
        </section>
        <p className="check-body">{t(lang, "assessment.precheck.howToAnswer")}</p>
        {home && !booth && <p className="check-body">{t(lang, "assessment.precheck.helperReads")}</p>}
        <p className="flow-note">
          <CheckIcon name="speaker" size={20} />
          <span className="check-meta">{t(lang, "assessment.precheck.canListen")}</span>
        </p>
      </div>
    </CheckShell>
  );
}
