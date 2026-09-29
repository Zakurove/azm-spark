/**
 * After the pre-check, before the camera:
 *   S25  Before you start: the warnings for the whole check (warn and info cards, read at home)
 *   S27  Your tests today: the frozen protocol, its duration and every skip with its reason (P6)
 *   S26  Helper briefing (home, Q11, O34-2): read aloud sentence by sentence, the P4 picture
 */
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { CHECK_DATA, screenText, testDef } from "../../../movements/assessments";
import type { ScreenId, Side, TestId } from "../../../movements/types";
import { testCounter } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { CheckShell } from "../shared/CheckShell";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import {
  alignedSentences,
  checkWarnings,
  fillTokens,
  helperBriefScreen,
  pdTimingToken,
  planView,
  rangeVars,
  warningTone,
  type SpeechLine,
} from "./copy";
import { ListenButton, NoticeCard, SentenceStack, TopDownDrawing } from "./parts";
import { useEntryLines, useVoice } from "./voice";

/* ------------------------------------------------------------------ S25 */

/** The display text of a warning card, or null when it cannot be shown whole. */
export function warningText(id: ScreenId, lang: "ar" | "en", pdBucket: string | null): string | null {
  const text = screenText(id, lang);
  if (id !== "warn_pd_timing") return text;
  // SPEC-GAP: pd-timing-last. {x} is the last check's dose bucket; the flow does not receive it yet
  // (foundationRequests), so the card shows only when the bucket is known, never with a raw token.
  const x = pdTimingToken(pdBucket, lang);
  return x ? fillTokens(text, { x }) : null;
}

export function Warnings({ model, dispatch }: ScreenProps) {
  const { lang, booth } = useCheckUi();
  const voice = useVoice(model.data.soundMode);
  const ids = checkWarnings(model.data.warnings);
  const skippedForSore = model.data.protocol
    .filter((i) => i.skipped === "pressure_sore")
    .map((i) => i.testId);
  const cards = ids
    .map((id) => ({ id, text: warningText(id, lang, null) }))
    .filter((c): c is { id: ScreenId; text: string } => c.text !== null);
  const lines: SpeechLine[] = cards.flatMap((c) => {
    const out: SpeechLine[] = [{ display: c.text }];
    if (c.id === "scr_note_care")
      for (const testId of new Set(skippedForSore))
        out.push({
          display: t(lang, "assessment.warnings.skippedTest", { test: testDef(testId).name[lang] }),
        });
    return out;
  });
  const autoplay = model.data.setting === "home" && !booth && model.data.soundMode === "voice";
  useEntryLines(voice, lines, autoplay);
  return (
    <CheckShell
      sound
      footer={{
        primary: {
          label: t(lang, "assessment.warnings.continue"),
          onClick: () => dispatch({ type: "CONTINUE" }),
        },
      }}
    >
      <div className="flow-stack" data-screen="S25">
        <h1>{t(lang, "assessment.warnings.title")}</h1>
        {cards.map((c) => (
          <NoticeCard key={c.id} tone={warningTone(c.id)}>
            <p className="check-body">{bidiText(lang, c.text)}</p>
            {c.id === "scr_note_care" &&
              [...new Set(skippedForSore)].map((testId) => (
                <p key={testId} className="check-body flow-strong">
                  {t(lang, "assessment.warnings.skippedTest", { test: testDef(testId).name[lang] })}
                </p>
              ))}
          </NoticeCard>
        ))}
        <ListenButton onClick={() => void voice.play(lines)} />
      </div>
    </CheckShell>
  );
}

/* ------------------------------------------------------------------ S27 */

export function Plan({ model, dispatch }: ScreenProps) {
  const { lang, guest } = useCheckUi();
  const env = model.data.env;
  const view = env ? planView(model.data.protocol, env, lang, Date.now(), guest) : null;
  const none = !view || view.rows.length === 0;
  return (
    <CheckShell
      footer={{
        primary: {
          label: t(lang, none ? "assessment.common.backToToday" : "assessment.plan.start"),
          onClick: () => dispatch({ type: "PLAN_START" }),
        },
      }}
    >
      <div className="flow-stack" data-screen="S27">
        <h1>{t(lang, none ? "assessment.plan.noneTitle" : "assessment.plan.title")}</h1>
        {none ? (
          <p className="check-body">{t(lang, "assessment.plan.noneBody")}</p>
        ) : (
          <p className="check-meta">{t(lang, "assessment.plan.meta", rangeVars(view.minutes))}</p>
        )}
        {view && view.rows.length > 0 && (
          <ol className="flow-plan">
            {view.rows.map((row, i) => (
              <li key={row.testId} className="flow-plan-row">
                <span className="flow-plan-n" aria-hidden="true">
                  {bidiText(lang, String(i + 1))}
                </span>
                <div className="flow-plan-body">
                  <h2>{row.name}</h2>
                  <p className="check-meta">{bidiText(lang, row.purpose)}</p>
                  {(row.perSide || row.helper || row.variant) && (
                    <p className="flow-chips">
                      {row.perSide && (
                        <span className="check-chip">
                          {t(
                            lang,
                            row.perSide === "arm" ? "assessment.plan.eachArm" : "assessment.plan.eachSide",
                          )}
                        </span>
                      )}
                      {row.helper && (
                        <span className="check-chip">
                          <CheckIcon name="people" size={18} />
                          {t(lang, "assessment.plan.withHelper")}
                        </span>
                      )}
                      {row.variant && <span className="check-chip">{row.variant}</span>}
                    </p>
                  )}
                  {row.variantWhy && (
                    <p className="check-meta">{t(lang, `assessment.plan.variantWhy.${row.variantWhy}`)}</p>
                  )}
                  {row.vitals && <p className="check-meta">{t(lang, "assessment.plan.vitalsNote")}</p>}
                  {row.sideLines.length > 0 && (
                    <ul className="flow-side-lines">
                      {row.sideLines.map((line) => (
                        <li key={line}>{bidiText(lang, line)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        {view && view.notToday.length > 0 && (
          <SkipGroup title={t(lang, "assessment.plan.notToday")} items={view.notToday} />
        )}
        {view && view.notPart.length > 0 && (
          <SkipGroup title={t(lang, "assessment.plan.notPart")} items={view.notPart} />
        )}
      </div>
    </CheckShell>
  );
}

function SkipGroup({
  title,
  items,
}: {
  title: string;
  items: { testId: TestId; name: string; reason: string; boothOffer: boolean }[];
}) {
  const { lang } = useCheckUi();
  return (
    <section className="flow-section" aria-label={title}>
      <h2>{title}</h2>
      <ul className="check-card flow-skip-list">
        {items.map((s) => (
          <li key={s.testId}>
            <p className="flow-strong">{s.name}</p>
            <p className="check-meta">{bidiText(lang, s.reason)}</p>
            {s.boothOffer && (
              <p className="check-meta">{bidiText(lang, CHECK_DATA.reasons.booth_offer[lang])}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ S26 */

/** The weaker side of the person (the helper stands there), or null. */
export function weakerSide(model: ScreenProps["model"]): Side | null {
  const s = model.data.env?.ctx.support;
  return s === "left" || s === "right" ? s : null;
}

export function HelperBrief({ model, dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const voice = useVoice(model.data.soundMode);
  const i = (model.state as { i?: number }).i ?? 0;
  const testId = model.data.tests[i]?.testId ?? "chair_stand_30s";
  const screen = helperBriefScreen(testId);
  const weaker = weakerSide(model);
  const counter = testCounter(model);
  const data = screen ? CHECK_DATA.screens[screen] : null;
  const body = data ? (lang === "ar" ? data.ar : data.en) : "";
  const speech = data ? (lang === "ar" ? data.arTts : data.en) : undefined;
  const { lines } = alignedSentences(body, speech);
  const checkIn = CHECK_DATA.helperBriefing.checkInLine;
  const checkInLine: SpeechLine =
    lang === "ar" ? { display: checkIn.ar, speech: checkIn.arTts } : { display: checkIn.en };
  const sideLine = weaker
    ? t(lang, "assessment.helper.weakerSide", {
        side: t(lang, weaker === "left" ? "assessment.helper.sideLeft" : "assessment.helper.sideRight"),
      })
    : t(lang, "assessment.helper.noWeakerSide");
  const all: SpeechLine[] = [...(screen ? lines : []), { display: sideLine }, checkInLine];
  useEntryLines(voice, all, true);
  const current = voice.current !== null && voice.current < lines.length && screen ? voice.current : null;
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
      onBack={() => dispatch({ type: "BACK" })}
      footer={{
        primary: {
          label: CHECK_DATA.helperBriefing.confirmButton[lang],
          onClick: () => dispatch({ type: "PREP_NEXT" }),
        },
      }}
    >
      <div className="flow-stack" data-screen="S26">
        <h1>{CHECK_DATA.helperBriefing.heading[lang]}</h1>
        <p className="check-meta">{t(lang, "assessment.helper.askToRead")}</p>
        {screen && (
          <TopDownDrawing
            alt={t(
              lang,
              screen === "scr_helper_brief_stand"
                ? "assessment.helper.altStand"
                : "assessment.helper.altTrunk",
            )}
            weaker={weaker}
            stand={screen === "scr_helper_brief_stand"}
          />
        )}
        {screen && <SentenceStack text={body} current={current} size={20} />}
        <p className="flow-strong flow-side-line">{bidiText(lang, sideLine)}</p>
        <div className="flow-sentences is-20">
          <p
            aria-current={voice.current === all.length - 1 ? "true" : undefined}
            className={voice.current === all.length - 1 ? "is-current" : undefined}
          >
            {bidiText(lang, checkInLine.display)}
          </p>
        </div>
        <ListenButton onClick={() => void voice.play(all)} />
      </div>
    </CheckShell>
  );
}
